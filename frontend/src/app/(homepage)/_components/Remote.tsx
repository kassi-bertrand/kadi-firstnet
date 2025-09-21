import { ShimmerButton } from "@/components/ui/shimmer-button";
import { UserPlus, Flame } from "lucide-react";

export default function Remote() {
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
    <div className="flex flex-col sm:hidden min-h-screen min-w-screen items-center justify-center gap-6 bg-black relative overflow-hidden">
      {/* Buttons */}
      <div className="flex flex-col gap-4 z-10">
        <ShimmerButton
            shimmerColor="#4dff88"
          shimmerDuration="2.5s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
          onClick={handleAddAgent}
        >
          <UserPlus className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            Join
          </span>
        </ShimmerButton>

        <ShimmerButton
          shimmerColor="#ff4d4d"
          shimmerDuration="3s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl w-60"
          onClick={handleSpawnFire}

        >
          <Flame className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            Fire
          </span>
        </ShimmerButton>

        {/* <ShimmerButton
            shimmerColor="#4da6ff"
          shimmerDuration="2.8s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
        >
          <Phone className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            911
          </span>
        </ShimmerButton> */}

        {/* <ShimmerButton
          shimmerColor="#bb00ff"
          shimmerDuration="2.5s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
        >
          <LogOut className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            Disconnect
          </span>
        </ShimmerButton> */}
      </div>
    </div>
  );
}
