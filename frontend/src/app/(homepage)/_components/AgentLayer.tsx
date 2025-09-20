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
          "icon-image": ["get", "icon"], // 👈 dynamic per agent
          "icon-size": 0.075,
          "icon-allow-overlap": true,
        }}
      />
    </Source>
  );
}
