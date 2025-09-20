/**
 * Civilian-Specific Behavior Tree
 *
 * Implements personality-driven decision making for civilian agents.
 * Uses the generic behavior tree framework from ../shared/behavior-tree.ts
 */

import {
  AgentBehaviorTree,
  BehaviorNode,
  Selector,
  Condition,
  Action,
  type Agent,
  type VisionResult
} from './shared/behavior-tree.js';
import type { PersonalityTraits } from './personality.js';

/**
 * Civilian-specific agent interface extending the generic Agent
 */
export interface CivilianAgent extends Agent {
  personality: PersonalityTraits;
  calculateStressLevel(): number;
  lastMoveTime?: number;
  currentPosition?: { lat: number; lon: number };
}

/**
 * Civilian Behavior Tree - implements personality-driven decision making
 */
export class CivilianBehaviorTree extends AgentBehaviorTree {
  private personality: PersonalityTraits;

  constructor(personality: PersonalityTraits) {
    super();
    this.personality = personality;
    // Tree is built in parent constructor
  }

  /**
   * Build the civilian-specific behavior tree structure
   */
  protected buildTree(): BehaviorNode {
    return new Selector([
      // Only priority: Emergency Response - call 911 OR flee when seeing fire
      new Condition(
        async (agent: Agent) => this.isInImmediateDanger(agent),
        [new Action(async (agent: Agent) => this.emergencyEvacuation(agent))]
      ),

      // Default: Normal wandering behavior only
      new Action(async (agent: Agent) => this.normalBehavior(agent))
    ]);
  }

  // ========================================================================
  // CONDITION METHODS - These check if something is true
  // ========================================================================

  private async isInImmediateDanger(agent: Agent): Promise<boolean> {
    const vision = await agent.getVision();
    // Danger threshold varies by courage: cowards detect danger farther away
    const dangerThreshold = 25 + (1 - this.personality.courage) * 25; // 25-50 meters

    // Log what the agent sees for debugging
    if (vision.hazards.length > 0) {
      console.log(`👀 ${agent.agentId}: Sees ${vision.hazards.length} hazards:`,
        vision.hazards.map(h => `${h.type} at ${h.distance.toFixed(1)}m`));
      console.log(`⚠️ ${agent.agentId}: Danger threshold: ${dangerThreshold.toFixed(1)}m (courage: ${this.personality.courage.toFixed(2)})`);
    }

    const inDanger = vision.hazards.some(h =>
      h.type === 'fire' && h.distance < dangerThreshold
    );

    if (inDanger) {
      console.log(`🚨 ${agent.agentId}: IN IMMEDIATE DANGER! Fire within ${dangerThreshold.toFixed(1)}m`);
    }

    return inDanger;
  }


  // ========================================================================
  // ACTION METHODS - These perform concrete behaviors
  // ========================================================================

  private async emergencyEvacuation(agent: Agent): Promise<void> {
    console.log(`🚨 ${agent.agentId}: EMERGENCY EVACUATION!`);

    // Randomly choose between calling 911 OR fleeing (not both)
    const shouldCall911 = Math.random() < 0.8;

    if (shouldCall911) {
      await this.call911AndStay(agent);
    } else {
      await this.fleeFromDanger(agent);
    }
  }

  private async call911AndStay(agent: Agent): Promise<void> {
    console.log(`📞 ${agent.agentId}: Calling 911 and staying to help!`);

    // Call 911 to report the fire
    await this.call911(agent);

    // Move slightly away from immediate danger but stay in area to help
    const vision = await agent.getVision();
    const fires = vision.hazards.filter(h => h.type === 'fire');

    if (fires.length > 0) {
      const nearestFire = fires.reduce((nearest, fire) =>
        fire.distance < nearest.distance ? fire : nearest
      );

      // Move to a safe distance (fire radius + 20 meters) but don't flee completely
      const safeDistance = nearestFire.radius + 20;
      const civilianAgent = agent as CivilianAgent;
      const currentPos = civilianAgent.currentPosition || { lat: 32.7825, lon: -96.7849 };

      // Calculate direction away from fire
      const angleAwayFromFire = Math.atan2(
        currentPos.lat - nearestFire.position.lat,
        currentPos.lon - nearestFire.position.lon
      );

      // Move to safe distance in that direction
      const safePosition = {
        lat: nearestFire.position.lat + Math.sin(angleAwayFromFire) * (safeDistance / 111000), // rough lat conversion
        lon: nearestFire.position.lon + Math.cos(angleAwayFromFire) * (safeDistance / 111000)
      };

      await agent.moveTo(safePosition, 'urgent');
    }
  }

  private async fleeFromDanger(agent: Agent): Promise<void> {
    console.log(`🏃 ${agent.agentId}: Fleeing from danger without calling 911!`);

    // Find nearest exit and flee quickly
    const vision = await agent.getVision();
    const exits = vision.exits.filter(e => e.type === 'exit' || e.type === 'staging_area');

    if (exits.length > 0) {
      // Go to nearest exit with emergency urgency
      const nearestExit = exits.reduce((nearest, exit) =>
        exit.distance < nearest.distance ? exit : nearest
      );

      await agent.moveTo(nearestExit.position, 'emergency');
    } else {
      // Fallback: move to downtown safety zone
      await agent.moveTo({ lat: 32.7767, lon: -96.7970 }, 'emergency');
    }
  }

  private async call911(agent: Agent): Promise<void> {
    const vision = await agent.getVision();
    const fires = vision.hazards.filter(h => h.type === 'fire');

    if (fires.length > 0) {
      // Report the nearest/largest fire
      const nearestFire = fires.reduce((nearest, fire) =>
        fire.distance < nearest.distance ? fire : nearest
      );

      console.log(`📞 ${agent.agentId}: Calling 911! Fire at ${nearestFire.position.lat.toFixed(4)}, ${nearestFire.position.lon.toFixed(4)}`);

      // Emit emergency call event with a broker‑safe channel name
      const civilianAgent = agent as any;
      if (civilianAgent.client && civilianAgent.client.publishEvent) {
        civilianAgent.client.publishEvent('emergency.call', {
          event: 'emergency.call',
          callerId: agent.agentId,
          emergency: 'fire',
          location: nearestFire.position,
          description: `Fire reported by civilian, distance: ${nearestFire.distance.toFixed(1)}m`,
          timestamp: Date.now()
        });
      }
    }
  }


  private async normalBehavior(agent: Agent): Promise<void> {
    const civilianAgent = agent as CivilianAgent;
    console.log(`🚶 ${agent.agentId}: Normal wandering behavior`);

    // Don't move too frequently - wait at least 2-5 seconds between moves (reduced for testing)
    const minWaitTime = 2000 + (Math.random() * 3000); // 2-5 seconds
    const now = Date.now();

    if (civilianAgent.lastMoveTime && (now - civilianAgent.lastMoveTime) < minWaitTime) {
      // Still waiting, don't move yet
      console.log(`⏳ ${agent.agentId}: Waiting ${((civilianAgent.lastMoveTime + minWaitTime - now) / 1000).toFixed(1)}s before next move`);
      return;
    }

    // Generate random movement within Dallas area
    // Base position around Deep Ellum area
    const basePosition = civilianAgent.currentPosition || { lat: 32.7825, lon: -96.7849 };

    // Movement range based on personality
    // More social people wander farther, less social stay closer
    const wanderRadius = 0.002 + (this.personality.sociability * 0.003); // 0.002-0.005 degrees (~200-500m)

    // Generate random destination within wander radius
    const randomAngle = Math.random() * 2 * Math.PI;
    const randomDistance = Math.random() * wanderRadius;

    const destination = {
      lat: basePosition.lat + Math.cos(randomAngle) * randomDistance,
      lon: basePosition.lon + Math.sin(randomAngle) * randomDistance
    };

    // Move with personality-based speed
    const urgency = this.personality.agility > 0.7 ? 'urgent' : 'normal';

    try {
      console.log(`🎯 ${agent.agentId}: Moving to ${destination.lat.toFixed(4)}, ${destination.lon.toFixed(4)}`);
      await agent.moveTo(destination, urgency);
      civilianAgent.lastMoveTime = now;
      civilianAgent.currentPosition = destination;
      console.log(`✅ ${agent.agentId}: Move command sent successfully`);
    } catch (error) {
      console.error(`❌ ${agent.agentId}: Failed to move during normal behavior:`, error);
    }
  }
}
