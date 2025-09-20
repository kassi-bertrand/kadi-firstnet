"use client";
import { useEffect, useState } from "react";
import { Agent } from "@/types/agent";
import MapBox from "./_components/MapBox";
import Dashboard from "./_components/Dashboard";
import Remote from "./_components/Remote";

export default function Home() {
  const [agentsMap, setAgentsMap] = useState<Map<string, Agent>>(new Map());

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch("/api/kadi-proxy");
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);

        const data = await res.json();
        type AgentWithCoords = Agent & {
          lat?: number;
          lon?: number;
          latitude?: number;
          longitude?: number;
        };
        
        setAgentsMap(prev => {
          const next = new Map(prev);
          (data.agents as AgentWithCoords[]).forEach((agent) => {
            const id = agent.id;
            const latitude = agent.latitude ?? agent.lat;
            const longitude = agent.longitude ?? agent.lon;
        
            if (id == null || latitude == null || longitude == null) return;
        
            const existing = next.get(id);
            if (!existing || existing.latitude !== latitude || existing.longitude !== longitude) {
              next.set(id, {
                ...existing,
                ...agent,
                id,
                latitude,
                longitude,
              });
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
