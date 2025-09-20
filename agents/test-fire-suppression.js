#!/usr/bin/env node
/**
 * Simple Fire Suppression Test
 *
 * 1. Civilian positioned next to fire (calls 911 immediately)
 * 2. Commander receives 911 call and dispatches firefighter
 * 3. Firefighter moves to fire, suppresses it, returns to base
 * 4. Fire disappears from map
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🔥 Fire Suppression Test Starting...\n');

// Fire location in Deep Ellum (one of the 6 fires the world sim creates)
const FIRE_LOCATION = { lat: 32.7825, lon: -96.7849 };

// Position civilian very close to fire so it sees it immediately
const CIVILIAN_POSITION = {
  lat: FIRE_LOCATION.lat + 0.0001, // ~11 meters away
  lon: FIRE_LOCATION.lon + 0.0001
};

let processes = [];

function startProcess(name, cwd, args = ['run', 'start']) {
  console.log(`🚀 Starting ${name}...`);

  const proc = spawn('npm', args, {
    cwd: path.join(__dirname, cwd),
    stdio: 'inherit',
    shell: true
  });

  proc.on('error', (error) => {
    console.error(`❌ Error starting ${name}:`, error);
  });

  processes.push({ name, proc });
  return proc;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  try {
    // Step 1: Start World Simulator (creates fires)
    console.log('1️⃣ Starting World Simulator...');
    startProcess('World Simulator', 'world-simulator');
    await sleep(4000); // Wait for fires to be created

    // Step 2: Start Commander (will spawn firefighter at station)
    console.log('2️⃣ Starting Commander Agent...');
    startProcess('Commander Agent', 'commander');
    await sleep(3000); // Wait for firefighter to be spawned

    // Step 3: Start Civilian next to fire
    console.log('3️⃣ Starting Civilian Agent (positioned next to fire)...');
    console.log(`   Civilian at: ${CIVILIAN_POSITION.lat}, ${CIVILIAN_POSITION.lon}`);
    console.log(`   Fire at: ${FIRE_LOCATION.lat}, ${FIRE_LOCATION.lon}`);
    startProcess('Civilian Agent', 'civilian', [
      'run', 'start', '1',
      `--lat=${CIVILIAN_POSITION.lat}`,
      `--lon=${CIVILIAN_POSITION.lon}`
    ]);

    console.log('\n✅ Test scenario running!');
    console.log('\n🎯 Expected sequence:');
    console.log('   1. Civilian sees fire and calls 911');
    console.log('   2. Commander receives 911 call');
    console.log('   3. Commander dispatches firefighter');
    console.log('   4. Firefighter moves to fire location');
    console.log('   5. Firefighter suppresses fire');
    console.log('   6. Fire disappears from map');
    console.log('   7. Firefighter returns to base');
    console.log('\n🗺️  Watch the frontend map to see the action!');
    console.log('\n⏹️  Press Ctrl+C to stop');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Stopping all processes...');

  processes.forEach(({ name, proc }) => {
    console.log(`   Stopping ${name}...`);
    proc.kill('SIGTERM');
  });

  setTimeout(() => {
    processes.forEach(({ name, proc }) => {
      if (!proc.killed) {
        console.log(`   Force killing ${name}...`);
        proc.kill('SIGKILL');
      }
    });
    console.log('✅ All processes stopped');
    process.exit(0);
  }, 2000);
});

// Run the test
runTest();