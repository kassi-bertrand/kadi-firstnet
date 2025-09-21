#!/usr/bin/env node
/**
 * Command-Integrated Firefighter Agent System V2
 * 
 * Features:
 * - Spawns firefighter agents at Dallas fire stations
 * - Remains stationed until commanded by Emergency Command Center
 * - Responds specifically to fire.emergency_dispatch events from commander
 * - Travels to assigned fires and extinguishes them
 * - Reports completion back to command center
 * - Automatically returns to station after mission completion
 * - Integrates seamlessly with Emergency Command Center dispatch system
 */

import { KadiClient } from '@kadi.build/core';

// Firefighter agent configuration
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
const networks = process.env.KADI_NETWORKS?.split(',') || ['global'];

console.log(`🚒 Command-Integrated Firefighter System connecting to: ${brokerUrl}`);
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

// Command-integrated firefighter agent class
class CommandIntegratedFirefighter {
  public readonly agentId: string;
  public readonly stationInfo: { id: string; lat: number; lon: number };
  
  private client: KadiClient;
  private isActive = false;
  private status: 'stationed' | 'dispatched' | 'responding' | 'fighting_fire' | 'returning' = 'stationed';
  private currentMission: any = null;
  private assignedFire: string | null = null;

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
    console.log(`   Station: ${stationInfo.lat.toFixed(4)}, ${stationInfo.lon.toFixed(4)}`);
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
      
      // Set up command center integration
      await this.setupCommandIntegration();
      
      this.isActive = true;
      this.status = 'stationed';
      
      // Report ready status to command center
      await this.reportStatusToCommand();
      
      console.log(`🎮 ${this.agentId} stationed and awaiting command center dispatch orders`);
      
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
    this.status = 'stationed';
    
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
      const result = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'firefighter',
        position: { lat: this.stationInfo.lat, lon: this.stationInfo.lon },
        status: 'available'
      });

      // Publish firefighter spawned event
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

      console.log(`🚒 ${this.agentId} spawned and stationed at ${this.stationInfo.id}`);
      
    } catch (error) {
      console.error(`❌ Failed to spawn ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Set up command center integration and dispatch listening
   */
  private async setupCommandIntegration(): Promise<void> {
    // Listen for position updates to track movement progress
    await this.client.subscribeToEvent('agent.position.updated', async (event: any) => {
      if (event.agentId === this.agentId) {
        await this.handlePositionUpdate(event);
      }
    });

    // 🎯 MAIN: Listen for emergency dispatch orders from command center
    await this.client.subscribeToEvent('fire.emergency_dispatch', async (dispatch: any) => {
      // Check if this dispatch is specifically for us
      if (dispatch.targetFirefighter === this.agentId || !dispatch.targetFirefighter) {
        await this.handleEmergencyDispatch(dispatch);
      }
    });

    // Also listen for general fire events (backup/fallback)
    await this.client.subscribeToEvent('fire.*', async (event: any) => {
      if (event.commandCenter && event.targetFirefighter === this.agentId) {
        await this.handleEmergencyDispatch(event);
      }
    });

    console.log(`📡 ${this.agentId} listening for command center dispatch orders`);
  }

  /**
   * Handle emergency dispatch orders from command center
   */
  private async handleEmergencyDispatch(dispatch: any): Promise<void> {
    try {
      // Only respond if we're available
      if (this.status !== 'stationed') {
        console.log(`🚒 ${this.agentId} received dispatch but currently ${this.status} - cannot respond`);
        return;
      }

      const fireId = dispatch.fireId;
      const fireLocation = { lat: dispatch.latitude, lon: dispatch.longitude };
      
      console.log(`🚨 ${this.agentId} RECEIVED EMERGENCY DISPATCH!`);
      console.log(`   Fire ID: ${fireId}`);
      console.log(`   Location: ${fireLocation.lat.toFixed(4)}, ${fireLocation.lon.toFixed(4)}`);
      console.log(`   Urgency: ${dispatch.urgency}`);
      console.log(`   Dispatched by: ${dispatch.dispatchedBy}`);

      // Accept the mission
      this.currentMission = dispatch;
      this.assignedFire = fireId;
      this.status = 'dispatched';

      // Report dispatch acknowledgment to command center
      await this.client.publishEvent('firefighter.dispatched', {
        firefighterId: this.agentId,
        action: 'dispatch_acknowledged',
        fireId: fireId,
        stationId: this.stationInfo.id,
        timestamp: new Date().toISOString(),
        estimatedArrival: this.estimateArrivalTime(fireLocation)
      });

      // Begin response to fire location
      await this.respondToFire(fireLocation, fireId);

    } catch (error) {
      console.error(`❌ ${this.agentId} failed to handle dispatch:`, error);
      this.resetToStation();
    }
  }

  /**
   * Respond to fire location
   */
  private async respondToFire(fireLocation: { lat: number; lon: number }, fireId: string): Promise<void> {
    try {
      this.status = 'responding';
      
      console.log(`🚒➡️🔥 ${this.agentId} responding to fire ${fireId}`);

      // Move to fire location
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: { lat: fireLocation.lat, lon: fireLocation.lon },
        profile: 'driving', // Emergency response - use driving for speed
        urgency: 'emergency'
      });

      if ((result as any)?.success) {
        console.log(`🚒 ${this.agentId} en route to fire ${fireId}`);
        
        // Publish response event
        await this.client.publishEvent('firefighter.responding', {
          firefighterId: this.agentId,
          action: 'en_route',
          fireId: fireId,
          stationId: this.stationInfo.id,
          destination: fireLocation,
          timestamp: new Date().toISOString()
        });
      } else {
        console.error(`❌ ${this.agentId} failed to start response to fire ${fireId}`);
        this.resetToStation();
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} failed to respond to fire:`, error);
      this.resetToStation();
    }
  }

  /**
   * Handle position updates and arrival detection
   */
  private async handlePositionUpdate(event: any): Promise<void> {
    const wasMoving = event.moving || false;
    
    // When we stop moving, check what we should do
    if (!wasMoving && this.currentMission) {
      if (this.status === 'responding') {
        // We've arrived at the fire
        await this.arriveAtFire(event.lat, event.lon);
      } else if (this.status === 'returning') {
        // We've returned to station
        await this.arriveAtStation();
      }
    }
  }

  /**
   * Handle arrival at fire location
   */
  private async arriveAtFire(lat: number, lon: number): Promise<void> {
    try {
      const fireId = this.assignedFire;
      if (!fireId) {
        console.error(`❌ ${this.agentId} arrived but no assigned fire ID`);
        this.resetToStation();
        return;
      }
      
      console.log(`🔥 ${this.agentId} ARRIVED AT FIRE ${fireId}!`);
      
      this.status = 'fighting_fire';
      
      // Report arrival to command center
      await this.client.publishEvent('firefighter.arrived', {
        firefighterId: this.agentId,
        action: 'arrived_at_fire',
        fireId: fireId,
        stationId: this.stationInfo.id,
        location: { latitude: lat, longitude: lon },
        timestamp: new Date().toISOString()
      });

      // Begin firefighting operations
      await this.fightFire(fireId);

    } catch (error) {
      console.error(`❌ ${this.agentId} arrival handling failed:`, error);
      this.resetToStation();
    }
  }

  /**
   * Fight the fire and extinguish it
   */
  private async fightFire(fireId: string): Promise<void> {
    try {
      console.log(`🔥🚒 ${this.agentId} fighting fire ${fireId}...`);
      
      // Simulate firefighting time (5-10 seconds)
      const firefightingTime = 5000 + Math.random() * 5000;
      
      await new Promise(resolve => setTimeout(resolve, firefightingTime));
      
      // Fire successfully extinguished!
      console.log(`💧 ${this.agentId} EXTINGUISHED FIRE ${fireId}!`);
      
      // Report fire extinguished to command center and fire agent
      await this.client.publishEvent('fire.extinguished', {
        fireId: fireId,
        extinguishedBy: this.agentId,
        extinguisherType: 'firefighter',
        action: 'extinguished',
        timestamp: new Date().toISOString(),
        stationId: this.stationInfo.id,
        location: this.currentMission ? {
          latitude: this.currentMission.latitude,
          longitude: this.currentMission.longitude
        } : null
      });

      // Report mission completion to command center
      await this.client.publishEvent('firefighter.completed', {
        firefighterId: this.agentId,
        action: 'completed_mission',
        fireId: fireId,
        stationId: this.stationInfo.id,
        timestamp: new Date().toISOString(),
        status: 'returning_to_station'
      });

      console.log(`✅ ${this.agentId} mission completed - returning to station`);
      
      // Return to station
      await this.returnToStation();

    } catch (error) {
      console.error(`❌ ${this.agentId} firefighting failed:`, error);
      this.resetToStation();
    }
  }

  /**
   * Return to fire station
   */
  private async returnToStation(): Promise<void> {
    try {
      this.status = 'returning';
      
      console.log(`🏠 ${this.agentId} returning to ${this.stationInfo.id}`);

      // Move back to fire station
      const result = await this.client.callTool('world-simulator', 'moveMe', {
        agentId: this.agentId,
        destination: { lat: this.stationInfo.lat, lon: this.stationInfo.lon },
        profile: 'driving',
        urgency: 'normal'
      });

      if ((result as any)?.success) {
        // Publish return notification
        await this.client.publishEvent('firefighter.returning', {
          firefighterId: this.agentId,
          action: 'returning_to_station',
          stationId: this.stationInfo.id,
          destination: {
            latitude: this.stationInfo.lat,
            longitude: this.stationInfo.lon
          },
          timestamp: new Date().toISOString()
        });
      } else {
        console.error(`❌ ${this.agentId} failed to start return journey`);
        this.resetToStation();
      }
      
    } catch (error) {
      console.error(`❌ ${this.agentId} return to station failed:`, error);
      this.resetToStation();
    }
  }

  /**
   * Handle successful return to station
   */
  private async arriveAtStation(): Promise<void> {
    try {
      console.log(`🏠 ${this.agentId} BACK AT STATION and ready for next dispatch`);
      
      // Reset to stationed status
      this.resetToStation();
      
      // Report back to command center
      await this.client.publishEvent('firefighter.stationed', {
        firefighterId: this.agentId,
        action: 'back_at_station',
        stationId: this.stationInfo.id,
        status: 'stationed',
        availability: 'available',
        timestamp: new Date().toISOString()
      });

      await this.reportStatusToCommand();
      
    } catch (error) {
      console.error(`❌ ${this.agentId} station arrival failed:`, error);
      this.resetToStation();
    }
  }

  /**
   * Reset firefighter to stationed status
   */
  private resetToStation(): void {
    this.status = 'stationed';
    this.currentMission = null;
    this.assignedFire = null;
    console.log(`✅ ${this.agentId} reset to stationed status`);
  }

  /**
   * Report current status to command center
   */
  private async reportStatusToCommand(): Promise<void> {
    try {
      await this.client.publishEvent('firefighter.status', {
        firefighterId: this.agentId,
        type: 'firefighter',
        status: this.status,
        stationId: this.stationInfo.id,
        stationLocation: {
          latitude: this.stationInfo.lat,
          longitude: this.stationInfo.lon
        },
        availability: this.status === 'stationed' ? 'available' : 'busy',
        currentMission: this.assignedFire,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.warn(`⚠️ ${this.agentId} failed to report status:`, error);
    }
  }

  /**
   * Estimate arrival time at fire location
   */
  private estimateArrivalTime(fireLocation: { lat: number; lon: number }): string {
    // Simple distance calculation for estimation
    const distance = this.calculateDistance(
      this.stationInfo.lat, this.stationInfo.lon,
      fireLocation.lat, fireLocation.lon
    );
    
    // Estimate time based on emergency response speed (~60 km/h average)
    const estimatedMinutes = Math.ceil(distance / 1000 * 60 / 60); // Convert to minutes
    const arrivalTime = new Date(Date.now() + estimatedMinutes * 60000);
    
    return arrivalTime.toISOString();
  }

  /**
   * Calculate distance between coordinates in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const latDiff = lat1 - lat2;
    const lonDiff = lon1 - lon2;
    return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111000; // Convert to meters approximately
  }

  /**
   * Get firefighter status
   */
  getStatus(): any {
    return {
      agentId: this.agentId,
      stationInfo: this.stationInfo,
      type: 'firefighter',
      status: this.status,
      isActive: this.isActive,
      assignedFire: this.assignedFire,
      currentMission: this.currentMission,
      availability: this.status === 'stationed' ? 'available' : 'busy'
    };
  }
}

/**
 * Create firefighter agents for all fire stations
 */
async function createFirefighters(): Promise<CommandIntegratedFirefighter[]> {
  const firefighters: CommandIntegratedFirefighter[] = [];
  
  for (const station of DALLAS_FIRE_STATIONS) {
    const firefighter = new CommandIntegratedFirefighter(station);
    firefighters.push(firefighter);
  }
  
  console.log(`🚒 Created ${firefighters.length} command-integrated firefighters`);
  return firefighters;
}

/**
 * Start all firefighter agents
 */
async function startFirefighters(firefighters: CommandIntegratedFirefighter[]): Promise<void> {
  console.log('🚀 Starting command-integrated firefighter system...');
  
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
  
  console.log(`✅ All ${firefighters.length} firefighters stationed and awaiting command center dispatch`);
}

/**
 * Stop all firefighter agents
 */
async function stopFirefighters(firefighters: CommandIntegratedFirefighter[]): Promise<void> {
  console.log('🛑 Stopping firefighter system...');
  
  const stopPromises = firefighters.map(firefighter => firefighter.stop());
  await Promise.allSettled(stopPromises);
  
  console.log('✅ All firefighters stopped');
}

/**
 * Display firefighter status
 */
function displayFirefighterStatus(firefighters: CommandIntegratedFirefighter[]): void {
  console.log('\n🚒 FIREFIGHTER STATUS REPORT');
  console.log('=============================');
  
  let available = 0, busy = 0;
  
  firefighters.forEach(firefighter => {
    const status = firefighter.getStatus();
    
    if (status.availability === 'available') available++;
    else busy++;
    
    let statusIcon = '🏠'; // Stationed
    if (status.status === 'responding') statusIcon = '🚒';
    else if (status.status === 'fighting_fire') statusIcon = '🔥';
    else if (status.status === 'returning') statusIcon = '🔄';
    
    console.log(`${statusIcon} ${status.agentId}`);
    console.log(`   Station: ${status.stationInfo.id}`);
    console.log(`   Status: ${status.status} | ${status.availability}`);
    if (status.assignedFire) {
      console.log(`   Mission: Fire ${status.assignedFire}`);
    }
  });
  
  console.log('');
  console.log(`📊 Summary: ${available} Available | ${busy} Busy`);
  console.log('=============================\n');
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  let firefighters: CommandIntegratedFirefighter[] = [];
  
  try {
    // Create and start firefighter agents
    firefighters = await createFirefighters();
    await startFirefighters(firefighters);
    
    // Set up status display interval
    const statusInterval = setInterval(() => {
      displayFirefighterStatus(firefighters);
    }, 45000); // Show status every 45 seconds
    
    // Set up graceful shutdown
    const shutdown = async () => {
      console.log('\n🔄 Shutting down firefighter system...');
      clearInterval(statusInterval);
      await stopFirefighters(firefighters);
      process.exit(0);
    };
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep the process running
    console.log('🎮 Command-integrated firefighter system operational.');
    console.log(`🚒 ${firefighters.length} firefighters stationed at Dallas fire stations.`);
    console.log('🎯 Awaiting emergency dispatch orders from Command Center.');
    console.log('📡 Monitoring fire.emergency_dispatch channel for commands.');
    
    // Show initial status
    setTimeout(() => displayFirefighterStatus(firefighters), 3000);
    
  } catch (error) {
    console.error('❌ Fatal error in firefighter system:', error);
    
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
export { CommandIntegratedFirefighter, main as startFirefighterSystem };
