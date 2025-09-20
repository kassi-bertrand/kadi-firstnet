// app/api/kadi-proxy/route.ts
import { NextResponse } from "next/server";
import { KadiClient } from "@kadi.build/core";
import type { Agent } from "@/types/agent";

// Server-side map to store latest agent states
let client: KadiClient | null = null;
const agentsMap: Map<string, Agent> = new Map();
const typesByAgentId: Map<string, Agent["type"]> = new Map();

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

  // Subscribe to world simulator streams
  // 1) Track types from spawn events
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

  // 2) Batched positions for dashboards
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

  // 3) Per-agent real-time updates (moving)
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

  // Keep legacy listeners (optional)
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

// GET handler
export async function GET() {
  await initKadiClient();

  // Return batched agents for client to consume
  return NextResponse.json({
    agents: Array.from(agentsMap.values()), // current snapshot
    count: agentsMap.size,
  });
}
