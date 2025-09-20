import { z } from 'zod';

// =========================================================================
// CORE POSITION AND LOCATION SCHEMAS
// =========================================================================

export const PositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180)
});

export const LocationSchema = z.object({
  id: z.string(),
  position: PositionSchema,
  name: z.string().optional(),
  type: z.enum(['exit', 'hospital', 'fire_station', 'police_station', 'staging_area']).optional()
});

// =========================================================================
// AGENT SCHEMAS
// =========================================================================

export const AgentTypeSchema = z.enum([
  'civilian',
  'firefighter',
  'ems',
  'police',
  'commander',
  'human_civilian'
]);

export const AgentStatusSchema = z.enum([
  'available',
  'en_route',
  'on_scene',
  'transporting',
  'staging',
  'out_of_service'
]);

export const AgentStateSchema = z.object({
  agentId: z.string(),
  type: AgentTypeSchema,
  position: PositionSchema,
  status: AgentStatusSchema,
  moving: z.boolean().default(false),
  speed: z.number().default(1.4), // m/s
  destination: PositionSchema.optional(),
  spawnedAt: z.number().default(() => Date.now()),
  lifetime: z.number().optional(), // milliseconds - if set, agent expires after this time
  lastUpdated: z.number().default(() => Date.now())
});

// ==========================================================================
// HAZARD SCHEMAS
// ==========================================================================

export const HazardTypeSchema = z.enum([
  'fire',
  'hazmat',
  'structural_collapse',
  'medical_emergency',
  'weather'
]);

export const FireIntensitySchema = z.enum([
  'incipient',     // Just started
  'developing',    // Growing
  'fully_developed', // Peak intensity
  'declining',     // Being suppressed
  'extinguished'   // Out
]);

export const HazardStateSchema = z.object({
  hazardId: z.string(),
  type: HazardTypeSchema,
  position: PositionSchema,
  intensity: z.number().min(0).max(1), // 0.0 to 1.0
  radius: z.number().positive(), // meters
  fireIntensity: FireIntensitySchema.optional(),
  spreadRate: z.number().default(0), // m/s
  suppressionEffort: z.number().min(0).max(1).default(0), // 0-1 suppression applied
  createdAt: z.number().default(() => Date.now()),
  lastUpdated: z.number().default(() => Date.now())
});

// ==========================================================================
// WORLD SIMULATOR TOOL SCHEMAS
// ==========================================================================

// What Do I See API
export const WhatDoISeeRequestSchema = z.object({
  agentId: z.string(),
  visionRange: z.number().positive().default(50) // meters
});

export const VisibleAgentSchema = z.object({
  id: z.string(),
  type: AgentTypeSchema,
  distance: z.number(),
  position: PositionSchema,
  isMoving: z.boolean(),
  status: AgentStatusSchema
});

export const VisibleHazardSchema = z.object({
  id: z.string(),
  type: HazardTypeSchema,
  distance: z.number(),
  position: PositionSchema,
  intensity: z.number(),
  radius: z.number()
});

export const VisibleLocationSchema = z.object({
  id: z.string(),
  type: z.enum(['exit', 'hospital', 'staging_area']),
  distance: z.number(),
  position: PositionSchema,
  name: z.string().optional()
});

export const WhatDoISeeResponseSchema = z.object({
  agents: z.array(VisibleAgentSchema),
  hazards: z.array(VisibleHazardSchema),
  exits: z.array(VisibleLocationSchema),
  success: z.boolean().default(true),
  error: z.string().optional()
});

// Move Me API
export const MoveMeRequestSchema = z.object({
  agentId: z.string(),
  destination: PositionSchema,
  profile: z.enum(['walking', 'driving']).default('driving'),
  speed: z.number().positive().optional(), // m/s, will default based on profile
  urgency: z.enum(['normal', 'urgent', 'emergency']).default('normal')
});

export const MoveMeResponseSchema = z.object({
  success: z.boolean(),
  estimatedArrival: z.number().optional(), // timestamp
  estimatedDuration: z.number().optional(), // seconds
  error: z.string().optional()
});

// Agent Management API
export const SpawnAgentRequestSchema = z.object({
  agentId: z.string(),
  type: AgentTypeSchema,
  position: PositionSchema,
  status: AgentStatusSchema.default('available'),
  lifetime: z.number().optional() // milliseconds - how long agent lives
});

export const SpawnAgentResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional()
});

export const GetAgentPositionRequestSchema = z.object({
  agentId: z.string()
});

export const GetAgentPositionResponseSchema = z.object({
  position: PositionSchema.optional(),
  moving: z.boolean().optional(),
  status: AgentStatusSchema.optional(),
  success: z.boolean(),
  error: z.string().optional()
});

// =========================================================================
// EVENT SCHEMAS
// =========================================================================

export const WorldTickEventSchema = z.object({
  time: z.number(), // timestamp
  tick: z.number(), // tick counter
  dt: z.number().default(0.1) // delta time in seconds
});

export const AgentPositionUpdatedEventSchema = z.object({
  agentId: z.string(),
  lat: z.number(),
  lon: z.number(),
  moving: z.boolean(),
  status: AgentStatusSchema,
  heading: z.number().optional()
});

// Batch of all agents' positions for dashboards
export const WorldPositionsBatchEventSchema = z.object({
  time: z.number(), // timestamp
  tick: z.number(), // world tick counter
  agents: z.array(z.object({
    agentId: z.string(),
    lat: z.number(),
    lon: z.number(),
    moving: z.boolean(),
    status: AgentStatusSchema,
    heading: z.number().optional()
  }))
});

export const AgentMovementCompletedEventSchema = z.object({
  agentId: z.string(),
  finalPosition: PositionSchema,
  arrivalTime: z.number()
});

export const HazardSpawnedEventSchema = z.object({
  hazardId: z.string(),
  type: HazardTypeSchema,
  position: PositionSchema,
  intensity: z.number(),
  radius: z.number()
});

export const HazardUpdatedEventSchema = z.object({
  hazardId: z.string(),
  position: PositionSchema,
  intensity: z.number(),
  radius: z.number(),
  suppressionEffort: z.number()
});

export const AgentSpawnedEventSchema = z.object({
  agentId: z.string(),
  type: AgentTypeSchema,
  position: PositionSchema,
  status: AgentStatusSchema
});

export const AgentExpiredEventSchema = z.object({
  agentId: z.string(),
  type: AgentTypeSchema,
  position: PositionSchema,
  lifetime: z.number(),
  reason: z.enum(['lifetime_expired', 'manual_despawn', 'simulation_ended'])
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Position = z.infer<typeof PositionSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;
export type HazardType = z.infer<typeof HazardTypeSchema>;
export type FireIntensity = z.infer<typeof FireIntensitySchema>;
export type HazardState = z.infer<typeof HazardStateSchema>;

export type WhatDoISeeRequest = z.infer<typeof WhatDoISeeRequestSchema>;
export type WhatDoISeeResponse = z.infer<typeof WhatDoISeeResponseSchema>;
export type MoveMeRequest = z.infer<typeof MoveMeRequestSchema>;
export type MoveMeResponse = z.infer<typeof MoveMeResponseSchema>;
export type SpawnAgentRequest = z.infer<typeof SpawnAgentRequestSchema>;
export type SpawnAgentResponse = z.infer<typeof SpawnAgentResponseSchema>;

export type WorldTickEvent = z.infer<typeof WorldTickEventSchema>;
export type AgentPositionUpdatedEvent = z.infer<typeof AgentPositionUpdatedEventSchema>;
export type AgentMovementCompletedEvent = z.infer<typeof AgentMovementCompletedEventSchema>;
export type HazardSpawnedEvent = z.infer<typeof HazardSpawnedEventSchema>;
export type HazardUpdatedEvent = z.infer<typeof HazardUpdatedEventSchema>;
export type AgentSpawnedEvent = z.infer<typeof AgentSpawnedEventSchema>;
