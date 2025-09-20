#!/usr/bin/env node

import { KadiClient } from '@kadi.build/core';
import { v4 as uuidv4 } from 'uuid';
import debug from 'debug';
import {
  type AgentState,
  type HazardState,
  type Position,
  type Location,
  type WhatDoISeeRequest,
  type WhatDoISeeResponse,
  type MoveMeRequest,
  type MoveMeResponse,
  type SpawnAgentRequest,
  type SpawnAgentResponse,
  WhatDoISeeRequestSchema,
  MoveMeRequestSchema,
  SpawnAgentRequestSchema,
  GetAgentPositionRequestSchema,
  AgentStateSchema
} from './types.js';

const log = debug('world-simulator');
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';

/**
 * World Simulator Agent - Central Authority for Emergency Simulation
 *
 * Single source of truth for:
 * - Agent positions and movement
 * - Hazard locations and evolution
 * - Realistic pathfinding and simulation
 */
export class WorldSimulatorAgent {
  private client: KadiClient;
  private worldState = {
    agents: new Map<string, AgentState>(),
    hazards: new Map<string, HazardState>(),
    locations: new Map<string, Location>(),
    activeMovements: new Map<string, {
      startTime: number;
      duration: number;
      waypoints: Position[];  // Array of waypoints to follow
      currentSegment: number; // Which segment we're on
      totalDistance: number;  // Total route distance
      // Optional per-segment durations (ms) matching waypoints[i] -> waypoints[i+1]
      segmentDurations?: number[];
    }>()
  };
  private tickCounter = 0;
  private isRunning = false;
  // Simulation/update configuration
  private simHz = 10; // ticks per second
  private batchHz = Math.max(0, Number(process.env.WORLD_BATCH_HZ ?? 2));
  private batchEveryTicks = 0; // computed from simHz and batchHz
  private stationaryHz = Math.max(0, Number(process.env.WORLD_STATIONARY_HZ ?? 0));
  private stationaryEveryTicks = 0; // computed from simHz and stationaryHz

  constructor() {
    this.client = new KadiClient({
      name: 'world-simulator',
      role: 'agent',
      transport: 'broker',
      brokers: { 
        local: brokerUrl,
        remote: "ws://kadi.build:8080"
      },
      defaultBroker: 'remote',
      networks: ['global']
    });

    this.setupDefaultLocations();
    log('World Simulator initialized');

    // Compute tick gating based on env-configurable rates
    this.batchEveryTicks = this.batchHz > 0 ? Math.max(1, Math.round(this.simHz / this.batchHz)) : 0;
    this.stationaryEveryTicks = this.stationaryHz > 0 ? Math.max(1, Math.round(this.simHz / this.stationaryHz)) : 0;
    if (this.batchEveryTicks > 0) {
      log(`Batch positions stream enabled at ${this.batchHz} Hz (every ${this.batchEveryTicks} ticks)`);
    } else {
      log('Batch positions stream disabled');
    }
    if (this.stationaryEveryTicks > 0) {
      log(`Stationary per-agent updates enabled at ${this.stationaryHz} Hz (every ${this.stationaryEveryTicks} ticks)`);
    } else {
      log('Stationary per-agent updates disabled');
    }
  }

  private setupDefaultLocations(): void {
    const locations: Location[] = [
      {
        id: 'downtown-safety',
        position: { lat: 32.7767, lon: -96.7970 },
        name: 'Downtown Safety Zone',
        type: 'staging_area'
      },
      {
        id: 'deep-ellum-exit',
        position: { lat: 32.7825, lon: -96.7849 },
        name: 'Deep Ellum Exit',
        type: 'exit'
      },
      {
        id: 'parkland-hospital',
        position: { lat: 32.7885, lon: -96.8414 },
        name: 'Parkland Hospital',
        type: 'hospital'
      }
    ];

    locations.forEach(loc => this.worldState.locations.set(loc.id, loc));
    log(`Initialized ${locations.length} Dallas locations`);
  }

  private async registerTools(): Promise<void> {
    // Register world.whatDoISee tool
    try {
      this.client.registerTool('whatDoISee', async (params: unknown) => {
      try {
        const request = WhatDoISeeRequestSchema.parse(params);
        log(`📡 Received whatDoISee request from agent: ${request.agentId}, visionRange: ${request.visionRange}m`);
        return await this.handleWhatDoISee(request);
      } catch (error) {
        log(`❌ whatDoISee error:`, error);
        return {
          agents: [],
          hazards: [],
          exits: [],
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
      });
      log('✅ Registered tool: whatDoISee');
    } catch (error) {
      log('❌ Failed to register whatDoISee:', error);
      throw new Error(`Broker rejected whatDoISee registration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Register world.moveMe tool
    try {
      this.client.registerTool('moveMe', async (params: unknown) => {
      try {
        const request = MoveMeRequestSchema.parse(params);
        log(`🚶 Received moveMe request from agent: ${request.agentId} → ${request.destination.lat}, ${request.destination.lon} (${request.profile})`);
        const result = await this.handleMoveMe(request);
        if (result.success) {
          log(`✅ Movement started for ${request.agentId}, duration: ${result.estimatedDuration?.toFixed(1)}s`);
        }
        return result;
      } catch (error) {
        log(`❌ moveMe error:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
      });
      log('✅ Registered tool: moveMe');
    } catch (error) {
      log('❌ Failed to register moveMe:', error);
      throw new Error(`Broker rejected moveMe registration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Register world.spawnAgent tool
    try {
      this.client.registerTool('spawnAgent', async (params: unknown) => {
      try {
        const request = SpawnAgentRequestSchema.parse(params);
        return await this.handleSpawnAgent(request);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
      });
      log('✅ Registered tool: spawnAgent');
    } catch (error) {
      log('❌ Failed to register spawnAgent:', error);
      throw new Error(`Broker rejected spawnAgent registration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Register world.getAgentPosition tool
    try {
      this.client.registerTool('getAgentPosition', async (params: unknown) => {
      try {
        const request = GetAgentPositionRequestSchema.parse(params);
        const agent = this.worldState.agents.get(request.agentId);

        return agent ? {
          position: agent.position,
          moving: agent.moving,
          status: agent.status,
          success: true
        } : {
          success: false,
          error: 'Agent not found'
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
      });
      log('✅ Registered tool: getAgentPosition');
    } catch (error) {
      log('❌ Failed to register getAgentPosition:', error);
      throw new Error(`Broker rejected getAgentPosition registration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    log('✅ All KADI tools registered successfully');
  }

  private async handleWhatDoISee(request: WhatDoISeeRequest): Promise<WhatDoISeeResponse> {
    const agent = this.worldState.agents.get(request.agentId);
    if (!agent) {
      return {
        agents: [],
        hazards: [],
        exits: [],
        success: false,
        error: 'Agent not found'
      };
    }

    const response: WhatDoISeeResponse = {
      agents: [],
      hazards: [],
      exits: [],
      success: true
    };

    // Find visible agents
    for (const [otherId, otherAgent] of this.worldState.agents) {
      if (otherId === request.agentId) continue;

      const distance = this.calculateDistance(agent.position, otherAgent.position);
      if (distance <= request.visionRange) {
        response.agents.push({
          id: otherId,
          type: otherAgent.type,
          distance,
          position: otherAgent.position,
          isMoving: otherAgent.moving,
          status: otherAgent.status
        });
      }
    }

    // Find visible hazards
    for (const [hazardId, hazard] of this.worldState.hazards) {
      const distance = this.calculateDistance(agent.position, hazard.position);
      if (distance <= request.visionRange || distance <= hazard.radius) {
        response.hazards.push({
          id: hazardId,
          type: hazard.type,
          distance,
          position: hazard.position,
          intensity: hazard.intensity,
          radius: hazard.radius
        });
      }
    }

    // Find visible exits
    for (const [locationId, location] of this.worldState.locations) {
      if (location.type === 'exit' || location.type === 'staging_area') {
        const distance = this.calculateDistance(agent.position, location.position);
        if (distance <= request.visionRange * 2) {
          response.exits.push({
            id: locationId,
            type: location.type,
            distance,
            position: location.position,
            name: location.name
          });
        }
      }
    }

    log(`${request.agentId} sees: ${response.agents.length} agents, ${response.hazards.length} hazards, ${response.exits.length} exits`);
    return response;
  }

  private async handleMoveMe(request: MoveMeRequest): Promise<MoveMeResponse> {
    const agent = this.worldState.agents.get(request.agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // Get real routing data from OSRM or fallback to straight-line
    const routingResult = await this.getOSRMRoute(
      agent.position,
      request.destination,
      request.profile
    );
    log(`Raw OSRM response: ${JSON.stringify(routingResult.waypoints, null, 2)}`)

    let distance = routingResult.distance;
    let baseDuration = routingResult.duration;

    // Apply urgency multipliers to the OSRM-calculated duration
    let duration = baseDuration;
    if (request.urgency === 'urgent') duration *= 0.75;      // 25% faster
    if (request.urgency === 'emergency') duration *= 0.5;    // 50% faster

    // If user specified a custom speed, override the calculation
    if (request.speed) {
      const speedMap = {
        walking: 1.4,    // m/s
        driving: 8.0,    // m/s
        emergency: 12.0  // m/s
      };

      const defaultSpeed = speedMap[request.profile];
      const speedMultiplier = request.speed / defaultSpeed;
      duration = baseDuration / speedMultiplier;
    }

    const estimatedArrival = Date.now() + (duration * 1000);

    // Store movement with waypoints for realistic pathing
    const waypoints = routingResult.waypoints || [agent.position, request.destination];
    // Scale per-segment durations (if any) to match adjusted total duration
    let segmentDurationsMs: number[] | undefined = undefined;
    if (routingResult.segmentDurations && routingResult.segmentDurations.length === Math.max(0, waypoints.length - 1)) {
      const scale = baseDuration > 0 ? (duration / baseDuration) : 1;
      segmentDurationsMs = routingResult.segmentDurations.map(s => s * scale * 1000);
    }

    this.worldState.activeMovements.set(request.agentId, {
      startTime: Date.now(),
      duration: duration * 1000,
      waypoints: waypoints,
      currentSegment: 0,
      totalDistance: distance,
      segmentDurations: segmentDurationsMs
    });

    // Update agent
    agent.moving = true;
    agent.destination = request.destination;
    agent.speed = distance / duration; // actual speed based on route
    agent.lastUpdated = Date.now();

    const routingMethod = routingResult.success ? 'OSRM' : 'fallback';
    log(`${request.agentId} moving ${distance.toFixed(0)}m in ${duration.toFixed(1)}s (${routingMethod} routing)`);

    return {
      success: true,
      estimatedArrival,
      estimatedDuration: duration
    };
  }

  private async handleSpawnAgent(request: SpawnAgentRequest): Promise<SpawnAgentResponse> {
    if (this.worldState.agents.has(request.agentId)) {
      return { success: false, error: 'Agent already exists' };
    }

    const currentTime = Date.now();
    const agentState: AgentState = {
      agentId: request.agentId,
      type: request.type,
      position: request.position,
      status: request.status,
      moving: false,
      speed: 1.4,
      spawnedAt: currentTime,
      lifetime: request.lifetime,
      lastUpdated: currentTime
    };

    this.worldState.agents.set(request.agentId, agentState);

    this.client.publishEvent('world.agent.spawned', {
      agentId: request.agentId,
      type: request.type,
      position: request.position,
      status: request.status
    });

    const lifetimeInfo = request.lifetime ? ` (lifetime: ${request.lifetime / 1000}s)` : '';
    log(`Spawned ${request.agentId} at ${request.position.lat}, ${request.position.lon}${lifetimeInfo}`);
    return { success: true };
  }

  private calculateDistance(pos1: Position, pos2: Position): number {
    const earthRadiusMeters = 6371e3; // Earth's radius in meters

    // Convert degrees to radians
    const lat1Radians = pos1.lat * Math.PI / 180;
    const lat2Radians = pos2.lat * Math.PI / 180;
    const deltaLatRadians = (pos2.lat - pos1.lat) * Math.PI / 180;
    const deltaLonRadians = (pos2.lon - pos1.lon) * Math.PI / 180;

    // Haversine formula
    const a = Math.sin(deltaLatRadians / 2) * Math.sin(deltaLatRadians / 2) +
      Math.cos(lat1Radians) * Math.cos(lat2Radians) *
      Math.sin(deltaLonRadians / 2) * Math.sin(deltaLonRadians / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusMeters * c;
  }

  /**
   * Decode OSRM polyline geometry into waypoints
   */
  private decodePolyline(encoded: string, precision: number = 5): Position[] {
    const waypoints: Position[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const factor = Math.pow(10, precision);

    while (index < encoded.length) {
      let b: number;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const deltaLat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
      lat += deltaLat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const deltaLng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
      lng += deltaLng;

      waypoints.push({
        lat: lat / factor,
        lon: lng / factor
      });
    }

    return waypoints;
  }

  /**
   * Get real routing data from OSRM service (using driving data for all requests)
   */
  private async getOSRMRoute(from: Position, to: Position, profile: 'walking' | 'driving'): Promise<{
    distance: number;        // meters
    duration: number;        // seconds
    waypoints?: Position[];  // decoded full route polyline
    segmentDurations?: number[]; // seconds per segment between consecutive waypoints
    success: boolean;
    error?: string;
  }> {
    try {
      // OSRM expects longitude,latitude format
      const fromCoord = `${from.lon},${from.lat}`;
      const toCoord = `${to.lon},${to.lat}`;

      // Always use driving profile since we only have car routing set up
      // We'll treat walking as slower movement on the same roads
      const osrmProfile = 'driving';
      const osrmHost = '54.164.27.226:5000';

      // Request high-precision geometry and per-step data
      const url = `http://${osrmHost}/route/v1/${osrmProfile}/${fromCoord};${toCoord}?overview=full&steps=true&geometries=polyline6&annotations=distance,duration`;

      log(`OSRM request: ${url}`);

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`OSRM HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(`OSRM routing failed: ${data.message || 'No route found'}`);
      }

      const route = data.routes[0];

      // Prefer building waypoints and per-segment durations from steps so we can
      // vary speed per step. Fall back to full route geometry when needed.
      let waypoints: Position[] = [];
      let segmentDurations: number[] | undefined = undefined;

      if (route.legs && route.legs.length > 0 && route.legs[0].steps && route.legs[0].steps.length > 0) {
        segmentDurations = [];
        for (const leg of route.legs) {
          for (const step of leg.steps) {
            if (!step.geometry) continue;
            const stepPts: Position[] = this.decodePolyline(step.geometry, 6);
            if (stepPts.length === 0) continue;

            // Append step points, avoiding duplicate at join boundaries
            if (waypoints.length === 0) {
              waypoints.push(...stepPts);
            } else {
              // If first of this step equals last of previous, skip it
              const last = waypoints[waypoints.length - 1];
              const first = stepPts[0];
              const same = Math.abs(last.lat - first.lat) < 1e-9 && Math.abs(last.lon - first.lon) < 1e-9;
              waypoints.push(...(same ? stepPts.slice(1) : stepPts));
            }

            // Distribute the step duration across its subsegments proportionally to distance
            if (stepPts.length > 1) {
              const segDists: number[] = [];
              let stepDist = 0;
              for (let i = 0; i < stepPts.length - 1; i++) {
                const d = this.calculateDistance(stepPts[i], stepPts[i + 1]);
                segDists.push(d);
                stepDist += d;
              }
              if (stepDist <= 0) {
                // Edge case: zero-length geometry; divide evenly
                const even = (step.duration || 0) / (stepPts.length - 1);
                for (let i = 0; i < stepPts.length - 1; i++) segmentDurations.push(even);
              } else {
                for (let i = 0; i < segDists.length; i++) {
                  const frac = segDists[i] / stepDist;
                  segmentDurations.push(frac * (step.duration || 0));
                }
              }
            }
          }
        }
        log(`Decoded ${waypoints.length} waypoints from OSRM step geometries`);
      }

      // Fallback to route-level geometry if steps missing
      if ((!waypoints || waypoints.length === 0) && route.geometry) {
        waypoints = this.decodePolyline(route.geometry, 6);
        log(`Decoded ${waypoints.length} waypoints from OSRM route geometry`);
        if (waypoints.length > 1) {
          // Create segment durations proportional to distances for constant speed
          const segDists: number[] = [];
          let tot = 0;
          for (let i = 0; i < waypoints.length - 1; i++) {
            const d = this.calculateDistance(waypoints[i], waypoints[i + 1]);
            segDists.push(d);
            tot += d;
          }
          if (tot > 0) {
            segmentDurations = segDists.map(d => (d / tot) * route.duration);
          }
        }
      }

      return {
        distance: route.distance, // meters
        duration: route.duration, // seconds
        waypoints,
        segmentDurations,
        success: true
      };

    } catch (error) {
      log(`OSRM routing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Fallback to straight-line distance
      const straightLineDistance = this.calculateDistance(from, to);
      const fallbackSpeed = profile === 'driving' ? 8.0 : 1.4; // m/s

      return {
        distance: straightLineDistance,
        duration: straightLineDistance / fallbackSpeed,
        waypoints: [from, to], // Fallback to straight line
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Compute compass bearing (degrees 0..360) from point A to B
   */
  private computeBearing(a: Position, b: Position): number {
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  private updateAgentMovements(): void {
    const currentTime = Date.now();

    for (const [agentId, movement] of this.worldState.activeMovements) {
      const agent = this.worldState.agents.get(agentId);
      if (!agent) {
        this.worldState.activeMovements.delete(agentId);
        continue;
      }

      const elapsed = currentTime - movement.startTime;
      const progress = elapsed / movement.duration;

      if (progress >= 1.0) {
        // Movement completed - set to final waypoint
        const finalWaypoint = movement.waypoints[movement.waypoints.length - 1];
        agent.position = { ...finalWaypoint };
        agent.moving = false;
        agent.destination = undefined;
        agent.lastUpdated = currentTime;

        this.worldState.activeMovements.delete(agentId);

        this.client.publishEvent('agent.movement.completed', {
          agentId,
          finalPosition: agent.position,
          arrivalTime: currentTime
        });

        // Emit a single final position update for listeners expecting this stream
        this.client.publishEvent('agent.position.updated', {
          agentId,
          lat: agent.position.lat,
          lon: agent.position.lon,
          moving: false,
          status: agent.status
        });

        log(`${agentId} reached destination via ${movement.waypoints.length} waypoints`);
      } else {
        // Follow waypoints using per-segment durations if available, otherwise distance-based progress
        let position: Position;
        let from: Position | undefined;
        let to: Position | undefined;
        let segmentProgress = 0;

        if (movement.segmentDurations && movement.segmentDurations.length === Math.max(0, movement.waypoints.length - 1)) {
          // Time-based interpolation
          let elapsedInSegmentMs = elapsed;
          let segmentIndex = 0;
          for (; segmentIndex < movement.segmentDurations.length; segmentIndex++) {
            const segmentDurationMs = movement.segmentDurations[segmentIndex];
            if (elapsedInSegmentMs <= segmentDurationMs) break;
            elapsedInSegmentMs -= segmentDurationMs;
          }

          if (segmentIndex >= movement.segmentDurations.length) {
            position = movement.waypoints[movement.waypoints.length - 1];
            from = movement.waypoints[movement.waypoints.length - 2];
            to = movement.waypoints[movement.waypoints.length - 1];
            segmentProgress = 1;
          } else {
            from = movement.waypoints[segmentIndex];
            to = movement.waypoints[segmentIndex + 1];
            const segmentDurationMs = movement.segmentDurations[segmentIndex];
            segmentProgress = segmentDurationMs > 0 ? (elapsedInSegmentMs / segmentDurationMs) : 1;
            position = {
              lat: from.lat + (to.lat - from.lat) * segmentProgress,
              lon: from.lon + (to.lon - from.lon) * segmentProgress
            };
          }
        } else {
          // Distance-based interpolation along entire route
          position = this.interpolateAlongWaypoints(movement.waypoints, progress);
          // Best-effort heading using the nearest segment to progress
          // Find approximate segment index by projecting progress onto total segments
          const approxIndex = Math.max(0, Math.min(movement.waypoints.length - 2, Math.floor(progress * (movement.waypoints.length - 1))));
          from = movement.waypoints[approxIndex];
          to = movement.waypoints[approxIndex + 1];
        }

        agent.position = position;
        agent.lastUpdated = currentTime;

        // Compute heading if we have a segment
        let heading: number | undefined = undefined;
        if (from && to) {
          heading = this.computeBearing(from, to);
        }

        // Emit position update event for moving agents
        this.client.publishEvent('agent.position.updated', {
          agentId,
          lat: position.lat,
          lon: position.lon,
          moving: true,
          status: agent.status,
          ...(heading !== undefined ? { heading } : {})
        });
      }
    }
  }

  /**
   * Interpolate position along a series of waypoints based on progress (0-1)
   */
  private interpolateAlongWaypoints(waypoints: Position[], progress: number): Position {
    if (waypoints.length < 2) {
      return waypoints[0] || { lat: 0, lon: 0 };
    }

    // Calculate cumulative distances between waypoints
    const segmentDistances: number[] = [];
    let totalDistance = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const segmentDistance = this.calculateDistance(waypoints[i], waypoints[i + 1]);
      segmentDistances.push(segmentDistance);
      totalDistance += segmentDistance;
    }

    // Find which segment we should be on based on progress
    const targetDistance = progress * totalDistance;
    let cumulativeDistance = 0;

    for (let i = 0; i < segmentDistances.length; i++) {
      const segmentStart = cumulativeDistance;
      const segmentEnd = cumulativeDistance + segmentDistances[i];

      if (targetDistance <= segmentEnd) {
        // We're in this segment
        const segmentProgress = (targetDistance - segmentStart) / segmentDistances[i];

        // Interpolate within this segment
        const from = waypoints[i];
        const to = waypoints[i + 1];

        return {
          lat: from.lat + (to.lat - from.lat) * segmentProgress,
          lon: from.lon + (to.lon - from.lon) * segmentProgress
        };
      }

      cumulativeDistance += segmentDistances[i];
    }

    // If we get here, return the last waypoint
    return waypoints[waypoints.length - 1];
  }

  private updateHazards(): void {
    const currentTime = Date.now();

    for (const [hazardId, hazard] of this.worldState.hazards) {
      if (hazard.type === 'fire' && hazard.intensity > 0) {
        const timeSinceUpdate = (currentTime - hazard.lastUpdated) / 1000;

        // Fire grows unless suppressed
        if (hazard.suppressionEffort < 0.5) {
          hazard.intensity = Math.min(1.0, hazard.intensity + 0.01 * timeSinceUpdate);
          hazard.radius = Math.min(100, hazard.radius + hazard.spreadRate * timeSinceUpdate);
        } else {
          hazard.intensity = Math.max(0, hazard.intensity - 0.02 * timeSinceUpdate * hazard.suppressionEffort);
        }

        hazard.lastUpdated = currentTime;

        // this.client.publishEvent('world.hazard.fire.updated', {
        //   hazardId,
        //   position: hazard.position,
        //   intensity: hazard.intensity,
        //   radius: hazard.radius,
        //   suppressionEffort: hazard.suppressionEffort
        // });
      }
    }
  }

  private async checkAgentLifetimes(currentTime: number): Promise<void> {
    const expiredAgents: string[] = [];

    for (const [agentId, agent] of this.worldState.agents) {
      if (agent.lifetime) {
        const ageInMs = currentTime - agent.spawnedAt;
        if (ageInMs >= agent.lifetime) {
          expiredAgents.push(agentId);
        }
      }
    }

    // Remove expired agents and emit events
    for (const agentId of expiredAgents) {
      const agent = this.worldState.agents.get(agentId);
      if (agent) {
        // Remove from active movements if moving
        this.worldState.activeMovements.delete(agentId);

        // Emit expiration event
        await this.client.publishEvent('world.agent.expired', {
          agentId,
          type: agent.type,
          position: agent.position,
          lifetime: agent.lifetime!,
          reason: 'lifetime_expired'
        });

        // Remove from world state
        this.worldState.agents.delete(agentId);
        log(`Agent ${agentId} expired after ${agent.lifetime! / 1000}s`);
      }
    }
  }

  private async tick(): Promise<void> {
    const currentTime = Date.now();
    this.tickCounter++;

    this.updateAgentMovements();
    this.updateHazards();
    await this.checkAgentLifetimes(currentTime);

    // Optional: publish position updates for stationary agents at configured rate
    if (this.stationaryEveryTicks > 0 && (this.tickCounter % this.stationaryEveryTicks === 0)) {
      for (const [agentId, agent] of this.worldState.agents) {
        if (!agent.moving) {
          this.client.publishEvent('agent.position.updated', {
            agentId,
            lat: agent.position.lat,
            lon: agent.position.lon,
            moving: false,
            status: agent.status
          });
        }
      }
    }

    // Batch positions stream for dashboards
    if (this.batchEveryTicks > 0 && (this.tickCounter % this.batchEveryTicks === 0)) {
      const agents = Array.from(this.worldState.agents.entries()).map(([agentId, a]) => ({
        agentId,
        lat: a.position.lat,
        lon: a.position.lon,
        moving: a.moving,
        status: a.status
      }));
      
      this.client.publishEvent('world.positions.batch', {
        time: currentTime,
        tick: this.tickCounter,
        agents
      });
    }

    // Publish world tick
    // await this.client.publishEvent('world.tick', {
    //   time: currentTime,
    //   tick: this.tickCounter,
    //   dt: 0.1
    // });
  }

  public async createSampleFire(): Promise<void> {
    const fireId = uuidv4();
    const fire: HazardState = {
      hazardId: fireId,
      type: 'fire',
      position: { lat: 32.7825, lon: -96.7849 }, // Deep Ellum
      intensity: 0.6,
      radius: 25,
      fireIntensity: 'developing',
      spreadRate: 0.5,
      suppressionEffort: 0,
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };

    this.worldState.hazards.set(fireId, fire);

    this.client.publishEvent('world.hazard.fire.spawned', {
      hazardId: fireId,
      type: 'fire',
      position: fire.position,
      intensity: fire.intensity,
      radius: fire.radius
    });

    log(`Created sample fire in Deep Ellum`);
  }

  public async start(): Promise<void> {
    try {
      log('🛠️ Registering tools with KadiClient...');
      await this.registerTools();
      log('✅ Tools registered locally');

      log('🔌 Connecting to KADI broker...');
      await this.client.connectToBrokers();
      log('✅ Connected to KADI broker successfully - tools sent to broker');

      log('🌍 World Simulator connected and ready to receive requests!');

      // Create sample fire
      setTimeout(() => this.createSampleFire(), 2000);

      // Start 10 FPS simulation
      this.isRunning = true;
      const tickInterval = setInterval(async () => {
        if (!this.isRunning) {
          clearInterval(tickInterval);
          return;
        }

        try {
          await this.tick();
        } catch (error) {
          log('Tick error:', error);
        }
      }, 100);

      log('Simulation started at 10 FPS');

    } catch (error) {
      log('❌ Failed to start World Simulator:', error);
      if (error instanceof Error) {
        log('❌ Error details:', error.message);
        if (error.stack) {
          log('❌ Stack trace:', error.stack);
        }
      }
      process.exit(1);
    }
  }

  public stop(): void {
    this.isRunning = false;
    log('World Simulator stopped');
  }
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const worldSimulator = new WorldSimulatorAgent();

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    worldSimulator.stop();
    process.exit(0);
  });

  worldSimulator.start().catch(error => {
    console.error('Startup failed:', error);
    process.exit(1);
  });
}
