import { KadiClient } from '@kadi.build/core';
import { CivilianAgent, AgentAction } from './agent.js';

// Execute agent actions by making calls to civilian-ability
export async function executeAgentAction(client: KadiClient, agent: CivilianAgent, action: AgentAction): Promise<void> {
  if (action.type === 'none') return;
  
  console.log(`🎬 ${agent.civilianId} executing action: ${action.type} (${action.reason})`);
  
  try {
    switch (action.type) {
      case 'move_toward':
      case 'investigate':
      case 'follow':
        if (action.targetLocation) {
          // Need to get the agent's current location first
          const currentLocation = agent.getCurrentLocation();
          if (currentLocation) {
            await client.callTool('civilian-ability', 'walk', {
              from: currentLocation,
              to: {
                latitude: action.targetLocation.latitude,
                longitude: action.targetLocation.longitude
              },
              civilianId: agent.civilianId
            });
          } else {
            console.log(`⚠️ ${agent.civilianId} doesn't know their current location, skipping movement`);
          }
        }
        break;
        
      case 'move_away':
      case 'flee_from':
        if (action.targetLocation) {
          const currentLocation = agent.getCurrentLocation();
          if (currentLocation) {
            // Calculate a location away from the target
            const offsetLat = action.targetLocation.latitude + (Math.random() - 0.5) * 0.01;
            const offsetLon = action.targetLocation.longitude + (Math.random() - 0.5) * 0.01;
            
            await client.callTool('civilian-ability', 'walk', {
              from: currentLocation,
              to: {
                latitude: offsetLat,
                longitude: offsetLon
              },
              civilianId: agent.civilianId
            });
          } else {
            console.log(`⚠️ ${agent.civilianId} doesn't know their current location, skipping movement`);
          }
        }
        break;
        
      case 'wait':
        // Stop current movement - but only if the civilian exists
        try {
          await client.callTool('civilian-ability', 'stop_civilian', {
            civilianId: agent.civilianId
          });
        } catch (error: any) {
          if (error.message?.includes('not found')) {
            console.log(`⚠️ ${agent.civilianId} can't wait - not spawned yet`);
          } else {
            throw error; // Re-throw other errors
          }
        }
        break;
    }
  } catch (error) {
    console.error(`❌ Failed to execute action for ${agent.civilianId}:`, error);
  }
}