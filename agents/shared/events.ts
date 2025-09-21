/**
 * Shared event type definitions between Commander and Firefighter.
 *
 * These are lightweight TypeScript interfaces describing the shape of the
 * messages we exchange over the KADI broker. There is no runtime enforcement
 * by the broker; comments and explicit field names keep the wire contract
 * readable and stable across agents.
 */

// Commander → Firefighters: dispatch order (broadcast)
export interface FirefighterDispatchEvent {
  // Unique id for this dispatch attempt. Allows acknowledgement/cancellation.
  dispatchId: string;
  // Logical incident identifier created by the commander.
  incidentId: string;
  // Who initiated the dispatch (useful for auditing in multi‑commander setups).
  commanderId: string;
  // Target destination (typically the incident location).
  destination: { lat: number; lon: number };
  // Suggested urgency level for routing.
  urgency: 'normal' | 'urgent' | 'emergency';
  // Human‑readable text for UI logs.
  description?: string;
  // Optional deadline for acknowledgements; after this, commander may re‑dispatch.
  deadlineMs?: number;
}

// Firefighter → Commander: acknowledgement for a specific dispatch
export interface FirefighterDispatchAckEvent {
  dispatchId: string;
  firefighterId: string;
  // Accept or decline this dispatch.
  accepted: boolean;
  // Optional reason for decline (e.g., "busy", "too_far").
  reason?: string;
  // Optional best‑effort ETA in seconds (if accepted and known).
  etaSeconds?: number;
}

// Firefighter → Anyone: status heartbeat (already in place but typed here)
export interface FirefighterStatusEvent {
  firefighterId: string;
  status: 'at_base' | 'en_route' | 'on_scene' | 'extinguishing' | 'returning';
  incidentId?: string;
  timestamp: number;
  position: { lat: number; lon: number };
}

// Commander → Firefighter(s): cancel an earlier dispatch (when resolved or reassigned)
export interface FirefighterDispatchCancelEvent {
  dispatchId: string;
  incidentId: string;
  reason?: string;
}

// Firefighter → Commander: self-dispatch notification for nearby hazard
// When a firefighter at base detects a nearby fire and decides to self-dispatch,
// we publish this event so a commander (or multiple) can record that this hazard
// likely already has a unit assigned. This helps avoid duplicate dispatches to
// the same hazard from other coordinators.
export interface FirefighterSelfDispatchEvent {
  firefighterId: string;
  // The hazard this unit intends to suppress (as detected via whatDoISee)
  hazardId: string;
  // Optional synthetic incident id used locally by the firefighter agent
  incidentId?: string;
  // Where the hazard was observed (used by commanders to proximity-match incidents)
  position: { lat: number; lon: number };
  timestamp: number;
}
