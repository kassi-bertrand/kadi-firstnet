#!/usr/bin/env node
/**
 * Civilian Agent System Entry Point
 * 
 * Creates and manages civilian agents with different personality archetypes.
 * Handles graceful startup/shutdown and agent lifecycle management.
 */

import { CivilianAgent } from './src/agent.js';

// Available personality archetypes
const ARCHETYPES = ['hero', 'coward', 'follower', 'loner'];

/**
 * Create civilian agents with different personalities
 */
async function createAgents(): Promise<CivilianAgent[]> {
  const agents: CivilianAgent[] = [];
  
  // Create one agent of each archetype by default
  for (const archetype of ARCHETYPES) {
    const agent = new CivilianAgent(`civilian-${archetype}`, archetype);
    agents.push(agent);
  }
  
  // Create a few random agents for variety
  for (let i = 0; i < 3; i++) {
    const randomArchetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
    const agent = new CivilianAgent(`civilian-random-${i + 1}`, randomArchetype);
    agents.push(agent);
  }
  
  return agents;
}

/**
 * Start all agents
 */
async function startAgents(agents: CivilianAgent[]): Promise<void> {
  console.log('🚀 Starting civilian agent system...');
  
  // Start agents with staggered timing to avoid overwhelming the broker
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    
    try {
      await agent.start();
      
      // Small delay between agent starts
      if (i < agents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (error) {
      console.error(`❌ Failed to start ${agent.agentId}:`, error);
    }
  }
  
  console.log(`✅ Started ${agents.length} civilian agents`);
}

/**
 * Stop all agents gracefully
 */
async function stopAgents(agents: CivilianAgent[]): Promise<void> {
  console.log('🛑 Stopping civilian agent system...');
  
  const stopPromises = agents.map(agent => agent.stop());
  await Promise.allSettled(stopPromises);
  
  console.log('✅ All agents stopped');
}

/**
 * Display agent status
 */
function displayStatus(agents: CivilianAgent[]): void {
  console.log('\n📊 Agent Status:');
  console.log('================');
  
  agents.forEach(agent => {
    const status = agent.getStatus();
    const pos = `${status.position.lat.toFixed(4)}, ${status.position.lon.toFixed(4)}`;
    const stress = (status.stressLevel * 100).toFixed(0);
    const moving = status.isMoving ? '🚶' : '🧍';
    
    console.log(`${moving} ${status.agentId} (${status.archetype})`);
    console.log(`   Position: ${pos} | Stress: ${stress}% | Active: ${status.isActive ? '✅' : '❌'}`);
  });
  
  console.log('================\n');
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  let agents: CivilianAgent[] = [];
  
  try {
    // Create and start agents
    agents = await createAgents();
    await startAgents(agents);
    
    // Set up status display interval
    const statusInterval = setInterval(() => {
      displayStatus(agents);
    }, 30000); // Show status every 30 seconds
    
    // Set up graceful shutdown
    const shutdown = async () => {
      console.log('\n🔄 Graceful shutdown initiated...');
      clearInterval(statusInterval);
      await stopAgents(agents);
      process.exit(0);
    };
    
    // Handle shutdown signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
    // Keep the process running
    console.log('🎮 Civilian agent system is running. Press Ctrl+C to stop.');
    console.log('📍 Agents will react to fire events and make decisions based on their personalities.');
    
    // Show initial status
    setTimeout(() => displayStatus(agents), 5000);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    
    // Try to clean up on error
    if (agents.length > 0) {
      await stopAgents(agents);
    }
    
    process.exit(1);
  }
}

// Start the system if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

// Export for programmatic use
export { CivilianAgent, main as startCivilianSystem };