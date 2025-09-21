"use client";

import { Source, Layer } from "react-map-gl/mapbox";
import type { Agent } from "@/types/agent";
import { agentsMapToGeoJSON } from "@/utils/geojson";

interface AgentLayerProps {
  agentsMap: Map<string, Agent>;
}

export default function AgentLayer({ agentsMap }: AgentLayerProps) {
  const data = agentsMapToGeoJSON(agentsMap);

  return (
    <Source id="agents" type="geojson" data={data}>
      <Layer
        id="agents-symbol"
        type="symbol"
        layout={{
          "icon-image": ["get", "icon"], // each feature has `icon` property
          "icon-size": [
            "match",
            ["get", "icon"],
            "civilian-icon", 0.05,   // civilians smaller
            "police-icon", 0.1,     // police car
            "fire-icon", 0.1,        // fire truck
            "firefighter-icon", 0.075, // person but slightly larger
            "ems-icon", 0.1,         // ambulance
            "brain-icon", 0.1,      // misc
            0.05                   // default size
          ],
          "icon-allow-overlap": true,
        }}
      />
    </Source>
  );
}
