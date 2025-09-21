/* eslint-disable @typescript-eslint/no-explicit-any */

"use client";
import { useEffect, useState } from "react";
import { Agent } from "@/types/agent";
import MapBox from "./_components/MapBox";
import Dashboard from "./_components/Dashboard";
import Remote from "./_components/Remote";

export default function Home() {
  const [agentsMap, setAgentsMap] = useState<Map<string, Agent>>(() => {
    const map = new Map<string, Agent>();
    // Add a test agent at some coordinates
    // map.set("test-agent", {
    //   id: "test-agent",
    //   type: "ems",
    //   latitude: 32.7749,  // Example: San Francisco
    //   longitude: -96.8,
    //   event: "test",
    // });
    return map;
  });
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch("/api/kadi-proxy");
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);

        const data = await res.json();
        // Full reconciliation with server: rebuild the map from response
        setAgentsMap(() => {
          const next = new Map<string, Agent>();
          (data.agents as Agent[]).forEach((agent: Agent) => {
            // Normalize id/lat/lon fields
            const id = (agent as Agent).id as string | undefined;
            const latitude = (agent as any).latitude ?? (agent as any).lat;
            const longitude = (agent as any).longitude ?? (agent as any).lon;
            if (id == null || latitude == null || longitude == null) return;
            // Ignore any 'die' marker; backend already prunes removed agents
            next.set(id, {
              ...agent,
              id,
              latitude,
              longitude,
            } as Agent);
          });
          return next;
        });
      } catch (err) {
        console.error("Failed to fetch agents:", err);
      }
    };
    fetchAgents();
    const interval = setInterval(fetchAgents, 500); // poll every 0.5s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col min-h-screen min-w-screen">
      {/* Desktop  */}
      <div className="hidden sm:flex">
        <MapBox agentsMap={agentsMap} />
        <Dashboard />
      </div>
      {/* Mobile  */}
      <div className="flex flex-col sm:hidden min-h-screen min-w-screen items-center justify-center gap-6 bg-black relative overflow-hidden">
        <Remote />
      </div>
    </div>
  );
}
