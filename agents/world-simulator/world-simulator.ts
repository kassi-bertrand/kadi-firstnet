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
  type SuppressFireRequest,
  type SuppressFireResponse,
  type SpawnHazardRequest,
  type SpawnHazardResponse,
  WhatDoISeeRequestSchema,
  MoveMeRequestSchema,
  SpawnAgentRequestSchema,
  GetAgentPositionRequestSchema,
  SuppressFireRequestSchema,
  SpawnHazardRequestSchema,
  AgentStateSchema
} from './types.js';

const log = debug('world-simulator');
const TRACE_FIRE_ID = process.env.FIRE_TRACE_ID;
// Prefer remote broker by default; allow override via env
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://kadi.build:8080';

// Waypoint simplification: minimum distance between waypoints in meters
// Lower = more detailed path, Higher = smoother but less accurate
// Try values: 5m (detailed), 10m (balanced), 20m (smooth), 50m (very sparse)
const MIN_WAYPOINT_DISTANCE = Number(process.env.MIN_WAYPOINT_DISTANCE) || 50 // meters - adjust this to control sparsity!

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
  private instanceId: string = process.env.WORLD_INSTANCE_ID || uuidv4();
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
        local: 'ws://localhost:8080',
        remote: brokerUrl
      },
      defaultBroker: 'remote',
      networks: ['global']
    });

    this.setupDefaultLocations();
    log(`World Simulator initialized (instanceId=${this.instanceId}, broker remote=${brokerUrl}, default=remote)`);

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

    // Register suppressFire tool
    try {
      this.client.registerTool('suppressFire', async (params: unknown) => {
      try {
        const request = SuppressFireRequestSchema.parse(params);
        log(`🚿 Received suppressFire request from agent: ${request.agentId} targeting fire: ${request.fireId}`);
        return await this.handleSuppressFire(request);
      } catch (error) {
        return {
          success: false,
          fireExtinguished: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
      });
      log('✅ Registered tool: suppressFire');
    } catch (error) {
      log('❌ Failed to register suppressFire:', error);
      throw new Error(`Broker rejected suppressFire registration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Register despawnAgent tool
    try {
      this.client.registerTool('despawnAgent', async (params: unknown) => {
        try {
          const { agentId } = params as { agentId: string };
          log(`🛫 Received despawnAgent request for agent: ${agentId}`);
          return await this.handleDespawnAgent(agentId);
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      log('✅ Registered tool: despawnAgent');
    } catch (error) {
      log('❌ Failed to register despawnAgent:', error);
      throw new Error(`Broker rejected despawnAgent registration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Register spawnHazard tool
    try {
      this.client.registerTool('spawnHazard', async (params: unknown) => {
        try {
          const request = SpawnHazardRequestSchema.parse(params);
          log(`🔥 Received spawnHazard request: ${request.type} hazard ${request.hazardId} at ${request.position.lat}, ${request.position.lon}`);
          return await this.handleSpawnHazard(request);
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      log('✅ Registered tool: spawnHazard');
    } catch (error) {
      log('❌ Failed to register spawnHazard:', error);
      throw new Error(`Broker rejected spawnHazard registration: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

    // Log fire IDs for debugging
    const fireIds = response.hazards
      .filter(h => h.type === 'fire')
      .map(h => h.id);
    if (fireIds.length > 0) {
      log(`${request.agentId} sees fires with IDs: ${fireIds.join(', ')}`);
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
    log(`Simplified route has ${routingResult.waypoints?.length || 0} waypoints (MIN_DISTANCE=${MIN_WAYPOINT_DISTANCE}m)`)

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

    // Also emit initial position update so agent appears on map immediately
    this.client.publishEvent('agent.position.updated', {
      agentId: request.agentId,
      lat: request.position.lat,
      lon: request.position.lon,
      moving: false,
      status: request.status,
      type: request.type,
      time: currentTime,
      tick: this.tickCounter
    });

    const lifetimeInfo = request.lifetime ? ` (lifetime: ${request.lifetime / 1000}s)` : '';
    log(`Spawned ${request.agentId} at ${request.position.lat}, ${request.position.lon}${lifetimeInfo}`);
    return { success: true };
  }

  private async handleDespawnAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    const agent = this.worldState.agents.get(agentId);
    if (!agent) {
      return {
        success: false,
        error: 'Agent not found'
      };
    }

    // Remove agent from world state
    this.worldState.agents.delete(agentId);
    this.worldState.activeMovements.delete(agentId);

    // Emit despawn event (non-blocking)
    this.publishInformationalEvent('world.agent.despawned', {
      agentId,
      type: agent.type,
      position: agent.position,
      timestamp: Date.now()
    });

    log(`🛫 Despawned agent: ${agentId}`);
    return { success: true };
  }

  /**
   * Non-blocking event publish with error handling for informational events
   */
  private publishInformationalEvent(eventName: string, data: any): void {
    try {
      this.client.publishEvent(eventName, data);
    } catch (error) {
      log(`⚠️ Failed to publish ${eventName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      // Don't throw - just log and continue
    }
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
   * Simplify waypoints by removing points that are too close together
   */
  private simplifyWaypoints(waypoints: Position[], minDistance: number = MIN_WAYPOINT_DISTANCE): Position[] {
    if (waypoints.length <= 2) return waypoints;

    const simplified: Position[] = [waypoints[0]]; // Always keep the first point
    let lastKeptPoint = waypoints[0];

    for (let i = 1; i < waypoints.length - 1; i++) {
      const currentPoint = waypoints[i];
      const distance = this.calculateDistance(lastKeptPoint, currentPoint);

      // Only keep this point if it's far enough from the last kept point
      if (distance >= minDistance) {
        simplified.push(currentPoint);
        lastKeptPoint = currentPoint;
      }
    }

    // Always keep the last point to ensure we reach the exact destination
    const lastPoint = waypoints[waypoints.length - 1];
    if (this.calculateDistance(lastKeptPoint, lastPoint) > 0.001) {
      simplified.push(lastPoint);
    }

    return simplified;
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

      // Simplify waypoints to reduce density
      const originalCount = waypoints.length;
      waypoints = this.simplifyWaypoints(waypoints, MIN_WAYPOINT_DISTANCE);

      if (originalCount > waypoints.length) {
        log(`Simplified waypoints from ${originalCount} to ${waypoints.length} (removed ${originalCount - waypoints.length} points)`);

        // Recalculate segment durations after simplification
        if (waypoints.length > 1) {
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
          status: agent.status,
          type: agent.type,
          time: currentTime,
          tick: this.tickCounter
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
        // Include velocity for client-side prediction
        const velocity = from && to ? {
          lat: (to.lat - from.lat) * (1000 / movement.duration), // lat/second
          lon: (to.lon - from.lon) * (1000 / movement.duration)  // lon/second
        } : undefined;

        this.client.publishEvent('agent.position.updated', {
          agentId,
          lat: position.lat,
          lon: position.lon,
          moving: true,
          status: agent.status,
          type: agent.type,
          time: currentTime,
          tick: this.tickCounter,
          ...(velocity ? { velocity } : {}),
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
    const hazardsToDelete: Array<{ hazardId: string; position: Position }> = [];

    for (const [hazardId, hazard] of this.worldState.hazards) {
      if (hazard.type === 'fire') {
        const timeSinceUpdate = (currentTime - hazard.lastUpdated) / 1000;

        // Only update growing/shrinking fires that still have intensity
        if (hazard.intensity > 0) {
          // Fire grows only when there is no suppression; any suppression causes decline
          if (hazard.suppressionEffort > 0) {
            // Stronger suppression reduces faster
            hazard.intensity = Math.max(0, hazard.intensity - 0.02 * timeSinceUpdate * Math.max(0.1, hazard.suppressionEffort));
          } else {
            // No suppression applied → slow growth and spread
            hazard.intensity = Math.min(1.0, hazard.intensity + 0.01 * timeSinceUpdate);
            hazard.radius = Math.min(100, hazard.radius + hazard.spreadRate * timeSinceUpdate);
          }

          hazard.lastUpdated = currentTime;
        }

        // Check if fire should be removed (intensity dropped to 0 or below)
        if (hazard.intensity <= 0) {
          hazardsToDelete.push({ hazardId, position: hazard.position });
          // Send final update with intensity 0 before removal
          this.client.publishEvent('world.hazard.fire.updated', {
            instanceId: this.instanceId,
            hazardId,
            position: hazard.position,
            intensity: 0,
            radius: 0,
            suppressionEffort: hazard.suppressionEffort,
            time: currentTime,
            tick: this.tickCounter
          });
          if (TRACE_FIRE_ID && hazardId === TRACE_FIRE_ID) {
            log(`TRACE fire ${hazardId}: published intensity=0 before removal (tick=${this.tickCounter})`);
          }
          continue;  // Don't send normal update for extinguished fires
        }

        this.client.publishEvent('world.hazard.fire.updated', {
          instanceId: this.instanceId,
          hazardId,
          position: hazard.position,
          intensity: hazard.intensity,
          radius: hazard.radius,
          suppressionEffort: hazard.suppressionEffort,
          time: currentTime,
          tick: this.tickCounter
        });
        if (TRACE_FIRE_ID && hazardId === TRACE_FIRE_ID) {
          log(`TRACE fire ${hazardId}: published updated intensity=${hazard.intensity.toFixed(2)} (tick=${this.tickCounter})`);
        }

        // Also publish as fire agent update for frontend visualization
        this.client.publishEvent('fire.updated', {
          instanceId: this.instanceId,
          id: hazardId,
          type: 'fire',
          longitude: hazard.position.lon,
          latitude: hazard.position.lat,
          intensity: hazard.intensity,  // Include intensity!
          event: 'fire.updated',
          time: currentTime
        });
      }
    }

    // Remove extinguished fires from world state
    for (const item of hazardsToDelete) {
      this.worldState.hazards.delete(item.hazardId);
      log(`🔥💀 Removed extinguished fire ${item.hazardId} from world state`);
      // Emit explicit removed event to help downstream consumers
      this.client.publishEvent('world.hazard.fire.removed', {
        instanceId: this.instanceId,
        hazardId: item.hazardId,
        position: item.position,
        time: currentTime,
        tick: this.tickCounter
      });
      if (TRACE_FIRE_ID && item.hazardId === TRACE_FIRE_ID) {
        log(`TRACE fire ${item.hazardId}: removed from world state (tick=${this.tickCounter})`);
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

        // Emit expiration event (non-blocking)
        this.publishInformationalEvent('world.agent.expired', {
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
            status: agent.status,
            type: agent.type,
            time: currentTime,
            tick: this.tickCounter
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
        status: a.status,
        type: a.type
      }));
      
      this.client.publishEvent('world.positions.batch', {
        time: currentTime,
        tick: this.tickCounter,
        agents
      });
    }

    // Publish world tick (non-blocking - critical for maintaining tick rate)
    this.publishInformationalEvent('world.tick', {
      time: currentTime,
      tick: this.tickCounter,
      dt: 0.1
    });
  }

  private async handleSuppressFire(request: SuppressFireRequest): Promise<SuppressFireResponse> {
    log(`🚿 Agent ${request.agentId} attempting to suppress fire ${request.fireId}`);

    // Log all current fire IDs for debugging
    const currentFireIds = Array.from(this.worldState.hazards.keys()).filter(id => {
      const h = this.worldState.hazards.get(id);
      return h && h.type === 'fire';
    });
    log(`Current fire IDs in world: ${currentFireIds.join(', ') || 'none'}`);

    // Check if fire exists
    const fire = this.worldState.hazards.get(request.fireId);
    if (!fire || fire.type !== 'fire') {
      log(`❌ Fire ${request.fireId} not found. Available fires: ${currentFireIds.join(', ')}`);
      return {
        success: false,
        fireExtinguished: false,
        error: 'Fire not found'
      };
    }

    // Check if agent exists and is close enough to the fire
    const agent = this.worldState.agents.get(request.agentId);
    if (!agent) {
      return {
        success: false,
        fireExtinguished: false,
        error: 'Agent not found'
      };
    }

    // Calculate distance between agent and fire
    const distance = this.calculateDistance(agent.position, fire.position);
    const maxSuppressionRange = 45; // meters - increased to handle pathfinding constraints

    if (distance > maxSuppressionRange) {
      return {
        success: false,
        fireExtinguished: false,
        error: `Too far from fire (${distance.toFixed(1)}m > ${maxSuppressionRange}m)`
      };
    }

    // Apply suppression to the fire
    const suppressionRate = request.suppressionRate || 0.2;
    const newIntensity = Math.max(0, fire.intensity - suppressionRate);

    log(`🚿 Suppressing fire ${request.fireId}: ${fire.intensity.toFixed(2)} → ${newIntensity.toFixed(2)} (rate: ${suppressionRate})`);

    // Update fire state
    fire.intensity = newIntensity;
    fire.suppressionEffort = Math.min(1, fire.suppressionEffort + suppressionRate);
    fire.lastUpdated = Date.now();

    // Check if fire is extinguished
    const fireExtinguished = newIntensity <= 0.05; // Consider extinguished at 5% intensity

    if (fireExtinguished) {
      log(`🎉 Fire ${request.fireId} extinguished by agent ${request.agentId}!`);

      // Set intensity to 0 but DON'T delete yet - let updateHazards handle it
      fire.intensity = 0;
      fire.suppressionEffort = 1;

      // Emit world.hazard.fire.updated with intensity 0 (non-blocking)
      const time = Date.now();
      const tick = this.tickCounter;
      this.publishInformationalEvent('world.hazard.fire.updated', {
        instanceId: this.instanceId,
        hazardId: request.fireId,
        position: fire.position,
        intensity: 0,
        radius: 0,
        suppressionEffort: 1,
        time,
        tick
      });
      if (TRACE_FIRE_ID && request.fireId === TRACE_FIRE_ID) {
        log(`TRACE fire ${request.fireId}: suppressFire emitted intensity=0 (tick=${tick})`);
      }

      // Emit fire extinguished event (non-blocking)
      this.publishInformationalEvent('fire.extinguished', {
        instanceId: this.instanceId,
        fireId: request.fireId,
        extinguishedBy: request.agentId,
        position: fire.position,
        timestamp: time,
        time,
        tick
      });

      // Also emit updated fire event for frontend (intensity 0) - non-blocking
      this.publishInformationalEvent('fire.updated', {
        instanceId: this.instanceId,
        id: request.fireId,
        longitude: fire.position.lon,
        latitude: fire.position.lat,
        intensity: 0,
        event: 'fire.updated',
        time
      });
      if (TRACE_FIRE_ID && request.fireId === TRACE_FIRE_ID) {
        log(`TRACE fire ${request.fireId}: emitted fire.updated intensity=0`);
      }

      return {
        success: true,
        fireExtinguished: true,
        remainingIntensity: 0
      };
    } else {
      // Fire still burning but weakened (non-blocking)
      this.publishInformationalEvent('fire.updated', {
        instanceId: this.instanceId,
        id: request.fireId,
        longitude: fire.position.lon,
        latitude: fire.position.lat,
        intensity: newIntensity,
        event: 'fire.updated',
        time: Date.now()
      });
      if (TRACE_FIRE_ID && request.fireId === TRACE_FIRE_ID) {
        log(`TRACE fire ${request.fireId}: suppressFire emitted fire.updated intensity=${newIntensity.toFixed(2)}`);
      }

      return {
        success: true,
        fireExtinguished: false,
        remainingIntensity: newIntensity
      };
    }
  }

  private async handleSpawnHazard(request: SpawnHazardRequest): Promise<SpawnHazardResponse> {
    log(`🔥 Creating ${request.type} hazard: ${request.hazardId}`);

    // Check if hazard already exists
    if (this.worldState.hazards.has(request.hazardId)) {
      return {
        success: false,
        error: `Hazard ${request.hazardId} already exists`
      };
    }

    const currentTime = Date.now();

    // Create hazard state
    const hazard: HazardState = {
      hazardId: request.hazardId,
      type: request.type,
      position: request.position,
      intensity: request.intensity,
      radius: request.radius,
      fireIntensity: request.fireIntensity || (request.type === 'fire' ? 'developing' : undefined),
      spreadRate: request.spreadRate || (request.type === 'fire' ? 0.3 : 0),
      suppressionEffort: 0,
      createdAt: currentTime,
      lastUpdated: currentTime
    };

    // Add to world state
    this.worldState.hazards.set(request.hazardId, hazard);

    // Emit appropriate spawn events based on hazard type (non-blocking to prevent movement interference)
    if (request.type === 'fire') {
      // Fire-specific events - don't await to prevent blocking agent movements
      this.client.publishEvent('world.hazard.fire.spawned', {
        instanceId: this.instanceId,
        hazardId: request.hazardId,
        type: 'fire',
        position: hazard.position,
        intensity: hazard.intensity,
        radius: hazard.radius,
        time: currentTime,
        tick: this.tickCounter
      });

      // Also publish as fire agent for frontend visualization
      this.client.publishEvent('fire.spawned', {
        instanceId: this.instanceId,
        id: request.hazardId,
        type: 'fire',
        longitude: hazard.position.lon,
        latitude: hazard.position.lat,
        event: 'fire.spawned',
        time: currentTime
      });
    } else {
      // Generic hazard spawn event for non-fire hazards
      this.client.publishEvent('world.hazard.spawned', {
        instanceId: this.instanceId,
        hazardId: request.hazardId,
        type: request.type,
        position: hazard.position,
        intensity: hazard.intensity,
        radius: hazard.radius,
        time: currentTime,
        tick: this.tickCounter
      });
    }

    log(`✅ Spawned ${request.type} hazard ${request.hazardId} at ${request.position.lat}, ${request.position.lon} (intensity: ${request.intensity}, radius: ${request.radius}m)`);
    return { success: true };
  }

  public async spawnFirefightersAtStations(): Promise<void> {
    // List of some Dallas fire stations (lat/lon)
    const fireStations = [
      { name: 'Station 1 - SMU North', lat: 32.8440, lon: -96.7830 },
      { name: 'Station 2 - SMU East', lat: 32.8425, lon: -96.7805 },
      { name: 'Station 5 - SMU South', lat: 32.8385, lon: -96.7855 },
      { name: 'Station 11 - SMU West', lat: 32.8400, lon: -96.7880 },
      { name: 'Station 18 - SMU Center', lat: 32.8410, lon: -96.7840 }
    ];
    
  
    for (const station of fireStations) {
      for (let i = 0; i < 2; i++) { // spawn 2 firefighters per station
        const agentId = `ff_${station.name.replace(/\s+/g, '_')}_${i + 1}_${Date.now()}`;
  
        try {
          const result = await this.client.callTool('world-simulator', 'spawnAgent', {
            agentId,
            type: 'firefighter',
            position: { lat: station.lat, lon: station.lon },
            status: 'available'
          }) as any;
  
          if (result.success) {
            console.log(`🚒 Spawned firefighter ${agentId} at ${station.name} (${station.lat.toFixed(4)}, ${station.lon.toFixed(4)})`);
          } else {
            console.warn(`⚠️ Failed to spawn firefighter ${agentId}: ${result.error}`);
          }
  
          // Small delay to prevent race conditions
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`❌ Error spawning firefighter ${agentId}:`, err);
        }
      }
    }
  
    console.log(`✅ All firefighters spawned at Dallas fire stations (2 per station)`);
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
      setTimeout(() => this.spawnFirefightersAtStations(), 2000);

      const result = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: 'commander1',
        type: 'commander',
        position: { lat: 32.7767, lon: -96.797 },
        status: 'available'
      });
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
