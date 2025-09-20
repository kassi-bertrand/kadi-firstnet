import type { Agent } from "@/types/agent";
import type { FeatureCollection, Point } from "geojson";

export function agentsMapToGeoJSON(agentsMap: Map<string, Agent>): FeatureCollection<Point> {
  const features = Array.from(agentsMap.values()).map((agent) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [agent.longitude, agent.latitude],
    },
    properties: {
      id: agent.id,
      type: agent.type,
      event: agent.event,
    },
  }));

  return {
    type: "FeatureCollection" as const,
    features,
  };
}
