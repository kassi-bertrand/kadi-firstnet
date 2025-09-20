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
        const updatedMap = new Map(agentsMap);

        data.agents.forEach((agent: Agent) => {
          const existing = updatedMap.get(agent.id);
          if (!existing || existing.event !== agent.event) {
            updatedMap.set(agent.id, agent);
          }
        });
        setAgentsMap(updatedMap);
      } catch (err) {
        console.error("Failed to fetch agents:", err);
      }
    };
    fetchAgents();
    const interval = setInterval(fetchAgents, 500); // poll every 1s
    return () => clearInterval(interval);
  });

  return (
    <div className="flex flex-col min-h-screen min-w-screen bg-black">
      <MapBox agentsMap={agentsMap} />
      <Dashboard />
    </div>
  );
}
