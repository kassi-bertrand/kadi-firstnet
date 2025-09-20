#!/usr/bin/env node
/**
 * Firefighter Agent - Emergency Response Unit
 *
 * Behavior cycle:
 * 1. Sit at base (fire station) - wait for dispatch
 * 2. Respond to dispatch orders from commander
 * 3. Move to fire location when dispatched
 * 4. Extinguish fire when close enough
 * 5. Notify completion when fire is extinguished
 * 6. Return to base and become available again
 */

import { KadiClient } from '@kadi.build/core';

type FirefighterStatus = 'at_base' | 'en_route' | 'on_scene' | 'extinguishing' | 'returning';

interface FirefighterState {
  agentId: string;
  status: FirefighterStatus;
  baseStation: { lat: number; lon: number };
  currentIncident?: string;
  currentDestination?: { lat: number; lon: number };
  lastStatusUpdate: number;
}

export class FirefighterAgent {
  private client: KadiClient;
  private agentId: string;
  private state: FirefighterState;
  private isRunning: boolean = false;
  private tickInterval?: NodeJS.Timeout;

  constructor(agentId: string, baseStation: { lat: number; lon: number }) {
    this.agentId = agentId;
    const brokerUrl = process.env.KADI_BROKER_URL || 'ws://kadi.build:8080';
    this.client = new KadiClient({
      name: this.agentId,
      role: 'agent',
      transport: 'broker',
      brokers: {
        local: 'ws://localhost:8080',
        remote: brokerUrl
      },
      defaultBroker: 'remote',
      networks: ['global']
    });

    this.state = {
      agentId,
      status: 'at_base',
      baseStation,
      lastStatusUpdate: Date.now()
    };
  }

  async start(): Promise<void> {
    console.log(`🚒 Firefighter ${this.agentId}: Reporting for duty at base station`);

    try {
      await this.client.connectToBrokers();
      console.log(`KADI client (firefighter ${this.agentId}) connected (remote broker=${process.env.KADI_BROKER_URL || 'ws://kadi.build:8080'})`);
      this.isRunning = true;

      // First try to spawn the agent
      const spawnResult = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'firefighter',
        position: this.state.baseStation,
        status: 'available'
      }) as any;

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
              type: 'firefighter',
              position: this.state.baseStation,
              status: 'available'
            }) as any;

            if (!respawnResult.success) {
              throw new Error(`Failed to respawn firefighter: ${respawnResult.error}`);
            }
          } catch (e) {
            console.error(`❌ ${this.agentId}: Failed to respawn:`, e);
            throw e;
          }
        } else {
          throw new Error(`Failed to spawn firefighter: ${spawnResult.error}`);
        }
      }

      console.log(`🗺️ Firefighter ${this.agentId}: Spawned at base station ${this.state.baseStation.lat}, ${this.state.baseStation.lon}`);

      // Subscribe to dispatch orders
      await this.subscribeToEvents();

      // Start behavior loop
      this.startBehaviorLoop();

      // Notify commander we're available
      await this.notifyStatusChange('at_base');

      // Re-notify commander every 10 seconds to ensure registration
      setInterval(async () => {
        if (this.state.status === 'at_base') {
          await this.notifyStatusChange('at_base');
        }
      }, 10000);

      console.log(`✅ Firefighter ${this.agentId}: Ready and standing by`);
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to start:`, error);
    }
  }

  private async subscribeToEvents(): Promise<void> {
    console.log(`📡 Firefighter ${this.agentId}: Subscribing to dispatch orders`);

    // Listen for dispatch orders from commander
    await this.client.subscribeToEvent('firefighter.dispatch', async (event: any) => {
      // Respond to any dispatch if we're available (first come, first served)
      if (this.state.status === 'at_base') {
        console.log(`🚨 ${this.agentId}: Responding to dispatch for incident ${event.incidentId}`);
        await this.handleDispatch(event);
      } else {
        console.log(`⚠️ ${this.agentId}: Received dispatch but currently ${this.state.status} - cannot respond`);
      }
    });

    // TODO: Listen for other relevant events
    // this.client.subscribe('fire.extinguished', async (event) => {
    //   // Check if this was our fire
    // });
  }

  private async handleDispatch(event: any): Promise<void> {
    console.log(`🚨 Firefighter ${this.agentId}: Received dispatch to incident ${event.incidentId}`);

    if (this.state.status !== 'at_base') {
      console.log(`⚠️ Firefighter ${this.agentId}: Already deployed, cannot respond to new dispatch`);
      return;
    }

    // Update state for dispatch
    this.state.status = 'en_route';
    this.state.currentIncident = event.incidentId;
    this.state.currentDestination = event.destination;
    this.state.lastStatusUpdate = Date.now();

    console.log(`🚗 Firefighter ${this.agentId}: En route to ${event.destination.lat}, ${event.destination.lon}`);

    // Move to incident location
    try {
      const moveResult = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: event.destination,
        urgency: 'emergency'
      });

      await this.notifyStatusChange('en_route');
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to move to incident:`, error);
    }
  }

  private startBehaviorLoop(): void {
    // Check status every 2 seconds
    this.tickInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.behaviorTick();
      } catch (error) {
        console.error(`❌ Firefighter ${this.agentId}: Behavior tick error:`, error);
      }
    }, 2000);
  }

  private async behaviorTick(): Promise<void> {
    switch (this.state.status) {
      case 'at_base':
        // Check for nearby fires even when at base
        await this.checkForNearbyFires();
        break;

      case 'en_route':
        await this.checkArrivalAtIncident();
        break;

      case 'on_scene':
        await this.startFireSuppression();
        break;

      case 'extinguishing':
        await this.continueFireSuppression();
        break;

      case 'returning':
        await this.checkArrivalAtBase();
        break;
    }
  }

  private async checkForNearbyFires(): Promise<void> {
    // Only check every 5 seconds to avoid spamming
    const now = Date.now();
    if (this.state.lastStatusUpdate && (now - this.state.lastStatusUpdate) < 5000) {
      return;
    }

    try {
      const vision = await this.client.callTool('world-simulator', 'whatDoISee', {
        agentId: this.agentId,
        visionRange: 100 // Check within 100 meters when at base
      }) as any;

      if (vision.success && vision.hazards) {
        const fires = vision.hazards.filter((h: any) => h.type === 'fire');

        if (fires.length > 0) {
          const nearestFire = fires.reduce((nearest: any, fire: any) =>
            fire.distance < nearest.distance ? fire : nearest
          );

          console.log(`🔥 Firefighter ${this.agentId}: FIRE DETECTED at station! Distance: ${nearestFire.distance.toFixed(1)}m`);
          console.log(`🚨 Firefighter ${this.agentId}: Self-dispatching to nearby fire!`);

          // Self-dispatch to the fire
          this.state.status = 'en_route';
          this.state.currentIncident = `self_dispatch_${Date.now()}`;
          this.state.currentDestination = nearestFire.position;
          this.state.lastStatusUpdate = now;

          // Move to the fire immediately
          await this.client.callTool('world-simulator', 'moveMe', {
            agentId: this.agentId,
            destination: nearestFire.position,
            urgency: 'emergency'
          });

          await this.notifyStatusChange('en_route');
        }
      }
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to check for fires:`, error);
    }
  }

  private async checkArrivalAtIncident(): Promise<void> {
    // Check if we've arrived at the incident location
    try {
      const positionResult = await this.client.callTool('world-simulator', 'getAgentPosition', {
        agentId: this.agentId
      }) as any;

      if (positionResult.success && !positionResult.moving) {
        console.log(`🎯 Firefighter ${this.agentId}: Arrived at incident scene`);
        this.state.status = 'on_scene';
        this.state.lastStatusUpdate = Date.now();
        await this.notifyStatusChange('on_scene');
      }
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to check position:`, error);
    }
  }

  private async startFireSuppression(): Promise<void> {
    console.log(`🔥 Firefighter ${this.agentId}: Assessing fire situation`);

    // Look for fires nearby
    try {
      const vision = await this.client.callTool('world-simulator', 'whatDoISee', {
        agentId: this.agentId,
        visionRange: 50 // meters
      }) as any;

      if (vision.success && vision.hazards.length > 0) {
        const fires = vision.hazards.filter((h: any) => h.type === 'fire');

        if (fires.length > 0) {
          const nearestFire = fires.reduce((nearest: any, fire: any) =>
            fire.distance < nearest.distance ? fire : nearest
          );

          if (nearestFire.distance <= 20) { // Close enough to start suppression
            console.log(`🚿 Firefighter ${this.agentId}: Starting fire suppression on fire ${nearestFire.id}`);
            this.state.status = 'extinguishing';
            this.state.lastStatusUpdate = Date.now();
            await this.notifyStatusChange('extinguishing');
          } else {
            // Move closer to the fire
            await this.client.callTool('world-simulator', 'moveMe', {
              agentId: this.agentId,
              destination: nearestFire.position,
              urgency: 'urgent'
            });
          }
        } else {
          console.log(`✅ Firefighter ${this.agentId}: No fires found at incident location - mission complete`);
          await this.returnToBase();
        }
      }
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to assess fire situation:`, error);
    }
  }

  private async continueFireSuppression(): Promise<void> {
    // Continue suppressing fire until it's extinguished
    try {
      const vision = await this.client.callTool('world-simulator', 'whatDoISee', {
        agentId: this.agentId,
        visionRange: 30
      }) as any;

      if (vision.success) {
        const fires = vision.hazards.filter((h: any) => h.type === 'fire' && h.distance <= 25);

        if (fires.length > 0) {
          const targetFire = fires[0];
          console.log(`🚿 Firefighter ${this.agentId}: Suppressing fire ${targetFire.id} (intensity: ${targetFire.intensity.toFixed(2)})`);

          // Call suppressFire tool on world simulator
          const suppressionResult = await this.client.callTool('world-simulator', 'suppressFire', {
            agentId: this.agentId,
            fireId: targetFire.id,
            suppressionRate: 0.3 // reduce intensity by 30% per suppression cycle
          }) as any;

          if (suppressionResult.success) {
            console.log(`💧 Firefighter ${this.agentId}: Applied suppression to fire ${targetFire.id}`);

            if (suppressionResult.fireExtinguished) {
              console.log(`🎉 Firefighter ${this.agentId}: Fire ${targetFire.id} successfully extinguished!`);
              await this.returnToBase();
            } else {
              console.log(`🔥 Firefighter ${this.agentId}: Fire still burning, intensity: ${suppressionResult.remainingIntensity?.toFixed(2)}`);
              // Continue suppression in next tick
            }
          } else {
            console.log(`⚠️ Firefighter ${this.agentId}: Suppression failed: ${suppressionResult.error}`);

            // If fire not found, it's probably already extinguished
            if (suppressionResult.error?.includes('not found')) {
              console.log(`✅ Firefighter ${this.agentId}: Fire already extinguished - returning to base`);
              await this.returnToBase();
            }
            // If too far, try to move closer
            else if (suppressionResult.error?.includes('Too far')) {
              await this.client.callTool('world-simulator', 'moveMe', {
                agentId: this.agentId,
                destination: targetFire.position,
                urgency: 'urgent'
              });
            }
          }
        } else {
          console.log(`✅ Firefighter ${this.agentId}: No more fires detected in suppression range`);
          await this.returnToBase();
        }
      }
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed during fire suppression:`, error);
    }
  }

  private async returnToBase(): Promise<void> {
    console.log(`🏠 Firefighter ${this.agentId}: Returning to base station`);

    this.state.status = 'returning';
    this.state.currentDestination = this.state.baseStation;
    this.state.lastStatusUpdate = Date.now();

    try {
      await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: this.state.baseStation,
        urgency: 'normal'
      });

      await this.notifyStatusChange('returning');
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to return to base:`, error);
    }
  }

  private async checkArrivalAtBase(): Promise<void> {
    try {
      const positionResult = await this.client.callTool('world-simulator', 'getAgentPosition', {
        agentId: this.agentId
      }) as any;

      if (positionResult.success && !positionResult.moving) {
        console.log(`🏠 Firefighter ${this.agentId}: Back at base station - available for new incidents`);

        // Reset state
        this.state.status = 'at_base';
        this.state.currentIncident = undefined;
        this.state.currentDestination = undefined;
        this.state.lastStatusUpdate = Date.now();

        await this.notifyStatusChange('at_base');
      }
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to check base arrival:`, error);
    }
  }

  private async notifyStatusChange(newStatus: FirefighterStatus): Promise<void> {
    console.log(`📡 Firefighter ${this.agentId}: Status changed to ${newStatus}`);

    try {
      await this.client.publishEvent('firefighter.status', {
        firefighterId: this.agentId,
        status: newStatus,
        incidentId: this.state.currentIncident,
        timestamp: Date.now(),
        position: this.state.currentDestination || this.state.baseStation
      });
    } catch (error) {
      console.error(`❌ Firefighter ${this.agentId}: Failed to notify status change:`, error);
    }
  }


  async stop(): Promise<void> {
    console.log(`🛑 Firefighter ${this.agentId}: Going off duty`);
    this.isRunning = false;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }

    // Try to despawn from world simulator
    try {
      await this.client.callTool('world-simulator', 'despawnAgent', {
        agentId: this.agentId
      });
    } catch (error) {
      console.warn(`⚠️ Firefighter ${this.agentId}: Could not despawn from world:`, error);
    }

    await this.client.disconnect();
  }
}

// Main execution for standalone firefighter
if (import.meta.url === `file://${process.argv[1]}`) {
  // This would typically be spawned by the commander
  const firefighterId = process.argv[2] || `firefighter_${Date.now()}`;
  // Spawn at Station 18 - Deep Ellum by default (different from commander's downtown location)
  const lat = parseFloat(process.argv[3]) || 32.7825;
  const lon = parseFloat(process.argv[4]) || -96.7849;

  const firefighter = new FirefighterAgent(firefighterId, { lat, lon });

  firefighter.start().catch(console.error);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await firefighter.stop();
    process.exit(0);
  });
}
