"use client";

import { useEffect, useRef, useState } from "react";
import { Source, Layer } from "react-map-gl/mapbox";
import type { Agent } from "@/types/agent";
import { agentsMapToGeoJSON } from "@/utils/geojson";

interface MovingAgent extends Agent {
  targetLng: number;
  targetLat: number;
}

interface AgentLayerProps {
  agentsMap: Map<string, Agent>;
  speed?: number; // interpolation factor per frame (0 < speed <= 1)
}

export default function AgentLayer({
  agentsMap,
  speed = 0.005,
}: AgentLayerProps) {
  const [movingAgents, setMovingAgents] = useState<MovingAgent[]>([]);
  const rafRef = useRef<number>(0);

  // Update target positions whenever agentsMap changes
  useEffect(() => {
    setMovingAgents(prev => {
      const updated: MovingAgent[] = [];
      agentsMap.forEach(agent => {
        const existing = prev.find(a => a.id === agent.id);
        if (existing) {
          updated.push({
            ...existing,
            targetLng: agent.longitude,
            targetLat: agent.latitude,
          });
        } else {
          updated.push({
            ...agent,
            targetLng: agent.longitude,
            targetLat: agent.latitude,
          });
        }
      });
      return updated;
    });
  }, [agentsMap]);

  // Animate agents towards their targets
  useEffect(() => {
    const animate = () => {
      setMovingAgents(prev =>
        prev.map(agent => {
          const lngDiff = agent.targetLng - agent.longitude;
          const latDiff = agent.targetLat - agent.latitude;

          return {
            ...agent,
            longitude: agent.longitude + lngDiff * speed,
            latitude: agent.latitude + latDiff * speed,
            targetLng: agent.targetLng,
            targetLat: agent.targetLat,
          };
        })
      );
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [speed]);

  const geoJSONData = agentsMapToGeoJSON(
    new Map(movingAgents.map(a => [a.id, a]))
  );

  return (
    <Source type="geojson" data={geoJSONData}>
      <Layer
        id="agents"
        type="circle"
        paint={{
          "circle-radius": 4,
          "circle-color": [
            "match",
            ["get", "type"],
            "civilian", "#00ff00",   // green
            "police", "#0000ff",     // blue
            "firefighter", "#ff0000",// red
            "fire", "#ff6600",       // orange (distinct from firefighter)
            "ems", "#ffff00",        // yellow
            "#888888",               // default gray
          ],
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1,
        }}
      />
    </Source>
  );
}
