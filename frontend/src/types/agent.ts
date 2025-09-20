export interface Agent {
    id: string,
    type: "civilian" | "police" | "firefighter" | "ems" | "fire",
    event: string,
    longitude: number,
    latitude: number,
}