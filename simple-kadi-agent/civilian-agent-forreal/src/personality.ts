/**
 * Personality System for Civilian Agents
 * 
 * Defines personality traits and archetypes that drive different civilian behaviors
 * in emergency situations. Each civilian gets a personality that influences their
 * decision-making in the behavior tree.
 */

// Core personality traits that define how a civilian behaves
export interface PersonalityTraits {
  courage: number;        // 0.0 = cowardly, 1.0 = fearless
  sociability: number;    // 0.0 = loner, 1.0 = loves crowds  
  agility: number;        // 0.0 = slow, 1.0 = fast
  helpfulness: number;    // 0.0 = selfish, 1.0 = altruistic
}

// Complete personality profile with derived properties
export interface PersonalityProfile extends PersonalityTraits {
  archetype: string;
  // Derived properties calculated from base traits
  vision_range: number;     // How far they can see (20-60 meters)
  panic_threshold: number;  // When they start panicking (0.0-1.0)
  follow_distance: number;  // How close they stay to crowds (5-35 meters)
}

// Pre-defined personality archetypes for predictable, distinct behaviors
export const ARCHETYPES: Record<string, PersonalityTraits> = {
  hero: {
    courage: 0.9,       // Very brave - helps others first
    helpfulness: 0.9,   // Always helps others
    sociability: 0.7,   // Works well with groups  
    agility: 0.6        // Average speed
  },

  coward: {
    courage: 0.1,       // Very scared - flees immediately
    helpfulness: 0.2,   // Doesn't help others
    sociability: 0.4,   // Somewhat social but self-focused
    agility: 0.8        // Fast runner when scared
  },

  follower: {
    courage: 0.4,       // Moderate courage - needs others
    helpfulness: 0.5,   // Sometimes helps
    sociability: 0.9,   // Loves groups, hates being alone
    agility: 0.5        // Average speed
  },

  loner: {
    courage: 0.6,       // Reasonably brave on their own
    helpfulness: 0.3,   // Prefers self-reliance  
    sociability: 0.1,   // Avoids crowds
    agility: 0.7        // Moves efficiently alone
  }
};

/**
 * Create a personality profile from an archetype or randomly
 */
export function createPersonality(archetype?: string): PersonalityProfile {
  let traits: PersonalityTraits;

  if (archetype && ARCHETYPES[archetype]) {
    // Use archetype as base with small random variations for uniqueness
    const base = ARCHETYPES[archetype];
    traits = {
      courage: clamp(base.courage + randomVariation(), 0, 1),
      sociability: clamp(base.sociability + randomVariation(), 0, 1), 
      agility: clamp(base.agility + randomVariation(), 0, 1),
      helpfulness: clamp(base.helpfulness + randomVariation(), 0, 1)
    };
  } else {
    // Generate completely random personality
    traits = {
      courage: Math.random(),
      sociability: Math.random(),
      agility: Math.random(), 
      helpfulness: Math.random()
    };
    archetype = 'random';
  }

  // Calculate derived properties from base traits
  return {
    ...traits,
    archetype,
    vision_range: 20 + (traits.courage * 40),           // Brave people see further
    panic_threshold: 0.3 + (traits.courage * 0.4),     // Brave people panic less
    follow_distance: 5 + (traits.sociability * 30)     // Social people follow closer
  };
}

/**
 * Get list of available archetype names
 */
export function getAvailableArchetypes(): string[] {
  return Object.keys(ARCHETYPES);
}

/**
 * Format personality for human-readable display
 */
export function formatPersonality(personality: PersonalityProfile): string {
  const p = personality;
  return `${p.archetype.toUpperCase()} - Courage:${p.courage.toFixed(2)} Social:${p.sociability.toFixed(2)} Agile:${p.agility.toFixed(2)} Help:${p.helpfulness.toFixed(2)}`;
}

// Helper functions
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomVariation(): number {
  return (Math.random() - 0.5) * 0.1; // ±0.05 variation
}
