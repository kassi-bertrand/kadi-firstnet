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

  client.subscribeToEvent("world.agent.spawned", (data: any) => {
    const id = data?.agentId as string | undefined;
    const type = data?.type as Agent["type"] | undefined;
    const pos = data?.position as { lat?: number; lon?: number } | undefined;
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
  
  client.subscribeToEvent("world.positions.batch", (batch: any) => {
    if (!batch?.agents) return;
    for (const a of batch.agents as Array<any>) {
      const id = a?.agentId as string | undefined;
      const lat = a?.lat as number | undefined;
      const lon = a?.lon as number | undefined;
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
  
  client.subscribeToEvent("agent.position.updated", (data: any) => {
    const id = (data?.agentId as string) || (data?.id as string);
    const lat = (data?.lat as number) ?? (data?.latitude as number);
    const lon = (data?.lon as number) ?? (data?.longitude as number);
    if (!id || lat == null || lon == null) return;
    agentsMap.set(id, {
      id,
      type: typesByAgentId.get(id) ?? "civilian",
      event: "agent.position.updated",
      longitude: lon,
      latitude: lat,
    });
  });
  
  client.subscribeToEvent("civilian.*", (data: any) => {
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
  
  client.subscribeToEvent("fire.*", (data: any) => {
    if (data?.id && data?.longitude != null && data?.latitude != null) {
      const id = data.id as string;
      typesByAgentId.set(id, "fire");
      agentsMap.set(id, {
        id,
        type: "fire",
        event: data.event ?? "fire.*",
        longitude: data.longitude,
        latitude: data.latitude,
      });
    }
  });
}  


export async function GET(req: NextRequest) {
  await initKadiClient();

  // Parse query params
  const url = new URL(req.url);
  const action = url.searchParams.get("action"); // e.g., "addAgent"
  const type = url.searchParams.get("type") as Agent["type"] | undefined; // optional

  if (action === "spawnAgent" && client) {
    const uniqueId = `agent-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await client.callTool('world-simulator', 'spawnAgent', {
      agentId: uniqueId,
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