#!/usr/bin/env node
/**
 * Civilian Agent System
 * 
 * Features:
 * - Spawns civilian agents that roam randomly around Dallas
 * - Uses vision to detect fire hazards
 * - Makes emergency calls when fires are spotted
 * - Publishes 'emergency.fire.reported' events for emergency dispatch systems
 */

import { KadiClient } from '@kadi.build/core';

// Civilian agent configuration
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
const networks = process.env.KADI_NETWORKS?.split(',') || ['global'];

console.log(`🚶 Civilian Agent connecting to: ${brokerUrl}`);
console.log(`🌍 Using networks: ${networks.join(', ')}`);

// Dallas area boundaries for random roaming
const DALLAS_BOUNDS = {
  north: 32.85,   // North Dallas
  south: 32.70,   // South Dallas
  east: -96.65,   // East Dallas
  west: -96.85    // West Dallas
};

// Civilian agent class
class CivilianAgent {
  public readonly agentId: string;
  private client: KadiClient;
  private isActive = false;
  private currentPosition: { lat: number; lon: number };
  private isRoaming = false;
  private reportedFires = new Set<string>(); // Track fires we've already reported
  private isApproachingFire = false; // Track if we're moving toward a fire
  private currentTargetFire: any = null; // The fire we're currently investigating

  constructor(agentId: string) {
    this.agentId = agentId;

    // Initialize KADI client
    this.client = new KadiClient({
      name: this.agentId,
      role: 'agent',
      transport: 'broker',
      brokers: { remote: brokerUrl },
      defaultBroker: 'remote',
      networks
    });

    // Start at random position within Dallas
    this.currentPosition = this.getRandomDallasPosition();

    console.log(`🚶 Created civilian ${this.agentId}`);
    console.log(`   Starting location: ${this.currentPosition.lat.toFixed(4)}, ${this.currentPosition.lon.toFixed(4)}`);
  }

  /**
   * Start the civilian agent
   */
  async start(): Promise<void> {
    try {
      // Connect to KADI broker
      await this.client.connectToBrokers();
      console.log(`✅ ${this.agentId} connected to broker`);
      
      // Spawn the civilian at random position
      await this.spawnCivilian();
      
      // Set up event handlers
      await this.setupEventHandlers();
      
      // Start random roaming
      await this.startRoaming();
      
      this.isActive = true;
      console.log(`🎮 ${this.agentId} is now active and roaming Dallas`);
      
    } catch (error) {
      console.error(`❌ Failed to start ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Stop the civilian agent
   */
  async stop(): Promise<void> {
    this.isActive = false;
    this.isRoaming = false;
    
    try {
      await this.client.disconnect();
      console.log(`🛑 ${this.agentId} stopped`);
    } catch (error) {
      console.error(`⚠️ Error stopping ${this.agentId}:`, error);
    }
  }

  /**
   * Spawn the civilian at their starting position
   */
  private async spawnCivilian(): Promise<void> {
    try {
      const result = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'civilian',
        position: { lat: this.currentPosition.lat, lon: this.currentPosition.lon }
      });

      console.log(`🚶 ${this.agentId} spawned at ${this.currentPosition.lat.toFixed(4)}, ${this.currentPosition.lon.toFixed(4)}`);
      
    } catch (error) {
      console.error(`❌ Failed to spawn ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Set up event handlers for position tracking and vision
   */
  private async setupEventHandlers(): Promise<void> {
    // Listen for position updates
    await this.client.subscribeToEvent('agent.position.updated', async (event: any) => {
      if (event.agentId === this.agentId) {
        this.currentPosition = { lat: event.lat, lon: event.lon };
        const wasMoving = event.moving || false;
        
        console.log(`📍 ${this.agentId} at ${event.lat.toFixed(4)}, ${event.lon.toFixed(4)} ${wasMoving ? '🚶' : '🧍'}`);
        
        // When we stop moving, check what we should do next
        if (!wasMoving) {
          if (this.isApproachingFire && this.currentTargetFire) {
            // We've arrived at the fire we were investigating
            await this.investigateFire();
          } else if (this.isRoaming) {
            // Normal roaming - look around for fires
            await this.lookAroundForFires();
            
            // Wait a bit, then continue roaming (unless we found a fire to investigate)
            setTimeout(async () => {
              if (this.isActive && this.isRoaming && !this.isApproachingFire) {
                await this.moveToRandomLocation();
              }
            }, 5000 + Math.random() * 10000); // Wait 5-15 seconds before moving again
          }
        }
      }
    });
  }

  /**
   * Start random roaming behavior
   */
  private async startRoaming(): Promise<void> {
    this.isRoaming = true;
    console.log(`🚶 ${this.agentId} starting to roam Dallas randomly`);
    
    // Start first movement after a short delay
    setTimeout(async () => {
      if (this.isActive) {
        await this.moveToRandomLocation();
      }
    }, 2000);
  }

  /**
   * Move to a random location within Dallas bounds
   */
  private async moveToRandomLocation(): Promise<void> {
    if (!this.isActive || !this.isRoaming || this.isApproachingFire) return;

    try {
      const destination = this.getRandomDallasPosition();
      
      console.log(`🎯 ${this.agentId} heading to ${destination.lat.toFixed(4)}, ${destination.lon.toFixed(4)}`);
      
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: { lat: destination.lat, lon: destination.lon },
        profile: 'walking',
        urgency: 'normal'
      });

      if ((result as any)?.success) {
        console.log(`🚶 ${this.agentId} moving to new location`);
      } else {
        console.warn(`⚠️ ${this.agentId} failed to start movement, will retry`);
        // Retry after a delay
        setTimeout(() => this.moveToRandomLocation(), 5000);
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} movement failed:`, error);
      // Retry after a delay
      setTimeout(() => this.moveToRandomLocation(), 5000);
    }
  }

  /**
   * Look around for fires and approach them if found
   */
  private async lookAroundForFires(): Promise<void> {
    try {
      console.log(`👁️ ${this.agentId} looking around for hazards...`);
      
      const vision = await this.client.callTool('world-simulator', 'whatDoISee', {
        agentId: this.agentId,
        visionRange: 150 // 150 meter vision range for civilians
      });
      
      // Check for fire hazards with proper type checking
      const fireHazards = (vision as any)?.hazards?.filter((h: any) => h.type === 'fire') || [];
      
      if (fireHazards.length > 0) {
        console.log(`🔥 ${this.agentId} spotted ${fireHazards.length} fire(s)!`);
        
        // Find the closest fire that we haven't reported yet
        let closestUnreportedFire = null;
        let closestDistance = Infinity;
        
        for (const fire of fireHazards) {
          const fireId = fire.id || fire.hazardId || `fire-${fire.position?.lat}-${fire.position?.lon}`;
          
          if (!this.reportedFires.has(fireId)) {
            const fireLocation = fire.position || this.currentPosition;
            const distance = this.calculateDistance(
              this.currentPosition.lat, this.currentPosition.lon,
              fireLocation.lat || fireLocation.latitude,
              fireLocation.lon || fireLocation.longitude
            );
            
            if (distance < closestDistance) {
              closestDistance = distance;
              closestUnreportedFire = fire;
            }
          }
        }
        
        // If we found an unreported fire, approach it
        if (closestUnreportedFire) {
          await this.approachFire(closestUnreportedFire);
        } else {
          console.log(`📞 ${this.agentId} all visible fires already reported`);
        }
      } else {
        console.log(`👀 ${this.agentId} no fires visible in area`);
      }
      
    } catch (error) {
      console.warn(`⚠️ ${this.agentId} vision check failed:`, error);
    }
  }

  /**
   * Approach a fire to investigate it closely
   */
  private async approachFire(fire: any): Promise<void> {
    try {
      const fireId = fire.id || fire.hazardId || `fire-${fire.position?.lat}-${fire.position?.lon}`;
      const fireLocation = fire.position || this.currentPosition;
      
      console.log(`🚶➡️🔥 ${this.agentId} approaching fire ${fireId} to investigate`);
      
      // Calculate a position close to the fire but not too close (30-50 meters away)
      const approachDistance = 30 + Math.random() * 20; // 30-50 meters
      const fireLat = fireLocation.lat || fireLocation.latitude;
      const fireLon = fireLocation.lon || fireLocation.longitude;
      
      // Calculate approach position (slightly offset from fire)
      const angle = Math.random() * 2 * Math.PI; // Random angle
      const offsetLat = (approachDistance / 111000) * Math.cos(angle); // Convert meters to degrees
      const offsetLon = (approachDistance / 111000) * Math.sin(angle);
      
      const approachPosition = {
        lat: fireLat + offsetLat,
        lon: fireLon + offsetLon
      };
      
      // Set investigation state
      this.isApproachingFire = true;
      this.currentTargetFire = fire;
      
      // Move towards the fire
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: { lat: approachPosition.lat, lon: approachPosition.lon },
        profile: 'walking',
        urgency: 'normal'
      });

      if ((result as any)?.success) {
        console.log(`🚶 ${this.agentId} moving closer to investigate fire ${fireId}`);
      } else {
        console.warn(`⚠️ ${this.agentId} failed to approach fire, will continue roaming`);
        this.isApproachingFire = false;
        this.currentTargetFire = null;
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} failed to approach fire:`, error);
      this.isApproachingFire = false;
      this.currentTargetFire = null;
    }
  }

  /**
   * Investigate the fire up close, make the emergency call, then move away
   */
  private async investigateFire(): Promise<void> {
    try {
      const fire = this.currentTargetFire;
      const fireId = fire.id || fire.hazardId || `fire-${fire.position?.lat}-${fire.position?.lon}`;
      
      console.log(`🔥👁️ ${this.agentId} investigating fire ${fireId} up close`);
      
      // Take a moment to assess the situation
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000)); // 2-5 seconds
      
      // Make the emergency call
      await this.reportFire(fire, fireId);
      this.reportedFires.add(fireId);
      
      console.log(`🏃‍♂️ ${this.agentId} moving away from fire ${fireId} to safety`);
      
      // Move away from the fire to a safe distance
      await this.moveAwayFromFire(fire);
      
    } catch (error) {
      console.error(`❌ ${this.agentId} fire investigation failed:`, error);
    } finally {
      // Reset investigation state
      this.isApproachingFire = false;
      this.currentTargetFire = null;
    }
  }

  /**
   * Move away from a fire to a safer location
   */
  private async moveAwayFromFire(fire: any): Promise<void> {
    try {
      const fireLocation = fire.position || this.currentPosition;
      const fireLat = fireLocation.lat || fireLocation.latitude;
      const fireLon = fireLocation.lon || fireLocation.longitude;
      
      // Calculate a position further away from the fire (200-300 meters)
      const safeDistance = 200 + Math.random() * 100; // 200-300 meters
      
      // Move in opposite direction from fire
      const fireToMeAngle = Math.atan2(
        this.currentPosition.lon - fireLon,
        this.currentPosition.lat - fireLat
      );
      
      // Move further in the same direction (away from fire)
      const safeLat = this.currentPosition.lat + (safeDistance / 111000) * Math.cos(fireToMeAngle);
      const safeLon = this.currentPosition.lon + (safeDistance / 111000) * Math.sin(fireToMeAngle);
      
      // Make sure we stay within Dallas bounds
      const safePosition = {
        lat: Math.max(DALLAS_BOUNDS.south, Math.min(DALLAS_BOUNDS.north, safeLat)),
        lon: Math.max(DALLAS_BOUNDS.west, Math.min(DALLAS_BOUNDS.east, safeLon))
      };
      
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: { lat: safePosition.lat, lon: safePosition.lon },
        profile: 'walking',
        urgency: 'normal'
      });

      if ((result as any)?.success) {
        console.log(`🏃‍♂️ ${this.agentId} moving to safety away from fire`);
        
        // After moving to safety, resume normal roaming after a delay
        setTimeout(async () => {
          if (this.isActive && !this.isApproachingFire) {
            console.log(`✅ ${this.agentId} reached safety, resuming normal roaming`);
            await this.moveToRandomLocation();
          }
        }, 10000 + Math.random() * 5000); // Wait 10-15 seconds before resuming roaming
      } else {
        console.warn(`⚠️ ${this.agentId} failed to move to safety, resuming roaming`);
        setTimeout(() => this.moveToRandomLocation(), 5000);
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} failed to move away from fire:`, error);
      // Resume roaming after error
      setTimeout(() => this.moveToRandomLocation(), 5000);
    }
  }

  /**
   * Calculate distance between two coordinates in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Simple Euclidean distance (good enough for local areas)
    const latDiff = lat1 - lat2;
    const lonDiff = lon1 - lon2;
    return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111000; // Convert to meters approximately
  }
  private async reportFire(fire: any, fireId: string): Promise<void> {
    try {
      console.log(`📞 ${this.agentId} calling emergency services about fire ${fireId}!`);
      
      const fireLocation = fire.position || this.currentPosition;
      
      // Publish emergency fire report event
      await this.client.publishEvent('emergency.fire.reported', {
        reporterId: this.agentId,
        reporterType: 'civilian',
        fireId: fireId,
        location: {
          latitude: fireLocation.lat || fireLocation.latitude,
          longitude: fireLocation.lon || fireLocation.longitude
        },
        reportedAt: new Date().toISOString(),
        urgency: fire.intensity > 0.7 ? 'high' : fire.intensity > 0.4 ? 'medium' : 'low',
        fireDetails: {
          intensity: fire.intensity || 0.5,
          radius: fire.radius || 50,
          fireIntensity: fire.fireIntensity || 'unknown'
        },
        reporterLocation: {
          latitude: this.currentPosition.lat,
          longitude: this.currentPosition.lon
        },
        description: `Fire spotted by civilian ${this.agentId}`,
        callerType: '911_call'
      });
      
      // Also publish a civilian action event for tracking
      await this.client.publishEvent('civilian.emergency.call', {
        civilianId: this.agentId,
        action: 'reported_fire',
        fireId: fireId,
        timestamp: new Date().toISOString(),
        location: {
          latitude: this.currentPosition.lat,
          longitude: this.currentPosition.lon
        }
      });
      
      console.log(`✅ ${this.agentId} successfully reported fire ${fireId} to emergency services`);
      
    } catch (error) {
      console.error(`❌ ${this.agentId} failed to report fire:`, error);
    }
  }

  /**
   * Get a random position within Dallas bounds
   */
  private getRandomDallasPosition(): { lat: number; lon: number } {
    const lat = DALLAS_BOUNDS.south + Math.random() * (DALLAS_BOUNDS.north - DALLAS_BOUNDS.south);
    const lon = DALLAS_BOUNDS.west + Math.random() * (DALLAS_BOUNDS.east - DALLAS_BOUNDS.west);
    
    return { lat, lon };
  }

  /**
   * Get civilian status
   */
  getStatus(): any {
    return {
      agentId: this.agentId,
      type: 'civilian',
      isActive: this.isActive,
      isRoaming: this.isRoaming,
      isApproachingFire: this.isApproachingFire,
      currentTargetFire: this.currentTargetFire?.id || this.currentTargetFire?.hazardId || null,
      currentPosition: this.currentPosition,
      reportedFires: Array.from(this.reportedFires)
    };
  }
}

/**
 * Create multiple civilian agents
 */
async function createCivilians(count: number = 20): Promise<CivilianAgent[]> {
  const civilians: CivilianAgent[] = [];
  
  for (let i = 1; i <= count; i++) {
    const civilian = new CivilianAgent(`civilian-${i}`);
    civilians.push(civilian);
  }
  
  console.log(`🚶 Created ${civilians.length} civilian agents for Dallas roaming`);
  return civilians;
}

/**
 * Start all civilian agents
 */
async function startCivilians(civilians: CivilianAgent[]): Promise<void> {
  console.log('🚀 Starting civilian agent system...');
  
  // Start civilians with staggered timing
  for (let i = 0; i < civilians.length; i++) {
    const civilian = civilians[i];
    
    try {
      await civilian.start();
      
      // Small delay between civilian starts
      if (i < civilians.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } catch (error) {
      console.error(`❌ Failed to start ${civilian.agentId}:`, error);
    }
  }
  
  console.log(`✅ Started ${civilians.length} civilian agents roaming Dallas`);
}

/**
 * Stop all civilian agents
 */
async function stopCivilians(civilians: CivilianAgent[]): Promise<void> {
  console.log('🛑 Stopping civilian agent system...');
  
  const stopPromises = civilians.map(civilian => civilian.stop());
  await Promise.allSettled(stopPromises);
  
  console.log('✅ All civilian agents stopped');
}

/**
 * Display civilian status
 */
function displayStatus(civilians: CivilianAgent[]): void {
  console.log('\n📊 Civilian Status:');
  console.log('==================');
  
  civilians.forEach(civilian => {
    const status = civilian.getStatus();
    let behaviorStatus = 'Stationary';
    
    if (status.isApproachingFire) {
      behaviorStatus = `🔥 Investigating fire ${status.currentTargetFire || 'unknown'}`;
    } else if (status.isRoaming) {
      behaviorStatus = '🚶 Roaming';
    }
    
    console.log(`🚶 ${status.agentId}`);
    console.log(`   Position: ${status.currentPosition.lat.toFixed(4)}, ${status.currentPosition.lon.toFixed(4)}`);
    console.log(`   Status: ${behaviorStatus} | Active: ${status.isActive ? '✅' : '❌'}`);
    console.log(`   Fires Reported: ${status.reportedFires.length}`);
  });
  
  console.log('==================\n');
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  let civilians: CivilianAgent[] = [];
  
  try {
    // Create and start civilian agents (default 5)
    const civilianCount = parseInt(process.env.CIVILIAN_COUNT || '5');
    civilians = await createCivilians(civilianCount);
    await startCivilians(civilians);
    
    // Set up status display interval
    const statusInterval = setInterval(() => {
      displayStatus(civilians);
    }, 30000); // Show status every 30 seconds
    
    // Set up graceful shutdown
    const shutdown = async () => {
      console.log('\n🔄 Graceful shutdown initiated...');
      clearInterval(statusInterval);
      await stopCivilians(civilians);
      process.exit(0);
    };
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep the process running
    console.log('🎮 Civilian agent system is running.');
    console.log(`🚶 ${civilians.length} civilians roaming Dallas and watching for fires.`);
    console.log('🔥 When they spot a fire, they will:');
    console.log('   1. Approach the fire to investigate (30-50m away)');
    console.log('   2. Make an emergency call to report it');
    console.log('   3. Move away from the fire to safety (200-300m away)');
    console.log('📞 Emergency calls are published as "emergency.fire.reported" events.');
    
    // Show initial status
    setTimeout(() => displayStatus(civilians), 10000);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    
    // Try to clean up on error
    if (civilians.length > 0) {
      await stopCivilians(civilians);
    }
    
    process.exit(1);
  }
}

// Start the system if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

// Export for programmatic use
export { CivilianAgent, main as startCivilianSystem };
