export interface Agent {
    id: string,
    type: "civilian" | "police" | "firefighter" | "ems" | "fire" | "commander" | "brain",
    event: string,
    longitude: number,
    latitude: number,
}