// app/api/kadi-proxy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { KadiClient } from "@kadi.build/core";
import type { Agent } from "@/types/agent";

// Server-side map to store latest agent states
let client: KadiClient | null = null;
const agentsMap: Map<string, Agent> = new Map();
const typesByAgentId: Map<string, Agent["type"]> = new Map();
const lastUpdateById: Map<string, number> = new Map();

// Debug logging control for very chatty fire event logs
const FIRE_DEBUG: boolean = (() => {
  const val = (process.env.DEBUG_FIRE || "").toLowerCase();
  return val === "1" || val === "true" || val === "yes";
})();
const fireLog = (...args: any[]) => { if (FIRE_DEBUG) console.log(...args); };
// Optional removal threshold (default 0 to require exact zero); set to 0.05 to match simulator extinguish threshold
const FIRE_REMOVE_THRESHOLD: number = (() => {
  const raw = process.env.FIRE_REMOVE_THRESHOLD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? (n as number) : 0;
})();

// If set, only accept events from a specific simulator instance
const ACCEPT_INSTANCE_ID: string | undefined = process.env.KADI_SIM_INSTANCE || process.env.SIM_INSTANCE_ID;
const TRACE_FIRE_ID: string | undefined = process.env.FIRE_TRACE_ID;
function traceLog(id: string | undefined, ...args: any[]) {
  if (!TRACE_FIRE_ID) return;
  if (id === TRACE_FIRE_ID) console.log('[TRACE]', ...args);
}
function shouldAcceptEvent(data: any): boolean {
  if (!ACCEPT_INSTANCE_ID) return true;
  const id = (data && (data.instanceId as string)) || undefined;
  if (!id) return false;
  return id === ACCEPT_INSTANCE_ID;
}

// Initialize Kadi client only once
async function initKadiClient() {
  if (client) return;

  const brokerUrl = process.env.KADI_BROKER_URL || "ws://kadi.build:8080";
  const networks = process.env.KADI_NETWORKS?.split(",") || ["global"];

  client = new KadiClient({
    name: "proxy",
    role: "agent",
    transport: "broker",
    brokers: {
      local: "ws://localhost:8080",
      remote: brokerUrl
    },
    defaultBroker: "remote",
    networks,
  });

  await client.connectToBrokers();
  console.log(`KADI client connected to broker at ${brokerUrl}`);

  // Subscribe to world simulator streams
  // 1) Track types from spawn events
  client.subscribeToEvent("world.agent.spawned", (data: any) => {
    const id = data?.agentId as string | undefined;
    const type = data?.type as Agent["type"] | undefined;
    const pos = data?.position as { lat?: number; lon?: number } | undefined;
    if (!id) return;
    if (type) typesByAgentId.set(id, type);
    lastUpdateById.set(id, Date.now());
    if (pos?.lat != null && pos?.lon != null) {
      agentsMap.set(id, {
        id,
        type: typesByAgentId.get(id) ?? "civilian",
        event: "world.agent.spawned",
        longitude: pos.lon,
        latitude: pos.lat,
      });
    }
  });
  // 2) Batched positions for dashboards
  client.subscribeToEvent("world.positions.batch", (batch: any) => {
    if (!batch?.agents) return;
    for (const a of batch.agents as Array<any>) {
      const id = a?.agentId as string | undefined;
      const lat = a?.lat as number | undefined;
      const lon = a?.lon as number | undefined;
      const typ = a?.type as Agent["type"] | undefined;
      const time = (batch?.time as number | undefined) ?? Date.now();
      if (!id || lat == null || lon == null) continue;
      const prevTime = lastUpdateById.get(id) ?? 0;
      if (time < prevTime) continue; // ignore stale batch
      if (typ) typesByAgentId.set(id, typ);
      lastUpdateById.set(id, time);
      agentsMap.set(id, {
        id,
        type: typesByAgentId.get(id) ?? "civilian",
        event: "world.positions.batch",
        longitude: lon,
        latitude: lat,
      });
    }
  });

  // 3) Per-agent real-time updates (moving)
  client.subscribeToEvent("agent.position.updated", (data: any) => {
    const id = (data?.agentId as string) || (data?.id as string);
    const lat = (data?.lat as number) ?? (data?.latitude as number);
    const lon = (data?.lon as number) ?? (data?.longitude as number);
    const typ = data?.type as Agent["type"] | undefined;
    const time = (data?.time as number | undefined) ?? Date.now();
    if (!id || lat == null || lon == null) return;
    const prevTime = lastUpdateById.get(id) ?? 0;
    if (time < prevTime) return; // ignore stale per-agent update
    if (typ) typesByAgentId.set(id, typ);
    lastUpdateById.set(id, time);
    agentsMap.set(id, {
      id,
      type: typesByAgentId.get(id) ?? "civilian",
      event: "agent.position.updated",
      longitude: lon,
      latitude: lat,
    });
  });

  // 4) Handle agent despawn events
  client.subscribeToEvent("world.agent.despawned", (data: any) => {
    const id = data?.agentId as string;
    if (!id) return;

    // Remove agent from maps
    agentsMap.delete(id);
    typesByAgentId.delete(id);

    console.log(`Agent despawned and removed from map: ${id}`);
  });

  // Handle agent lifetime expiration
  client.subscribeToEvent("world.agent.expired", (data: any) => {
    const id = data?.agentId as string;
    if (!id) return;

    // Remove expired agent from maps
    agentsMap.delete(id);
    typesByAgentId.delete(id);
    lastUpdateById.delete(id);

    console.log(`🛑 Agent ${id} expired after ${data?.lifetime / 1000 || '?'}s and removed from map`);
  });

  // 5) Consolidated fire lifecycle management
  // Track fires that have been explicitly removed to ignore any late/out-of-order re-adds
  const deletedFireIds: Set<string> = new Set();

  function removeFire(fireId: string, reason: string, time?: number) {
    const t = typeof time === 'number' ? time : Date.now();
    const prev = lastUpdateById.get(fireId) ?? 0;
    if (t < prev) {
      fireLog(`🔥⏪ FRONTEND: Ignoring stale removal for ${fireId} (prev=${prev}, t=${t}) from ${reason}`);
      traceLog(fireId, `Ignoring stale removal (prev=${prev}, t=${t}) reason=${reason}`);
      return;
    }
    lastUpdateById.set(fireId, t);
    if (agentsMap.has(fireId)) {
      agentsMap.delete(fireId);
      typesByAgentId.delete(fireId);
      console.log(`🔥🗑️ FRONTEND: Fire ${fireId} REMOVED from map: ${reason} (t=${t})`);
      traceLog(fireId, `REMOVED from agentsMap (reason=${reason}, t=${t})`);
    } else {
      fireLog(`🔥❌ FRONTEND: Tried to remove fire ${fireId} but it wasn't in map: ${reason} (t=${t})`);
      traceLog(fireId, `Remove called but not in agentsMap (reason=${reason}, t=${t})`);
    }
    // Mark as deleted so any late updates for this ID are ignored
    deletedFireIds.add(fireId);
    traceLog(fireId, `Marked as deleted`);
  }

  function updateFire(fireId: string, data: any, eventName: string, time?: number) {
    // If this fire was already deleted due to intensity=0 or explicit removal,
    // ignore any late updates to prevent icons from reappearing.
    if (deletedFireIds.has(fireId)) {
      fireLog(`🔥🚫 FRONTEND: Ignoring update for deleted fire ${fireId} via ${eventName}`);
      traceLog(fireId, `REAPPEARANCE DETECTED; update after deletion via ${eventName}`);
      return;
    }
    if (data?.longitude != null && data?.latitude != null) {
      const t = typeof time === 'number' ? time : Date.now();
      const prev = lastUpdateById.get(fireId) ?? 0;
      if (t < prev) {
        fireLog(`🔥⏪ FRONTEND: Ignoring stale update for ${fireId} via ${eventName} (prev=${prev}, t=${t})`);
        traceLog(fireId, `Ignoring stale update via ${eventName} (prev=${prev}, t=${t})`);
        return;
      }
      typesByAgentId.set(fireId, "fire");
      lastUpdateById.set(fireId, t);
      agentsMap.set(fireId, {
        id: fireId,
        type: "fire",
        event: eventName,
        longitude: data.longitude,
        latitude: data.latitude,
      });
      fireLog(`🔥📍 FRONTEND: Fire ${fireId} updated at ${data.latitude}, ${data.longitude} via ${eventName} (t=${t})`);
       traceLog(fireId, `UPDATED via ${eventName} at ${data.latitude}, ${data.longitude} t=${t}`);
    }
  }

  client.subscribeToEvent("fire.extinguished", (data: any) => {
    if (!shouldAcceptEvent(data)) return;
    fireLog(`🔥💀 FRONTEND: Received fire.extinguished event:`, JSON.stringify(data));
    const id = data?.fireId || data?.id;
    if (id) {
      const t = (data?.time as number | undefined) ?? (data?.timestamp as number | undefined) ?? Date.now();
      removeFire(id, "fire.extinguished event", t);
    } else {
      fireLog(`🔥❌ FRONTEND: fire.extinguished event missing ID`, data);
    }
  });


  // Keep legacy listeners (optional)
  client.subscribeToEvent("civilian.*", (data: any) => {
    // console.log("Civilian: ", data);
    if (data?.id && data?.longitude != null && data?.latitude != null) {
      const id = data.id as string;
      typesByAgentId.set(id, "civilian");
      agentsMap.set(id, {
        id,
        type: "civilian",
        event: data.event ?? "civilian.*",
        longitude: data.longitude,
        latitude: data.latitude,
      });
    }
  });

  // 7) Handle world.hazard.fire.* events using consolidated functions
  client.subscribeToEvent("world.hazard.fire.spawned", (data: any) => {
    if (!shouldAcceptEvent(data)) return;
    fireLog(`🔥🌍 FRONTEND: Received world.hazard.fire.spawned:`, JSON.stringify(data));
    const id = data?.hazardId as string;
    const pos = data?.position as { lat?: number; lon?: number } | undefined;
    if (!id || !pos?.lat || !pos?.lon) {
      fireLog(`🔥❌ FRONTEND: world.hazard.fire.spawned missing data`, data);
      return;
    }

    const t = (data?.time as number | undefined) ?? Date.now();
    // If a new fire with same ID appears, allow updates again
    deletedFireIds.delete(id);
    traceLog(id, `SPAWNED at ${pos.lat}, ${pos.lon} t=${t}`);
    updateFire(id, { longitude: pos.lon, latitude: pos.lat }, "world.hazard.fire.spawned", t);
  });

  client.subscribeToEvent("world.hazard.fire.updated", (data: any) => {
    if (!shouldAcceptEvent(data)) return;
    fireLog(`🔥🌍 FRONTEND: Received world.hazard.fire.updated:`, JSON.stringify(data));
    const id = data?.hazardId as string;
    const intensity = data?.intensity as number;
    const pos = data?.position as { lat?: number; lon?: number } | undefined;
    const t = (data?.time as number | undefined) ?? Date.now();

    if (!id) {
      fireLog(`🔥❌ FRONTEND: world.hazard.fire.updated missing ID`, data);
      return;
    }
    const prev = lastUpdateById.get(id) ?? 0;
    if (t < prev) {
      fireLog(`🔥⏪ FRONTEND: Ignoring stale world.hazard.fire.updated for ${id} (prev=${prev}, t=${t})`);
      traceLog(id, `Ignoring stale world.hazard.fire.updated (prev=${prev}, t=${t})`);
      return;
    }

    if (typeof intensity === 'number' && intensity <= FIRE_REMOVE_THRESHOLD) {
      console.log(`🔥💀 FRONTEND: world.hazard.fire.updated removing ${id} due to intensity ${intensity}`);
      traceLog(id, `UPDATED with intensity=${intensity} → removing`);
      removeFire(id, `world.hazard.fire intensity ${intensity}`, t);
    } else if (pos?.lat && pos?.lon) {
      fireLog(`🔥🔄 FRONTEND: world.hazard.fire.updated updating ${id} position, intensity: ${intensity}`);
      traceLog(id, `UPDATED intensity=${intensity} at ${pos.lat}, ${pos.lon} t=${t}`);
      updateFire(id, { longitude: pos.lon, latitude: pos.lat }, "world.hazard.fire.updated", t);
    }
  });

  // 8) Explicit removal event handling (belt-and-suspenders)
  client.subscribeToEvent("world.hazard.fire.removed", (data: any) => {
    if (!shouldAcceptEvent(data)) return;
    fireLog(`🔥🧹 FRONTEND: Received world.hazard.fire.removed:`, JSON.stringify(data));
    const id = data?.hazardId as string | undefined;
    if (!id) {
      fireLog(`🔥❌ FRONTEND: world.hazard.fire.removed missing ID`, data);
      return;
    }
    const t = (data?.time as number | undefined) ?? Date.now();
    traceLog(id, `REMOVED event t=${t}`);
    removeFire(id, 'world.hazard.fire.removed', t);
  });


  // 4) Firefighter status updates (helps type hydration)
  client.subscribeToEvent("firefighter.status", (data: any) => {
    const id = data?.firefighterId as string | undefined;
    const pos = data?.position as { lat?: number; lon?: number } | undefined;
    if (!id) return;
    typesByAgentId.set(id, "firefighter");
    if (pos?.lat != null && pos?.lon != null) {
      const now = Date.now();
      const prev = lastUpdateById.get(id) ?? 0;
      if (now >= prev) {
        lastUpdateById.set(id, now);
        agentsMap.set(id, {
          id,
          type: "firefighter",
          event: "firefighter.status",
          longitude: pos.lon,
          latitude: pos.lat,
        });
      }
    }
  });
}


export async function GET(req: NextRequest) {
  await initKadiClient();

  // Parse query params
  const url = new URL(req.url);
  const action = url.searchParams.get("action"); // e.g., "addAgent"
  const type = url.searchParams.get("type") as Agent["type"] | undefined; // optional

  if (action === "addAgent" && client) {
    // Generate a random agent ID
    const agentId = `agent_${Math.floor(Math.random() * 100000)}`;

    // Randomize spawn location anywhere in Dallas metro (~0.15 degree range = ~15km)
    const spawnLat = 32.7767 + (Math.random() - 0.5) * 0.3;
    const spawnLon = -96.7970 + (Math.random() - 0.5) * 0.3;

    // Random destination elsewhere in Dallas (different from spawn)
    const destLat = 32.7767 + (Math.random() - 0.5) * 0.3;
    const destLon = -96.7970 + (Math.random() - 0.5) * 0.3;

    // Calculate appropriate lifetime based on distance
    const distance = Math.sqrt(
      Math.pow((destLat - spawnLat) * 111000, 2) +
      Math.pow((destLon - spawnLon) * 111000, 2)
    ); // rough meters
    const lifetime = Math.max(60000, distance * 10); // at least 60 seconds

    await client.callTool('world-simulator', 'spawnAgent', {
      agentId,
      type: "civilian",
      position: { lat: spawnLat, lon: spawnLon },
      status: "transporting",
      lifetime
    });

    // Start movement immediately after spawn
    const speed = distance / (lifetime / 1000); // m/s to arrive on time
    await client.callTool('world-simulator', 'moveMe', {
      agentId,
      destination: { lat: destLat, lon: destLon },
      profile: 'driving',
      speed: Math.min(speed, 15) // cap at reasonable speed
    });
  }
  
  else if (action === "spawnFire" && client) {
    // Example: Spawn a fire hazard using the new spawnHazard tool
    // Generate a unique hazard ID
    const hazardId = `fire_${Math.floor(Math.random() * 100000)}`;

    // Random position around Deep Ellum area
    const lat = 32.7825 + (Math.random() - 0.5) * 0.01;
    const lon = -96.7849 + (Math.random() - 0.5) * 0.01;

    await client.callTool('world-simulator', 'spawnHazard', {
      hazardId,
      type: "fire",
      position: { lat, lon },
      intensity: 0.3 + Math.random() * 0.5, // Random intensity 0.3-0.8
      radius: 15 + Math.random() * 25,      // Random radius 15-40m
      fireIntensity: "developing",
      spreadRate: 0.2 + Math.random() * 0.3 // Random spread rate
    });
  }
  

  return NextResponse.json({
    agents: Array.from(agentsMap.values()),
    actionPerformed: action ?? null,
  });
}
