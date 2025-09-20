"use client";

import Map from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Agent } from "@/types/agent";
import AgentLayer from "./AgentLayer";

const MAP_BOX_TOKEN = process.env.NEXT_PUBLIC_MAP_BOX_TOKEN;

interface MapBoxProps {
  agentsMap: Map<string, Agent>;
}

export default function MapBox({ agentsMap }: MapBoxProps) {
  return (
    <Map
      mapboxAccessToken={MAP_BOX_TOKEN}
      initialViewState={{
        longitude: -96.797,
        latitude: 32.7767,
        zoom: 10,
        pitch: 40,
      }}
      style={{ width: "100vw", height: "100vh" }}
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
        addIcon("police-icon", "/images/police.png");    // police
        addIcon("firefighter-icon", "/images/firefighter.png");    
        addIcon("ems-icon", "/images/ems.png");          // EMS
      }}
    >
      <AgentLayer agentsMap={agentsMap} />
    </Map>
  );
}
