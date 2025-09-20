"use client";
import { useEffect, useState } from "react";
import { Agent } from "@/types/agent";
import MapBox from "./_components/MapBox";
import Dashboard from "./_components/Dashboard";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { cn } from "@/lib/utils";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Pause, UserPlus } from "lucide-react";
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
        setAgentsMap(prev => {
          const next = new Map(prev);
          (data.agents as Agent[]).forEach((agent: Agent) => {
            if (agent.event === "die") {
              next.delete(agent.id);
              return; // exits THIS iteration only
            }
            // Ensure we always store latitude/longitude fields
            const id = agent.id;
            const latitude = (agent as any).latitude ?? (agent as any).lat;
            const longitude = (agent as any).longitude ?? (agent as any).lon;
            if (id == null || latitude == null || longitude == null) return;
            agent.event == "die"
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
