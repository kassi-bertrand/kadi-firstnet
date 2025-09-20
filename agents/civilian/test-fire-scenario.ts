#!/usr/bin/env node

/**
 * Test script to spawn a civilian near the fire and observe emergency behavior
 */

import { CivilianAgent } from './civilian-agent.js';

async function testFireScenario() {
  console.log('🔥 Testing fire emergency scenario...');

  // Create a cowardly civilian (should detect fire from farther away)
  const cowardAgent = new CivilianAgent('test-coward-near-fire', 'coward');

  // Create a brave civilian
  const heroAgent = new CivilianAgent('test-hero-near-fire', 'hero');

  try {
    // Start both agents
    await cowardAgent.start();
    await heroAgent.start();

    // Move them very close to the fire location (Deep Ellum: 32.7825, -96.7849)
    console.log('📍 Moving agents close to fire location...');

    // Place coward 30 meters from fire (should trigger evacuation)
    await cowardAgent.moveTo({ lat: 32.7827, lon: -96.7847 }, 'normal');

    // Place hero 20 meters from fire (should trigger evacuation)
    await heroAgent.moveTo({ lat: 32.7826, lon: -96.7848 }, 'normal');

    console.log('✅ Test agents spawned and positioned near fire!');
    console.log('🔍 Watch the console for emergency evacuation messages...');
    console.log('⏰ Agents will check for danger every world tick (every 100ms)');

  } catch (error) {
    console.error('❌ Test setup failed:', error);
  }
}

testFireScenario();