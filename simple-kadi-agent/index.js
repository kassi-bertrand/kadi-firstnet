// Simple civilian-ability - just the basics
import { KadiClient } from '@kadi.build/core';

// Use remote KADI broker by default
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://kadi.build:8080';
const networks = process.env.KADI_NETWORKS ? process.env.KADI_NETWORKS.split(',') : ['global'];

console.log(`🌐 Civilian-ability connecting to: ${brokerUrl}`);
console.log(`🌍 Using networks: ${networks.join(', ')}`);

const civilianAbility = new KadiClient({
    name: 'civilian-ability',
    version: '0.0.1',
    description: 'Simple civilian ability',
    role: 'ability',
    transport: 'broker',
    networks: networks,
    brokers: { remote: brokerUrl },
    defaultBroker: 'remote'
});

// Simple civilian storage
let civilians = new Map();

// Generate random location within Dallas bounds
function generateRandomDallasLocation() {
  const minLat = 32.645, maxLat = 32.775;
  const minLng = -96.925, maxLng = -96.835;
  
  return {
    latitude: Math.random() * (maxLat - minLat) + minLat,
    longitude: Math.random() * (maxLng - minLng) + minLng
  };
}

// Spawn a civilian
async function spawn_civilian(params = {}) {
  const civilianId = params.civilianId || `civilian_${Date.now()}`;
  const agentType = params.agentType || 'civilian'; // Default to civilian if not specified
  
  // Use preferred location if provided, otherwise use random Dallas location
  const Location = params.preferredLocation || generateRandomDallasLocation();
  const timestamp = new Date().toISOString();

  // Store civilian with type
  civilians.set(civilianId, {
    id: civilianId,
    location: Location,
    isActive: true,
    spawnTime: timestamp,
    agentType: agentType
  });

  console.log(`✅ Spawned ${agentType} ${civilianId} at ${Location.latitude.toFixed(4)}, ${Location.longitude.toFixed(4)}`);

  // Publish spawn event with standardized Agent schema
  civilianAbility.publishEvent('civilian.spawn', {
    id: civilianId,
    type: agentType, // Use the provided agent type
    event: "spawn",
    longitude: Location.longitude,
    latitude: Location.latitude,
    // Additional metadata
    timestamp
  });

  // Start autonomous walking behavior
  setTimeout(async () => {
    try {
      const destination = generateRandomDallasLocation();
      console.log(`🎯 ${civilianId} starting autonomous walk to ${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)}`);
      
      await walk({
        from: Location,
        to: destination,
        civilianId: civilianId
      });
      
    } catch (error) {
      console.error(`❌ Error during autonomous walk for ${civilianId}:`, error.message);
    }
  }, 1000); // Start walking after 1 second

  return { civilianId, Location, timestamp };
}

// Walk function with OSRM API and enhanced route adherence
async function walk({ from, to, civilianId }) {
  console.log(`🚶 ${civilianId} walking from ${from.latitude.toFixed(4)}, ${from.longitude.toFixed(4)} to ${to.latitude.toFixed(4)}, ${to.longitude.toFixed(4)}`);

  let distance, duration;

  try {
    // Get real route from OSRM API
    console.log('🗺️ Fetching route from OSRM...');
    const route = await fetch(`http://router.project-osrm.org/route/v1/walking/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`);
    const routeData = await route.json();
    
    if (!routeData.routes || !routeData.routes[0]) {
      throw new Error('No route found');
    }

    const routeInfo = routeData.routes[0];
    distance = routeInfo.distance; // meters
    duration = routeInfo.duration; // seconds
    
    console.log(`📊 Route calculated: ${distance.toFixed(1)}m in ${duration.toFixed(1)}s`);

    // Simulate walking along the route
    const coordinates = routeInfo.geometry.coordinates; // Array of [lng, lat] pairs
    if (coordinates && coordinates.length > 1) {
      console.log(`🛤️ Starting walk simulation with ${coordinates.length} waypoints`);
      
      // Get the agent type for this civilian
      const civilian = civilians.get(civilianId);
      const agentType = civilian ? civilian.agentType : 'civilian';

      // Publish walk start event with standardized Agent schema
      civilianAbility.publishEvent('civilian.walk_start', {
        id: civilianId,
        type: agentType, // Use actual agent type
        event: "walk_start",
        longitude: from.longitude,
        latitude: from.latitude,
        // Additional metadata
        timestamp: new Date().toISOString(),
        destination: { latitude: to.latitude, longitude: to.longitude },
        totalDistance: distance,
        estimatedDuration: duration
      });
      
      // Frontend-friendly movement with smooth updates
      const maxUpdates = Math.min(30, Math.max(8, Math.floor(coordinates.length / 4))); // Fewer updates for slower movement
      const simulationSpeedMultiplier = 1.5; // Slower movement
      const baseUpdateInterval = 2; // 2 seconds between updates in simulation time
      const realUpdateIntervalMs = (baseUpdateInterval * 1000) / simulationSpeedMultiplier;

      const totalUpdates = maxUpdates;
      const stepSize = Math.max(1, Math.floor(coordinates.length / totalUpdates)); // Ensure stepSize is at least 1
      
      console.log(`� Walking ${distance.toFixed(0)}m - frontend tracking: ${totalUpdates} updates every ${realUpdateIntervalMs}ms`);
      
      for (let i = 1; i < totalUpdates; i++) {
        const coordIndex = i * stepSize;
        if (coordIndex < coordinates.length) {
          const currentCoord = coordinates[coordIndex];
          if (!currentCoord || currentCoord.length < 2) {
            console.warn(`⚠️ Invalid coordinate at index ${coordIndex}:`, currentCoord);
            continue;
          }
          
          const currentLocation = {
            latitude: currentCoord[1],
            longitude: currentCoord[0]
          };
          
          // Update civilian location
          if (civilians.has(civilianId)) {
            civilians.get(civilianId).location = currentLocation;
          }

          // Publish location update with standardized Agent schema
          civilianAbility.publishEvent('civilian.location_update', {
            id: civilianId,
            type: agentType, // Use the civilian's stored agent type
            event: "location_update",
            longitude: currentLocation.longitude,
            latitude: currentLocation.latitude,
            // Additional metadata (can be ignored if not needed)
            timestamp: new Date().toISOString(),
            progress: i / totalUpdates,
            stepIndex: i,
            totalSteps: totalUpdates
          });
          
          console.log(`📍 ${civilianId} location update: ${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)} (${(i/totalUpdates*100).toFixed(0)}% complete) [${i}/${totalUpdates}]`);
          
          // Frontend-friendly timing
          await new Promise(resolve => setTimeout(resolve, realUpdateIntervalMs));
        }
      }
      
      // Update final location
      const finalCoord = coordinates[coordinates.length - 1];
      const finalLocation = {
        latitude: finalCoord[1],
        longitude: finalCoord[0]
      };

      // Update civilian location
      if (civilians.has(civilianId)) {
        civilians.get(civilianId).location = finalLocation;
      }
    }

  } catch (error) {
    console.error('❌ Route calculation failed:', error.message);
    // Fallback to simple calculation
    const latDiff = to.latitude - from.latitude;
    const lonDiff = to.longitude - from.longitude;
    distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 111000; // Convert to meters
    duration = distance / 1.4; // Walking speed ~1.4 m/s
    
    // Get the agent type for this civilian
    const civilian = civilians.get(civilianId);
    const agentType = civilian ? civilian.agentType : 'civilian';
    
    // Publish walk start event with standardized Agent schema (fallback)
    civilianAbility.publishEvent('civilian.walk_start', {
      id: civilianId,
      type: agentType,
      event: "walk_start",
      longitude: from.longitude,
      latitude: from.latitude,
      // Additional metadata
      timestamp: new Date().toISOString(),
      destination: { latitude: to.latitude, longitude: to.longitude },
      totalDistance: distance,
      estimatedDuration: duration,
      routeType: 'fallback'
    });
    
    // Fallback with improved updates
    const maxUpdates = 20; // More updates for smoother fallback
    const realUpdateIntervalMs = 1333; // Match main timing
    
    console.log(`🚶 Fallback walking ${distance.toFixed(0)}m, ${maxUpdates} updates for frontend tracking`);
    
    for (let i = 1; i <= maxUpdates; i++) {
      const progress = i / maxUpdates;
      const currentLat = from.latitude + (latDiff * progress);
      const currentLng = from.longitude + (lonDiff * progress);
      
      const currentLocation = {
        latitude: currentLat,
        longitude: currentLng
      };
      
      // Update civilian location
      if (civilians.has(civilianId)) {
        civilians.get(civilianId).location = currentLocation;
      }
      
      // Publish location update with standardized Agent schema
      civilianAbility.publishEvent('civilian.location_update', {
        id: civilianId,
        type: agentType,
        event: "location_update",
        longitude: currentLocation.longitude,
        latitude: currentLocation.latitude,
        // Additional metadata (can be ignored if not needed)
        timestamp: new Date().toISOString(),
        progress: progress,
        stepIndex: i,
        totalSteps: maxUpdates,
        routeType: 'fallback'
      });
      
      console.log(`📍 ${civilianId} fallback location update: ${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)} (${(progress*100).toFixed(0)}% complete) [${i}/${maxUpdates}]`);
      
      // Frontend-friendly timing
      await new Promise(resolve => setTimeout(resolve, realUpdateIntervalMs));
    }
    
    // Update civilian location to destination
    if (civilians.has(civilianId)) {
      civilians.get(civilianId).location = to;
    }
  }

  const timestamp = new Date().toISOString();

  // Get the agent type for this civilian
  const civilian = civilians.get(civilianId);
  const agentType = civilian ? civilian.agentType : 'civilian';

  // Publish walk complete event
  civilianAbility.publishEvent('civilian.walk_complete', {
    id: civilianId,
    type: agentType,
    event: "walk_complete",
    longitude: to.longitude,
    latitude: to.latitude,
    // Additional metadata
    timestamp,
    distance: distance,
    duration: duration
  });

  console.log(`✅ ${civilianId} completed walk: ${distance.toFixed(1)}m in ${duration.toFixed(1)}s`);

  // Start next autonomous walk after a short break (continuous wandering)
  setTimeout(async () => {
    try {
      console.log(`🔄 ${civilianId} taking a break, then continuing to wander...`);
      
      // Generate next random destination
      const nextDestination = generateRandomDallasLocation();
      console.log(`🎯 ${civilianId} continuing autonomous wandering to ${nextDestination.latitude.toFixed(4)}, ${nextDestination.longitude.toFixed(4)}`);
      
      // Start next walk from current location
      await walk({
        from: to,  // Current location becomes new starting point
        to: nextDestination,
        civilianId: civilianId
      });
      
    } catch (error) {
      console.error(`❌ Error during continuous wandering for ${civilianId}:`, error.message);
    }
  }, 5000 + Math.random() * 10000); // Random break between 5-15 seconds

  return { from, to, distance, duration, timestamp, location: to };
}

// Stop civilian
async function stop_civilian(params) {
  const civilianId = typeof params === 'string' ? params : params.civilianId;
  
  if (!civilians.has(civilianId)) {
    throw new Error(`Civilian ${civilianId} not found`);
  }

  civilians.delete(civilianId);
  console.log(`🛑 Stopped civilian ${civilianId}`);

  return { civilianId, status: 'stopped', timestamp: new Date().toISOString() };
}

// Register tools
civilianAbility.registerTool('spawn_civilian', spawn_civilian, {
  description: 'Spawn a civilian at a random location',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object', properties: { Location: { type: 'object' }, timestamp: { type: 'string' } } }
});

civilianAbility.registerTool('walk', walk, {
  description: 'Walk from one location to another',
  inputSchema: { 
    type: 'object', 
    properties: { 
      from: { type: 'object' }, 
      to: { type: 'object' },
      civilianId: { type: 'string' }
    },
    required: ['from', 'to', 'civilianId']
  },
  outputSchema: { type: 'object', properties: { from: { type: 'object' }, to: { type: 'object' }, distance: { type: 'number' }, duration: { type: 'number' }, timestamp: { type: 'string' } } }
});

civilianAbility.registerTool('stop_civilian', stop_civilian, {
  description: 'Stop a civilian',
  inputSchema: { 
    type: 'object', 
    properties: { civilianId: { type: 'string' } },
    required: ['civilianId']
  },
  outputSchema: { type: 'object', properties: { civilianId: { type: 'string' }, status: { type: 'string' }, timestamp: { type: 'string' } } }
});

// Start the ability
civilianAbility.serve().then(() => {
  console.log('🟢 Simple Civilian Ability is running!');
  console.log(' Available tools: spawn_civilian, walk, stop_civilian');
}).catch((error) => {
  console.error('❌ Error starting ability:', error.message);
  process.exit(1);
});

export default civilianAbility;