"use client";
import { useEffect, useState } from "react";
import { Agent } from "@/types/agent";
import MapBox from "./_components/MapBox";
import Dashboard from "./_components/Dashboard";

export default function Home() {
  const [agentsMap, setAgentsMap] = useState<Map<string, Agent>>(new Map());

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch("/api/kadi-proxy");
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);

        const data = await res.json();
        setAgentsMap(prev => {
          const next = new Map(prev);
          (data.agents as Agent[]).forEach((agent: Agent) => {
            // Ensure we always store latitude/longitude fields
            const id = agent.id;
            const latitude = (agent as any).latitude ?? (agent as any).lat;
            const longitude = (agent as any).longitude ?? (agent as any).lon;
            if (id == null || latitude == null || longitude == null) return;

            const existing = next.get(id);
            if (!existing || existing.latitude !== latitude || existing.longitude !== longitude) {
              next.set(id, {
                ...existing,
                ...agent,
                id,
                latitude,
                longitude,
              } as Agent);
            }
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
    <div className="flex flex-col min-h-screen min-w-screen bg-black">
      <MapBox agentsMap={agentsMap} />
      <Dashboard />
    </div>
  );
}
