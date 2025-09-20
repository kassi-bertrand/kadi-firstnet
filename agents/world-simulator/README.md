# World Simulator Agent

Central authority for FirstNet Incident Commander emergency simulation. Manages all agent positions, hazard evolution, and world state as a single source of truth.

## Features

### 🌍 **World State Management**
- Agent positions and movement tracking
- Hazard locations and fire spreading simulation
- Dallas-based real-world locations (Downtown, Deep Ellum, Parkland Hospital)
- Real-time state synchronization across all agents

### 🛠️ **KADI Tools (API)**
- `world.whatDoISee(agentId, visionRange)` - Get comprehensive view of surroundings
- `world.moveMe(agentId, destination, profile)` - Request realistic movement
- `world.spawnAgent(agentId, type, position)` - Add new agent to simulation
- `world.getAgentPosition(agentId)` - Query agent location and status

### 📡 **Real-time Events**
- `world.tick` - 10 FPS simulation heartbeat
- `world.positions.batch` - Batched positions for dashboards (default 2 Hz)
- `agent.position.updated` - Real-time position updates
- `agent.movement.completed` - Movement completion notifications
- `world.hazard.fire.spawned|updated` - Fire lifecycle events
- `world.agent.spawned` - New agent notifications

## Batch Positions Stream

For dashboards or UIs showing many agents at once, subscribe to a single batched stream instead of per‑agent events.

- Event: `world.positions.batch`
- Default frequency: 2 Hz (configurable via `WORLD_BATCH_HZ`)
- Payload:
  - `{ time: number, tick: number, agents: Array<{ agentId, lat, lon, moving, status, heading? }>} }

Example subscription
```typescript
await client.subscribeToEvent('world.positions.batch', (batch) => {
  // Render all agents in one pass; interpolate smoothly between batches
  renderAgents(batch.agents);
});
```

Why this exists
- Reduces event fan‑out when 100s of agents are moving
- Keeps UI logic simple: one event, many positions
- Works well with client‑side interpolation at 60 FPS

## Quick Start

### Prerequisites
- Node.js 18+
- KADI Broker running on `ws://localhost:8080`
- RabbitMQ running (for KADI broker)

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## Usage Examples

### Civilian Agent Vision
```typescript
const vision = await call('world.whatDoISee', {
  agentId: 'civilian-001',
  visionRange: 50 // meters
});

// Returns: { agents: [...], hazards: [...], exits: [...] }
```

### Agent Movement
```typescript
await call('world.moveMe', {
  agentId: 'civilian-001',
  destination: { lat: 32.7767, lon: -96.7970 }, // Dallas Downtown
  profile: 'walking', // or 'driving', 'emergency'
  urgency: 'normal' // or 'urgent', 'emergency'
});
```

### Spawn New Agent
```typescript
await call('world.spawnAgent', {
  agentId: 'firefighter-001',
  type: 'firefighter',
  position: { lat: 32.7773, lon: -96.7967 }
});
```

## Dallas Test Locations

| Location | Coordinates | Type |
|----------|-------------|------|
| Downtown Safety Zone | 32.7767, -96.7970 | staging_area |
| Deep Ellum Exit | 32.7825, -96.7849 | exit |
| Parkland Hospital | 32.7885, -96.8414 | hospital |

## Fire Simulation

The World Simulator includes realistic fire behavior:

- **Fire Spreading**: Grows over time based on suppression effort
- **Intensity Levels**: 0.0 (extinguished) to 1.0 (fully developed)
- **Suppression Response**: Fire intensity decreases with firefighter intervention
- **Radius Growth**: Fire area expands unless actively suppressed

### Sample Fire
On startup, creates a test fire in Deep Ellum:
- Position: 32.7825, -96.7849
- Initial intensity: 0.6
- Radius: 25 meters
- Spread rate: 0.5 m/s

## Architecture

### World State
```typescript
{
  agents: Map<agentId, AgentState>,
  hazards: Map<hazardId, HazardState>,
  locations: Map<locationId, Location>,
  activeMovements: Map<agentId, MovementData>
}
```

### Agent Types
- `civilian` - Regular civilian agents
- `human_civilian` - Real people using mobile devices
- `firefighter` - Fire suppression units
- `ems` - Emergency medical services
- `police` - Law enforcement units
- `commander` - Incident command agents

### Movement Profiles
- `walking`: 1.4 m/s (civilian walking speed)
- `driving`: 8.0 m/s (urban driving speed)
- `emergency`: 12.0 m/s (emergency vehicle speed)

### Urgency Multipliers
- `normal`: 1.0x speed
- `urgent`: 1.5x speed
- `emergency`: 2.0x speed

## Configuration

### Environment Variables
- `KADI_BROKER_URL` - KADI broker WebSocket URL (default: `ws://localhost:8080`)
- `DEBUG` - Enable debug logging (`DEBUG=world-simulator`)
- `WORLD_BATCH_HZ` - Frequency of `world.positions.batch` events (default: `2`)
- `WORLD_STATIONARY_HZ` - Frequency of per-agent updates when stationary (default: `0` to disable)

### Tuning Guidance
- Keep simulation tick at 10 Hz (good balance of smoothness and CPU).
- Drive dashboards from `world.positions.batch` at 2–5 Hz; interpolate client‑side for smooth motion.
- Stationary per‑agent updates are disabled by default; set `WORLD_STATIONARY_HZ=1` only if you need periodic keep‑alive for parked units.

### Simulation Parameters
- **Tick Rate**: 10 FPS (100ms intervals)
- **Moving Position Updates**: Every tick (10 Hz)
- **Stationary Position Updates**: Disabled by default; set `WORLD_STATIONARY_HZ` to enable
- **Batch Positions**: `world.positions.batch` at `WORLD_BATCH_HZ` (default 2 Hz)
- **Fire Spread Rate**: 0.5 m/s base rate
- **Vision Range**: 50m default, configurable per request

## Dashboard Integration

Recommended pattern for maps/UI:
- Subscribe to `world.positions.batch` and render all visible agents.
- Interpolate on the client between batches for smooth animation.
- Optionally, also subscribe to `agent.movement.completed` for arrival markers and status transitions.

Example
```typescript
// Batch positions for drawing
await client.subscribeToEvent('world.positions.batch', (batch) => {
  updateLayer(batch.agents); // draw markers; maintain last/next state for interpolation
});

// Arrival notifications
await client.subscribeToEvent('agent.movement.completed', ({ agentId, finalPosition }) => {
  markArrived(agentId, finalPosition);
});
```

## Movement and ETA

Movement follows OSRM road routes:
- The simulator decodes OSRM step geometries into waypoints and interpolates along them.
- Duration is set from OSRM’s ETA, adjusted by `urgency` or an explicit `speed` override.
- Typical demo speeds: `speed: 24` (m/s ≈ 54 mph) reduces trip time to ~1/3 of OSRM’s default driving estimate.

## What Do I See

Use `world.whatDoISee(agentId, visionRange)` to query situational awareness:
- Agents: within `visionRange` meters
- Hazards: within `visionRange` meters or inside hazard radius
- Exits: locations of type `exit` or `staging_area` within `2 × visionRange`

Notes
- Default `visionRange` is 50 m; use 200–500 m for city scale.
- Dallas coordinates use negative longitude (e.g., `lon: -96.78`).

## Event Reference

- `world.positions.batch`
  - Batched agent positions for dashboards; controlled by `WORLD_BATCH_HZ`.
- `agent.position.updated`
  - Emitted at 10 Hz while moving; upon arrival one final update is sent.
  - Periodic stationary updates are disabled by default (set `WORLD_STATIONARY_HZ` to enable).
- `agent.movement.completed`
  - One‑shot when an agent reaches its destination.
- `world.tick`
  - Simulation heartbeat (10 Hz). Currently not published to avoid noise; enable only if needed.
- `world.hazard.fire.spawned|updated`, `world.agent.spawned`
  - Lifecycle events for hazards and agents.

## Integration with Other Agents

### Civilian Agents
```typescript
// Subscribe to world events
await agent.subscribeToEvent('world.tick', async () => {
  const vision = await agent.call('world.whatDoISee', {
    agentId: 'civilian-001'
  });

  if (vision.hazards.some(h => h.type === 'fire' && h.distance < 30)) {
    await agent.call('world.moveMe', {
      agentId: 'civilian-001',
      destination: safetyZone,
      urgency: 'emergency'
    });
  }
});
```

### Responder Agents
```typescript
// Firefighter moves toward fire
const vision = await agent.call('world.whatDoISee', {
  agentId: 'firefighter-001',
  visionRange: 100
});

const fires = vision.hazards.filter(h => h.type === 'fire');
if (fires.length > 0) {
  await agent.call('world.moveMe', {
    agentId: 'firefighter-001',
    destination: fires[0].position,
    profile: 'driving'
  });
}
```

## Performance

### Optimization Features
- Efficient distance calculations using Haversine formula
- Movement interpolation for smooth position updates
- Event batching for position updates
- Configurable vision ranges to limit computation

### Capacity
- Tested with 100+ concurrent agents
- Scales to 500+ agents with proper KADI broker configuration
- Memory efficient with Map-based state storage

## Development

### Scripts
- `npm run dev` - Development with auto-reload
- `npm run build` - TypeScript compilation
- `npm run typecheck` - Type checking only
- `npm run lint` - ESLint code quality check

### File Structure
```
world-simulator/
├── package.json          # NPM configuration
├── tsconfig.json         # TypeScript configuration
├── types.ts              # Zod schemas and TypeScript types
├── world-simulator.ts    # Main agent implementation
└── README.md            # This file
```

### Adding New Features

1. **New Tools**: Add to `registerTools()` method
2. **New Events**: Define schema in `types.ts`, publish in simulation loop
3. **New Hazard Types**: Extend `HazardTypeSchema` and add update logic
4. **New Agent Types**: Extend `AgentTypeSchema` and add behavior logic

## Troubleshooting

### Common Issues

**Connection Failed**
```
Error: Failed to connect to broker
```
- Ensure KADI broker is running on `ws://localhost:8080`
- Check RabbitMQ is running and accessible

**Agent Not Found**
```
{ success: false, error: "Agent not found" }
```
- Agent must be spawned before calling tools
- Use `world.spawnAgent()` to add agents to simulation

**Invalid Position**
```
ZodError: lat must be between -90 and 90
```
- Ensure latitude/longitude values are valid
- Dallas area: lat ~32.7, lon ~-96.8

**Too Many Position Events**
- Use the batch stream (`world.positions.batch`) for dashboards.
- Stationary per‑agent updates are disabled by default; enable via `WORLD_STATIONARY_HZ` if needed.
- For long trips, keep `WORLD_BATCH_HZ` modest (2–5 Hz) and interpolate client‑side for smooth motion with fewer messages.

### Debug Logging
```bash
DEBUG=world-simulator npm run dev
```

## License

MIT
