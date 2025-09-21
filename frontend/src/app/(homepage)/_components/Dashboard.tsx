"use client";

import { Dock, DockIcon } from "@/components/ui/dock";
import { UserPlus, Flame } from "lucide-react";
import { ShimmerButton } from "@/components/ui/shimmer-button";

export default function Dashboard() {
  const handleAddAgent = async () => {
    try {
      const res = await fetch("/api/kadi-proxy?action=addAgent");
      if (!res.ok) throw new Error("Failed to add agent");
      const data = await res.json();
      console.log("Agent added:", data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSpawnFire = async () => {
    try {
      const res = await fetch("/api/kadi-proxy?action=spawnFire");
      if (!res.ok) throw new Error("Failed to add agent");
      const data = await res.json();
      console.log("Agent added:", data);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Dock className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black px-4 py-2 gap-4 border-0">
      {/* Add Agent */}
      <DockIcon>
        <ShimmerButton
          shimmerColor="#4dff88"
          shimmerSize="0.05em"
          shimmerDuration="2.5s"
          background="rgba(0,0,0,1)"
          className="p-3 rounded-full"
          onClick={handleAddAgent}
        >
          <UserPlus className="text-white" />
        </ShimmerButton>
      </DockIcon>
      {/* Fire */}
      <DockIcon>
        <ShimmerButton
          shimmerColor="#ff4d4d"
          shimmerSize="0.05em"
          shimmerDuration="3s"
          background="rgba(0,0,0,1)"
          className="p-3 rounded-full"
          onClick={handleSpawnFire}
        >
          <Flame className="text-white" />
        </ShimmerButton>
      </DockIcon>
    </Dock>
  );
}
