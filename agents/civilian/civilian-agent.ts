#!/usr/bin/env node

/**
 * Civilian Agent Implementation
 *
 * A civilian agent with personality-driven behavior in emergency scenarios.
 * Uses the KADI framework to interact with the world simulator.
 */

import { KadiClient } from '@kadi.build/core';
import { CivilianBehaviorTree, type CivilianAgent as ICivilianAgent } from './civilian-behavior-tree.js';
import {
  generateArchetypePersonality,
  generateRandomPersonality,
  type PersonalityTraits,
  type ArchetypeKey,
  classifyPersonality
} from './personality.js';
import type { VisionResult, MovementResult } from './shared/behavior-tree.js';

// Prefer remote broker by default; override with KADI_BROKER_URL
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://kadi.build:8080';

export class CivilianAgent implements ICivilianAgent {
  public agentId: string;
  public personality: PersonalityTraits;
  public lastMoveTime?: number;
  public currentPosition?: { lat: number; lon: number };

  private client: KadiClient;
  private behaviorTree: CivilianBehaviorTree;
  private stressLevel: number = 0;
  private isActive: boolean = false;

  constructor(agentId: string, archetype?: ArchetypeKey, initialPosition?: { lat: number; lon: number }) {
    this.agentId = agentId;

    // Store initial position if provided
    if (initialPosition) {
      this.currentPosition = initialPosition;
    }

    // Initialize KADI client
    this.client = new KadiClient({
      name: agentId,
      role: 'agent',
      transport: 'broker',
      brokers: {
        local: 'ws://localhost:8080',
        remote: brokerUrl
      },
      defaultBroker: 'remote',
      networks: ['global']
    });

    // Generate personality
    this.personality = archetype
      ? generateArchetypePersonality(archetype)
      : generateRandomPersonality();

    // Initialize behavior tree
    this.behaviorTree = new CivilianBehaviorTree(this.personality);

    const personalityType = archetype || classifyPersonality(this.personality);
    console.log(`🧑 ${agentId} spawned with ${personalityType} personality:`, {
      courage: this.personality.courage.toFixed(2),
      sociability: this.personality.sociability.toFixed(2),
      agility: this.personality.agility.toFixed(2)
    });
  }

  /**
   * Start the civilian agent
   */
  async start(): Promise<void> {
    try {
      console.log(`🔌 ${this.agentId}: Connecting to KADI broker (remote=${brokerUrl})...`);
      await this.client.connectToBrokers();

      // Listen for world events
      await this.client.subscribeToEvent('world.tick', () => this.onWorldTick());
      await this.client.subscribeToEvent('agent.position.updated', (event: any) => {
        if (event.agentId === this.agentId) {
          this.onPositionUpdate(event);
        }
      });

      // First try to spawn the agent
      const spawnResult = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'civilian',
        position: this.getInitialPosition(),
        status: 'available'
      }) as { success: boolean; error?: string };

      if (!spawnResult.success) {
        // If agent already exists, try to despawn and respawn
        if (spawnResult.error?.includes('already exists')) {
          console.log(`⚠️ ${this.agentId}: Agent already exists, attempting to respawn...`);

          try {
            // Despawn the existing agent
            await this.client.callTool('world-simulator', 'despawnAgent', {
              agentId: this.agentId
            });

            // Wait a moment for despawn to complete
            await new Promise(resolve => setTimeout(resolve, 500));

            // Try spawning again
            const respawnResult = await this.client.callTool('world-simulator', 'spawnAgent', {
              agentId: this.agentId,
              type: 'civilian',
              position: this.getInitialPosition(),
              status: 'available'
            }) as { success: boolean; error?: string };

            if (!respawnResult.success) {
              throw new Error(`Failed to respawn agent: ${respawnResult.error}`);
            }
          } catch (e) {
            console.error(`❌ ${this.agentId}: Failed to respawn:`, e);
            throw e;
          }
        } else {
          throw new Error(`Failed to spawn agent: ${spawnResult.error}`);
        }
      }

      this.isActive = true;
      console.log(`✅ ${this.agentId}: Connected and spawned successfully`);

    } catch (error) {
      console.error(`❌ ${this.agentId}: Failed to start:`, error);
      throw error;
    }
  }

  /**
   * Stop the civilian agent
   */
  async stop(): Promise<void> {
    this.isActive = false;
    console.log(`🛑 ${this.agentId}: Stopping...`);

    // Try to despawn from world simulator
    try {
      await this.client.callTool('world-simulator', 'despawnAgent', {
        agentId: this.agentId
      });
    } catch (error) {
      console.warn(`⚠️ ${this.agentId}: Could not despawn from world:`, error);
    }

    // Disconnect from broker
    await this.client.disconnect();
  }

  /**
   * Get initial spawn position (around Dallas area)
   */
  private getInitialPosition(): { lat: number; lon: number } {
    // Use provided position if available, otherwise spawn randomly in Deep Ellum
    if (this.currentPosition) {
      return this.currentPosition;
    }

    // Default: Spawn in Deep Ellum area with some randomization
    const basePosition = { lat: 32.7825, lon: -96.7849 };
    const randomOffset = 0.002; // ~200m radius

    return {
      lat: basePosition.lat + (Math.random() - 0.5) * randomOffset,
      lon: basePosition.lon + (Math.random() - 0.5) * randomOffset
    };
  }

  /**
   * Handle world tick events - make decisions
   */
  private async onWorldTick(): Promise<void> {
    if (!this.isActive) return;

    try {
      // Execute behavior tree to make decision
      await this.behaviorTree.execute(this);

      // Update stress level over time
      this.updateStressLevel();

    } catch (error) {
      console.error(`❌ ${this.agentId}: Decision error:`, error);
    }
  }

  /**
   * Handle position update events
   */
  private onPositionUpdate(event: any): void {
    this.currentPosition = { lat: event.lat, lon: event.lon };
    console.log(`📍 ${this.agentId}: Moved to ${event.lat.toFixed(4)}, ${event.lon.toFixed(4)}`);
  }

  /**
   * Update stress level based on environment
   */
  private updateStressLevel(): void {
    // Gradually reduce stress over time
    this.stressLevel = Math.max(0, this.stressLevel - 0.01);

    // Stress increases when seeing hazards (implemented in getVision results)
    // This is a simplified stress model
  }

  // ========================================================================
  // INTERFACE IMPLEMENTATION - Required by CivilianAgent interface
  // ========================================================================

  /**
   * Get what the agent can see (delegates to world simulator)
   */
  async getVision(): Promise<VisionResult> {
    try {
      const result = await this.client.callTool('world-simulator', 'whatDoISee', {
        agentId: this.agentId,
        visionRange: this.personality.visionRange
      }) as {
        success: boolean;
        error?: string;
        hazards?: any[];
        agents?: any[];
        exits?: any[];
      };

      if (!result.success) {
        throw new Error(result.error || 'Vision request failed');
      }

      // Increase stress when seeing hazards
      if (result.hazards && result.hazards.length > 0) {
        const nearbyHazards = result.hazards.filter((h: any) => h.distance < 50);
        this.stressLevel = Math.min(1, this.stressLevel + nearbyHazards.length * 0.1);
      }

      return {
        hazards: result.hazards || [],
        agents: result.agents || [],
        exits: result.exits || []
      };

    } catch (error) {
      console.error(`❌ ${this.agentId}: Vision error:`, error);
      return { hazards: [], agents: [], exits: [] };
    }
  }

  /**
   * Move to a destination (delegates to world simulator)
   */
  async moveTo(destination: { lat: number; lon: number }, urgency: string = 'normal'): Promise<MovementResult> {
    try {
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination,
        profile: 'walking',
        urgency,
        speed: this.personality.movementSpeed
      }) as MovementResult;

      if (result.success) {
        console.log(`🚶 ${this.agentId}: Moving to ${destination.lat.toFixed(4)}, ${destination.lon.toFixed(4)} (${urgency})`);
      } else {
        console.error(`❌ ${this.agentId}: Move failed:`, result.error);
      }

      return result;

    } catch (error) {
      console.error(`❌ ${this.agentId}: Movement error:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Calculate current stress level (used by behavior tree)
   */
  calculateStressLevel(): number {
    return this.stressLevel;
  }
}

/**
 * Create and start multiple civilian agents
 */
export async function spawnCivilians(count: number, archetypes?: ArchetypeKey[]): Promise<CivilianAgent[]> {
  const agents: CivilianAgent[] = [];

  for (let i = 0; i < count; i++) {
    const agentId = `civilian-${String(i + 1).padStart(3, '0')}`;
    const archetype = archetypes ? archetypes[i % archetypes.length] : undefined;

    const agent = new CivilianAgent(agentId, archetype);
    agents.push(agent);

    try {
      await agent.start();
      // Small delay between spawns to avoid overwhelming the broker
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Failed to start ${agentId}:`, error);
    }
  }

  return agents;
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  async function main() {
    const count = parseInt(process.argv[2]) || 1;
    const useArchetypes = process.argv.includes('--archetypes');

    // Check for position arguments: --lat=32.7825 --lon=-96.7849
    const latArg = process.argv.find(arg => arg.startsWith('--lat='));
    const lonArg = process.argv.find(arg => arg.startsWith('--lon='));

    let fixedPosition: { lat: number; lon: number } | undefined;
    if (latArg && lonArg) {
      fixedPosition = {
        lat: parseFloat(latArg.split('=')[1]),
        lon: parseFloat(lonArg.split('=')[1])
      };
      console.log(`📍 Positioning civilian at: ${fixedPosition.lat}, ${fixedPosition.lon}`);
    }

    console.log(`🎭 Spawning ${count} civilian agent${count > 1 ? 's' : ''}${useArchetypes ? ' with archetypes' : ''}...`);

    // For test scenario, spawn single agent at fixed position
    if (count === 1 && fixedPosition) {
      const agent = new CivilianAgent('test_civilian', 'hero', fixedPosition);
      await agent.start();

      // Handle shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down civilian agent...');
        await agent.stop();
        process.exit(0);
      });
    } else {
      // Original multi-agent spawning
      const archetypes: ArchetypeKey[] = useArchetypes ? ['hero', 'coward', 'follower'] : [];
      const agents = await spawnCivilians(count, archetypes.length > 0 ? archetypes : undefined);

      console.log(`✅ Spawned ${agents.length} civilian agents successfully!`);

      // Handle shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down civilian agents...');
        await Promise.all(agents.map(agent => agent.stop()));
        process.exit(0);
      });
    }
  }

  main().catch(error => {
    console.error('❌ Startup failed:', error);
    process.exit(1);
  });
}
