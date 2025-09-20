#!/usr/bin/env node
/**
 * Commander Agent - Emergency Response Incident Commander
 *
 * Manages emergency response operations by:
 * - Listening to 911 calls and other emergency events
 * - Managing resource allocation (firefighters, EMS, police)
 * - Making strategic decisions using LLM integration
 * - Dispatching appropriate resources to incidents
 */

import { KadiClient } from '@kadi.build/core';

// TODO: Import LLM integration (OpenAI, Anthropic, etc.)
// import { OpenAI } from 'openai';

interface ResourceConfig {
  firefighters: number;
  ems: number;
  police: number;
}

interface FireStation {
  id: string;
  name: string;
  position: { lat: number; lon: number };
  availableUnits: number;
  totalUnits: number;
}

interface ActiveIncident {
  incidentId: string;
  type: 'fire' | 'medical' | 'police';
  location: { lat: number; lon: number };
  severity: 'low' | 'medium' | 'high' | 'critical';
  assignedResources: string[]; // agent IDs
  status: 'reported' | 'dispatched' | 'on_scene' | 'resolved';
  reportedAt: number;
  description?: string;
}

export class CommanderAgent {
  private client: KadiClient;
  private agentId: string;
  private isRunning: boolean = false;

  // Resource management
  private resourceConfig: ResourceConfig;
  private fireStations: FireStation[];
  private activeIncidents: Map<string, ActiveIncident> = new Map();
  private registeredFirefighters: Set<string> = new Set();

  // TODO: LLM integration
  // private llm: OpenAI;

  constructor(resourceConfig: ResourceConfig) {
    this.agentId = `commander_${Date.now()}`;
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
    this.resourceConfig = resourceConfig;
    this.fireStations = this.initializeDallasFireStations();

    // TODO: Initialize LLM
    // this.llm = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  private initializeDallasFireStations(): FireStation[] {
    // Known Dallas fire station locations
    return [
      {
        id: 'dfd_station_1',
        name: 'DFD Station 1 - Downtown',
        position: { lat: 32.7767, lon: -96.7970 },
        availableUnits: Math.floor(this.resourceConfig.firefighters / 4),
        totalUnits: Math.floor(this.resourceConfig.firefighters / 4)
      },
      {
        id: 'dfd_station_18',
        name: 'DFD Station 18 - Deep Ellum',
        position: { lat: 32.7825, lon: -96.7849 },
        availableUnits: Math.floor(this.resourceConfig.firefighters / 4),
        totalUnits: Math.floor(this.resourceConfig.firefighters / 4)
      },
      {
        id: 'dfd_station_2',
        name: 'DFD Station 2 - Oak Cliff',
        position: { lat: 32.7357, lon: -96.8147 },
        availableUnits: Math.floor(this.resourceConfig.firefighters / 4),
        totalUnits: Math.floor(this.resourceConfig.firefighters / 4)
      },
      {
        id: 'dfd_station_4',
        name: 'DFD Station 4 - East Dallas',
        position: { lat: 32.7881, lon: -96.7676 },
        availableUnits: this.resourceConfig.firefighters - (3 * Math.floor(this.resourceConfig.firefighters / 4)),
        totalUnits: this.resourceConfig.firefighters - (3 * Math.floor(this.resourceConfig.firefighters / 4))
      }
    ];
  }

  async start(): Promise<void> {
    console.log(`🎖️ Commander ${this.agentId}: Starting incident command operations`);
    console.log(`📊 Resources available: ${this.resourceConfig.firefighters} firefighters, ${this.resourceConfig.ems} EMS, ${this.resourceConfig.police} police`);

    try {
      await this.client.connectToBrokers();
      console.log(`KADI client (commander) connected (remote broker=${process.env.KADI_BROKER_URL || 'ws://kadi.build:8080'})`);
      this.isRunning = true;

      // First try to spawn the agent
      const spawnResult = await this.client.callTool('world-simulator', 'spawnAgent', {
        agentId: this.agentId,
        type: 'commander',
        position: { lat: 32.7767, lon: -96.7970 }, // Downtown command center
        status: 'available'
      }) as any;

      if (!spawnResult.success) {
        // If agent already exists, try to despawn and respawn
        if (spawnResult.error?.includes('already exists')) {
          console.log(`⚠️ Commander ${this.agentId}: Agent already exists, attempting to respawn...`);

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
              type: 'commander',
              position: { lat: 32.7767, lon: -96.7970 },
              status: 'available'
            }) as any;

            if (!respawnResult.success) {
              throw new Error(`Failed to respawn commander: ${respawnResult.error}`);
            }
          } catch (e) {
            console.error(`❌ Commander ${this.agentId}: Failed to respawn:`, e);
            throw e;
          }
        } else {
          throw new Error(`Failed to spawn commander: ${spawnResult.error}`);
        }
      }

      // Spawn initial resources at their stations
      await this.deployInitialResources();

      // Subscribe to emergency events
      await this.subscribeToEvents();

      console.log(`✅ Commander ${this.agentId}: Incident command center operational`);
    } catch (error) {
      console.error(`❌ Commander ${this.agentId}: Failed to start:`, error);
    }
  }

  private async deployInitialResources(): Promise<void> {
    console.log(`🚒 Commander ${this.agentId}: Ready to coordinate firefighter resources`);
    console.log(`📡 Commander ${this.agentId}: Waiting for firefighter agents to register themselves...`);

    // Initialize station availability (will be updated as firefighters register)
    for (const station of this.fireStations) {
      station.availableUnits = 0; // Start with 0, increment as firefighters register
      console.log(`🏢 ${station.name}: Ready to receive firefighters`);
    }


    console.log(`ℹ️  Start firefighter agents manually - they will register with the commander automatically`);
    // TODO: Eventually commander could auto-spawn firefighter processes
    // TODO: Deploy EMS and police resources similarly
  }

  private async subscribeToEvents(): Promise<void> {
    console.log(`📡 Commander ${this.agentId}: Subscribing to emergency events`);

    // Subscribe to emergency 911 calls using a broker-safe channel name
    try {
      await this.client.subscribeToEvent('emergency.call', async (event: any) => {
        await this.handle911Call(event);
      });
      console.log('✅ Subscribed to emergency.call events');
    } catch (error) {
      // Fallback: try wildcard, if the broker supports it
      try {
        await this.client.subscribeToEvent('emergency.*', async (_event: any) => {
          await this.handle911Call(_event);
        });
        console.log('✅ Subscribed to emergency.* events');
      } catch (error2) {
        console.log('⚠️  emergency call subscription failed (will retry):', (error2 as Error).message);
        // Set up a periodic retry
        this.retry911Subscription();
      }
    }

    try {
      // Subscribe to firefighter status updates
      await this.client.subscribeToEvent('firefighter.status', async (event: any) => {
        await this.handleFirefighterStatus(event);
      });
      console.log('✅ Subscribed to firefighter.status events');
    } catch (error) {
      console.log('⚠️  firefighter.status subscription failed:', (error as Error).message);
    }

    try {
      // Subscribe to fire extinguished events
      await this.client.subscribeToEvent('fire.extinguished', async (event: any) => {
        await this.handleFireExtinguished(event);
      });
      console.log('✅ Subscribed to fire.extinguished events');
    } catch (error) {
      console.log('⚠️  fire.extinguished subscription failed:', (error as Error).message);
    }

    // TODO: Subscribe to other critical events
    // this.client.subscribe('fire.updated', async (event) => {
    //   await this.handleFireUpdate(event);
    // });
  }

  private async handle911Call(event: any): Promise<void> {
    console.log(`📞 Commander ${this.agentId}: Received 911 call from ${event.callerId}`);
    console.log(`🔥 Emergency: ${event.emergency} at ${event.location.lat}, ${event.location.lon}`);

    // Create incident record
    const incidentId = `incident_${Date.now()}`;
    const incident: ActiveIncident = {
      incidentId,
      type: event.emergency === 'fire' ? 'fire' : 'medical',
      location: event.location,
      severity: 'medium', // TODO: LLM should determine severity
      assignedResources: [],
      status: 'reported',
      reportedAt: Date.now(),
      description: event.description
    };

    this.activeIncidents.set(incidentId, incident);

    // TODO: Use LLM to analyze the situation and determine response
    await this.analyzeAndRespond(incident);
  }

  private async analyzeAndRespond(incident: ActiveIncident): Promise<void> {
    console.log(`🧠 Commander ${this.agentId}: Analyzing incident ${incident.incidentId}`);

    // TODO: Prepare context for LLM
    const situationContext = {
      incident: incident,
      availableResources: this.getAvailableResources(),
      activeIncidents: Array.from(this.activeIncidents.values()),
      fireStations: this.fireStations
    };

    // TODO: Call LLM for decision making
    // const llmPrompt = this.buildLLMPrompt(situationContext);
    // const response = await this.llm.chat.completions.create({
    //   model: "gpt-4",
    //   messages: [{ role: "user", content: llmPrompt }]
    // });

    // TODO: Parse LLM response and execute commands
    // const decision = this.parseLLMDecision(response.choices[0].message.content);
    // await this.executeDecision(decision, incident);

    // TEMPORARY: Simple rule-based dispatch until LLM is integrated
    await this.simpleDispatch(incident);
  }

  private async simpleDispatch(incident: ActiveIncident): Promise<void> {
    console.log(`🚨 Commander ${this.agentId}: Dispatching resources to ${incident.incidentId}`);

    if (incident.type === 'fire') {
      // Check if any firefighters are available
      const totalAvailable = this.fireStations.reduce((sum, station) => sum + station.availableUnits, 0);

      if (totalAvailable > 0) {
        console.log(`🚒 Commander ${this.agentId}: Dispatching ANY available firefighter to incident`);

        // Send dispatch to ANY available firefighter (first one to respond wins)
        await this.client.publishEvent('firefighter.dispatch', {
          incidentId: incident.incidentId,
          destination: incident.location,
          urgency: 'emergency',
          description: `Fire emergency at ${incident.location.lat.toFixed(4)}, ${incident.location.lon.toFixed(4)}`
        });

        incident.status = 'dispatched';
        console.log(`📡 Dispatch order sent for incident ${incident.incidentId}`);
      } else {
        console.log(`⚠️ Commander ${this.agentId}: No available firefighters for incident ${incident.incidentId}`);
        console.log(`ℹ️  Available units per station:`, this.fireStations.map(s => `${s.name}: ${s.availableUnits}`));
      }
    }
  }

  private findNearestAvailableStation(location: { lat: number; lon: number }): FireStation | null {
    return this.fireStations
      .filter(station => station.availableUnits > 0)
      .reduce((nearest, station) => {
        const distance = this.calculateDistance(location, station.position);
        const nearestDistance = nearest ? this.calculateDistance(location, nearest.position) : Infinity;
        return distance < nearestDistance ? station : nearest;
      }, null as FireStation | null);
  }

  private calculateDistance(pos1: { lat: number; lon: number }, pos2: { lat: number; lon: number }): number {
    // Simple Euclidean distance - TODO: use proper geographic distance
    const dlat = pos1.lat - pos2.lat;
    const dlon = pos1.lon - pos2.lon;
    return Math.sqrt(dlat * dlat + dlon * dlon);
  }

  private getAvailableResources() {
    // TODO: Return current resource availability
    return {
      firefighters: this.fireStations.reduce((sum, station) => sum + station.availableUnits, 0),
      // TODO: Add EMS and police availability
    };
  }

  private async retry911Subscription(): Promise<void> {
    // Retry subscribing to emergency.call every 5 seconds
    const retryInterval = setInterval(async () => {
      try {
        await this.client.subscribeToEvent('emergency.call', async (event: any) => {
          await this.handle911Call(event);
        });
        console.log('✅ Successfully subscribed to emergency.call after retry');
        clearInterval(retryInterval);
      } catch (error) {
        // Still can't subscribe, will retry again
      }
    }, 5000);
  }

  private async handleFirefighterStatus(event: any): Promise<void> {
    console.log(`🚒 Commander ${this.agentId}: Firefighter ${event.firefighterId} status: ${event.status}`);

    const firefighterId = event.firefighterId;
    const isNewFirefighter = !this.registeredFirefighters.has(firefighterId);

    // Track firefighter availability
    if (event.status === 'at_base') {
      // If this is a new firefighter registering for the first time
      if (isNewFirefighter) {
        this.registeredFirefighters.add(firefighterId);
        // Find nearest station and increment
        const nearestStation = this.findNearestStation(event.position);
        if (nearestStation) {
          nearestStation.availableUnits = Math.min(nearestStation.availableUnits + 1, nearestStation.totalUnits);
          console.log(`✅ NEW Firefighter ${firefighterId} registered at ${nearestStation.name}`);
          console.log(`📊 ${nearestStation.name}: ${nearestStation.availableUnits}/${nearestStation.totalUnits} units available`);
        }
      }
      // Otherwise it's just checking in
    } else if (event.status === 'en_route' || event.status === 'on_scene' || event.status === 'extinguishing') {
      // Firefighter is busy - only decrement if they were previously at base
      // (We don't want to decrement multiple times for the same deployment)
      const nearestStation = this.findNearestStation(event.position);
      if (nearestStation && nearestStation.availableUnits > 0) {
        nearestStation.availableUnits--;
        console.log(`📊 ${nearestStation.name}: ${nearestStation.availableUnits}/${nearestStation.totalUnits} units available (firefighter deployed)`);
      }
    } else if (event.status === 'returning') {
      // Firefighter is returning to base - increment availability
      const nearestStation = this.findNearestStation(event.position);
      if (nearestStation) {
        nearestStation.availableUnits = Math.min(nearestStation.availableUnits + 1, nearestStation.totalUnits);
        console.log(`🔄 Firefighter ${firefighterId} returning to ${nearestStation.name}`);
        console.log(`📊 ${nearestStation.name}: ${nearestStation.availableUnits}/${nearestStation.totalUnits} units available`);
      }
    }

    // Update incident status if applicable
    if (event.incidentId) {
      const incident = this.activeIncidents.get(event.incidentId);
      if (incident) {
        if (event.status === 'on_scene') {
          incident.status = 'on_scene';
        }
        console.log(`📋 Incident ${event.incidentId}: ${incident.status}`);
      }
    }
  }

  private findNearestStation(position: { lat: number; lon: number }): FireStation | null {
    return this.fireStations.reduce((nearest, station) => {
      const distance = this.calculateDistance(position, station.position);
      const nearestDistance = nearest ? this.calculateDistance(position, nearest.position) : Infinity;
      return distance < nearestDistance ? station : nearest;
    }, null as FireStation | null);
  }

  private async handleFireExtinguished(event: any): Promise<void> {
    console.log(`🎉 Commander ${this.agentId}: Fire ${event.fireId} extinguished by ${event.extinguishedBy}`);

    // Mark incident as resolved
    if (event.incidentId) {
      const incident = this.activeIncidents.get(event.incidentId);
      if (incident) {
        incident.status = 'resolved';
        console.log(`✅ Incident ${event.incidentId}: RESOLVED - fire extinguished`);

        // TODO: Could trigger post-incident procedures
        // TODO: Could notify other agencies (EMS for casualties, etc.)
      }
    }

    // TODO: Update fire status in world simulator
    // TODO: Notify other systems about successful suppression
  }

  // TODO: LLM integration methods
  // private buildLLMPrompt(context: any): string { }
  // private parseLLMDecision(response: string): any { }
  // private executeDecision(decision: any, incident: ActiveIncident): Promise<void> { }

  async stop(): Promise<void> {
    console.log(`🛑 Commander ${this.agentId}: Shutting down incident command`);
    this.isRunning = false;

    // Try to despawn from world simulator
    try {
      await this.client.callTool('world-simulator', 'despawnAgent', {
        agentId: this.agentId
      });
    } catch (error) {
      console.warn(`⚠️ Commander ${this.agentId}: Could not despawn from world:`, error);
    }

    await this.client.disconnect();
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const resourceConfig: ResourceConfig = {
    firefighters: 8,  // 2 per station
    ems: 4,
    police: 6
  };

  const commander = new CommanderAgent(resourceConfig);

  commander.start().catch(console.error);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await commander.stop();
    process.exit(0);
  });
}
