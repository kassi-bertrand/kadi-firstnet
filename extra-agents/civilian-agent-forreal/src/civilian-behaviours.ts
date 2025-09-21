/**
 * Civilian-Specific Behavior Tree Implementation
 * 
 * Defines the decision-making logic for civilian agents in emergency situations.
 * Uses the generic behavior tree framework to create personality-driven behaviors
 * that result in realistic and diverse civilian responses.
 */

import { BehaviorNode, Selector, Condition, Action, Agent, BehaviorResult } from './behaviour-tree.js';
import { PersonalityProfile } from './personality.js';

// Civilian agent interface that extends the generic Agent
export interface CivilianAgent extends Agent {
  personality: PersonalityProfile;
  getVision(): Promise<VisionData>;
  moveTo(destination: Position, urgency?: string): Promise<void>;
  getStressLevel(): number;
  getCurrentPosition(): Position;
}

// Data structures for world interaction
interface VisionData {
  hazards?: Array<{
    id: string;
    type: string;
    distance: number;
    position: Position;
  }>;
  agents?: Array<{
    id: string;
    type: string;
    distance: number;
    isMoving: boolean;
    position: Position;
  }>;
  exits?: Array<{
    id: string;
    distance: number;
    position: Position;
  }>;
}

interface Position {
  lat: number;
  lon: number;
}

/**
 * Main Civilian Behavior Tree
 * 
 * Creates a personality-driven decision tree that determines how a civilian
 * responds to different situations in emergency scenarios.
 */
export class CivilianBehaviorTree {
  private tree: BehaviorNode;
  private personality: PersonalityProfile;

  constructor(personality: PersonalityProfile) {
    this.personality = personality;
    this.tree = this.buildTree();
  }

  /**
   * Execute the behavior tree for decision making
   */
  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    return await this.tree.execute(agent);
  }

  /**
   * Build the complete civilian behavior tree based on personality
   * 
   * Priority order:
   * 1. Emergency Response - If in immediate danger, evacuate
   * 2. Panic Response - If panicking, behavior depends on courage
   * 3. Social Response - If sees others, behavior depends on sociability  
   * 4. Normal Behavior - Default state
   */
  private buildTree(): BehaviorNode {
    return new Selector([
      // Priority 1: Emergency Response
      new Condition(
        async (agent) => this.isInImmediateDanger(agent as CivilianAgent),
        [new Action('emergency-evacuation', async (agent) => this.emergencyEvacuation(agent as CivilianAgent))]
      ),

      // Priority 2: Panic Response  
      new Condition(
        async (agent) => this.shouldPanic(agent as CivilianAgent),
        [
          new Selector([
            // Brave people help others when panicking
            new Condition(
              async (agent) => this.isBrave(agent as CivilianAgent),
              [new Action('help-others', async (agent) => this.helpOthersEvacuate(agent as CivilianAgent))]
            ),
            // Others flee in panic
            new Action('flee-panic', async (agent) => this.fleeInPanic(agent as CivilianAgent))
          ])
        ]
      ),

      // Priority 3: Social Response
      new Condition(
        async (agent) => this.seesOtherCivilians(agent as CivilianAgent),
        [
          new Selector([
            // Social people follow crowds
            new Condition(
              async (agent) => this.isHighlySocial(agent as CivilianAgent),
              [new Action('follow-crowd', async (agent) => this.followCrowd(agent as CivilianAgent))]
            ),
            // Antisocial people avoid crowds
            new Action('avoid-crowd', async (agent) => this.avoidCrowd(agent as CivilianAgent))
          ])
        ]
      ),

      // Priority 4: Normal Behavior
      new Action('normal-behavior', async (agent) => this.normalBehavior(agent as CivilianAgent))
    ]);
  }

  // =============================================================================
  // CONDITION METHODS - Decision points in the behavior tree
  // =============================================================================

  /**
   * Check if agent is in immediate danger requiring emergency response
   */
  private async isInImmediateDanger(agent: CivilianAgent): Promise<boolean> {
    try {
      const vision = await agent.getVision();
      
      // Danger threshold based on personality - cowards detect danger from further away
      const dangerThreshold = 20 + (1 - agent.personality.courage) * 30; // 20-50 meters
      
      return vision.hazards?.some(hazard => 
        hazard.type === 'fire' && hazard.distance < dangerThreshold
      ) || false;
    } catch (error) {
      console.warn(`⚠️ ${agent.agentId} danger check failed:`, error);
      return false;
    }
  }

  /**
   * Check if agent should enter panic state based on stress and personality
   */
  private async shouldPanic(agent: CivilianAgent): Promise<boolean> {
    const stressLevel = agent.getStressLevel();
    return stressLevel > agent.personality.panic_threshold;
  }

  /**
   * Check if agent sees other civilian agents nearby
   */
  private async seesOtherCivilians(agent: CivilianAgent): Promise<boolean> {
    try {
      const vision = await agent.getVision();
      const otherCivilians = vision.agents?.filter(other => 
        other.type === 'civilian' && other.id !== agent.agentId
      ) || [];
      
      return otherCivilians.length > 0;
    } catch (error) {
      console.warn(`⚠️ ${agent.agentId} social check failed:`, error);
      return false;
    }
  }

  /**
   * Check if agent has brave personality (high courage)
   */
  private async isBrave(agent: CivilianAgent): Promise<boolean> {
    return agent.personality.courage > 0.7;
  }

  /**
   * Check if agent has highly social personality
   */
  private async isHighlySocial(agent: CivilianAgent): Promise<boolean> {
    return agent.personality.sociability > 0.6;
  }

  // =============================================================================
  // ACTION METHODS - Concrete behaviors the agent can perform
  // =============================================================================

  /**
   * Emergency evacuation - immediate response to danger
   */
  private async emergencyEvacuation(agent: CivilianAgent): Promise<void> {
    console.log(`🚨 ${agent.agentId} (${agent.personality.archetype}): EMERGENCY EVACUATION!`);
    
    // Move to safety with emergency urgency
    // TODO: Find actual nearest exit instead of hardcoded position
    const safePosition: Position = { lat: 32.7767, lon: -96.7970 };
    await agent.moveTo(safePosition, 'emergency');
  }

  /**
   * Help others evacuate - brave personality behavior during panic
   */
  private async helpOthersEvacuate(agent: CivilianAgent): Promise<void> {
    console.log(`🦸 ${agent.agentId} (${agent.personality.archetype}): Helping others evacuate (brave personality)`);
    
    try {
      const vision = await agent.getVision();
      const nearbyCivilians = vision.agents?.filter(other => 
        other.type === 'civilian' && 
        other.distance < agent.personality.follow_distance &&
        !other.isMoving // Focus on civilians who might be stuck or confused
      ) || [];

      if (nearbyCivilians.length > 0) {
        const closestCivilian = nearbyCivilians.sort((a, b) => a.distance - b.distance)[0];
        console.log(`   Moving toward ${closestCivilian.id} to assist`);
        
        // Move toward the civilian who needs help
        await agent.moveTo(closestCivilian.position, 'normal');
      } else {
        // No one nearby to help, proceed to evacuation
        await this.emergencyEvacuation(agent);
      }
    } catch (error) {
      console.warn(`⚠️ ${agent.agentId} help others failed:`, error);
      // Fallback to self-evacuation
      await this.emergencyEvacuation(agent);
    }
  }

  /**
   * Flee in panic - cowardly response to stress
   */
  private async fleeInPanic(agent: CivilianAgent): Promise<void> {
    console.log(`😱 ${agent.agentId} (${agent.personality.archetype}): Fleeing in panic!`);
    
    // Fast evacuation with panic urgency (uses agility for speed)
    const safePosition: Position = { lat: 32.7767, lon: -96.7970 };
    await agent.moveTo(safePosition, 'panic');
  }

  /**
   * Follow crowd - social behavior when seeing other civilians
   */
  private async followCrowd(agent: CivilianAgent): Promise<void> {
    console.log(`👥 ${agent.agentId} (${agent.personality.archetype}): Following crowd (social personality)`);
    
    try {
      const vision = await agent.getVision();
      const nearbyCivilians = vision.agents?.filter(other => 
        other.type === 'civilian' && 
        other.distance < agent.personality.follow_distance
      ) || [];

      if (nearbyCivilians.length >= 2) {
        // Calculate center of crowd
        const crowdCenter = this.calculateCrowdCenter(nearbyCivilians);
        console.log(`   Following ${nearbyCivilians.length} civilians toward crowd center`);
        
        await agent.moveTo(crowdCenter, 'normal');
      } else if (nearbyCivilians.length === 1) {
        // Follow the single civilian
        console.log(`   Following single civilian ${nearbyCivilians[0].id}`);
        await agent.moveTo(nearbyCivilians[0].position, 'normal');
      }
    } catch (error) {
      console.warn(`⚠️ ${agent.agentId} crowd following failed:`, error);
    }
  }

  /**
   * Avoid crowd - antisocial behavior, maintain distance from others
   */
  private async avoidCrowd(agent: CivilianAgent): Promise<void> {
    console.log(`🚶 ${agent.agentId} (${agent.personality.archetype}): Avoiding crowd (antisocial personality)`);
    
    try {
      const vision = await agent.getVision();
      const nearbyCivilians = vision.agents?.filter(other => 
        other.type === 'civilian' && other.distance < 20 // Too close for comfort
      ) || [];

      if (nearbyCivilians.length > 0) {
        // Move away from the crowd
        const currentPos = agent.getCurrentPosition();
        const avoidancePosition = this.calculateAvoidancePosition(currentPos, nearbyCivilians);
        
        console.log(`   Moving away from ${nearbyCivilians.length} civilians`);
        await agent.moveTo(avoidancePosition, 'normal');
      }
    } catch (error) {
      console.warn(`⚠️ ${agent.agentId} crowd avoidance failed:`, error);
    }
  }

  /**
   * Normal behavior - default state when no special conditions are met
   */
  private async normalBehavior(agent: CivilianAgent): Promise<void> {
    // Decide whether to wander based on personality
    const shouldWander = Math.random() < this.getWanderProbability(agent);
    
    if (shouldWander) {
      console.log(`🚶 ${agent.agentId} (${agent.personality.archetype}): Starting to wander around`);
      await this.wanderAround(agent);
    } else {
      console.log(`✨ ${agent.agentId} (${agent.personality.archetype}): Normal behavior - staying alert`);
    }
  }

  /**
   * Calculate probability of wandering based on personality
   */
  private getWanderProbability(agent: CivilianAgent): number {
    // Base probability - increased to 50% as requested
    let probability = 0.3; // 30% base chance
    
    // Social agents wander more (looking for others to interact with)
    probability += agent.personality.sociability * 0.15;
    
    // Agile agents are more likely to move around
    probability += agent.personality.agility * 0.1;
    
    // Loners wander less frequently but when they do, they go farther
    if (agent.personality.archetype === 'loner') {
      probability *= 0.7;
    }
    
    // Heroes patrol more actively
    if (agent.personality.archetype === 'hero') {
      probability += 0.05;
    }
    
    return Math.min(probability, 0.5); // Cap at 50% chance per tick
  }

  /**
   * Make the agent wander to a nearby random location
   */
  private async wanderAround(agent: CivilianAgent): Promise<void> {
    try {
      const currentPos = agent.getCurrentPosition();
      if (!currentPos) return;
      
      // Don't start new movement if already moving
      if (agent.getStatus().isMoving) {
        console.log(`⏳ ${agent.agentId} already moving - skipping wander`);
        return;
      }
      
      // Generate a random nearby destination based on personality
      const wanderRadius = this.getWanderRadius(agent);
      const angle = Math.random() * 2 * Math.PI;
      
      // Convert radius from meters to approximate lat/lon degrees
      const radiusInDegrees = wanderRadius / 111000; // Rough conversion
      
      const destination = {
        lat: currentPos.lat + Math.cos(angle) * radiusInDegrees,
        lon: currentPos.lon + Math.sin(angle) * radiusInDegrees
      };
      
      console.log(`🎯 ${agent.agentId} wandering ${wanderRadius.toFixed(0)}m to ${destination.lat.toFixed(4)}, ${destination.lon.toFixed(4)}`);
      await agent.moveTo(destination, 'normal');
      
    } catch (error) {
      console.warn(`⚠️ ${agent.agentId} wander failed:`, error);
    }
  }

  /**
   * Get wander radius based on personality
   */
  private getWanderRadius(agent: CivilianAgent): number {
    let baseRadius = 50; // 50 meters base
    
    // Agile agents can wander farther
    baseRadius += agent.personality.agility * 100;
    
    // Social agents stay closer to spawn (more likely to encounter others)
    if (agent.personality.sociability > 0.7) {
      baseRadius *= 0.8;
    }
    
    // Loners wander much farther when they do move
    if (agent.personality.archetype === 'loner') {
      baseRadius *= 2.0;
    }
    
    // Heroes patrol wider areas
    if (agent.personality.archetype === 'hero') {
      baseRadius *= 1.5;
    }
    
    return Math.max(25, Math.min(baseRadius, 200)); // Between 25-200 meters
  }

  // =============================================================================
  // HELPER METHODS - Utility functions for calculations
  // =============================================================================

  /**
   * Calculate the center position of a group of civilians
   */
  private calculateCrowdCenter(civilians: Array<{ position: Position }>): Position {
    if (civilians.length === 0) {
      return { lat: 32.7767, lon: -96.7970 }; // Default position
    }

    const totalLat = civilians.reduce((sum, civilian) => sum + civilian.position.lat, 0);
    const totalLon = civilians.reduce((sum, civilian) => sum + civilian.position.lon, 0);

    return {
      lat: totalLat / civilians.length,
      lon: totalLon / civilians.length
    };
  }

  /**
   * Calculate a position that avoids nearby civilians
   */
  private calculateAvoidancePosition(currentPos: Position, civilians: Array<{ position: Position }>): Position {
    // Simple avoidance: move in opposite direction from crowd center
    const crowdCenter = this.calculateCrowdCenter(civilians);
    
    const deltaLat = currentPos.lat - crowdCenter.lat;
    const deltaLon = currentPos.lon - crowdCenter.lon;
    
    // Amplify the difference to move further away
    const avoidanceFactor = 0.01; // Adjust based on coordinate system scale
    
    return {
      lat: currentPos.lat + deltaLat * avoidanceFactor,
      lon: currentPos.lon + deltaLon * avoidanceFactor
    };
  }
}
