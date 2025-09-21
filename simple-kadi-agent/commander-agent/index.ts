#!/usr/bin/env node
/**
 * Emergency Command Center Agent
 * 
 * Features:
 * - Subscribes to emergency.fire.reported events from civilians
 * - Maintains full situational awareness through event tracking
 * - Dispatches closest available firefighters to fire locations
 * - Tracks all agent positions and statuses
 * - Coordinates emergency response operations
 * - Acts as central command and control for Dallas emergency services
 */

import { KadiClient } from '@kadi.build/core';

// Command agent configuration
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
const networks = process.env.KADI_NETWORKS?.split(',') || ['global'];

console.log(`🎯 Emergency Command Center connecting to: ${brokerUrl}`);
console.log(`🌍 Using networks: ${networks.join(', ')}`);

// Real Dallas Fire Station coordinates (for reference)
const DALLAS_FIRE_STATIONS = [
  { id: 'Fire Station 1', lat: 32.7767, lon: -96.7970 },
  { id: 'Fire Station 2', lat: 32.7834, lon: -96.8067 },
  { id: 'Fire Station 3', lat: 32.7555, lon: -96.8022 },
  { id: 'Fire Station 4', lat: 32.7462, lon: -96.7728 },
  { id: 'Fire Station 5', lat: 32.8023, lon: -96.7694 },
  { id: 'Fire Station 6', lat: 32.7311, lon: -96.7756 },
  { id: 'Fire Station 7', lat: 32.8234, lon: -96.8445 },
  { id: 'Fire Station 8', lat: 32.7689, lon: -96.7267 },
];

// Emergency Command Center class
class EmergencyCommandCenter {
  public readonly agentId = 'emergency-command-center';
  private client: KadiClient;
  private isActive = false;
  
  // Situational awareness tracking
  private activeFirefighters = new Map<string, any>(); // firefighterId -> status
  private activeFires = new Map<string, any>(); // fireId -> details
  private civilianReports = new Map<string, any>(); // reportId -> report
  private agentPositions = new Map<string, any>(); // agentId -> position
  private firefighterStations = new Map<string, any>(); // firefighterId -> station info
  
  // Dispatch tracking
  private activeDispatches = new Map<string, any>(); // fireId -> dispatch info
  private responseHistory = new Array<any>(); // Historical dispatch records

  constructor() {
    // Initialize KADI client
    this.client = new KadiClient({
      name: this.agentId,
      role: 'agent',
      transport: 'broker',
      brokers: { remote: brokerUrl },
      defaultBroker: 'remote',
      networks
    });

    console.log(`🎯 Created Emergency Command Center`);
    console.log(`   Role: Central Emergency Dispatch & Coordination`);
  }

  /**
   * Start the emergency command center
   */
  async start(): Promise<void> {
    try {
      // Connect to KADI broker
      await this.client.connectToBrokers();
      console.log(`✅ ${this.agentId} connected to broker`);
      
      // Spawn the command center in world-simulator
      await this.spawnCommandCenter();
      
      // Set up comprehensive event monitoring
      await this.setupEventHandlers();
      
      // Initialize situational awareness
      await this.initializeSituationalAwareness();
      
      this.isActive = true;
      console.log(`🎮 Emergency Command Center is now active and monitoring Dallas`);
      
    } catch (error) {
      console.error(`❌ Failed to start ${this.agentId}:`, error);
      throw error;
    }
  }

  /**
   * Stop the command center
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
   * Spawn the command center agent in world-simulator
   */
  private async spawnCommandCenter(): Promise<void> {
    try {
      // Command center coordinates (Dallas City Hall - central location for emergency coordination)
      const commandCenterLocation = {
        lat: 32.7767,  // Dallas City Hall coordinates
        lon: -96.7970
      };

      const result = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'commander',
        position: { lat: commandCenterLocation.lat, lon: commandCenterLocation.lon },
        status: 'available',
        properties: {
          role: 'emergency_dispatch',
          coverage_area: 'Dallas_Metro',
          capabilities: ['emergency_dispatch', 'resource_coordination', 'situational_awareness'],
          jurisdiction: 'Dallas_Emergency_Services'
        }
      });

      console.log(`🎯 Emergency Command Center spawned at Dallas City Hall (${commandCenterLocation.lat.toFixed(4)}, ${commandCenterLocation.lon.toFixed(4)})`);
      console.log(`🌍 Command Center is now visible in world-simulator with full Dallas oversight`);
      
    } catch (error) {
      console.error(`❌ Failed to spawn command center in world-simulator:`, error);
      console.warn(`⚠️ Command center will operate without world-simulator presence`);
    }
  }

  /**
   * Set up comprehensive event monitoring for situational awareness
   */
  private async setupEventHandlers(): Promise<void> {
    // 🚨 PRIMARY: Listen for emergency fire reports from civilians
    await this.client.subscribeToEvent('emergency.fire.reported', async (report: any) => {
      await this.handleEmergencyFireReport(report);
    });

    // 📍 Track all agent positions for full map awareness
    await this.client.subscribeToEvent('agent.position.updated', async (event: any) => {
      this.updateAgentPosition(event);
    });

    // 🚒 Monitor firefighter status changes
    await this.client.subscribeToEvent('firefighter.*', async (event: any) => {
      await this.handleFirefighterEvent(event);
    });

    // 🔥 Monitor fire events
    await this.client.subscribeToEvent('fire.*', async (event: any) => {
      await this.handleFireEvent(event);
    });

    // 🚶 Monitor civilian activity
    await this.client.subscribeToEvent('civilian.*', async (event: any) => {
      await this.handleCivilianEvent(event);
    });

    console.log(`📡 Command Center monitoring all emergency channels`);
  }

  /**
   * Handle emergency fire reports from civilians - PRIMARY FUNCTION
   */
  private async handleEmergencyFireReport(report: any): Promise<void> {
    try {
      const fireId = report.fireId;
      const reportId = `${report.reporterId}-${fireId}-${Date.now()}`;
      
      console.log(`🚨 EMERGENCY CALL RECEIVED!`);
      console.log(`   Fire ID: ${fireId}`);
      console.log(`   Reporter: ${report.reporterId} (${report.reporterType})`);
      console.log(`   Location: ${report.location.latitude.toFixed(4)}, ${report.location.longitude.toFixed(4)}`);
      console.log(`   Urgency: ${report.urgency}`);
      console.log(`   Description: ${report.description}`);

      // Store the civilian report
      this.civilianReports.set(reportId, {
        ...report,
        reportId,
        receivedAt: new Date().toISOString()
      });

      // Add fire to active tracking if not already known
      if (!this.activeFires.has(fireId)) {
        this.activeFires.set(fireId, {
          fireId,
          location: report.location,
          reportedBy: report.reporterId,
          firstReportedAt: new Date().toISOString(),
          urgency: report.urgency,
          fireDetails: report.fireDetails,
          status: 'reported'
        });
        
        console.log(`🔥 Added fire ${fireId} to active incident tracking`);
      }

      // Dispatch firefighters to the fire
      await this.dispatchFirefightersToFire(fireId, report);

    } catch (error) {
      console.error(`❌ Failed to handle emergency fire report:`, error);
    }
  }

  /**
   * Dispatch the closest available firefighters to a fire
   */
  private async dispatchFirefightersToFire(fireId: string, fireReport: any): Promise<void> {
    try {
      console.log(`🎯 DISPATCHING FIREFIGHTERS to fire ${fireId}`);

      // Get fire location
      const fireLocation = fireReport.location;
      
      // Find available firefighters and calculate distances
      const availableFirefighters = Array.from(this.activeFirefighters.values())
        .filter(ff => ff.status === 'stationed' || ff.status === 'available')
        .map(ff => {
          const distance = this.calculateDistance(
            ff.position?.lat || ff.stationLat, 
            ff.position?.lon || ff.stationLon,
            fireLocation.latitude,
            fireLocation.longitude
          );
          return { ...ff, distanceToFire: distance };
        })
        .sort((a, b) => a.distanceToFire - b.distanceToFire);

      if (availableFirefighters.length === 0) {
        console.log(`⚠️ NO AVAILABLE FIREFIGHTERS for fire ${fireId}!`);
        
        // Publish alert about lack of resources
        await this.client.publishEvent('emergency.dispatch.alert', {
          type: 'no_available_units',
          fireId: fireId,
          fireLocation: fireLocation,
          timestamp: new Date().toISOString(),
          severity: 'critical'
        });
        return;
      }

      // Determine how many firefighters to dispatch based on urgency
      let dispatchCount = 1;
      if (fireReport.urgency === 'high') {
        dispatchCount = Math.min(3, availableFirefighters.length);
      } else if (fireReport.urgency === 'medium') {
        dispatchCount = Math.min(2, availableFirefighters.length);
      }

      const dispatchedFirefighters = availableFirefighters.slice(0, dispatchCount);
      
      console.log(`🚒 Dispatching ${dispatchedFirefighters.length} firefighter(s):`);
      
      // Create dispatch record
      const dispatchInfo = {
        fireId: fireId,
        fireLocation: fireLocation,
        dispatchedAt: new Date().toISOString(),
        dispatchedUnits: dispatchedFirefighters.map(ff => ff.agentId),
        urgency: fireReport.urgency,
        reporterId: fireReport.reporterId,
        commanderId: this.agentId
      };
      
      this.activeDispatches.set(fireId, dispatchInfo);

      // Send dispatch orders to each firefighter
      for (const firefighter of dispatchedFirefighters) {
        console.log(`   📡 ${firefighter.agentId} (${firefighter.distanceToFire.toFixed(0)}m away)`);
        
        // Publish direct fire alert to firefighter
        await this.client.publishEvent('fire.emergency_dispatch', {
          fireId: fireId,
          latitude: fireLocation.latitude,
          longitude: fireLocation.longitude,
          urgency: fireReport.urgency,
          dispatchedBy: this.agentId,
          dispatchedAt: new Date().toISOString(),
          targetFirefighter: firefighter.agentId,
          event_type: 'fire_start',
          intensity: fireReport.fireDetails?.intensity || 0.7,
          priority: 'emergency_dispatch',
          commandCenter: true
        });

        // Update firefighter status
        this.activeFirefighters.set(firefighter.agentId, {
          ...firefighter,
          status: 'dispatched',
          assignedFire: fireId,
          dispatchedAt: new Date().toISOString()
        });
      }

      // Publish dispatch notification
      await this.client.publishEvent('emergency.dispatch.initiated', dispatchInfo);
      
      // Update fire status
      const fire = this.activeFires.get(fireId);
      if (fire) {
        this.activeFires.set(fireId, {
          ...fire,
          status: 'units_dispatched',
          dispatchedUnits: dispatchedFirefighters.map(ff => ff.agentId),
          dispatchedAt: new Date().toISOString()
        });
      }

      console.log(`✅ DISPATCH COMPLETED for fire ${fireId}`);
      
    } catch (error) {
      console.error(`❌ Failed to dispatch firefighters:`, error);
    }
  }

  /**
   * Update agent position tracking (provides "map view")
   */
  private updateAgentPosition(event: any): void {
    const agentId = event.agentId;
    const position = { lat: event.lat, lon: event.lon, moving: event.moving || false };
    
    this.agentPositions.set(agentId, {
      ...position,
      lastUpdated: new Date().toISOString()
    });

    // Update firefighter positions specifically
    if (agentId.includes('firefighter')) {
      const firefighter = this.activeFirefighters.get(agentId);
      if (firefighter) {
        this.activeFirefighters.set(agentId, {
          ...firefighter,
          position: position,
          lastSeen: new Date().toISOString()
        });
      }
    }

    // Log important movements
    if (!event.moving && agentId.includes('firefighter')) {
      const firefighter = this.activeFirefighters.get(agentId);
      if (firefighter && firefighter.assignedFire) {
        console.log(`🚒 ${agentId} stopped moving - may have reached fire ${firefighter.assignedFire}`);
      }
    }
  }

  /**
   * Handle firefighter events to maintain status awareness
   */
  private async handleFirefighterEvent(event: any): Promise<void> {
    const firefighterId = event.firefighterId || event.id;
    if (!firefighterId) return;

    // Initialize firefighter if not known
    if (!this.activeFirefighters.has(firefighterId)) {
      this.activeFirefighters.set(firefighterId, {
        agentId: firefighterId,
        type: 'firefighter',
        status: 'unknown',
        stationId: event.stationId,
        lastSeen: new Date().toISOString()
      });
      
      // Try to match with station coordinates
      const station = DALLAS_FIRE_STATIONS.find(s => s.id === event.stationId);
      if (station) {
        const ff = this.activeFirefighters.get(firefighterId);
        this.activeFirefighters.set(firefighterId, {
          ...ff,
          stationLat: station.lat,
          stationLon: station.lon
        });
      }
    }

    // Update firefighter status based on event type
    const firefighter = this.activeFirefighters.get(firefighterId);
    let newStatus = firefighter.status;

    if (event.action === 'completed_mission' || event.event === 'fire_extinguished') {
      newStatus = 'returning_to_station';
      
      // Fire has been extinguished
      if (firefighter.assignedFire) {
        console.log(`🔥 Fire ${firefighter.assignedFire} extinguished by ${firefighterId}`);
        const fire = this.activeFires.get(firefighter.assignedFire);
        if (fire) {
          this.activeFires.set(firefighter.assignedFire, {
            ...fire,
            status: 'extinguished',
            extinguishedBy: firefighterId,
            extinguishedAt: new Date().toISOString()
          });
        }
      }
    } else if (event.action === 'back_at_station' || event.event === 'back_at_station') {
      newStatus = 'stationed';
      
      // Clear assignment
      this.activeFirefighters.set(firefighterId, {
        ...firefighter,
        status: newStatus,
        assignedFire: null,
        returnedAt: new Date().toISOString()
      });
      
      console.log(`🏠 ${firefighterId} returned to station and available for dispatch`);
      return;
    } else if (event.action === 'arrived_at_fire') {
      newStatus = 'fighting_fire';
    } else if (event.event === 'dispatched') {
      newStatus = 'responding';
    }

    // Update firefighter
    this.activeFirefighters.set(firefighterId, {
      ...firefighter,
      status: newStatus,
      lastEventAt: new Date().toISOString()
    });
  }

  /**
   * Handle fire events
   */
  private async handleFireEvent(event: any): Promise<void> {
    const fireId = event.fireId;
    if (!fireId) return;

    if (event.event === 'fire_extinguished' || event.action === 'extinguished') {
      console.log(`🔥➡️💧 Fire ${fireId} has been extinguished`);
      
      // Update fire status
      const fire = this.activeFires.get(fireId);
      if (fire) {
        this.activeFires.set(fireId, {
          ...fire,
          status: 'extinguished',
          extinguishedAt: new Date().toISOString()
        });
      }

      // Clear dispatch
      this.activeDispatches.delete(fireId);
    }
  }

  /**
   * Handle civilian events
   */
  private async handleCivilianEvent(event: any): Promise<void> {
    // Log civilian emergency actions
    if (event.action === 'reported_fire') {
      console.log(`👥 Civilian ${event.civilianId} reported fire ${event.fireId}`);
    }
  }

  /**
   * Initialize situational awareness by announcing presence
   */
  private async initializeSituationalAwareness(): Promise<void> {
    // Announce command center activation
    await this.client.publishEvent('command.center.online', {
      commanderId: this.agentId,
      status: 'active',
      monitoring: ['emergency.fire.reported', 'firefighter.*', 'fire.*', 'agent.position.updated'],
      capabilities: ['emergency_dispatch', 'resource_coordination', 'situational_awareness'],
      coverage_area: 'Dallas_Metro',
      timestamp: new Date().toISOString()
    });

    console.log(`📡 Emergency Command Center online and monitoring Dallas emergency services`);
  }

  /**
   * Calculate distance between two coordinates in meters
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const latDiff = lat1 - lat2;
    const lonDiff = lon1 - lon2;
    return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111000; // Convert to meters approximately
  }

  /**
   * Get full situational status (provides "map view" functionality)
   */
  getSituationalStatus(): any {
    return {
      commandCenter: this.agentId,
      isActive: this.isActive,
      currentTime: new Date().toISOString(),
      
      // Fire situation
      activeFires: Object.fromEntries(this.activeFires),
      activeDispatches: Object.fromEntries(this.activeDispatches),
      
      // Resources
      firefighters: Object.fromEntries(this.activeFirefighters),
      availableFirefighters: Array.from(this.activeFirefighters.values())
        .filter(ff => ff.status === 'stationed' || ff.status === 'available').length,
      busyFirefighters: Array.from(this.activeFirefighters.values())
        .filter(ff => ff.status === 'responding' || ff.status === 'fighting_fire').length,
      
      // Intelligence
      civilianReports: this.civilianReports.size,
      trackedAgents: this.agentPositions.size,
      responseHistory: this.responseHistory.length
    };
  }
}

/**
 * Display command center status
 */
function displayCommandStatus(commandCenter: EmergencyCommandCenter): void {
  const status = commandCenter.getSituationalStatus();
  
  console.log('\n🎯 EMERGENCY COMMAND CENTER STATUS');
  console.log('====================================');
  console.log(`Status: ${status.isActive ? '🟢 ACTIVE' : '🔴 OFFLINE'}`);
  console.log(`Time: ${new Date().toLocaleTimeString()}`);
  console.log('');
  console.log(`🔥 Active Fires: ${Object.keys(status.activeFires).length}`);
  console.log(`🚒 Available Units: ${status.availableFirefighters}/${Object.keys(status.firefighters).length}`);
  console.log(`📡 Tracked Agents: ${status.trackedAgents}`);
  console.log(`📞 Civilian Reports: ${status.civilianReports}`);
  
  if (Object.keys(status.activeFires).length > 0) {
    console.log('\n🔥 ACTIVE INCIDENTS:');
    Object.values(status.activeFires).forEach((fire: any) => {
      console.log(`   ${fire.fireId}: ${fire.status} at ${fire.location.latitude.toFixed(4)}, ${fire.location.longitude.toFixed(4)}`);
    });
  }
  
  if (Object.keys(status.activeDispatches).length > 0) {
    console.log('\n🚒 ACTIVE DISPATCHES:');
    Object.values(status.activeDispatches).forEach((dispatch: any) => {
      console.log(`   Fire ${dispatch.fireId}: ${dispatch.dispatchedUnits.length} unit(s) dispatched`);
    });
  }
  
  console.log('====================================\n');
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  let commandCenter: EmergencyCommandCenter;
  
  try {
    // Create and start emergency command center
    commandCenter = new EmergencyCommandCenter();
    await commandCenter.start();
    
    // Set up status display interval
    const statusInterval = setInterval(() => {
      displayCommandStatus(commandCenter);
    }, 30000); // Show status every 30 seconds
    
    // Set up graceful shutdown
    const shutdown = async () => {
      console.log('\n🔄 Emergency Command Center shutting down...');
      clearInterval(statusInterval);
      await commandCenter.stop();
      process.exit(0);
    };
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep the process running
    console.log('🎮 Emergency Command Center is operational.');
    console.log('📞 Monitoring emergency channels for fire reports.');
    console.log('🚒 Ready to dispatch firefighters to incidents.');
    console.log('🎯 Providing centralized command and control for Dallas emergency services.');
    
    // Show initial status
    setTimeout(() => displayCommandStatus(commandCenter), 5000);
    
  } catch (error) {
    console.error('❌ Fatal error in Emergency Command Center:', error);
    process.exit(1);
  }
}

// Start the system if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

// Export for programmatic use
export { EmergencyCommandCenter, main as startCommandCenter };
