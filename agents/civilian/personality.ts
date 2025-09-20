/**
 * Civilian Personality System
 *
 * Defines personality traits that drive civilian behavior in emergency scenarios.
 * Each civilian gets unique traits that affect their decision-making.
 */

export interface PersonalityTraits {
  // Core traits (0.0 to 1.0)
  courage: number;      // 0.0 = cowardly, 1.0 = fearless
  sociability: number;  // 0.0 = loner, 1.0 = loves crowds
  agility: number;      // 0.0 = slow, 1.0 = fast

  // Derived properties (calculated from traits)
  visionRange: number;     // 30-70 meters based on alertness
  movementSpeed: number;   // 1.0-1.8 m/s based on agility
  followDistance: number;  // 10-40 meters based on sociability
  helpRadius: number;      // 5-30 meters based on helpfulness
}

/**
 * Pre-defined personality archetypes for consistent character types
 */
export const CIVILIAN_ARCHETYPES = {
  // THE HERO - Brave civilian who helps others
  hero: {
    courage: 0.9,         // Very brave
    sociability: 0.7,     // Works well with groups
    agility: 0.6,         // Average speed
  },

  // THE COWARD - Runs away immediately
  coward: {
    courage: 0.1,         // Very scared
    sociability: 0.4,     // Somewhat social
    agility: 0.8,         // Fast runner
  },

  // THE FOLLOWER - Always goes with crowds
  follower: {
    courage: 0.4,         // Moderate courage
    sociability: 0.9,     // Loves groups
    agility: 0.5,         // Average speed
  }
} as const;

export type ArchetypeKey = keyof typeof CIVILIAN_ARCHETYPES;

/**
 * Generate a random personality with reasonable distributions
 */
export function generateRandomPersonality(): PersonalityTraits {
  const traits = {
    courage: Math.random(),
    sociability: Math.random(),
    agility: Math.random()
  };

  return calculateDerivedProperties(traits);
}

/**
 * Create personality from archetype with some random variation
 */
export function generateArchetypePersonality(archetype: ArchetypeKey): PersonalityTraits {
  const baseTraits = CIVILIAN_ARCHETYPES[archetype];

  // Add small random variation (±0.1) to make each agent unique
  const traits = {
    courage: Math.max(0, Math.min(1, baseTraits.courage + (Math.random() - 0.5) * 0.2)),
    sociability: Math.max(0, Math.min(1, baseTraits.sociability + (Math.random() - 0.5) * 0.2)),
    agility: Math.max(0, Math.min(1, baseTraits.agility + (Math.random() - 0.5) * 0.2))
  };

  return calculateDerivedProperties(traits);
}

/**
 * Calculate derived properties from core traits
 */
function calculateDerivedProperties(traits: { courage: number; sociability: number; agility: number }): PersonalityTraits {
  // Calculate alertness from courage (brave people are more observant)
  const alertness = Math.min(1, traits.courage + 0.2);

  // Calculate helpfulness from courage and sociability
  const helpfulness = (traits.courage + traits.sociability) / 2;

  return {
    ...traits,
    // Derived properties based on traits
    visionRange: 30 + (alertness * 40),        // 30-70 meters
    movementSpeed: 1.0 + (traits.agility * 0.8), // 1.0-1.8 m/s
    followDistance: 10 + (traits.sociability * 30), // 10-40 meters
    helpRadius: 5 + (helpfulness * 25)         // 5-30 meters
  };
}

/**
 * Determine archetype from personality traits (for debugging/display)
 */
export function classifyPersonality(personality: PersonalityTraits): string {
  const { courage, sociability } = personality;

  if (courage > 0.7 && sociability > 0.6) return 'hero';
  if (courage < 0.3) return 'coward';
  if (sociability > 0.7) return 'follower';
  if (sociability < 0.3) return 'loner';

  return 'average';
}