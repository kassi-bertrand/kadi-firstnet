// Step 1: Define what a personality looks like
// Each trait is a number between 0.0 (low) and 1.0 (high)
export interface PersonalityTraits {
  // Primary traits - these drive behavior decisions
  courage: number;      // 0.0 = cowardly, 1.0 = fearless
  sociability: number;  // 0.0 = loner, 1.0 = loves crowds  
  agility: number;      // 0.0 = slow, 1.0 = fast
  helpfulness: number;  // 0.0 = selfish, 1.0 = altruistic
  panic_threshold: number; // 0.0 = panics easily, 1.0 = stays calm
  alertness: number;    // 0.0 = oblivious, 1.0 = very aware
}

// Step 2: Pre-defined character archetypes  
// Emergency service personnel with professional training
export const CIVILIAN_ARCHETYPES: Record<string, PersonalityTraits> = {
  // POLICE OFFICER - Law enforcement professional
  police: {
    courage: 0.85,        // Very brave, trained for danger
    sociability: 0.7,     // Works well in teams
    agility: 0.7,         // Good physical fitness
    helpfulness: 0.8,     // Serves and protects
    panic_threshold: 0.9, // Professional training prevents panic
    alertness: 0.95       // Highly alert, always scanning for threats
  },

  // FIREFIGHTER - Emergency response professional
  firefighter: {
    courage: 0.95,        // Extremely brave, runs toward danger
    sociability: 0.8,     // Strong team coordination
    agility: 0.8,         // Excellent physical condition
    helpfulness: 0.9,     // Dedicated to saving lives
    panic_threshold: 0.85, // Trained to stay calm in emergencies
    alertness: 0.8        // Alert to hazards and victims
  },

  // EMS PARAMEDIC - Medical emergency professional
  ems: {
    courage: 0.75,        // Brave but cautious (safety first)
    sociability: 0.75,    // Works closely with team and patients
    agility: 0.65,        // Good fitness, careful movement with equipment
    helpfulness: 0.95,    // Primary focus is helping people
    panic_threshold: 0.8, // Medical training maintains composure
    alertness: 0.9        // Highly alert to medical signs and dangers
  }
};

// Step 3: Function to create random personalities
// This mixes traits randomly but keeps them realistic
export function generateRandomPersonality(): PersonalityTraits {
  return {
    courage: Math.random(),
    sociability: Math.random(), 
    agility: Math.random(),
    helpfulness: Math.random(),
    panic_threshold: Math.random(),
    alertness: Math.random()
  };
}

// Step 4: Helper function to get a personality by type
export function getArchetypePersonality(archetypeName: string): PersonalityTraits {
  const archetype = CIVILIAN_ARCHETYPES[archetypeName];
  if (!archetype) {
    console.warn(`Unknown archetype: ${archetypeName}, using random personality`);
    return generateRandomPersonality();
  }
  
  // Return a copy so the original doesn't get modified
  return { ...archetype };
}

// Step 5: Function to describe a personality in human terms
export function describePersonality(personality: PersonalityTraits): string {
  const traits: string[] = [];
  
  // Describe each trait based on its value
  if (personality.courage > 0.7) traits.push("very brave");
  else if (personality.courage < 0.3) traits.push("cowardly");
  
  if (personality.sociability > 0.7) traits.push("very social");
  else if (personality.sociability < 0.3) traits.push("antisocial");
  
  if (personality.helpfulness > 0.7) traits.push("helpful");
  else if (personality.helpfulness < 0.3) traits.push("selfish");
  
  if (personality.agility > 0.7) traits.push("agile");
  else if (personality.agility < 0.3) traits.push("slow");
  
  return traits.length > 0 ? traits.join(", ") : "average personality";
}