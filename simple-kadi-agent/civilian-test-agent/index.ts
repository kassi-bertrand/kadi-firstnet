import { KadiClient } from '@kadi.build/core';
import { CivilianAgent } from './agent.js';
import { executeAgentAction } from './actions.js';

/**
 * Main orchestration for the personality-driven civilian agent system.
 * 
 * This   console.log(`\n👀 Emergency Service Agents are now active and monitoring for incidents...`);
  console.log(`🚨 EMERGENCY RESPONSE CAPABILITIES:`);
  console.log(`👮 Police (${agents.filter(a => a.archetype === 'police').length}): Will patrol and respond to incidents with confidence`);
  console.log(`🚒 Firefighters (${agents.filter(a => a.archetype === 'firefighter').length}): ALL WILL IMMEDIATELY RESPOND TO ANY FIRE INCIDENT`);
  console.log(`🚑 EMS (${agents.filter(a => a.archetype === 'ems').length}): Will prioritize patient care and medical emergencies`);
  console.log(`\n🔥 Fire Response Protocol: When any fire is detected, ALL ${agents.filter(a => a.archetype === 'firefighter').length} firefighters will automatically dispatch!`);
  console.log(`💡 Press Ctrl+C to stop the emergency services\n`);andles:
 * - Setting up the KADI client and broker connection
 * - Creating agents with different personality archetypes
 * - Managing the event subscription and agent reactions
 * - Spawning agents with their preferred locations
 * - Coordinating the social dynamics between agents
 */

async function main() {
  // Use remote KADI broker by default, fallback to local
  const brokerUrl = process.env.KADI_BROKER_URL || 'ws://kadi.build:8080';
  const networks = process.env.KADI_NETWORKS
    ? process.env.KADI_NETWORKS.split(',')
    : ['global'];

  console.log(`🌐 Connecting to KADI broker: ${brokerUrl}`);
  console.log(`🌍 Using networks: ${networks.join(', ')}`);

  // Create a client that connects to the broker and subscribes to events
  const client = new KadiClient({
    name: 'civilian-test-agent',
    role: 'agent',
    transport: 'broker',
    brokers: { remote: brokerUrl},
    defaultBroker: 'remote',
    networks
  });

  // Establish the broker connection up front for clarity/determinism
  await client.connectToBrokers();
  console.log(`Connected to broker at ${brokerUrl} (networks: ${networks.join(', ')})`);

  // Create 20 emergency service agents (police, firefighter, EMS)
  const agents: CivilianAgent[] = [];
  
  // Create 7 police officers
  for (let i = 0; i <= 6; i++) {
    agents.push(new CivilianAgent(`police-${i}`, 'police'));
  }
  
  // Create 7 firefighters
  for (let i = 0; i <= 6; i++) {
    agents.push(new CivilianAgent(`firefighter-${i}`, 'firefighter'));
  }
  
  // Create 6 EMS paramedics
  for (let i = 0; i <= 5; i++) {
    agents.push(new CivilianAgent(`ems-${i}`, 'ems'));
  }

  console.log(`🚨 Created ${agents.length} emergency service agents:`);
  console.log(`   � Police Officers: ${agents.filter(a => a.archetype === 'police').length}`);
  console.log(`   � Firefighters: ${agents.filter(a => a.archetype === 'firefighter').length}`);
  console.log(`   � EMS Paramedics: ${agents.filter(a => a.archetype === 'ems').length}`);

  const spawnedAgents = new Set<string>(); // Track which agents have been spawned
  
  // Subscribe to fire incident events - all firefighters respond immediately
  const unsubscribeFire = await client.subscribeToEvent('fire.*', async (data) => {
    console.log(`\n🔥 [FIRE EVENT] ${data.id || 'unknown'} - ${data.event || 'fire_event'}`);
    console.log(`   Type: ${data.fireType || 'unknown'} fire`);
    console.log(`   Severity: ${data.severity || 'unknown'}`);
    console.log(`   Location: ${data.latitude}, ${data.longitude}`);
    
    // Get all firefighters for response
    const firefighters = agents.filter(agent => agent.archetype === 'firefighter');
    const spawnedFirefighters = firefighters.filter(ff => spawnedAgents.has(ff.civilianId));
    
    if (data.event === 'fire_started') {
      console.log(`� EMERGENCY RESPONSE: ALL ${spawnedFirefighters.length} FIREFIGHTERS DISPATCHED!`);
      console.log(`   Fire ID: ${data.id}`);
      console.log(`   Urgency Level: ${data.severity === 'critical' ? 'MAXIMUM' : data.severity === 'high' ? 'HIGH' : 'STANDARD'}`);
      
      // All firefighters immediately respond to the fire
      const responsePromises = spawnedFirefighters.map(async (firefighter) => {
        const action = {
          type: 'move_toward' as const,
          targetLocation: { latitude: data.latitude, longitude: data.longitude },
          urgency: data.severity === 'critical' ? 'emergency' as const : 
                   data.severity === 'high' ? 'high' as const : 'normal' as const,
          reason: `🚨 EMERGENCY DISPATCH: ${data.fireType} fire (${data.severity} severity) - Fire ID: ${data.id}`
        };
        
        console.log(`🚒 ${firefighter.civilianId}: ${action.reason}`);
        
        try {
          await executeAgentAction(client, firefighter, action);
          return `✅ ${firefighter.civilianId} dispatched successfully`;
        } catch (error) {
          console.error(`❌ Failed to dispatch ${firefighter.civilianId}:`, error);
          return `❌ ${firefighter.civilianId} dispatch failed`;
        }
      });
      
      // Wait for all firefighters to be dispatched
      const results = await Promise.allSettled(responsePromises);
      console.log(`📋 DISPATCH RESULTS:`);
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(`   ${result.value}`);
        } else {
          console.log(`   ❌ ${spawnedFirefighters[index].civilianId}: ${result.reason}`);
        }
      });
      
    } else if (data.event === 'fire_status_changed') {
      if (data.status === 'contained') {
        console.log(`🟡 Fire ${data.id} contained - firefighters maintaining position`);
      } else if (data.status === 'extinguished') {
        console.log(`✅ Fire ${data.id} extinguished - firefighters can return to normal operations`);
        console.log(`🚒 ${spawnedFirefighters.length} firefighters returning to patrol duties`);
      }
    }
    
    console.log(''); // Add spacing between fire event reactions
  });

  // Subscribe to civilian events - each agent reacts based on personality
  const unsubscribeCivilian = await client.subscribeToEvent('civilian.*', async (data) => {
    console.log(`\n📡 [EVENT] ${data.civilianId || 'unknown'} - ${Object.keys(data).join(', ')}`);
    
    // Let each agent analyze and react to the event
    for (const agent of agents) {
      const action = agent.reactToAgentEvent(data, spawnedAgents);
      
      // Execute the action if it's not 'none'
      if (action.type !== 'none') {
        await executeAgentAction(client, agent, action);
      }
    }    
    console.log(''); // Add spacing between event reactions
  });

  // Subscribe to world movement events as a test
  try {
    console.log('🌍 Subscribing to world movement events...');
    const unsubscribePosition = await client.subscribeToEvent('agent.position.updated', async (event) => {
      console.log('📍 [WORLD] Agent position updated:', event);
    });
    const unsubscribeMovement = await client.subscribeToEvent('agent.movement.completed', async (event) => {
      console.log('🏁 [WORLD] Agent movement completed:', event);
    });
    
  } catch (worldSubErr) {
    console.log('⚠️ Could not subscribe to world events (probably not available):', worldSubErr instanceof Error ? worldSubErr.message : worldSubErr);
  }

  // Spawn civilians with personality-based locations
  console.log('🚀 Starting to spawn agents...\n');
  
  for(const agent of agents) {
    try{
      const preferredLocation = agent.generateSpawnLocation();
      
      // Set the agent's initial location so they can move right away
      agent.updateLocation(preferredLocation.latitude, preferredLocation.longitude);
      
      console.log(`🎭 Spawning ${agent.archetype.toUpperCase()} ${agent.civilianId}...`);
      
      const result = await client.callTool('civilian-ability', 'spawn_civilian', { 
        civilianId: agent.civilianId,
        preferredLocation: preferredLocation,
        agentType: agent.archetype // Pass the agent type (police, firefighter, ems)
      });
      
      // Mark agent as spawned so they can start reacting to events
      spawnedAgents.add(agent.civilianId);
      
      console.log(`✅ ${agent.archetype.toUpperCase()} ${agent.civilianId} spawned successfully!`);
      console.log(`   Personality: ${agent.description}`);
      console.log(`   Location: ${preferredLocation.latitude.toFixed(4)}, ${preferredLocation.longitude.toFixed(4)}`);
      
      // Try the world-simulator moveMe call for the first agent as a test
      if (agent.civilianId === agents[0].civilianId) {
        try {
          console.log(`🌍 Testing world-simulator.moveMe for ${agent.civilianId}...`);
          
          // Add a small delay to ensure world-simulator agent is ready
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Try the call with detailed logging
          console.log(`🔧 Calling world-simulator.moveMe with params:`, {
            agentId: agent.civilianId,
            destination: { lat: 32.7767, lon: -96.7970 },
            profile: 'walking',
            urgency: 'normal'
          });

          const worldResult = await client.callTool('world-simulator', 'moveMe', {
            agentId: agent.civilianId,
            destination: { lat: 32.7767, lon: -96.7970 },
            profile: 'walking',
            urgency: 'normal'
          });
          
          console.log(`✅ world-simulator.moveMe call successful for ${agent.civilianId}:`, worldResult);
        } catch (worldErr) {
          console.log(`⚠️ world-simulator.moveMe failed for ${agent.civilianId}:`);
          console.log(`   Error type: ${worldErr?.constructor?.name}`);
          console.log(`   Error message: ${worldErr instanceof Error ? worldErr.message : worldErr}`);
          console.log(`   Full error:`, worldErr);
        }
      }
      
      // Wait 2 seconds before spawning the next one
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      console.error(`❌ Error spawning ${agent.civilianId}:`, err instanceof Error ? err.message : err);
      console.log(`   Retrying in 5 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Try one more time
      try {
        const preferredLocation = agent.generateSpawnLocation();
        agent.updateLocation(preferredLocation.latitude, preferredLocation.longitude);
        
        const result = await client.callTool('civilian-ability', 'spawn_civilian', { 
          civilianId: agent.civilianId,
          preferredLocation: preferredLocation,
          agentType: agent.archetype // Pass the agent type for retry too
        });
        
        spawnedAgents.add(agent.civilianId);
        console.log(`✅ ${agent.archetype.toUpperCase()} ${agent.civilianId} spawned on retry!`);
      } catch (retryErr) {
        console.error(`❌ Failed to spawn ${agent.civilianId} even on retry:`, retryErr instanceof Error ? retryErr.message : retryErr);
      }
    }
  }
 
  // Keep the process alive indefinitely - only stop with Ctrl+C
  console.log(`\n👀 Agents are now active and will continue running indefinitely...`);
  console.log(`Expected emergency service behaviors:`);
  console.log(`👮 Police: Will patrol and respond to incidents with confidence`);
  console.log(`� Firefighter: Will work as a team and move toward emergencies`);
  console.log(`� EMS: Will prioritize patient care and manageable situations`);
  console.log(`\n💡 Press Ctrl+C to stop the agents\n`);
  
  // Setup graceful shutdown on Ctrl+C
  let isShuttingDown = false;
  
  process.on('SIGINT', async () => {
    if (isShuttingDown) {
      console.log('\n🔴 Force exit!');
      process.exit(1);
    }
    
    isShuttingDown = true;
    console.log('\n🛑 Shutting down agents gracefully...');
    
    // Show final social status
    console.log(`\n📊 FINAL SOCIAL STATUS:`);
    agents.forEach(agent => {
      console.log(`${agent.getPersonalityEmoji()} ${agent.civilianId}: ${agent.getSocialStatus()}`);
    });

    // Cleanup
    try {
      console.log('🧹 Cleaning up subscriptions...');
      unsubscribeCivilian();
      console.log('🔌 Disconnecting from broker...');
      await client.disconnect();
      console.log('✅ Shutdown complete!');
    } catch (err) {
      console.error('❌ Error during shutdown:', err);
    }
    
    process.exit(0);
  });
  
  // Status updates every 60 seconds to show the agents are still active
  const statusInterval = setInterval(() => {
    console.log(`💓 Agents still active - ${spawnedAgents.size}/${agents.length} spawned`);
    agents.forEach(agent => {
      const status = agent.getSocialStatus();
      if (status !== 'Feeling neutral') {
        console.log(`  ${agent.getPersonalityEmoji()} ${agent.civilianId}: ${status}`);
      }
    });
  }, 60000);
  
  // Keep process alive forever
  await new Promise(() => {}); // This promise never resolves, keeping the process alive
}

main().catch((err) => {
  console.error(`Fatal:`, err);
  process.exit(1);
});