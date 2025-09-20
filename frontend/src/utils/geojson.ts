import type { Agent } from "@/types/agent";
import type { FeatureCollection, Point } from "geojson";

export function agentsMapToGeoJSON(
  agentsMap: Map<string, Agent>
): FeatureCollection<Point> {
  const features = Array.from(agentsMap.values()).map((agent) => {
    let icon: string;

    switch (agent.type) {
      case "fire":
        icon = "fire-icon";
        break;
      case "police":
        icon = "police-icon";
        break;
      case "firefighter":
        icon = "firefighter-icon";
        break;
      case "ems":
        icon = "ems-icon";
        break;
      case "civilian":
        icon = "civilian-icon"; 
        break;
      case "commander":
        icon = "brain-icon";
        break;
      case "brain":
        icon = "brain-icon";
        break;
    }

    return {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [agent.longitude, agent.latitude],
      },
      properties: {
        id: agent.id,
        type: agent.type,
        event: agent.event,
        icon,
      },
    };
  });

  return {
    type: "FeatureCollection" as const,
    features,
  };
}
