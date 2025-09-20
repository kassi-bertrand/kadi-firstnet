import { ShimmerButton } from "@/components/ui/shimmer-button";
import { UserPlus, Pause, Flame, Phone, LogOut } from "lucide-react";

export default function Remote() {
  return (
    <div className="flex flex-col sm:hidden min-h-screen min-w-screen items-center justify-center gap-6 bg-black relative overflow-hidden">
      {/* Buttons */}
      <div className="flex flex-col gap-4 z-10">
        <ShimmerButton
            shimmerColor="#4dff88"
          shimmerDuration="2.5s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
        >
          <UserPlus className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            Add Agent
          </span>
        </ShimmerButton>

        {/* <ShimmerButton
          shimmerColor="#ffcc00"
          shimmerDuration="2s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
        >
          <Pause className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            Pause
          </span>
        </ShimmerButton> */}

        <ShimmerButton
          shimmerColor="#ff4d4d"
          shimmerDuration="3s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
        >
          <Flame className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            Fire
          </span>
        </ShimmerButton>

        <ShimmerButton
            shimmerColor="#4da6ff"
          shimmerDuration="2.8s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
        >
          <Phone className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            911
          </span>
        </ShimmerButton>

        <ShimmerButton
          shimmerColor="#bb00ff"
          shimmerDuration="2.5s"
          background="rgba(0,0,0,1)"
          className="flex items-center gap-2 px-6 py-4 rounded-xl shadow-2xl"
        >
          <LogOut className="w-6 h-6 text-white" />
          <span className="text-center text-sm font-medium text-white lg:text-lg">
            Disconnect
          </span>
        </ShimmerButton>
      </div>
    </div>
  );
}
