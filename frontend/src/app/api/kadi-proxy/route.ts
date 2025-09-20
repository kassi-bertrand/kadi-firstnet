// app/api/kadi-proxy/route.ts
import { NextResponse } from "next/server";
import { KadiClient } from "@kadi.build/core";
import type { Agent } from "@/types/agent";

// Server-side map to store latest agent states
let client: KadiClient | null = null;
const agentsMap: Map<string, Agent> = new Map();

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

  // Subscribe to events once
  client.subscribeToEvent("civilian.*", (data) => {
    if (data?.id && data?.longitude && data?.latitude) {
      const agent: Agent = {
        id: data.id,
        type: data.type,
        event: data.event,
        longitude: data.longitude,
        latitude: data.latitude,
      };
      agentsMap.set(agent.id, agent);
    }
  });
  client.subscribeToEvent("fire.*", (data) => {
    if (data?.id && data?.longitude && data?.latitude) {
      const agent: Agent = {
        id: data.id,
        type: data.type,
        event: data.event,
        longitude: data.longitude,
        latitude: data.latitude,
      };
      agentsMap.set(agent.id, agent);
    }
  })
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
