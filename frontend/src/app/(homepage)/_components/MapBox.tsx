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
        zoom: 12,
        pitch: 60,   // more tilt for 3D effect
        bearing: -20, // rotate slightly
      }}
      style={{ width: "100vw", height: "100vh" }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
      onLoad={(e) => {
        const map = e.target;

        // --- Terrain setup ---
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });

        // --- Add 3D buildings ---
        const layers = map.getStyle().layers;
        const labelLayerId = layers.find(
          (layer) => layer.type === "symbol" && layer.layout?.["text-field"]
        )?.id;

        map.addLayer(
          {
            id: "3d-buildings",
            source: "composite",
            "source-layer": "building",
            filter: ["==", "extrude", "true"],
            type: "fill-extrusion",
            minzoom: 15,
            paint: {
              "fill-extrusion-color": "#aaa",
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                15,
                0,
                15.05,
                ["get", "height"],
              ],
              "fill-extrusion-base": [
                "interpolate",
                ["linear"],
                ["zoom"],
                15,
                0,
                15.05,
                ["get", "min_height"],
              ],
              "fill-extrusion-opacity": 0.6,
            },
          },
          labelLayerId
        );

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
