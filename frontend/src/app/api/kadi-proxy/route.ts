// app/api/kadi-proxy/route.ts
import { NextRequest, NextResponse } from "next/server";
import { KadiClient } from "@kadi.build/core";
import type { Agent } from "@/types/agent";

// Server-side map to store latest agent states
let client: KadiClient | null = null;
const agentsMap: Map<string, Agent> = new Map();
const typesByAgentId: Map<string, Agent["type"]> = new Map();

interface SpawnedAgentEvent {
  agentId: string;
  type?: Agent["type"];
  position?: { lat?: number; lon?: number };
}

interface PositionsBatchEvent {
  agents: Array<{ agentId: string; lat: number; lon: number }>;
}

interface UpdatedAgentEvent {
  agentId?: string;
  id?: string;
  lat?: number;
  lon?: number;
  latitude?: number;
  longitude?: number;
  event?: string;
}

interface LegacyAgentEvent {
  id: string;
  latitude: number;
  longitude: number;
  event?: string;
}


// Initialize Kadi client only once
async function initKadiClient() {
  if (client) return;

  const brokerUrl = process.env.KADI_BROKER_URL || "ws://localhost:8080";
  const networks = process.env.KADI_NETWORKS?.split(",") || ["global"];

  client = new KadiClient({
    name: "proxy",
    role: "agent",
    transport: "broker",
    brokers: { local: brokerUrl },
    defaultBroker: "local",
    networks,
  });

  await client.connectToBrokers();
  console.log(`KADI client connected to broker at ${brokerUrl}`);

  client.subscribeToEvent("world.agent.spawned", (data: SpawnedAgentEvent) => {
    const id = data.agentId;
    const type = data.type;
    const pos = data.position;
    if (!id) return;
    if (type) typesByAgentId.set(id, type);
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
  
  client.subscribeToEvent("world.positions.batch", (batch: PositionsBatchEvent) => {
    for (const a of batch.agents) {
      const id = a.agentId;
      const lat = a.lat;
      const lon = a.lon;
      if (!id || lat == null || lon == null) continue;
      agentsMap.set(id, {
        id,
        type: typesByAgentId.get(id) ?? "civilian",
        event: "world.positions.batch",
        longitude: lon,
        latitude: lat,
      });
    }
  });
  
  client.subscribeToEvent("agent.position.updated", (data: UpdatedAgentEvent) => {
    const id = data.agentId ?? data.id;
    const lat = data.lat ?? data.latitude;
    const lon = data.lon ?? data.longitude;
    if (!id || lat == null || lon == null) return;
    agentsMap.set(id, {
      id,
      type: typesByAgentId.get(id) ?? "civilian",
      event: "agent.position.updated",
      longitude: lon,
      latitude: lat,
    });
  });
  
  client.subscribeToEvent("civilian.*", (data: LegacyAgentEvent) => {
    const { id, longitude, latitude, event } = data;
    typesByAgentId.set(id, "civilian");
    agentsMap.set(id, {
      id,
      type: "civilian",
      event: event ?? "civilian.*",
      longitude,
      latitude,
    });
  });
  
  client.subscribeToEvent("fire.*", (data: LegacyAgentEvent) => {
    const { id, longitude, latitude, event } = data;
    typesByAgentId.set(id, "fire");
    agentsMap.set(id, {
      id,
      type: "fire",
      event: event ?? "fire.*",
      longitude,
      latitude,
    });
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