#!/usr/bin/env node
/**
 * Smart Fire Agent with Firefighter Integration
 * 
 * Features:
 * - Spawns fires at random locations every 2 minutes (reduced frequency)
 * - Listens for fire.extinguished events from firefighters
 * - Despawns fires when extinguished by firefighters
 * - Proper fireId field in all events for agent coordination
 * - Event-driven fire simulation for firefighter agent coordination
 */

import { KadiClient } from '@kadi.build/core';

// Fire agent configuration
const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';
const networks = process.env.KADI_NETWORKS?.split(',') || ['global'];

console.log(`🔥 Fire Agent connecting to: ${brokerUrl}`);
console.log(`🌍 Using networks: ${networks.join(', ')}`);

// Initialize KADI client
const fireAgent = new KadiClient({
  name: 'fire-test-agent',
  role: 'agent',
  transport: 'broker',
  brokers: { remote: brokerUrl },
  defaultBroker: 'remote',
  networks
});

// Fire tracking
let fireCounter = 0;
let activeFires = new Map();

// Generate random Dallas area coordinates
function generateRandomLocation() {
  const baseLat = 32.7767;
  const baseLon = -96.7970;
  const spread = 0.02; // ~2km spread around Dallas
  
  return {
    latitude: baseLat + (Math.random() - 0.5) * spread,
    longitude: baseLon + (Math.random() - 0.5) * spread
  };
}

// Generate fire intensity and properties
function generateFireProperties() {
  return {
    intensity: Math.random() * 0.8 + 0.2, // 0.2 to 1.0
    size: Math.random() * 100 + 50, // 50-150 meters radius
    spread_rate: Math.random() * 0.5 + 0.1, // 0.1 to 0.6 per minute
    danger_level: Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low'
  };
}

// Spawn a fire and publish events
async function spawnFire() {
  fireCounter++;
  const fireId = `fire-${fireCounter}`;
  const location = generateRandomLocation();
  const properties = generateFireProperties();
  const timestamp = new Date().toISOString();
  
  // Store fire info
  activeFires.set(fireId, {
    id: fireId,
    location,
    properties,
    startTime: timestamp,
    status: 'active'
  });
  
  console.log(`🔥 FIRE STARTED: ${fireId} at ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`);
  console.log(`   Intensity: ${(properties.intensity * 100).toFixed(0)}% | Size: ${properties.size.toFixed(0)}m | Danger: ${properties.danger_level}`);
  
  // Publish fire.started event (legacy)
  await fireAgent.publishEvent('fire.started', {
    fireId: fireId, // Add explicit fireId field
    id: fireId,
    latitude: location.latitude,
    longitude: location.longitude,
    timestamp: timestamp,
    intensity: properties.intensity,
    size: properties.size,
    spread_rate: properties.spread_rate,
    danger_level: properties.danger_level,
    event_type: 'fire_start'
  });

  // Call world-simulator's spawnHazard tool to create the fire in the simulation
  await fireAgent.callTool('world-simulator', 'spawnHazard', {
    hazardId: fireId,
    type: 'fire',
    position: { lat: location.latitude, lon: location.longitude },
    intensity: properties.intensity,
    radius: properties.size,
    fireIntensity: 'developing',
    spreadRate: properties.spread_rate,
    dangerLevel: properties.danger_level
  });
  
  console.log(`🔥 FIRE STARTED: ${fireId} at ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`);
  console.log(`   Intensity: ${(properties.intensity * 100).toFixed(0)}% | Size: ${properties.size.toFixed(0)}m | Danger: ${properties.danger_level}`);
  
  // Simulate fire progression with spread events
  setTimeout(async () => {
    if (activeFires.has(fireId)) {
      const fire = activeFires.get(fireId);
      fire.properties.size *= 1.3; // Fire grows 30%
      fire.properties.intensity = Math.min(1.0, fire.properties.intensity + 0.1);
      
      console.log(`🔥 FIRE SPREADING: ${fireId} - Size now ${fire.properties.size.toFixed(0)}m`);
      
      await fireAgent.publishEvent('fire.spread', {
        fireId: fireId, // Add explicit fireId field
        id: fireId,
        latitude: fire.location.latitude,
        longitude: fire.location.longitude,
        timestamp: new Date().toISOString(),
        intensity: fire.properties.intensity,
        size: fire.properties.size,
        spread_rate: fire.properties.spread_rate,
        danger_level: fire.properties.danger_level,
        event_type: 'fire_spread'
      });

      // Publish world.hazard.fire.updated for frontend
      await fireAgent.publishEvent('world.hazard.fire.updated', {
        hazardId: fireId,
        type: 'fire',
        position: { lat: fire.location.latitude, lon: fire.location.longitude },
        intensity: fire.properties.intensity,
        radius: fire.properties.size,
        spreadRate: fire.properties.spread_rate,
        dangerLevel: fire.properties.danger_level,
        time: Date.now(),
      });
    }
  }, 10000); // Fire spreads after 10 seconds
  
  // Auto-extinguish fire after longer time (5-10 minutes) as backup if no firefighters respond
  const extinguishTime = 300000 + Math.random() * 300000; // 5-10 minutes instead of 30-90 seconds
  setTimeout(async () => {
    if (activeFires.has(fireId)) {
      console.log(`💧 FIRE AUTO-EXTINGUISHED: ${fireId} (no firefighter response)`);
      
      await fireAgent.publishEvent('fire.extinguished', {
        fireId: fireId,
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: new Date().toISOString(),
        duration: extinguishTime / 1000,
        event_type: 'fire_extinguished',
        reason: 'auto_extinguish'
      });

      // Publish world.hazard.fire.removed for frontend
      await fireAgent.publishEvent('world.hazard.fire.removed', {
        hazardId: fireId,
        type: 'fire',
        position: { lat: location.latitude, lon: location.longitude },
        time: Date.now(),
        reason: 'auto_extinguish',
      });
      
      activeFires.delete(fireId);
      console.log(`🔥 Auto-extinguished fire ${fireId} removed from simulation`);
    }
  }, extinguishTime);
}

// Start the fire agent
async function startFireAgent() {
  try {
    // Connect to broker
    await fireAgent.connectToBrokers();
    console.log('✅ Fire Agent connected to broker');
    
    // Subscribe to fire.extinguished events from firefighters with retry logic
    let subscriptionAttempts = 0;
    const maxAttempts = 3;
    
    while (subscriptionAttempts < maxAttempts) {
      try {
        console.log(`📡 Attempting to subscribe to fire.extinguished events (attempt ${subscriptionAttempts + 1}/${maxAttempts})`);
        
        await fireAgent.subscribeToEvent('fire.extinguished', async (data: any) => {
          try {
            const fireId = data.fireId;
            console.log(`💧 Received extinguish notification for fire ${fireId} from ${data.extinguishedBy || 'unknown'}`);
            
            if (activeFires.has(fireId)) {
              const fire = activeFires.get(fireId);
              console.log(`🗑️ Despawning extinguished fire ${fireId} at ${fire.location.latitude.toFixed(4)}, ${fire.location.longitude.toFixed(4)}`);

              // Publish world.hazard.fire.removed for frontend
              await fireAgent.publishEvent('world.hazard.fire.removed', {
                hazardId: fireId,
                type: 'fire',
                position: { lat: fire.location.latitude, lon: fire.location.longitude },
                time: Date.now(),
                reason: 'firefighter_extinguish',
              });

              // Remove fire from tracking
              activeFires.delete(fireId);

              console.log(`✅ Fire ${fireId} successfully removed from simulation`);
            } else {
              console.log(`⚠️ Fire ${fireId} was not in active fires list - may have already been extinguished`);
            }
            
          } catch (error) {
            console.error('❌ Error handling fire.extinguished event:', error);
          }
        });
        
        console.log('📡 Fire Agent successfully subscribed to fire.extinguished events');
        break; // Success, exit retry loop
        
      } catch (subscriptionError) {
        subscriptionAttempts++;
        console.warn(`⚠️ Subscription attempt ${subscriptionAttempts} failed:`, (subscriptionError as any).message);
        
        if (subscriptionAttempts >= maxAttempts) {
          console.warn(`⚠️ Failed to subscribe to fire.extinguished events after ${maxAttempts} attempts`);
          console.warn(`⚠️ Fire agent will run without firefighter integration`);
          break;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Start fire spawning every 2 minutes (less frequent)
    console.log('🎮 Starting fire simulation - new fire every 2 minutes');
    
    // Spawn first fire immediately
    await spawnFire();
    
    // Then spawn fires every 2 minutes
    setInterval(async () => {
      try {
        await spawnFire();
      } catch (error) {
        console.error('❌ Error spawning fire:', error);
      }
    }, 120000); // Changed from 30000 to 120000 (2 minutes)
    
    // Status reporting every 60 seconds
    setInterval(() => {
      console.log(`📊 Status: ${activeFires.size} active fires, ${fireCounter} total fires spawned`);
      
      if (activeFires.size > 0) {
        console.log('   Active fires:');
        activeFires.forEach((fire, fireId) => {
          const elapsed = (Date.now() - new Date(fire.startTime).getTime()) / 1000;
          console.log(`   - ${fireId}: ${fire.properties.size.toFixed(0)}m, ${(fire.properties.intensity * 100).toFixed(0)}% intensity, ${elapsed.toFixed(0)}s old`);
        });
      }
    }, 60000);
    
    console.log('🔥 Smart Fire Agent is running!');
    console.log('📡 Listening for fire.extinguished events from firefighters');
    console.log('🕒 New fires spawn every 2 minutes, last 5-10 minutes if not extinguished');
    
  } catch (error) {
    console.error('❌ Failed to start fire agent:', error);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Fire Agent shutting down...');
  
  // Publish extinguish events for all active fires
  for (const [fireId, fire] of activeFires) {
    try {
      await fireAgent.publishEvent('fire.extinguished', {
        fireId: fireId,
        latitude: fire.location.latitude,
        longitude: fire.location.longitude,
        timestamp: new Date().toISOString(),
        event_type: 'fire_extinguished',
        reason: 'simulation_ended'
      });
    } catch (error) {
      console.warn(`⚠️ Failed to extinguish ${fireId}:`, error);
    }
  }
  
  await fireAgent.disconnect();
  console.log('✅ Fire Agent stopped');
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the agent
startFireAgent().catch(console.error);