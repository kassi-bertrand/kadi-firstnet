import { 
  PersonalityTraits, 
  getArchetypePersonality, 
  describePersonality 
} from './personality.js';

// Define action types that agents can request
export interface AgentAction {
  type: 'none' | 'move_toward' | 'move_away' | 'follow' | 'investigate' | 'flee_from' | 'wait';
  targetId?: string;
  targetLocation?: { latitude: number; longitude: number };
  urgency?: 'low' | 'normal' | 'high' | 'emergency';
  reason?: string;
}

export class CivilianAgent {
  civilianId: string;
  personality: PersonalityTraits;
  description: string;
  archetype: string;
  
  // Current agent state
  private currentLocation: { latitude: number; longitude: number } | null = null;
  private isCurrentlyMoving = false;
  
  // Social awareness - track other agents
  private knownAgents = new Map<string, { 
    lastSeen: number; 
    location: { latitude: number; longitude: number };
    archetype?: string;
    isMoving?: boolean;
  }>();
  
  // Current social state
  private socialState = {
    nearbyAgentCount: 0,
    crowdLevel: 'low', // 'low', 'medium', 'high'
    lastSocialDecision: '',
    stressLevel: 0
  };

  constructor(civilianId: string, archetypeName: string) {
    this.civilianId = civilianId;
    this.archetype = archetypeName;
    this.personality = getArchetypePersonality(archetypeName);
    this.description = describePersonality(this.personality);
    console.log(`CivilianAgent ${civilianId} created with personality: ${this.description}`);
  }

  // Update agent's current location when we get events
  updateLocation(latitude: number, longitude: number): void {
    this.currentLocation = { latitude, longitude };
  }

  // Get current location for movement commands
  getCurrentLocation(): { latitude: number; longitude: number } | null {
    return this.currentLocation;
  }

  // React to events about other agents based on personality
  reactToAgentEvent(eventData: any, spawnedAgents: Set<string>): AgentAction {
    // Update our own location if this event is about us
    if (eventData.civilianId === this.civilianId && eventData.latitude && eventData.longitude) {
      this.updateLocation(eventData.latitude, eventData.longitude);
    }
    
    // Only react to events from other agents (not ourselves)
    if (eventData.civilianId === this.civilianId) {
      return { type: 'none' };
    }
    
    // Don't react if we haven't been spawned yet
    if (!spawnedAgents.has(this.civilianId)) {
      return { type: 'none' };
    }
    
    // Update our knowledge of other agents
    this.updateKnownAgent(eventData);
    
    // Calculate social situation
    this.updateSocialState();
    
    // React based on personality and event type
    const eventType = eventData.type || this.getEventType(eventData);
    
    switch (eventType) {
      case 'spawn':
        return this.reactToAgentSpawn(eventData);
      case 'walk_start':
        return this.reactToAgentMovement(eventData);
      case 'location_update':
        return this.reactToAgentLocationUpdate(eventData);
      case 'walk_complete':
        return this.reactToAgentArrival(eventData);
      default:
        return { type: 'none' };
    }
  }

  // Update our knowledge about other agents
  private updateKnownAgent(eventData: any): void {
    if (eventData.civilianId && eventData.latitude && eventData.longitude) {
      this.knownAgents.set(eventData.civilianId, {
        lastSeen: Date.now(),
        location: { latitude: eventData.latitude, longitude: eventData.longitude },
        isMoving: eventData.isMoving || false
      });
    }
  }

  // Calculate current social situation
  private updateSocialState(): void {
    const now = Date.now();
    const recentThreshold = 30000; // 30 seconds
    
    // Count recently seen agents
    let nearbyCount = 0;
    for (const [agentId, info] of this.knownAgents) {
      if (now - info.lastSeen < recentThreshold) {
        nearbyCount++;
      }
    }
    
    this.socialState.nearbyAgentCount = nearbyCount;
    
    // Determine crowd level
    if (nearbyCount >= 3) this.socialState.crowdLevel = 'high';
    else if (nearbyCount >= 1) this.socialState.crowdLevel = 'medium';
    else this.socialState.crowdLevel = 'low';
    
    // Update stress based on personality and crowd level
    this.updateStressLevel();
  }

  // Update stress based on personality and social situation
  private updateStressLevel(): void {
    const { nearbyAgentCount } = this.socialState;
    
    switch (this.archetype) {
      case 'police':
        // Police are comfortable with activity and crowds
        this.socialState.stressLevel = Math.max(0, this.socialState.stressLevel - 0.1);
        break;
      case 'firefighter':
        // Firefighters thrive in team environments
        if (nearbyAgentCount > 0) this.socialState.stressLevel = Math.max(0, this.socialState.stressLevel - 0.1);
        else this.socialState.stressLevel = Math.max(0, this.socialState.stressLevel - 0.05);
        break;
      case 'ems':
        // EMS prefers manageable situations for patient care
        if (nearbyAgentCount > 5) this.socialState.stressLevel += 0.1;
        else this.socialState.stressLevel = Math.max(0, this.socialState.stressLevel - 0.1);
        break;
    }
    
    // Cap stress level
    this.socialState.stressLevel = Math.min(1.0, this.socialState.stressLevel);
  }

  // Personality-based reactions to different events
  private reactToAgentSpawn(eventData: any): AgentAction {
    switch (this.archetype) {
      case 'hero':
        console.log(`🦸 ${this.civilianId}: "Another civilian spawned nearby! I should keep an eye on them in case they need help."`);
        this.socialState.lastSocialDecision = 'monitor_for_help';
        return {
          type: 'move_toward',
          targetId: eventData.civilianId,
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'low',
          reason: 'investigate and offer help'
        };
      case 'follower':
        console.log(`👥 ${this.civilianId}: "Ooh, someone new appeared! Maybe I can follow them around and see where they go."`);
        this.socialState.lastSocialDecision = 'potential_follow_target';
        return {
          type: 'move_toward',
          targetId: eventData.civilianId,
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'normal',
          reason: 'get close to follow them'
        };
      case 'loner':
        console.log(`🚶 ${this.civilianId}: "Ugh, more people in my area. I need to find somewhere quieter to avoid this crowd."`);
        this.socialState.lastSocialDecision = 'avoid_area';
        return {
          type: 'move_away',
          targetId: eventData.civilianId,
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'normal',
          reason: 'avoid crowded area'
        };
      case 'coward':
        console.log(`😰 ${this.civilianId}: "Another person appeared... I hope they're not dangerous. This is making me nervous."`);
        this.socialState.lastSocialDecision = 'stay_cautious';
        return {
          type: 'wait',
          reason: 'assess if the new person is safe'
        };
      default:
        return { type: 'none' };
    }
  }

  private reactToAgentMovement(eventData: any): AgentAction {
    switch (this.archetype) {
      case 'hero':
        console.log(`🦸 ${this.civilianId}: "Someone's moving fast - they might be in trouble or heading toward danger. I should investigate."`);
        return {
          type: 'investigate',
          targetId: eventData.civilianId,
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'high',
          reason: 'investigate potential danger'
        };
      case 'follower':
        console.log(`👥 ${this.civilianId}: "Perfect! Someone's on the move. I'll follow their route and see where they're going."`);
        this.socialState.lastSocialDecision = 'follow_movement';
        return {
          type: 'follow',
          targetId: eventData.civilianId,
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'high',
          reason: 'follow their movement path'
        };
      case 'loner':
        console.log(`🚶 ${this.civilianId}: "Movement nearby... I'll wait until they're gone before I move anywhere."`);
        return {
          type: 'wait',
          reason: 'let them pass first'
        };
      case 'coward':
        console.log(`😰 ${this.civilianId}: "People are moving around! Is something wrong? Should I be running too?"`);
        return {
          type: 'flee_from',
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'high',
          reason: 'flee from potential danger'
        };
      default:
        return { type: 'none' };
    }
  }

  private reactToAgentLocationUpdate(eventData: any): AgentAction {
    // Only react occasionally to avoid spam
    if (Math.random() > 0.3) return { type: 'none' };
    
    const crowdComment = this.getCrowdComment();
    if (crowdComment) {
      console.log(`${this.getPersonalityEmoji()} ${this.civilianId}: ${crowdComment}`);
      
      // Loners act on crowd stress
      if (this.archetype === 'loner' && this.socialState.crowdLevel === 'high') {
        return {
          type: 'move_away',
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'normal',
          reason: 'escape from crowded area'
        };
      }
      
      // Followers move toward crowds
      if (this.archetype === 'follower' && this.socialState.crowdLevel === 'medium') {
        return {
          type: 'move_toward',
          targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
          urgency: 'low',
          reason: 'join the group activity'
        };
      }
    }
    
    return { type: 'none' };
  }

  private reactToAgentArrival(eventData: any): AgentAction {
    // Check if this is the agent's own arrival
    const isMyArrival = eventData.civilianId === this.civilianId || eventData.id === this.civilianId;
    
    if (isMyArrival) {
      // React to our own arrival - decide on next wandering behavior
      switch (this.archetype) {
        case 'hero':
          console.log(`🦸 ${this.civilianId}: "Area secured. Time to patrol another location."`);
          return {
            type: 'investigate',
            urgency: 'normal',
            reason: 'continuing patrol after arrival'
          };
        case 'follower':
          console.log(`👥 ${this.civilianId}: "I made it! I should look around for others to join."`);
          return {
            type: 'investigate',
            urgency: 'low',
            reason: 'looking for others to follow after arrival'
          };
        case 'loner':
          console.log(`🚶 ${this.civilianId}: "Perfect. Now to find somewhere even more secluded."`);
          return {
            type: 'investigate',
            urgency: 'low',
            reason: 'seeking solitude after arrival'
          };
        case 'coward':
          console.log(`😰 ${this.civilianId}: "Made it safely... but what if this place isn't safe either?"`);
          return {
            type: 'investigate',
            urgency: 'normal',
            reason: 'nervous wandering after arrival'
          };
        default:
          return { type: 'none' };
      }
    } else {
      // React to OTHER agents arriving
      switch (this.archetype) {
        case 'hero':
          console.log(`🦸 ${this.civilianId}: "Good, they made it safely to their destination. Everyone's accounted for."`);
          return { type: 'none' };
        case 'follower':
          console.log(`👥 ${this.civilianId}: "They stopped! I wonder if that's a good spot. Maybe I should head there too."`);
          return {
            type: 'move_toward',
            targetLocation: { latitude: eventData.latitude, longitude: eventData.longitude },
            urgency: 'low',
            reason: 'investigate where they stopped'
          };
        case 'loner':
          console.log(`🚶 ${this.civilianId}: "Finally, they stopped moving. Now I can plan my route without running into them."`);
          return { type: 'none' };
        case 'coward':
          console.log(`😰 ${this.civilianId}: "They stopped... I hope that means the danger is over."`);
          return { type: 'none' };
        default:
          return { type: 'none' };
      }
    }
  }

  // Generate crowd-based comments
  private getCrowdComment(): string | null {
    const { nearbyAgentCount, crowdLevel } = this.socialState;
    
    switch (this.archetype) {
      case 'hero':
        if (crowdLevel === 'high') return `"${nearbyAgentCount} people nearby - good, I can help more people if needed."`;
        break;
      case 'follower':
        if (crowdLevel === 'low') return `"Only ${nearbyAgentCount} people around... I feel lonely. I should find a group!"`;
        if (crowdLevel === 'high') return `"Perfect! ${nearbyAgentCount} people nearby. This is my kind of crowd!"`;
        break;
      case 'loner':
        if (crowdLevel === 'medium') return `"${nearbyAgentCount} people nearby... getting a bit crowded for my taste."`;
        if (crowdLevel === 'high') return `"Way too many people here (${nearbyAgentCount})! I need to find a quieter area."`;
        break;
      case 'coward':
        if (crowdLevel === 'high') return `"${nearbyAgentCount} people moving around... this is stressful. What if something bad happens?"`;
        break;
    }
    
    return null;
  }

  // Helper methods
  private getEventType(eventData: any): string {
    // Infer event type from data structure
    if (eventData.timestamp && eventData.latitude && !eventData.progress) return 'spawn';
    if (eventData.totalDistance) return 'walk_start';
    if (eventData.progress !== undefined) return 'location_update';
    if (eventData.distance && !eventData.totalDistance) return 'walk_complete';
    return 'unknown';
  }

  getPersonalityEmoji(): string {
    switch (this.archetype) {
      case 'police': return '👮';
      case 'firefighter': return '�';
      case 'ems': return '�';
      default: return '🧑';
    }
  }

  // Get current social status for debugging
  getSocialStatus(): string {
    return `Known agents: ${this.knownAgents.size}, Crowd level: ${this.socialState.crowdLevel}, Stress: ${this.socialState.stressLevel.toFixed(2)}, Last decision: ${this.socialState.lastSocialDecision || 'none'}`;
  }

  // Define preferred spawn areas based on personality (existing method)
  getPreferredSpawnArea(): { centerLat: number; centerLon: number; radius: number } {
    switch (this.archetype) {
      case 'hero':
        // Downtown Dallas - where people need help
        return {
          centerLat: 32.7767,   // Downtown Dallas
          centerLon: -96.7970,
          radius: 0.01          // ~1km radius around downtown
        };
      
      case 'loner':
        // Outskirts - North Dallas suburbs
        return {
          centerLat: 32.8200,   // North Dallas suburbs
          centerLon: -96.8400,
          radius: 0.015         // ~1.5km radius in suburban area
        };
      
      case 'follower':
        // Near central area but not downtown (residential)
        return {
          centerLat: 32.7500,   // Residential area south of downtown
          centerLon: -96.8200,
          radius: 0.012         // ~1.2km radius
        };
      
      case 'coward':
      default:
        // Random area - middle ground
        return {
          centerLat: 32.7100,   // General Dallas area
          centerLon: -96.8500,
          radius: 0.02          // ~2km radius - larger random area
        };
    }
  }

  // Generate spawn coordinates within preferred area
  generateSpawnLocation(): { latitude: number; longitude: number } {
    const area = this.getPreferredSpawnArea();
    
    // Generate random offset within radius
    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * area.radius;
    
    const lat = area.centerLat + (distance * Math.cos(angle));
    const lon = area.centerLon + (distance * Math.sin(angle));
    
    return { latitude: lat, longitude: lon };
  }
}