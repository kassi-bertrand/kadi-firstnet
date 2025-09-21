"use client";

import Map from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Agent } from "@/types/agent";
import AgentLayer from "./AgentLayer";

const MAP_BOX_TOKEN = process.env.NEXT_PUBLIC_MAP_BOX_TOKEN;

interface MapBoxProps {
  agentsMap: Map<string, Agent>;
}

// North Texas bounding box (restrict panning)
const NORTH_TEXAS_BOUNDS: [[number, number], [number, number]] = [
  [-98.5, 31.0],  // SW corner
  [-94.0, 34.5],  // NE corner
];

export default function MapBox({ agentsMap }: MapBoxProps) {
  return (
    <Map
      mapboxAccessToken={MAP_BOX_TOKEN}
      initialViewState={{
        longitude: -96.7847,  // Center on SMU
        latitude: 32.8419,    // Center on SMU
        zoom: 14,             // Closer zoom for campus
        pitch: 30,
        bearing: 0,
      }}
      style={{ width: "100vw", height: "100vh" }}
      maxBounds={NORTH_TEXAS_BOUNDS}  // Keep map within North Texas
      mapStyle="mapbox://styles/mapbox/dark-v11"
      onLoad={(e) => {
        const map = e.target;

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
