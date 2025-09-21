#!/usr/bin/env node
/**
 * Smart Firefighter Agent System
 * 
 * Features:
 * - Spawns firefighter agents at actual Dallas fire station locations
 * - Distance-based dispatch system (only nearby firefighters respond)
 * - Fire intensity-based response ranges
 * - Multi-fire handling (available firefighters can respond to new fires)
 * - Priority dispatch (closer firefighters respond faster)
 */

import { KadiClient } from '@kadi.build/core';

// Firefighter agent configuration
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
const networks = process.env.KADI_NETWORKS?.split(',') || ['global'];

console.log(`🚒 Firefighter Agent connecting to: ${brokerUrl}`);
console.log(`🌍 Using networks: ${networks.join(', ')}`);

// Real Dallas Fire Station coordinates
const DALLAS_FIRE_STATIONS = [
  { id: 'Fire Station 1', lat: 32.7767, lon: -96.7970 }, // Downtown Dallas
  { id: 'Fire Station 2', lat: 32.7834, lon: -96.8067 }, // Oak Lawn
  { id: 'Fire Station 3', lat: 32.7555, lon: -96.8022 }, // Bishop Arts
  { id: 'Fire Station 4', lat: 32.7462, lon: -96.7728 }, // Fair Park area
  { id: 'Fire Station 5', lat: 32.8023, lon: -96.7694 }, // Lower Greenville
  { id: 'Fire Station 6', lat: 32.7311, lon: -96.7756 }, // South Dallas
  { id: 'Fire Station 7', lat: 32.8234, lon: -96.8445 }, // Love Field area
  { id: 'Fire Station 8', lat: 32.7689, lon: -96.7267 }, // East Dallas
];

// Smart firefighter agent class
class FirefighterAgent {
  public readonly agentId: string;
  public readonly stationInfo: { id: string; lat: number; lon: number };
  
  private client: KadiClient;
  private isActive = false;
  private currentFireId: string | null = null;
  private isRespondingToFire = false;

  constructor(stationInfo: { id: string; lat: number; lon: number }) {
    this.stationInfo = stationInfo;
    this.agentId = `firefighter-${stationInfo.id.replace(/\s+/g, '-').toLowerCase()}`;

    // Initialize KADI client
    this.client = new KadiClient({
      name: this.agentId,
      role: 'agent',
      transport: 'broker',
      brokers: { remote: brokerUrl },
      defaultBroker: 'remote',
      networks
    });

    console.log(`🚒 Created ${this.agentId} at ${stationInfo.id}`);
    console.log(`   Location: ${stationInfo.lat.toFixed(4)}, ${stationInfo.lon.toFixed(4)}`);
  }

  /**
   * Start the firefighter agent
   */
  async start(): Promise<void> {
    try {
      // Connect to KADI broker
      await this.client.connectToBrokers();
      console.log(`✅ ${this.agentId} connected to broker`);
      
      // Spawn the firefighter at the fire station
      await this.spawnAtStation();
      
      // Set up basic event handling (optional - can listen for fire events)
      await this.setupEventHandlers();
      
      this.isActive = true;
      console.log(`🎮 ${this.agentId} is now active and stationed - ready to respond to fires`);
      console.log(`📡 ${this.agentId} listening for fire.* events on networks: ${networks.join(', ')}`);
      
    } catch (error) {
      console.error(`❌ Failed to start ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Stop the firefighter agent
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
   * Spawn the firefighter at their assigned fire station
   */
  private async spawnAtStation(): Promise<void> {
    try {
      // Use world-simulator for spawning with firefighter type
      const result = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'firefighter', // Firefighter agent type
        position: { lat: this.stationInfo.lat, lon: this.stationInfo.lon },
        status: 'available' // Ready for dispatch
      });

      // Publish firefighter spawned event so it shows up on the map
      await this.client.publishEvent('firefighter.spawned', {
        firefighterId: this.agentId,
        type: 'firefighter',
        stationId: this.stationInfo.id,
        stationLocation: {
          latitude: this.stationInfo.lat,
          longitude: this.stationInfo.lon
        },
        status: 'available',
        timestamp: new Date().toISOString()
      });

      console.log(`🚒 ${this.agentId} spawned at ${this.stationInfo.id} (${this.stationInfo.lat.toFixed(4)}, ${this.stationInfo.lon.toFixed(4)})`);
      
    } catch (error) {
      console.error(`❌ Failed to spawn ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Set up smart event handlers with distance-based dispatch
   */
  private async setupEventHandlers(): Promise<void> {
    // Listen for position updates
    await this.client.subscribeToEvent('agent.position.updated', async (event: any) => {
      if (event.agentId === this.agentId) {
        const wasMoving = event.moving || false;
        console.log(`📍 ${this.agentId} position: ${event.lat.toFixed(4)}, ${event.lon.toFixed(4)} ${event.moving ? '🚶' : '🧍'}`);
        
        // If we were responding to a fire and now stopped moving, we've arrived at fire
        if (this.isRespondingToFire && !wasMoving) {
          await this.arrivedAtFire(event.lat, event.lon);
        }
        // If we're not responding to fire but we're moving and then stop at station, we've returned
        else if (!this.isRespondingToFire && !wasMoving) {
          // Check if we're close to our station (within 50 meters)
          const distanceToStation = this.calculateDistance(
            event.lat, event.lon, 
            this.stationInfo.lat, this.stationInfo.lon
          );
          
          if (distanceToStation <= 50) {
            await this.arrivedAtStation();
          }
        }
      }
    });

    // Smart fire event handling with distance-based dispatch
    await this.client.subscribeToEvent('fire.*', async (data: any) => {
      if (this.isActive && data.latitude && data.longitude) {
        console.log(`🔥 ${this.agentId} received fire event:`, data);
        
        // Respond to fire.started events or events with fire_start type
        if (data.event_type === 'fire_start' || !data.event_type) {
          // Calculate distance to fire
          const distance = this.calculateDistance(
            this.stationInfo.lat, 
            this.stationInfo.lon, 
            data.latitude, 
            data.longitude
          );
          
          // Determine response range based on fire intensity
          const fireIntensity = data.intensity || 0.5; // Default to medium intensity
          const maxResponseDistance = this.getResponseDistance(fireIntensity);
          
          console.log(`📏 ${this.agentId} is ${distance.toFixed(0)}m from fire (intensity: ${(fireIntensity * 100).toFixed(0)}%, max range: ${maxResponseDistance}m)`);
          
          // Only respond if within response range and not already busy
          if (distance <= maxResponseDistance) {
            if (!this.isRespondingToFire) {
              // Add small delay based on distance to let closer stations go first
              const responseDelay = Math.min(distance / 200, 3000); // Max 3 second delay
              
              setTimeout(async () => {
                // Double-check we're still not busy (another fire might have claimed us)
                if (!this.isRespondingToFire) {
                  console.log(`🚨 ${this.agentId} responding to fire alert at ${data.latitude.toFixed(4)}, ${data.longitude.toFixed(4)} (${distance.toFixed(0)}m away)`);
                  await this.respondToFire(data.latitude, data.longitude, data.fireId || 'unknown');
                } else {
                  console.log(`⏸️ ${this.agentId} was claimed by another fire during delay`);
                }
              }, responseDelay);
            } else {
              console.log(`🚒 ${this.agentId} already responding to fire ${this.currentFireId} - cannot respond to new fire`);
            }
          } else {
            console.log(`📏 ${this.agentId} too far from fire (${distance.toFixed(0)}m > ${maxResponseDistance}m) - not responding`);
          }
          
        } else if (data.event_type === 'fire_spread') {
          console.log(`📈 ${this.agentId} received fire spread notification for ${data.fireId || 'unknown'}`);
          // Could intensify response if needed
        } else if (data.event_type === 'fire_extinguished') {
          console.log(`💧 ${this.agentId} received fire extinguished notification for ${data.fireId || 'unknown'}`);
          
          // If this was our fire, we can return to station or be available for new fires
          if (this.currentFireId === data.fireId) {
            console.log(`✅ ${this.agentId} fire ${data.fireId} extinguished - now available for new calls`);
            this.isRespondingToFire = false;
            this.currentFireId = null;
          }
        } else {
          console.log(`ℹ️ ${this.agentId} received unknown fire event type: ${data.event_type}`);
        }
      } else {
        console.log(`⚠️ ${this.agentId} received fire event but missing location data:`, data);
      }
    });
  }

  /**
   * Respond to a fire by moving to the fire location
   */
  private async respondToFire(fireLatitude: number, fireLongitude: number, fireId: string): Promise<void> {
    try {
      // Set fire response state
      this.currentFireId = fireId;
      this.isRespondingToFire = true;
      
      // Publish firefighter response event
      await this.client.publishEvent('firefighter.response', {
        id: this.agentId,
        type: 'firefighter',
        event: "fire_response",
        longitude: fireLongitude,
        latitude: fireLatitude,
        timestamp: new Date().toISOString(),
        fireId: fireId,
        stationId: this.stationInfo.id
      });

      // Move to fire location using world-simulator
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: { lat: fireLatitude, lon: fireLongitude },
        profile: 'walking', // Could be 'driving' for faster response
        urgency: 'emergency' // Changed from 'high' to 'emergency'
      });

      if ((result as any)?.success) {
        console.log(`🚒 ${this.agentId} dispatched to fire ${fireId} at ${fireLatitude.toFixed(4)}, ${fireLongitude.toFixed(4)}`);
        
        // Publish firefighter dispatch event
        await this.client.publishEvent('firefighter.dispatch', {
          id: this.agentId,
          type: 'firefighter',
          event: "dispatched",
          longitude: fireLongitude,
          latitude: fireLatitude,
          timestamp: new Date().toISOString(),
          fireId: fireId,
          stationId: this.stationInfo.id,
          destination: { latitude: fireLatitude, longitude: fireLongitude }
        });
      } else {
        console.warn(`⚠️ ${this.agentId} movement to fire failed`);
        this.isRespondingToFire = false;
        this.currentFireId = null;
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} fire response failed:`, error);
      this.isRespondingToFire = false;
      this.currentFireId = null;
    }
  }

  /**
   * Handle arrival at fire location, extinguish fire, and return to station
   */
  private async arrivedAtFire(latitude: number, longitude: number): Promise<void> {
    try {
      console.log(`🔥 ${this.agentId} arrived at fire location ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      
      // Use vision to check what's around us - look for the fire
      const vision = await this.getVision();
      console.log(`👁️ ${this.agentId} vision check:`, vision);

      // Check if we can see any fire hazards nearby
      const fireHazards = vision.hazards?.filter((h: any) => h.type === 'fire') || [];
      let fireLat = latitude;
      let fireLon = longitude;
      if (fireHazards.length > 0) {
        fireLat = fireHazards[0].position?.lat ?? latitude;
        fireLon = fireHazards[0].position?.lon ?? longitude;
        console.log(`🎯 ${this.agentId} confirmed fire detected - ${fireHazards.length} fire hazards in vision`);
      } else {
        console.log(`❓ ${this.agentId} arrived but no fire detected in vision - may have missed the target`);
      }

      // Check distance to fire
      const distanceToFire = this.calculateDistance(latitude, longitude, fireLat, fireLon);
      if (distanceToFire > 44) {
        console.log(`🚶 ${this.agentId} is ${distanceToFire.toFixed(1)}m from fire, moving closer...`);
        const moveResult = await this.client.callTool('world-simulator', 'moveMe', {
          agentId: this.agentId,
          destination: { lat: fireLat, lon: fireLon },
          profile: 'walking',
          urgency: 'emergency'
        });
        if ((moveResult as any)?.success) {
          console.log(`🚶 ${this.agentId} moved closer to fire at ${fireLat}, ${fireLon}`);
        } else {
          console.warn(`⚠️ ${this.agentId} failed to move closer to fire`);
        }
        // Wait for position update event before suppressing
        return;
      }

      // Publish firefighter arrival event (status update, not position tracking)
      await this.client.publishEvent('firefighter.arrived', {
        firefighterId: this.agentId,
        type: 'firefighter',
        action: "arrived_at_fire",
        fireId: this.currentFireId || 'unknown',
        stationId: this.stationInfo.id,
        fireDetected: fireHazards.length > 0,
        hazardsInVision: fireHazards.length,
        timestamp: new Date().toISOString()
      });

      // Begin suppression loop: keep calling suppressFire until fire is extinguished
      const fireId = this.currentFireId;
      if (!fireId) {
        console.warn(`⚠️ ${this.agentId} has no currentFireId, cannot suppress fire`);
        return;
      }

      let fireExtinguished = false;
      let attempt = 0;
      while (!fireExtinguished && attempt < 20) { // Max 20 attempts (safety)
        attempt++;
        console.log(`🚒 ${this.agentId} attempting to suppress fire ${fireId} (attempt ${attempt})...`);
        try {
          const result: any = await this.client.callTool('world-simulator', 'suppressFire', {
            agentId: this.agentId,
            fireId: fireId,
            suppressionRate: 0.3 // or adjust as needed
          });
          if (result && result.success && result.fireExtinguished) {
            console.log(`💧 ${this.agentId} extinguished fire ${fireId}!`);
            fireExtinguished = true;
            break;
          } else {
            console.log(`🔥 ${this.agentId} suppression attempt: fire still burning (remaining intensity: ${result && result.remainingIntensity !== undefined ? result.remainingIntensity : 'unknown'})`);
          }
        } catch (err) {
          console.error(`❌ ${this.agentId} error calling suppressFire:`, err);
        }
        // Wait a bit before next attempt
        await new Promise(res => setTimeout(res, 1200));
      }

      if (fireExtinguished) {
        // Publish fire extinguished event (for logging/analytics)
        await this.client.publishEvent('fire.extinguished', {
          fireId: fireId,
          extinguishedBy: this.agentId,
          extinguisherType: 'firefighter',
          action: "extinguished",
          location: {
            latitude: fireLat,
            longitude: fireLon
          },
          timestamp: new Date().toISOString(),
          stationId: this.stationInfo.id,
        });
        // Continue to completion/return
        await this.extinguishFireAndReturn(fireLat, fireLon);
      } else {
        console.warn(`⚠️ ${this.agentId} failed to extinguish fire ${fireId} after ${attempt} attempts.`);
        // Still return to station, but log failure
        await this.extinguishFireAndReturn(fireLat, fireLon);
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} arrival notification failed:`, error);
      // Reset state on error
      this.isRespondingToFire = false;
      this.currentFireId = null;
    }
  }

  /**
   * Extinguish the fire and return to station
   */
  private async extinguishFireAndReturn(fireLatitude: number, fireLongitude: number): Promise<void> {
    try {
      const currentFireId = this.currentFireId;
      
      console.log(`💧 ${this.agentId} extinguished fire ${currentFireId}!`);
      
      // Publish fire extinguished event (make sure it's clearly a firefighter action, not a fire entity)
      await this.client.publishEvent('fire.extinguished', {
        fireId: currentFireId || 'unknown', // Put fireId first to be clear
        extinguishedBy: this.agentId,
        extinguisherType: 'firefighter',
        action: "extinguished",
        location: {
          latitude: fireLatitude,
          longitude: fireLongitude
        },
        timestamp: new Date().toISOString(),
        stationId: this.stationInfo.id,
        // Don't include 'id' or 'type' that might confuse frontend tracking
        // This is about the fire being extinguished, not about spawning an agent
      });
      
      // Also publish firefighter completion event (about firefighter status, not location)
      await this.client.publishEvent('firefighter.completed', {
        firefighterId: this.agentId,
        type: 'firefighter',
        action: "completed_mission",
        fireId: currentFireId || 'unknown',
        stationId: this.stationInfo.id,
        timestamp: new Date().toISOString(),
        status: 'returning_to_station'
        // Removed longitude/latitude to avoid frontend confusion
      });
      
      console.log(`🏠 ${this.agentId} returning to station ${this.stationInfo.id}...`);
      
      // Return to fire station
      await this.returnToStation();
      
    } catch (error) {
      console.error(`❌ ${this.agentId} fire extinguishing failed:`, error);
      // Reset state on error
      this.isRespondingToFire = false;
      this.currentFireId = null;
    }
  }

  /**
   * Return to fire station after completing firefighting
   */
  private async returnToStation(): Promise<void> {
    try {
      // Move back to fire station using world-simulator
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: { lat: this.stationInfo.lat, lon: this.stationInfo.lon },
        profile: 'walking',
        urgency: 'normal' // Not urgent on the way back
      });

      if ((result as any)?.success) {
        console.log(`🚒 ${this.agentId} heading back to ${this.stationInfo.id}`);
        
        // Publish return event
        await this.client.publishEvent('firefighter.returning', {
          id: this.agentId,
          type: 'firefighter',
          event: "returning_to_station",
          longitude: this.stationInfo.lon,
          latitude: this.stationInfo.lat,
          timestamp: new Date().toISOString(),
          stationId: this.stationInfo.id,
          destination: { latitude: this.stationInfo.lat, longitude: this.stationInfo.lon }
        });
      } else {
        console.warn(`⚠️ ${this.agentId} failed to start return journey`);
        // Reset state even if movement fails
        await this.resetToStationReady();
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} return to station failed:`, error);
      // Reset state on error
      await this.resetToStationReady();
    }
  }

  /**
   * Handle successful return to station
   */
  private async arrivedAtStation(): Promise<void> {
    try {
      console.log(`🏠 ${this.agentId} arrived back at ${this.stationInfo.id} - ready for new calls`);
      
      // Publish back at station event
      await this.client.publishEvent('firefighter.stationed', {
        id: this.agentId,
        type: 'firefighter',
        event: "back_at_station",
        longitude: this.stationInfo.lon,
        latitude: this.stationInfo.lat,
        timestamp: new Date().toISOString(),
        stationId: this.stationInfo.id,
        status: 'available'
      });
      
      // Reset to ready state
      await this.resetToStationReady();
      
    } catch (error) {
      console.error(`❌ ${this.agentId} station arrival notification failed:`, error);
      await this.resetToStationReady();
    }
  }

  /**
   * Reset firefighter to ready state at station
   */
  private async resetToStationReady(): Promise<void> {
    this.isRespondingToFire = false;
    this.currentFireId = null;
    console.log(`✅ ${this.agentId} is now available for new fire calls`);
  }

  /**
   * Get vision from world simulator to see what's around the firefighter
   */
  private async getVision(): Promise<any> {
    try {
      const result = await this.client.callTool('world-simulator', 'whatDoISee', {
        agentId: this.agentId,
        visionRange: 200 // 200 meter vision range for firefighters
      });
      
      return result;
      
    } catch (error) {
      console.warn(`⚠️ ${this.agentId} vision failed:`, error);
      return { hazards: [], agents: [], exits: [] };
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

  /**
   * Calculate response distance based on fire intensity
   */
  private getResponseDistance(intensity: number): number {
    // Base response distance: 2km
    const baseDistance = 2000;
    
    // High intensity fires get wider response (more stations respond)
    // Low intensity fires only get nearby stations
    if (intensity >= 0.8) {
      return baseDistance * 1.5; // 3km for high intensity fires
    } else if (intensity >= 0.5) {
      return baseDistance; // 2km for medium intensity fires
    } else {
      return baseDistance * 0.75; // 1.5km for low intensity fires
    }
  }

  /**
   * Get firefighter status
   */
  getStatus(): any {
    return {
      agentId: this.agentId,
      stationInfo: this.stationInfo,
      type: 'firefighter',
      status: this.isRespondingToFire ? 'responding' : 'stationed',
      isActive: this.isActive,
      currentFireId: this.currentFireId,
      isRespondingToFire: this.isRespondingToFire
    };
  }
}

/**
 * Create firefighter agents for all fire stations
 */
async function createFirefighters(): Promise<FirefighterAgent[]> {
  const firefighters: FirefighterAgent[] = [];
  
  for (const station of DALLAS_FIRE_STATIONS) {
    const firefighter = new FirefighterAgent(station);
    firefighters.push(firefighter);
  }
  
  console.log(`🚒 Created ${firefighters.length} firefighter agents with smart dispatch system`);
  return firefighters;
}

/**
 * Start all firefighter agents
 */
async function startFirefighters(firefighters: FirefighterAgent[]): Promise<void> {
  console.log('🚀 Starting smart firefighter agent system...');
  
  // Start firefighters with staggered timing
  for (let i = 0; i < firefighters.length; i++) {
    const firefighter = firefighters[i];
    
    try {
      await firefighter.start();
      
      // Small delay between firefighter starts
      if (i < firefighters.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      console.error(`❌ Failed to start ${firefighter.agentId}:`, error);
    }
  }
  
  console.log(`✅ Started ${firefighters.length} firefighter agents at their stations`);
}

/**
 * Stop all firefighter agents
 */
async function stopFirefighters(firefighters: FirefighterAgent[]): Promise<void> {
  console.log('🛑 Stopping firefighter agent system...');
  
  const stopPromises = firefighters.map(firefighter => firefighter.stop());
  await Promise.allSettled(stopPromises);
  
  console.log('✅ All firefighter agents stopped');
}

/**
 * Display firefighter status
 */
function displayStatus(firefighters: FirefighterAgent[]): void {
  console.log('\n📊 Firefighter Status:');
  console.log('======================');
  
  firefighters.forEach(firefighter => {
    const status = firefighter.getStatus();
    console.log(`🚒 ${status.agentId}`);
    console.log(`   Station: ${status.stationInfo.id}`);
    console.log(`   Location: ${status.stationInfo.lat.toFixed(4)}, ${status.stationInfo.lon.toFixed(4)}`);
    console.log(`   Status: ${status.status} | Active: ${status.isActive ? '✅' : '❌'}`);
  });
  
  console.log('======================\n');
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  let firefighters: FirefighterAgent[] = [];
  
  try {
    // Create and start firefighter agents
    firefighters = await createFirefighters();
    await startFirefighters(firefighters);
    
    // Set up status display interval
    const statusInterval = setInterval(() => {
      displayStatus(firefighters);
    }, 60000); // Show status every 60 seconds
    
    // Set up graceful shutdown
    const shutdown = async () => {
      console.log('\n🔄 Graceful shutdown initiated...');
      clearInterval(statusInterval);
      await stopFirefighters(firefighters);
      process.exit(0);
    };
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep the process running
    console.log('🎮 Firefighter agent system is running.');
    console.log(`🚒 ${firefighters.length} firefighters stationed at Dallas fire stations.`);
    console.log('🔥 They will receive fire alerts and are ready for dispatch.');
    
    // Show initial status
    setTimeout(() => displayStatus(firefighters), 5000);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    
    // Try to clean up on error
    if (firefighters.length > 0) {
      await stopFirefighters(firefighters);
    }
    
    process.exit(1);
  }
}

// Start the system if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

// Export for programmatic use
export { FirefighterAgent, main as startFirefighterSystem };
