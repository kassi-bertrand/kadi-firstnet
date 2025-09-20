// app/api/kadi-proxy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { KadiClient } from "@kadi.build/core";
import type { Agent } from "@/types/agent";

// Server-side map to store latest agent states
let client: KadiClient | null = null;
const agentsMap: Map<string, Agent> = new Map();
const typesByAgentId: Map<string, Agent["type"]> = new Map();
const lastUpdateById: Map<string, number> = new Map();

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

  // 5) Handle fire extinguished events
  client.subscribeToEvent("fire.extinguished", (data: any) => {
    const id = data?.fireId as string;
    if (!id) return;

    // Remove fire from map when extinguished
    agentsMap.delete(id);
    typesByAgentId.delete(id);
    lastUpdateById.delete(id);

    console.log(`Fire extinguished and removed from map: ${id}`);
  });

  // 6) Handle fire updates (including when intensity goes to 0)
  client.subscribeToEvent("fire.updated", (data: any) => {
    const id = data?.id as string;
    const intensity = data?.intensity as number;

    if (id && intensity !== undefined) {
      // If intensity is 0, remove the fire
      if (intensity <= 0) {
        agentsMap.delete(id);
        typesByAgentId.delete(id);
        lastUpdateById.delete(id);
        console.log(`Fire ${id} removed (intensity 0)`);
      }
      // Otherwise update its position
      else if (data?.longitude != null && data?.latitude != null) {
        typesByAgentId.set(id, "fire");
        lastUpdateById.set(id, Date.now());
        agentsMap.set(id, {
          id,
          type: "fire",
          event: "fire.updated",
          longitude: data.longitude,
          latitude: data.latitude,
        });
      }
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
  // Handle fire.* events more carefully
  client.subscribeToEvent("fire.*", (data: any) => {
    const id = data?.id || data?.fireId;
    if (!id) return;

    // Handle different fire events
    const event = data.event || "";

    if (event === "fire.extinguished" || event.includes("extinguished")) {
      // Remove fire when extinguished
      agentsMap.delete(id);
      typesByAgentId.delete(id);
      lastUpdateById.delete(id);
      console.log(`Fire ${id} extinguished and removed from map (via fire.* event)`);
    } else if (event === "fire.spawned" || event.includes("spawned")) {
      // Add new fire
      if (data?.longitude != null && data?.latitude != null) {
        typesByAgentId.set(id, "fire");
        lastUpdateById.set(id, Date.now());
        agentsMap.set(id, {
          id,
          type: "fire",
          event: event,
          longitude: data.longitude,
          latitude: data.latitude,
        });
        console.log(`Fire ${id} spawned at ${data.latitude}, ${data.longitude}`);
      }
    } else if (event === "fire.updated" || event.includes("updated")) {
      // Update fire position/intensity
      const intensity = data?.intensity;
      if (intensity !== undefined && intensity <= 0) {
        // Remove if intensity is 0
        agentsMap.delete(id);
        typesByAgentId.delete(id);
        lastUpdateById.delete(id);
        console.log(`Fire ${id} removed (intensity 0)`);
      } else if (data?.longitude != null && data?.latitude != null) {
        // Update position
        typesByAgentId.set(id, "fire");
        lastUpdateById.set(id, Date.now());
        agentsMap.set(id, {
          id,
          type: "fire",
          event: event,
          longitude: data.longitude,
          latitude: data.latitude,
        });
      }
    }
  });

  // 7) Handle world.hazard.fire.* events for fire lifecycle
  client.subscribeToEvent("world.hazard.fire.spawned", (data: any) => {
    const id = data?.hazardId as string;
    const pos = data?.position as { lat?: number; lon?: number } | undefined;
    if (!id || !pos?.lat || !pos?.lon) return;

    typesByAgentId.set(id, "fire");
    lastUpdateById.set(id, Date.now());
    agentsMap.set(id, {
      id,
      type: "fire",
      event: "world.hazard.fire.spawned",
      longitude: pos.lon,
      latitude: pos.lat,
    });
    console.log(`World hazard fire ${id} spawned at ${pos.lat}, ${pos.lon}`);
  });

  client.subscribeToEvent("world.hazard.fire.updated", (data: any) => {
    const id = data?.hazardId as string;
    const intensity = data?.intensity as number;
    const pos = data?.position as { lat?: number; lon?: number } | undefined;

    if (!id) return;

    if (intensity !== undefined && intensity <= 0) {
      // Remove if intensity is 0
      agentsMap.delete(id);
      typesByAgentId.delete(id);
      lastUpdateById.delete(id);
      console.log(`World hazard fire ${id} removed (intensity 0)`);
    } else if (pos?.lat && pos?.lon) {
      // Update position
>>>>>>> Stashed changes
      typesByAgentId.set(id, "fire");
      lastUpdateById.set(id, Date.now());
      agentsMap.set(id, {
        id,
        type: "fire",
        event: "world.hazard.fire.updated",
        longitude: pos.lon,
        latitude: pos.lat,
      });
    }
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
    await client.callTool('world-simulator', 'spawnAgent', {
      agentId: "test20",
      type: "civilian", // matches enum ["civilian", "firefighter", ...]
      position: {       // must be "position", not "properties"
        lat: 32.7767,
        lon: -96.7970
      },
      status: "transporting", // matches enum ["available", "en_route", ...]
      lifetime: 2000000           // milliseconds (or adjust as needed)
    });
  }
  

  return NextResponse.json({
    agents: Array.from(agentsMap.values()),
    actionPerformed: action ?? null,
  });
}