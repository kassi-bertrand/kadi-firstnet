"use client";

import { Dock, DockIcon } from "@/components/ui/dock";
import { Pause, UserPlus, Activity } from "lucide-react";

export default function Dashboard() {
  return (
    <Dock className="fixed bottom-6 left-1/2 -translate-x-1/2">
      {/* Pause / Dashboard Control */}
      <DockIcon>
        <Pause className="text-white" />
      </DockIcon>

      {/* Add Agent */}
      <DockIcon>
        <UserPlus className="text-white" />
      </DockIcon>

      <DockIcon>
        <Activity className="text-white" />
      </DockIcon>
    </Dock>
  );
}