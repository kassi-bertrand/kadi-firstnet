"use client";

import Map from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Agent } from "@/types/agent";
import AgentLayer from "./AgentLayer";

const MAP_BOX_TOKEN = process.env.NEXT_PUBLIC_MAP_BOX_TOKEN;

interface MapBoxProps {
  agentsMap: Map<string, Agent>;
}
const US_BOUNDS: [[number, number], [number, number]] = [
  [-125.0011, 24.9493], // Southwest corner
  [-66.9326, 49.5904],  // Northeast corner
];

export default function MapBox({ agentsMap }: MapBoxProps) {
  return (
    <Map
      mapboxAccessToken={MAP_BOX_TOKEN}
      initialViewState={{
        longitude: -96.797,
        latitude: 32.7767,
        zoom: 12,
        pitch: 60,   // more tilt for 3D effect
        bearing: -20, // rotate slightly
      }}
      style={{ width: "100vw", height: "100vh" }}
      maxBounds={US_BOUNDS} // 🔹 Restrict to US
      mapStyle="mapbox://styles/mapbox/dark-v11"
      onLoad={(e) => {
        const map = e.target;
        // --- Add icons ---
        const addIcon = (name: string, url: string) => {
          if (!map.hasImage(name)) {
            map.loadImage(url, (error, image) => {
              if (error) throw error;
              if (image) map.addImage(name, image);
            });
          }
        };

        addIcon("civilian-icon", "/images/civilian.png");
        addIcon("fire-icon", "/images/fire.png");
        addIcon("police-icon", "/images/police.png");
        addIcon("firefighter-icon", "/images/firefighter.png");
        addIcon("ems-icon", "/images/ems.png");
        addIcon("brain-icon", "/images/brain.png");
      }}
    >
      <AgentLayer agentsMap={agentsMap} />
    </Map>
  );
}
