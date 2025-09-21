/**
 * Civilian Agent Implementation
 * 
 * Integrates personality, behavior trees, and KADI communication to create
 * realistic civilian NPCs. Each agent runs autonomously and reacts to world
 * events based on their personality archetype.
 */

import { KadiClient } from '@kadi.build/core';
import { PersonalityProfile, createPersonality, formatPersonality } from './personality.js';
import { CivilianBehaviorTree, CivilianAgent as ICivilianAgent } from './civilian-behaviours.js';

// Agent state and world interaction interfaces
interface AgentState {
  position: { lat: number; lon: number };
  isMoving: boolean;
  isSpawned: boolean;
  stressLevel: number;
  lastDecisionTime: number;
}

interface VisionData {
  hazards?: Array<{
    id: string;
    type: string;
    distance: number;
    position: { lat: number; lon: number };
  }>;
  agents?: Array<{
    id: string;
    type: string;
    distance: number;
    isMoving: boolean;
    position: { lat: number; lon: number };
  }>;
  exits?: Array<{
    id: string;
    distance: number;
    position: { lat: number; lon: number };
  }>;
}

/**
 * Main Civilian Agent Class
 * 
 * Implements the CivilianAgent interface for behavior trees and provides
 * KADI integration for world interaction and event handling.
 */
export class CivilianAgent implements ICivilianAgent {
  public readonly agentId: string;
  public readonly personality: PersonalityProfile;
  
  private client: KadiClient;
  private behaviorTree: CivilianBehaviorTree;
  private state: AgentState;
  private isActive = false;

  constructor(agentId: string, archetype?: string) {
    this.agentId = agentId;
    this.personality = createPersonality(archetype);
    this.behaviorTree = new CivilianBehaviorTree(this.personality);
    
    // Initialize agent state
    this.state = {
      position: { lat: 32.7767, lon: -96.7970 }, // Default Dallas position
      isMoving: false,
      isSpawned: false,
      stressLevel: 0.0,
      lastDecisionTime: 0
    };

    // Initialize KADI client (connection happens in start())
    const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
    const networks = process.env.KADI_NETWORKS?.split(',') || ['global'];
    
    this.client = new KadiClient({
      name: agentId,
      role: 'agent',
      transport: 'broker',
      brokers: { remote: brokerUrl },
      defaultBroker: 'remote',
      networks
    });

    console.log(`🧑 Created ${this.agentId} (${this.personality.archetype})`);
    console.log(`   Personality: ${formatPersonality(this.personality)}`);
  }

  /**
   * Start the agent - connect to broker and set up event handling
   */
  async start(): Promise<void> {
    try {
      // Connect to KADI broker
      await this.client.connectToBrokers();
      console.log(`✅ ${this.agentId} connected to broker`);
      
      // Set up event subscriptions
      await this.setupEventHandlers();
      
      // Spawn the agent in the world
      await this.spawnInWorld();
      
      this.isActive = true;
      console.log(`🎮 ${this.agentId} is now active and making decisions`);
      
    } catch (error) {
      console.error(`❌ Failed to start ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Stop the agent and clean up connections
   */
  async stop(): Promise<void> {
    this.isActive = false;
    
    try {
      await this.client.disconnect();
      console.log(`🛑 ${this.agentId} stopped`);
    } catch (error) {
      console.error(`⚠️ Error stopping ${this.agentId}:`, error);
    }
  }

  /**
   * Set up event handlers for world events
   */
  private async setupEventHandlers(): Promise<void> {
    // React to world tick events for decision making
    await this.client.subscribeToEvent('world.tick', async () => {
      if (this.isActive && this.state.isSpawned) {
        await this.makeDecision();
      }
    });

    // Handle position updates
    await this.client.subscribeToEvent('agent.position.updated', async (event: any) => {
      if (event.agentId === this.agentId) {
        const previousPos = { ...this.state.position };
        this.state.position = { lat: event.lat, lon: event.lon };
        const wasMoving = this.state.isMoving;
        this.state.isMoving = event.moving || false;
        
        // Only log if position actually changed or movement state changed
        const positionChanged = Math.abs(previousPos.lat - event.lat) > 0.0001 || 
                               Math.abs(previousPos.lon - event.lon) > 0.0001;
        const movementStateChanged = wasMoving !== this.state.isMoving;
        
        if (positionChanged || movementStateChanged) {
          console.log(`📍 ${this.agentId} at ${event.lat.toFixed(4)}, ${event.lon.toFixed(4)} ${this.state.isMoving ? '🚶' : '🧍'}`);
        }
        
        // Detect movement completion - was moving, now stopped
        if (wasMoving && !this.state.isMoving) {
          try {
            // Publish walk complete event
            await this.client.publishEvent('civilian.walk_complete', {
              id: this.agentId,
              type: 'civilian', 
              event: "walk_complete",
              longitude: this.state.position.lon,
              latitude: this.state.position.lat,
              timestamp: new Date().toISOString(),
              personality: this.personality.archetype
            });
            
            console.log(`✅ ${this.agentId} completed walk - arrived at destination`);
            
          } catch (error) {
            console.warn(`⚠️ ${this.agentId} walk complete event failed:`, error);
          }
        }
      }
    });

    // React to fire events with personality-based responses
    await this.client.subscribeToEvent('fire.*', async (data: any) => {
      if (this.isActive && this.state.isSpawned) {
        await this.reactToFireEvent(data);
      }
    });

    // React to other civilian events
    await this.client.subscribeToEvent('civilian.*', async (data: any) => {
      if (this.isActive && this.state.isSpawned && data.civilianId !== this.agentId) {
        await this.reactToCivilianEvent(data);
      }
    });
  }

  /**
   * Spawn the agent in the world simulation
   */
  private async spawnInWorld(): Promise<void> {
    try {
      const spawnLocation = this.generateSpawnLocation();
      
      // Use world-simulator for spawning - match the expected schema exactly
      const result = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'civilian',  // Changed from agentType to type
        position: { lat: spawnLocation.lat, lon: spawnLocation.longitude },
        status: 'available'  // Add default status
        // Removed personality field as it's not in the schema
      });

      // Convert longitude to lon for internal state consistency
      this.state.position = { lat: spawnLocation.lat, lon: spawnLocation.longitude };
      this.state.isSpawned = true;
      
      // Publish spawn event using civilian-ability schema
      await this.client.publishEvent('civilian.spawn', {
        id: this.agentId,
        type: 'civilian',
        event: "spawn",
        longitude: spawnLocation.longitude,
        latitude: spawnLocation.lat,
        timestamp: new Date().toISOString(),
        personality: this.personality.archetype
      });
      
      console.log(`🎭 ${this.agentId} (${this.personality.archetype}) spawned at ${spawnLocation.lat.toFixed(4)}, ${spawnLocation.longitude.toFixed(4)}`);
      
    } catch (error) {
      console.error(`❌ Failed to spawn ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Generate a spawn location based on personality
   */
  private generateSpawnLocation(): { lat: number; longitude: number } {
    // Base location in Dallas area
    const baseLat = 32.7767;
    const baseLon = -96.7970;
    
    // Add personality-based variation
    const variation = 0.01; // ~1km variation
    const socialFactor = this.personality.sociability;
    
    // Social agents spawn closer to center, antisocial agents spread out
    const spread = (1 - socialFactor) * variation;
    
    return {
      lat: baseLat + (Math.random() - 0.5) * spread,
      longitude: baseLon + (Math.random() - 0.5) * spread
    };
  }

  /**
   * Make a decision using the behavior tree
   */
  private async makeDecision(): Promise<void> {
    // Throttle decisions to avoid spam (max once per 3 seconds, longer if moving)
    const now = Date.now();
    const minInterval = this.state.isMoving ? 5000 : 3000; // Slower decisions when moving
    
    if (now - this.state.lastDecisionTime < minInterval) {
      return;
    }
    
    try {
      // Execute behavior tree for decision making
      const result = await this.behaviorTree.execute(this);
      this.state.lastDecisionTime = now;
      
      // Update stress level over time
      this.updateStress();
      
    } catch (error) {
      console.error(`❌ Decision error for ${this.agentId}:`, error);
    }
  }

  /**
   * React to fire events based on personality
   */
  private async reactToFireEvent(data: any): Promise<void> {
    // Increase stress based on proximity and personality
    const distance = this.calculateDistance(
      this.state.position,
      { lat: data.latitude, lon: data.longitude }
    );
    
    // Cowards get stressed from far away, brave agents only when close
    const stressDistance = 100 + (1 - this.personality.courage) * 200; // 100-300m
    
    if (distance < stressDistance) {
      const stressIncrease = Math.max(0.1, (1 - distance / stressDistance) * 0.4);
      this.state.stressLevel = Math.min(1.0, this.state.stressLevel + stressIncrease);
      
      console.log(`🚨 ${this.agentId} stressed by fire (${distance.toFixed(0)}m away) - stress: ${this.state.stressLevel.toFixed(2)}`);
      
      // Trigger immediate decision making
      await this.makeDecision();
    }
  }

  /**
   * React to other civilian events
   */
  private async reactToCivilianEvent(data: any): Promise<void> {
    // Social agents react more to other civilians
    if (this.personality.sociability > 0.6 && Math.random() < 0.3) {
      console.log(`👥 ${this.agentId} noticed civilian event from ${data.civilianId}`);
      await this.makeDecision();
    }
  }

  /**
   * Update stress level over time (gradual recovery)
   */
  private updateStress(): void {
    // Gradually reduce stress (natural recovery)
    this.state.stressLevel = Math.max(0, this.state.stressLevel - 0.01);
  }

  /**
   * Calculate distance between two positions
   */
  private calculateDistance(pos1: { lat: number; lon: number }, pos2: { lat: number; lon: number }): number {
    // Simple Euclidean distance (good enough for local areas)
    const latDiff = pos1.lat - pos2.lat;
    const lonDiff = pos1.lon - pos2.lon;
    return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111000; // Convert to meters approximately
  }

  // =============================================================================
  // BEHAVIOR TREE INTERFACE IMPLEMENTATION
  // =============================================================================

  /**
   * Get vision from world simulator
   */
  async getVision(): Promise<VisionData> {
    try {
      const result = await this.client.callTool('world-simulator', 'whatDoISee', {
        agentId: this.agentId,
        visionRange: this.personality.vision_range
      });
      
      return result as VisionData;
      
    } catch (error) {
      console.warn(`⚠️ ${this.agentId} vision failed:`, error);
      return { hazards: [], agents: [], exits: [] };
    }
  }

  /**
   * Move to a destination
   */
  async moveTo(destination: { lat: number; lon: number }, urgency = 'normal'): Promise<void> {
    try {
      const currentPos = this.getCurrentPosition();
      
      // Publish walk start event using civilian-ability schema
      await this.client.publishEvent('civilian.walk_start', {
        id: this.agentId,
        type: 'civilian',
        event: "walk_start",
        longitude: currentPos.lon,
        latitude: currentPos.lat,
        timestamp: new Date().toISOString(),
        destination: { latitude: destination.lat, longitude: destination.lon },
        urgency: urgency,
        personality: this.personality.archetype
      });

      // Call world-simulator to start movement - let IT handle the actual movement
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination,
        profile: 'walking',
        urgency
      });

      if ((result as any)?.success) {
        this.state.isMoving = true;
        console.log(`🎯 ${this.agentId} starting walk to ${destination.lat.toFixed(4)}, ${destination.lon.toFixed(4)}`);
        
        // Don't use setTimeout - let the world-simulator handle movement timing
        // The agent.position.updated events will update our position naturally
        // Movement completion will be detected when we reach the destination
      } else {
        console.warn(`⚠️ ${this.agentId} movement request failed`);
      }
      
    } catch (error) {
      console.warn(`⚠️ ${this.agentId} movement failed:`, error);
    }
  }

  /**
   * Get current stress level
   */
  getStressLevel(): number {
    return this.state.stressLevel;
  }

  /**
   * Get current position
   */
  getCurrentPosition(): { lat: number; lon: number } {
    return { ...this.state.position };
  }

  /**
   * Get agent status for monitoring
   */
  getStatus(): any {
    return {
      agentId: this.agentId,
      archetype: this.personality.archetype,
      position: this.state.position,
      isMoving: this.state.isMoving,
      isSpawned: this.state.isSpawned,
      stressLevel: this.state.stressLevel,
      personality: {
        courage: this.personality.courage,
        sociability: this.personality.sociability,
        agility: this.personality.agility,
        helpfulness: this.personality.helpfulness
      },
      isActive: this.isActive
    };
  }
}