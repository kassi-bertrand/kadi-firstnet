export interface Agent {
    id: string,
    type: "civilian" | "police" | "firefighter" | "ems" | "fire" | "commander",
    event: string,
    longitude: number,
    latitude: number,
}