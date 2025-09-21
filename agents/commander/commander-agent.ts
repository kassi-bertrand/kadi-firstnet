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
// NOTE: To keep commander self‑contained, we define lightweight interfaces here
// that mirror the wire contract. This avoids cross‑package TS build issues.
// See agents/shared/events.ts for the canonical shapes.
interface FirefighterDispatchEvent {
  dispatchId: string;
  incidentId: string;
  commanderId: string;
  destination: { lat: number; lon: number };
  urgency: 'normal' | 'urgent' | 'emergency';
  description?: string;
  deadlineMs?: number;
}
interface FirefighterDispatchAckEvent {
  dispatchId: string;
  firefighterId: string;
  accepted: boolean;
  reason?: string;
  etaSeconds?: number;
}
interface FirefighterStatusEvent {
  firefighterId: string;
  status: 'at_base' | 'en_route' | 'on_scene' | 'extinguishing' | 'returning';
  incidentId?: string;
  timestamp: number;
  position: { lat: number; lon: number };
}
interface FirefighterDispatchCancelEvent {
  dispatchId: string;
  incidentId: string;
  reason?: string;
}

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

// Operational data collection interfaces
interface EventLog {
  timestamp: number;
  eventType: string;
  agentId?: string;
  incidentId?: string;
  data: any;
  description: string;
}

interface IncidentSummary {
  incidentId: string;
  type: string;
  startTime: number;
  endTime?: number;
  location: { lat: number; lon: number };
  unitsDispatched: string[];
  responseTimeSeconds?: number;
  resolutionTimeSeconds?: number;
  outcome: string;
  eventTimeline: EventLog[];
}

interface AgentActivitySummary {
  agentId: string;
  agentType: string;
  totalEvents: number;
  incidentsResponded: number;
  statusChanges: Array<{ status: string; timestamp: number; duration?: number }>;
  lastKnownPosition?: { lat: number; lon: number };
  firstActivity?: number;
  lastActivity?: number;
}

interface OperationalDataExport {
  timeRange: { start: number; end: number };
  totalEvents: number;
  incidents: IncidentSummary[];
  agentActivities: AgentActivitySummary[];
  emergencyCalls: Array<{ timestamp: number; type: string; location: { lat: number; lon: number }; data: any }>;
  rawEventLog: EventLog[];
  metrics: {
    totalIncidents: number;
    totalAgentsActive: number;
    averageResponseTime?: number;
    incidentsByType: Record<string, number>;
    busyHours: Array<{ hour: number; eventCount: number }>;
  };
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

  // Operational data collection
  private eventLog: EventLog[] = [];
  private incidentHistory: Map<string, IncidentSummary> = new Map();
  private agentActivities: Map<string, AgentActivitySummary> = new Map();
  private emergencyCallLog: Array<{ timestamp: number; type: string; location: { lat: number; lon: number }; data: any }> = [];
  // Track hazards already being handled due to firefighter self-dispatch.
  // Keyed by hazardId; value carries who took it and where it was observed.
  private hazardAssignments: Map<string, { firefighterId: string; position: { lat: number; lon: number }; assignedAt: number }>
    = new Map();
  // Track pending dispatches awaiting acknowledgement
  private pendingDispatches: Map<string, { incidentId: string; publishedAt: number; timeout?: NodeJS.Timeout }>
    = new Map();
  // Track which incident a firefighter is currently allocated to
  private allocations: Map<string, { incidentId: string; dispatchId: string }> = new Map();

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

      // Register operational data reporting tool
      await this.registerReportingTool();

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
      // Subscribe to firefighter status updates (heartbeat)
      await this.client.subscribeToEvent('firefighter.status', async (event: FirefighterStatusEvent) => {
        await this.handleFirefighterStatus(event);
      });
      console.log('✅ Subscribed to firefighter.status events');
    } catch (error) {
      console.log('⚠️  firefighter.status subscription failed:', (error as Error).message);
    }

    try {
      // Subscribe to firefighter dispatch acknowledgements
      await this.client.subscribeToEvent('firefighter.dispatch.ack', async (ack: FirefighterDispatchAckEvent) => {
        await this.handleDispatchAck(ack);
      });
      console.log('✅ Subscribed to firefighter.dispatch.ack events');
    } catch (error) {
      console.log('⚠️  firefighter.dispatch.ack subscription failed:', (error as Error).message);
    }

    try {
      // Subscribe to self-dispatch notifications so we avoid duplicating effort.
      await this.client.subscribeToEvent('firefighter.self_dispatch', async (evt: any) => {
        // Inline shape (see agents/shared/events.ts): { firefighterId, hazardId, incidentId?, position, timestamp }
        const hazardId = evt?.hazardId as string | undefined;
        const firefighterId = evt?.firefighterId as string | undefined;
        const position = evt?.position as { lat?: number; lon?: number } | undefined;
        if (!hazardId || !firefighterId || !position?.lat || !position?.lon) return;

        // Record the assignment. If an entry exists, we overwrite to reflect most recent claim.
        this.hazardAssignments.set(hazardId, {
          firefighterId,
          position: { lat: position.lat, lon: position.lon },
          assignedAt: evt?.timestamp || Date.now()
        });

        console.log(`🧭 Commander ${this.agentId}: Recorded self-dispatch — hazard ${hazardId} assigned to ${firefighterId}`);
      });
      console.log('✅ Subscribed to firefighter.self_dispatch events');
    } catch (error) {
      console.log('⚠️  firefighter.self_dispatch subscription failed:', (error as Error).message);
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

  // Data logging helper methods
  private logEvent(eventType: string, description: string, agentId?: string, incidentId?: string, data?: any): void {
    const eventLog: EventLog = {
      timestamp: Date.now(),
      eventType,
      agentId,
      incidentId,
      data: data || {},
      description
    };
    this.eventLog.push(eventLog);

    // Keep only last 1000 events to prevent memory issues
    if (this.eventLog.length > 1000) {
      this.eventLog.shift();
    }
  }

  private updateAgentActivity(agentId: string, agentType: string, event: string, position?: { lat: number; lon: number }): void {
    if (!this.agentActivities.has(agentId)) {
      this.agentActivities.set(agentId, {
        agentId,
        agentType,
        totalEvents: 0,
        incidentsResponded: 0,
        statusChanges: [],
        firstActivity: Date.now(),
        lastActivity: Date.now()
      });
    }

    const activity = this.agentActivities.get(agentId)!;
    activity.totalEvents++;
    activity.lastActivity = Date.now();
    if (position) {
      activity.lastKnownPosition = position;
    }

    // Track status changes
    if (event.includes('status')) {
      const statusMatch = event.match(/status.*?(\w+)/);
      if (statusMatch) {
        activity.statusChanges.push({
          status: statusMatch[1],
          timestamp: Date.now()
        });
      }
    }
  }

  private async handle911Call(event: any): Promise<void> {
    console.log(`📞 Commander ${this.agentId}: Received 911 call from ${event.callerId}`);
    console.log(`🔥 Emergency: ${event.emergency} at ${event.location.lat}, ${event.location.lon}`);

    // Log emergency call
    this.emergencyCallLog.push({
      timestamp: Date.now(),
      type: event.emergency || 'unknown',
      location: event.location,
      data: event
    });

    this.logEvent('emergency.call', `911 call: ${event.emergency} at ${event.location.lat}, ${event.location.lon}`, undefined, undefined, event);

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

    // Create incident summary for history tracking
    const incidentSummary: IncidentSummary = {
      incidentId,
      type: incident.type,
      startTime: incident.reportedAt,
      location: incident.location,
      unitsDispatched: [],
      outcome: 'reported',
      eventTimeline: [{
        timestamp: incident.reportedAt,
        eventType: 'incident.reported',
        incidentId,
        data: event,
        description: `${incident.type} incident reported at ${incident.location.lat}, ${incident.location.lon}`
      }]
    };
    this.incidentHistory.set(incidentId, incidentSummary);

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
      // STEP 0 — De-duplication guard: Skip dispatch if we already have a
      // self-dispatched firefighter handling a hazard very close to this
      // incident. We use a simple proximity check (e.g., 50 meters).
      const proximityMeters = Number(process.env.SELF_DISPATCH_PROXIMITY_M || 50);
      const claimedNearby = Array.from(this.hazardAssignments.values()).some((claim) => {
        return this.calculateDistance(incident.location, claim.position) <= proximityMeters;
      });
      if (claimedNearby) {
        console.log(`🛑 Commander ${this.agentId}: Skipping dispatch — nearby hazard already self-assigned within ${proximityMeters}m.`);
        // Mark incident as dispatched to avoid repeated attempts; in a richer
        // system we might track "in_progress_by=self_dispatch" instead.
        incident.status = 'dispatched';
        return;
      }

      // Check if any firefighters are available
      const totalAvailable = this.fireStations.reduce((sum, station) => sum + station.availableUnits, 0);

      if (totalAvailable > 0) {
        console.log(`🚒 Commander ${this.agentId}: Dispatching ANY available firefighter to incident`);

        // Create a unique dispatch id. We avoid extra deps by combining time + random.
        const dispatchId = `disp_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

        // Prepare the dispatch payload with a handshake contract.
        const payload: FirefighterDispatchEvent = {
          dispatchId,
          incidentId: incident.incidentId,
          commanderId: this.agentId,
          destination: incident.location,
          urgency: 'emergency',
          description: `Fire emergency at ${incident.location.lat.toFixed(4)}, ${incident.location.lon.toFixed(4)}`,
          // Ask for an ack quickly; will re‑dispatch if no acceptance.
          deadlineMs: Number(process.env.DISPATCH_ACK_TIMEOUT_MS || 5000)
        };

        // Publish dispatch to all available firefighters; first valid ACK wins.
        await this.client.publishEvent('firefighter.dispatch', payload);

        // Track pending dispatch and set a re‑dispatch timeout.
        const timeoutMs = payload.deadlineMs || 5000;
        const timer = setTimeout(() => this.handleDispatchTimeout(dispatchId), timeoutMs);
        this.pendingDispatches.set(dispatchId, { incidentId: incident.incidentId, publishedAt: Date.now(), timeout: timer });

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
    // Haversine distance (clear ASCII variable names for readability)
    const R = 6371e3; // meters
    const lat1 = pos1.lat * Math.PI / 180;
    const lat2 = pos2.lat * Math.PI / 180;
    const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
    const dLon = (pos2.lon - pos1.lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

  // Operational data export tool
  private generateOperationalReport(timeRange?: { start: number; end: number }): OperationalDataExport {
    const now = Date.now();
    const startTime = timeRange?.start || (now - 24 * 60 * 60 * 1000); // Default: last 24 hours
    const endTime = timeRange?.end || now;

    // Filter events by time range
    const filteredEvents = this.eventLog.filter(event =>
      event.timestamp >= startTime && event.timestamp <= endTime
    );

    const filteredCalls = this.emergencyCallLog.filter(call =>
      call.timestamp >= startTime && call.timestamp <= endTime
    );

    // Process incidents
    const incidents: IncidentSummary[] = Array.from(this.incidentHistory.values())
      .filter(incident => incident.startTime >= startTime && incident.startTime <= endTime);

    // Process agent activities
    const agentActivities: AgentActivitySummary[] = Array.from(this.agentActivities.values())
      .filter(activity => activity.lastActivity && activity.lastActivity >= startTime);

    // Calculate metrics
    const incidentsByType: Record<string, number> = {};
    incidents.forEach(incident => {
      incidentsByType[incident.type] = (incidentsByType[incident.type] || 0) + 1;
    });

    const resolvedIncidents = incidents.filter(i => i.endTime);
    const averageResponseTime = resolvedIncidents.length > 0
      ? resolvedIncidents.reduce((sum, i) => sum + (i.responseTimeSeconds || 0), 0) / resolvedIncidents.length
      : undefined;

    // Calculate busy hours
    const hourlyEvents: Record<number, number> = {};
    filteredEvents.forEach(event => {
      const hour = new Date(event.timestamp).getHours();
      hourlyEvents[hour] = (hourlyEvents[hour] || 0) + 1;
    });

    const busyHours = Object.entries(hourlyEvents)
      .map(([hour, count]) => ({ hour: parseInt(hour), eventCount: count }))
      .sort((a, b) => b.eventCount - a.eventCount);

    return {
      timeRange: { start: startTime, end: endTime },
      totalEvents: filteredEvents.length,
      incidents,
      agentActivities,
      emergencyCalls: filteredCalls,
      rawEventLog: filteredEvents,
      metrics: {
        totalIncidents: incidents.length,
        totalAgentsActive: agentActivities.length,
        averageResponseTime,
        incidentsByType,
        busyHours
      }
    };
  }

  /**
   * OPERATIONAL DATA ANALYSIS - LLM Query Examples
   *
   * With the structured data this tool provides, an LLM can answer
   * sophisticated
   * operational questions that help improve emergency response effectiveness:
   *
   * PERFORMANCE ANALYSIS:
   * - "Which firefighter had the fastest average response time today?"
   * - "Are there any agents who declined multiple dispatches? Why?"
   * - "What's our current unit availability vs. call volume?"
   * - "Which fire station area had the most incidents this week?"
   *
   * OPERATIONAL PATTERNS:
   * - "What are our peak emergency hours and do we have adequate staffing?"
   * - "How often do firefighters self-dispatch vs. get commanded?"
   * - "Are there geographic clusters of incidents we should investigate?"
   * - "What's the correlation between fire intensity and response time?"
   *
   * INCIDENT ANALYSIS:
   * - "Summarize today's major incidents and their outcomes"
   * - "Were there any incidents where multiple units responded to the same
   *  location?"
   * - "How long did it take to resolve each type of emergency?"
   * - "Which incidents required the most resources?"
   *
   * RESOURCE OPTIMIZATION:
   * - "Based on call patterns, should we reposition units for better coverage?"
   * - "Are certain firefighters getting overworked while others are idle?"
   * - "What's our success rate for different types of emergencies?"
   * - "Do we need additional units in high-activity areas?"
   *
   * TRAINING & DEVELOPMENT:
   * - "Which agents might benefit from additional response training?"
   * - "Are there communication gaps in our dispatch process?"
   * - "What scenarios should we practice more in training exercises?"
   *
   * COMPLIANCE & REPORTING:
   * - "Generate an after-action report for incident X with timeline"
   * - "What were our response times compared to city standards?"
   * - "Prepare a weekly summary for the fire chief"
   * - "Document resource utilization for budget planning"
   *
   * PREDICTIVE INSIGHTS:
   * - "Based on recent patterns, when should we expect the next busy period?"
   * - "Are there weather/time correlations with incident types?"
   * - "Should we adjust shift schedules based on activity patterns?"
   *
   * The raw data structure supports all these analyses by providing:
   * - Timestamped event sequences for timeline reconstruction
   * - Agent-specific performance metrics and location tracking
   * - Incident categorization with resolution outcomes
   * - Resource allocation and response time measurements
   * - Cross-referenced data for pattern identification
   */

  // Register KADI tool for external access
  async registerReportingTool(): Promise<void> {
    try {
      this.client.registerTool('getOperationalData', async (params: any) => {
        try {
          const { timeRange } = params || {};
          console.log(`📊 Commander: Generating operational report for ${timeRange?.start ? 'custom range' : 'last 24h'}`);

          const report = this.generateOperationalReport(timeRange);

          console.log(`📊 Report generated: ${report.totalEvents} events, ${report.incidents.length} incidents, ${report.agentActivities.length} active agents`);

          return {
            success: true,
            data: report
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });
      console.log('✅ Registered operational reporting tool: getOperationalData');
    } catch (error) {
      console.log('❌ Failed to register reporting tool:', error);
    }
  }

  private async handleFirefighterStatus(event: FirefighterStatusEvent): Promise<void> {
    console.log(`🚒 Commander ${this.agentId}: Firefighter ${event.firefighterId} status: ${event.status}`);

    // Log firefighter status update
    this.logEvent('firefighter.status', `Firefighter ${event.firefighterId} status: ${event.status}`, event.firefighterId, event.incidentId, event);
    this.updateAgentActivity(event.firefighterId, 'firefighter', `status ${event.status}`, event.position);

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

    // Also clear any self-dispatch record for this hazard so future incidents
    // near this area aren't blocked by stale assignments.
    if (event.fireId && this.hazardAssignments.has(event.fireId)) {
      this.hazardAssignments.delete(event.fireId);
      console.log(`🧹 Commander ${this.agentId}: Cleared hazard assignment for ${event.fireId}`);
    }

    // TODO: Update fire status in world simulator
    // TODO: Notify other systems about successful suppression
  }

  /**
   * Handle an acknowledgement for a dispatch. The first ACCEPTED ack wins; we
   * cancel any other pending dispatch attempts for the same incident.
   */
  private async handleDispatchAck(ack: FirefighterDispatchAckEvent): Promise<void> {
    // Log dispatch acknowledgment
    const ackResult = ack.accepted ? 'accepted' : 'declined';
    this.logEvent('firefighter.dispatch.ack', `Firefighter ${ack.firefighterId} ${ackResult} dispatch ${ack.dispatchId}`, ack.firefighterId, undefined, ack);

    if (ack.accepted) {
      // Update agent activity for incident response
      const activity = this.agentActivities.get(ack.firefighterId);
      if (activity) {
        activity.incidentsResponded++;
      }
    }

    const pending = this.pendingDispatches.get(ack.dispatchId);
    if (!pending) {
      // Unknown or already resolved dispatch. Ignore politely.
      console.log(`ℹ️ Commander: Received ACK for unknown/expired dispatch ${ack.dispatchId}`);
      return;
    }

    if (!ack.accepted) {
      console.log(`❎ Commander: Firefighter declined dispatch ${ack.dispatchId} (reason=${ack.reason || 'unspecified'})`);
      return; // Keep waiting for another ACK or timeout
    }

    // We have a winner: record allocation and clear the timeout.
    if (pending.timeout) clearTimeout(pending.timeout);
    this.pendingDispatches.delete(ack.dispatchId);

    this.allocations.set(ack.firefighterId, {
      incidentId: pending.incidentId,
      dispatchId: ack.dispatchId
    });

    console.log(`✅ Commander: Dispatch ${ack.dispatchId} accepted by ${ack.firefighterId}${ack.etaSeconds ? ` (ETA ${ack.etaSeconds}s)` : ''}`);

    // Optional: proactively cancel other pending dispatches for the same incident.
    for (const [otherId, info] of this.pendingDispatches) {
      if (info.incidentId === pending.incidentId) {
        if (info.timeout) clearTimeout(info.timeout);
        this.pendingDispatches.delete(otherId);
        const cancel: FirefighterDispatchCancelEvent = {
          dispatchId: otherId,
          incidentId: pending.incidentId,
          reason: 'accepted_by_another_unit'
        };
        this.client.publishEvent('firefighter.dispatch.cancel', cancel);
      }
    }
  }

  /**
   * Handle case where no firefighter acknowledges a dispatch swiftly; the
   * simplest strategy here is to re‑emit the dispatch by calling analyze/dispatch
   * again so we can try another wave (or escalate policy later).
   */
  private async handleDispatchTimeout(dispatchId: string): Promise<void> {
    const pending = this.pendingDispatches.get(dispatchId);
    if (!pending) return;
    this.pendingDispatches.delete(dispatchId);

    console.log(`⏰ Commander: Dispatch ${dispatchId} timed out without ACK; will attempt re-dispatch for incident ${pending.incidentId}`);

    const incident = this.activeIncidents.get(pending.incidentId);
    if (incident && incident.status !== 'resolved') {
      await this.simpleDispatch(incident);
    }
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
