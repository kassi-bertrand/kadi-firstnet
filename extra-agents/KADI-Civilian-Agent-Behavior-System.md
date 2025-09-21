# KADI Civilian Agent Behavior System: Creating Diverse NPC-Like Characters

## Overview

This document explains how to create diverse, realistic civilian agents for the FirstNet Incident Commander simulation using KADI's architecture. The goal is to make civilians behave like NPCs in a video game - each with unique personalities that drive different responses to emergency situations.

## Table of Contents
- [Core Principles](#core-principles)
- [Understanding Behavior Trees](#understanding-behavior-trees)
- [Personality System](#personality-system)
- [Behavioral Archetypes](#behavioral-archetypes)
- [Implementation Architecture](#implementation-architecture)
- [Detailed Implementation Strategy](#detailed-implementation-strategy)
- [Code Examples](#code-examples)

---

## Core Principles

### The KADI Way: Stateless Abilities + Stateful Agents

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Abilities     │    │   World State   │    │   Agent State   │
│   (Reusable)    │    │   (Shared)      │    │  (Individual)   │
├─────────────────┤    ├─────────────────┤    ├─────────────────┤
│ • see()         │    │ • Agent positions│    │ • Personality   │
│ • move()        │    │ • Fire locations │    │ • Goals         │
│ • pathfind()    │    │ • Obstacles     │    │ • Memory        │
│ • communicate() │    │ • Weather       │    │ • Emotions      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Key Insight**: All civilians use the same `see` and `move` abilities, but their **personality** determines **how** they use them.

### What is CivilianBehaviorTree in KADI Terms?

**`CivilianBehaviorTree` is NOT an ability** - it's an **internal decision-making component** that lives inside each civilian agent. Here's the distinction:

**KADI Abilities (Reusable Services):**
- `world.whatDoISee()` - Perception ability
- `world.moveMe()` - Movement ability
- `world.pathfind()` - Routing ability

**Agent Internal Components (Not Abilities):**
- `CivilianBehaviorTree` - Decision logic
- `PersonalitySystem` - Trait modifiers
- `EmotionalState` - Fear, stress tracking
- `AgentMemory` - Event history

```mermaid
graph TB
    subgraph "CIVILIAN AGENT (Single Process)"
        Agent["🧑 CivilianAgent Instance"]
        Agent --> BT["CivilianBehaviorTree<br/>(Internal Component)"]
        Agent --> PS["PersonalitySystem<br/>(Internal Component)"]
        Agent --> MS["AgentMemory<br/>(Internal Component)"]
        Agent --> ES["EmotionalState<br/>(Internal Component)"]

        BT --> Decision["Decision: 'I should evacuate'"]
    end

    subgraph "WORLD SIMULATOR (Separate Process)"
        WS["🌍 World Simulator"]
        WS --> PA["Perception Ability<br/>(Internal Tool)"]
        WS --> MA["Movement Ability<br/>(Internal Tool)"]
    end

    subgraph "KADI BROKER"
        Broker["🔌 Message Router"]
    end

    Agent <-->|"RPC Calls"| Broker
    WS <-->|"Tool Responses"| Broker

    Decision -.->|"Triggers RPC Call"| Agent
    Agent -.->|"world.whatDoISee()"| Broker
    Agent -.->|"world.moveMe()"| Broker
```

---

## Understanding Behavior Trees

### What is a Behavior Tree?

A **behavior tree** is like a decision flowchart that an agent follows every time it needs to make a decision. Think of it as "if-then-else" statements organized in a tree structure.

### Key Components Explained

#### 1. **Selector** - "Try options until one succeeds"
A Selector tries its children from left to right until one succeeds.

```javascript
// Think of Selector like this:
if (option1_works()) {
  do_option1();
} else if (option2_works()) {
  do_option2();
} else if (option3_works()) {
  do_option3();
}
```

#### 2. **Condition** - "Check if something is true"
A Condition asks a yes/no question.

```javascript
// Examples of conditions:
isInDanger()        // "Am I near fire?"
seesOtherPeople()   // "Do I see other civilians?"
isResporderNearby() // "Is there a firefighter close?"
isPoliceOfficerNearby() // "Is there police officer close?
```

#### 3. **Action** - "Do something"
An Action is the actual behavior the agent performs.

```javascript
// Examples of actions:
evacuateImmediately()  // "Run away from danger"
followCrowd()          // "Move toward other people"
helpOthers()           // "Assist nearby civilians"
```

### Visual Behavior Tree Example

```mermaid
graph TD
    Root["Root Selector
    Try these priorities in order"]

    Root --> Emergency{"Emergency?
    Am I in immediate danger?"}
    Root --> Panic{"Panic?
    Should I panic based on my personality?"}
    Root --> Social{"Social?
    Do I see other people?"}
    Root --> Normal["Normal Behavior
    Continue routine activities"]

    Emergency --> EmergencyAction["EVACUATE IMMEDIATELY
    Run to nearest exit"]

    Panic --> PanicSelector["Panic Response Selector
    What kind of person am I?"]
    PanicSelector --> Brave{"Brave?
    courage > 0.7"}
    PanicSelector --> Coward["FLEE IN PANIC
    Run away frantically"]

    Brave --> HelpOthers["HELP OTHERS
    Guide people to safety"]

    Social --> SocialSelector["Social Response Selector
    How social am I?"]
    SocialSelector --> HighlySocial{"Very Social?
    sociability > 0.6"}
    SocialSelector --> LowSocial["MAINTAIN DISTANCE
    Keep personal space"]

    HighlySocial --> FollowCrowd["FOLLOW CROWD
    Move with the group"]
```

### How the Tree Executes (Step by Step)

1. **Start at Root**: Agent begins decision-making process
2. **Check Emergency**: "Am I in immediate danger?"
   - **YES** → Execute "EVACUATE IMMEDIATELY" → DONE
   - **NO** → Continue to next option
3. **Check Panic**: "Should I panic based on my personality?"
   - **YES** → Check sub-options:
     - If brave → "HELP OTHERS" → DONE
     - If not brave → "FLEE IN PANIC" → DONE
   - **NO** → Continue to next option
4. **Check Social**: "Do I see other people?"
   - **YES** → Check sub-options:
     - If highly social → "FOLLOW CROWD" → DONE
     - If not social → "MAINTAIN DISTANCE" → DONE
   - **NO** → Continue to next option
5. **Default**: Execute "Normal Behavior" → DONE

---

## Personality System

### Core Personality Traits

Each civilian agent gets a unique personality with traits ranging from 0.0 to 1.0:

```typescript
const personality = {
  // Primary traits
  courage: 0.7,        // 0.0 = cowardly, 1.0 = fearless
  sociability: 0.4,    // 0.0 = loner, 1.0 = loves crowds
  agility: 0.6,        // 0.0 = slow, 1.0 = fast
  helpfulness: 0.8,    // 0.0 = selfish, 1.0 = altruistic
  panic_threshold: 0.5, // 0.0 = panics easily, 1.0 = stays calm
  alertness: 0.6,      // 0.0 = oblivious, 1.0 = very aware

  // Derived properties (calculated from traits)
  vision_range: 30 + (alertness * 40),        // 30-70 meters
  movement_speed: 1.0 + (agility * 0.8),      // 1.0-1.8 m/s
  follow_distance: 10 + (sociability * 30),   // 10-40 meters
  help_radius: 5 + (helpfulness * 25)         // 5-30 meters
};
```

### Personality Impact on Behavior

```mermaid
graph LR
    Traits[Personality Traits] --> Decisions[Decision Making]
    Traits --> Abilities[Ability Usage]

    subgraph "Trait Examples"
        T1["courage: 0.2
        Cowardly"]
        T2["sociability: 0.9
        Very Social"]
        T3["agility: 0.7
        Fast"]
    end

    subgraph "Behavior Examples"
        B1["Flees at first
        sign of danger"]
        B2["Always follows
        crowds"]
        B3["Moves quickly
        when panicked"]
    end

    T1 --> B1
    T2 --> B2
    T3 --> B3

    subgraph "Ability Modifications"
        A1["vision_range:
        small area"]
        A2["follow_distance:
        stays very close"]
        A3["movement_speed:
        1.7 m/s when running"]
    end

    T1 --> A1
    T2 --> A2
    T3 --> A3
```

---

## Behavioral Archetypes

### Pre-defined Personality Types

Instead of completely random personalities, we create recognizable character types:

```typescript
const CIVILIAN_ARCHETYPES = {
  // THE HERO - Brave civilian who helps others
  hero: {
    courage: 0.9,         // Very brave
    helpfulness: 0.9,     // Always helps others
    sociability: 0.7,     // Works well with groups
    panic_threshold: 0.8, // Hard to panic
    agility: 0.6,         // Average speed
    alertness: 0.8        // Very aware of surroundings
  },

  // THE COWARD - Runs away immediately
  coward: {
    courage: 0.1,         // Very scared
    helpfulness: 0.2,     // Doesn't help others
    sociability: 0.4,     // Somewhat social
    panic_threshold: 0.2, // Panics easily
    agility: 0.8,         // Fast runner
    alertness: 0.7        // Alert to danger
  },

  // THE FOLLOWER - Always goes with crowds
  follower: {
    courage: 0.4,         // Moderate courage
    helpfulness: 0.5,     // Sometimes helps
    sociability: 0.9,     // Loves groups
    panic_threshold: 0.4, // Moderate panic resistance
    agility: 0.5,         // Average speed
    alertness: 0.5        // Average awareness
  },

  // THE LONE WOLF - Independent decision maker
  loner: {
    courage: 0.6,         // Reasonably brave
    helpfulness: 0.3,     // Prefers self-reliance
    sociability: 0.1,     // Avoids crowds
    panic_threshold: 0.6, // Good under pressure
    agility: 0.7,         // Moves efficiently alone
    alertness: 0.8        // Very observant
  },

  // THE ELDERLY - Wise but slower
  elderly: {
    courage: 0.7,         // Life experience = courage
    helpfulness: 0.8,     // Wants to help younger people
    sociability: 0.6,     // Moderately social
    panic_threshold: 0.7, // Stays calm in crisis
    agility: 0.2,         // Slower movement
    alertness: 0.6        // Good situational awareness
  }
};
```

### Archetype Behavior Examples

```mermaid
graph TD
    Fire[Fire Detected] --> Response{Agent Response}

    Response --> Hero["Hero Response
    Help others evacuate
    before escaping myself"]
    Response --> Coward["Coward Response
    Run immediately
    via fastest route"]
    Response --> Follower["Follower Response
    Look for crowd to
    follow to safety"]
    Response --> Loner["Loner Response
    Find my own
    escape route"]
    Response --> Elderly["Elderly Response
    Move slowly but
    guide younger people"]

    Hero --> HeroAction["Moves toward
    other civilians
    to assist them"]
    Coward --> CowardAction["Immediate evacuation
    ignoring others"]
    Follower --> FollowerAction["Waits for group
    then follows"]
    Loner --> LonerAction["Calculates best
    personal route"]
    Elderly --> ElderlyAction["Slow but deliberate
    movement with guidance"]
```

---

## Implementation Architecture

### Complete System Architecture: Agents, Abilities & Broker

This diagram shows the complete KADI system with all agents, abilities, and broker connections:

```mermaid
graph TB
    subgraph "KADI BROKER (Central Hub)"
        Broker["🔌 KADI Broker<br/>WebSocket + RabbitMQ<br/>• Routes RPC calls<br/>• Delivers events<br/>• Network isolation"]
    end

    subgraph "WORLD SIMULATOR AGENT"
        WS["🌍 World Simulator Agent<br/>Role: 'ability'<br/>Central Authority"]
        WS --> WSTools["📦 Registered Tools:<br/>• world.whatDoISee<br/>• world.moveMe<br/>• world.spawnAgent"]
        WS --> WSAbilities["Internal Abilities:<br/>• Perception (distance calc)<br/>• OSRM Routing<br/>• Collision detection"]
    end

    subgraph "CIVILIAN AGENTS (Multiple Instances)"
        subgraph "Civilian Agent 001 (Hero)"
            C1["🧑 CivilianAgent<br/>Role: 'agent'<br/>Archetype: Hero"]
            C1 --> C1BT["CivilianBehaviorTree<br/>(Internal Component)"]
            C1 --> C1P["Personality:<br/>courage: 0.9<br/>helpfulness: 0.9<br/>(Internal State)"]
            C1 --> C1M["Memory & Emotions<br/>(Internal State)"]
        end

        subgraph "Civilian Agent 002 (Coward)"
            C2["😨 CivilianAgent<br/>Role: 'agent'<br/>Archetype: Coward"]
            C2 --> C2BT["CivilianBehaviorTree<br/>(Internal Component)"]
            C2 --> C2P["Personality:<br/>courage: 0.1<br/>agility: 0.8<br/>(Internal State)"]
            C2 --> C2M["Memory & Emotions<br/>(Internal State)"]
        end

        subgraph "Civilian Agent 003 (Follower)"
            C3["👥 CivilianAgent<br/>Role: 'agent'<br/>Archetype: Follower"]
            C3 --> C3BT["CivilianBehaviorTree<br/>(Internal Component)"]
            C3 --> C3P["Personality:<br/>sociability: 0.9<br/>courage: 0.4<br/>(Internal State)"]
            C3 --> C3M["Memory & Emotions<br/>(Internal State)"]
        end
    end

    subgraph "RESPONDER AGENTS"
        F1["🚒 FirefighterAgent<br/>Role: 'agent'<br/>Different Behavior Tree"]
        P1["👮 PoliceAgent<br/>Role: 'agent'<br/>Different Behavior Tree"]
    end

    subgraph "DASHBOARD & OBSERVERS"
        Dashboard["🗺️ Real-time Dashboard<br/>Role: 'observer'<br/>MapLibre Visualization"]
        Inspector["🔍 Agent Inspector<br/>Role: 'observer'<br/>Behavior Analysis"]
    end

    %% Broker connections
    WS <-->|"Tool Registration<br/>Event Publishing"| Broker
    C1 <-->|"Tool Calls<br/>Event Subscription"| Broker
    C2 <-->|"Tool Calls<br/>Event Subscription"| Broker
    C3 <-->|"Tool Calls<br/>Event Subscription"| Broker
    F1 <-->|"Tool Calls<br/>Event Subscription"| Broker
    P1 <-->|"Tool Calls<br/>Event Subscription"| Broker
    Dashboard <-->|"Event Subscription<br/>Live Updates"| Broker
    Inspector <-->|"Event Subscription<br/>Agent Monitoring"| Broker

    %% Decision flow
    C1BT -.->|"Decides: Help Others"| C1
    C2BT -.->|"Decides: Flee Quickly"| C2
    C3BT -.->|"Decides: Follow Crowd"| C3

    %% Tool calls
    C1 -.->|"world.whatDoISee()<br/>world.moveMe()"| Broker
    C2 -.->|"world.whatDoISee()<br/>world.moveMe()"| Broker
    C3 -.->|"world.whatDoISee()<br/>world.moveMe()"| Broker

    %% Events flow
    WS -.->|"agent.position.updated<br/>world.tick<br/>world.hazard.*"| Broker
    Broker -.->|"Event Delivery"| C1
    Broker -.->|"Event Delivery"| C2
    Broker -.->|"Event Delivery"| C3
    Broker -.->|"Live Updates"| Dashboard
```

### Key KADI Concepts Illustrated:

**🟦 ABILITIES (Reusable Services):**
- Live inside the World Simulator as registered tools
- `world.whatDoISee`, `world.moveMe`, etc.
- Accessed via broker RPC calls

**🟨 AGENTS (Behavioral Entities):**
- Each civilian is a separate KADI agent process
- Contains internal components (NOT abilities): BehaviorTree, Personality, Memory
- Calls abilities via broker to perform actions

**🟪 INTERNAL COMPONENTS (Not Abilities):**
- `CivilianBehaviorTree` - Decision making logic
- `PersonalitySystem` - Individual traits
- `AgentMemory` - Event history
- These live INSIDE agents, not as separate services

### System Components

```mermaid
graph TB
    subgraph "World Simulator (Central Authority)"
        WS["World Simulator
        🌍 Single Source of Truth"]
        WS --> PA["Perception Ability
        📡 see() function"]
        WS --> MA["Movement Ability
        🚶 move() function"]
        WS --> RA["Routing Ability
        🗺️ OSRM integration"]
    end

    subgraph "Civilian Agents (Multiple)"
        C1["Civilian 001
        🧑 Hero Archetype"]
        C2["Civilian 002
        😨 Coward Archetype"]
        C3["Civilian 003
        👥 Follower Archetype"]

        subgraph "Agent Components"
            BT["Behavior Tree
            Decision Engine"]
            PS["Personality System
            Trait Modifiers"]
            MS["Memory System
            Recent Events"]
            ES["Emotional State
            Fear, Stress, etc."]
        end
    end

    subgraph "Communication Layer"
        Broker["KADI Broker
        Event & RPC Routing"]
    end

    C1 <--> Broker
    C2 <--> Broker
    C3 <--> Broker
    WS <--> Broker

    Broker --> Dashboard["Real-time Dashboard
    🗺️ Live Visualization"]
```

### Data Flow Example

```mermaid
sequenceDiagram
    participant Agent as Civilian Agent (Hero Archetype)
    participant Broker as KADI Broker
    participant World as World Simulator
    participant Ability as Perception Ability

    Note over Agent: Every 100ms: Make Decision

    Agent->>Agent: 1. Execute Behavior Tree
    Agent->>Broker: 2. RPC: world.whatDoISee({agentId, visionRange})
    Broker->>World: 3. Route request
    World->>Ability: 4. Use internal perception
    Ability->>World: 5. Return visibility data
    World->>Broker: 6. Return comprehensive view
    Broker->>Agent: 7. Deliver results

    Agent->>Agent: 8. Apply personality to decision: Hero sees fire, Courage = 0.9 (brave), Helpfulness = 0.9 (helps others)

    Agent->>Broker: 9. RPC: world.moveMe({destination: near_civilians})
    Note over Agent: Decision: Move toward other civilians to help them evacuate

    Broker->>World: 10. Route movement request
    World->>World: 11. Execute OSRM routing
    World->>Broker: 12. Publish: agent.position.updated
    Broker->>Agent: 13. Receive position update

    Note over Agent: Hero moves toward civilians instead of immediately fleeing
```

---

## Detailed Implementation Strategy

### Phase 1: Foundation (Days 1-2)

#### 1.1 Basic Personality System
```typescript
// Start with 3 core traits only
const basicPersonality = {
  courage: Math.random(),
  sociability: Math.random(),
  agility: Math.random()
};
```

**Goal**: Get agents making different decisions based on simple traits.

**Success Criteria**:
- Brave agents move toward danger
- Cowardly agents flee immediately
- Social agents cluster together

#### 1.2 World Simulator Integration
- Implement `world.whatDoISee()` with basic vision
- Implement `world.moveMe()` with OSRM routing
- Test with 5-10 agents

### Phase 2: Archetypes (Days 3-4)

#### 2.1 Implement 3 Clear Archetypes
```typescript
const INITIAL_ARCHETYPES = {
  hero: { courage: 0.9, sociability: 0.7, agility: 0.6 },
  coward: { courage: 0.1, sociability: 0.4, agility: 0.8 },
  follower: { courage: 0.4, sociability: 0.9, agility: 0.5 }
};
```

#### 2.2 Test Emergent Behaviors
- Spawn 30 civilians (10 of each archetype)
- Create fire scenario
- Observe behavior patterns:
  - Heroes should move toward civilians
  - Cowards should flee immediately
  - Followers should cluster and move together

#### 2.3 Visual Validation
- Dashboard shows agent types with different colors
- Track movement patterns to verify personalities are working

### Phase 3: Behavior Trees (Days 5-6)

#### 3.1 Implement Proper Behavior Tree Structure

**What is a Behavior Tree?**
A behavior tree is like a decision flowchart that helps an agent decide what to do. Think of it as a series of "if-then" questions that lead to actions.

**The Three Main Components:**

1. **Selector** = "Try these options in priority order until one works"
2. **Condition** = "Check if something is true (yes/no question)"
3. **Action** = "Actually do something (move, speak, etc.)"

### Visual Behavior Tree Execution Flow

```mermaid
graph TD
    Root["🌳 Root Selector<br/>I need to decide what to do"]

    Root --> CheckDanger{"🔍 Condition: Am I in danger?<br/>calls isInDanger(agent)"}
    Root --> CheckSocial{"🔍 Condition: Do I see people?<br/>calls seesOtherPeople(agent)"}
    Root --> DoNormal["⚡ Action: Do normal stuff<br/>calls normalBehavior(agent)"]

    CheckDanger -->|YES| Evacuate["⚡ Action: EVACUATE!<br/>calls evacuateImmediately(agent)"]
    CheckDanger -->|NO| Root

    CheckSocial -->|YES| Follow["⚡ Action: Follow crowd<br/>calls followCrowd(agent)"]
    CheckSocial -->|NO| Root

    style Root fill:#e1f5fe
    style CheckDanger fill:#fff3e0
    style CheckSocial fill:#fff3e0
    style Evacuate fill:#ffebee
    style Follow fill:#e8f5e8
    style DoNormal fill:#e8f5e8
```

**How This Flows:**
1. Agent starts at Root Selector
2. Root tries first option: "Am I in danger?" (Condition)
3. If YES → Execute "EVACUATE!" (Action) → DONE
4. If NO → Try next option: "Do I see people?" (Condition)
5. If YES → Execute "Follow crowd" (Action) → DONE
6. If NO → Execute "Do normal stuff" (Action) → DONE

```typescript
// Step-by-step behavior tree implementation with TypeScript

// Forward declaration for the civilian agent type
interface CivilianAgent {
  agentId: string;
  personality: PersonalityTraits;
  getVision(): Promise<VisionResult>;
  moveTo(destination: Destination, urgency?: string): Promise<MovementResult>;
  calculateStressLevel(): number;
  // ... other agent methods
}

// Result types for behavior tree execution
type BehaviorResult = 'SUCCESS' | 'FAILURE' | 'RUNNING';

// Step 1: Create base behavior node class
// Think of this as the "blueprint" for all behavior tree components
abstract class BehaviorNode {
  protected children: BehaviorNode[] = []; // Child nodes in the tree

  // Every node must implement execute() - this is where the logic happens
  abstract execute(agent: CivilianAgent): Promise<BehaviorResult>;
}

// Step 2: Implement Selector (the "priority list" node)
// 🎯 PURPOSE: "Try these options (i.e. conditions) in order until one succeeds"
// REAL WORLD: Like checking "Am I in danger? → Am I social? → Do normal stuff"
// STRUCTURE: Selector gets an array of Condition objects, each with:
//   - checkFunction: the yes/no question
//   - children: array of things to do if YES (more Conditions or Actions)
class Selector extends BehaviorNode {
  constructor(children: BehaviorNode[]) {
    super();
    this.children = children; // Store the list of options to try
  }

  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    // 🔄 LOGIC: Try each child option until one succeeds
    for (const child of this.children) {
      const result = await child.execute(agent); // Pass agent to child

      if (result === 'SUCCESS') {
        return 'SUCCESS'; // Found one that worked, we're done!
      }
      // If FAILURE, continue to next child (keep trying options)
    }
    return 'FAILURE'; // All options failed - nothing worked
  }
}

// Step 3: Implement Condition (the "yes/no question" node)
// 🎯 PURPOSE: "Check if something is true, then maybe do something"
// REAL WORLD: "Am I in danger?" → if YES, do emergency actions
class Condition extends BehaviorNode {
  // Store the function that checks the condition (the "question")
  private checkFunction: (agent: CivilianAgent) => Promise<boolean>;

  constructor(
    checkFunction: (agent: CivilianAgent) => Promise<boolean>, // The yes/no question
    children: BehaviorNode[] = [] // What to do if the answer is YES
  ) {
    super();
    this.checkFunction = checkFunction; // Store the question
    this.children = children; // Store the "what to do if yes" actions
  }

  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    // 🔍 STEP 1: Ask the yes/no question
    // Example: checkFunction might be "isInDanger(agent)"
    const conditionMet = await this.checkFunction(agent);

    // 🔄 STEP 2: If YES and we have child actions, do them
    if (conditionMet && this.children.length > 0) {
      // Condition is true, so execute the child behavior
      // Example: if "isInDanger" is true, run "evacuateImmediately"
      return await this.children[0].execute(agent);
    }

    // 🎯 STEP 3: Return result based on whether condition was met
    // SUCCESS = condition was true, FAILURE = condition was false
    return conditionMet ? 'SUCCESS' : 'FAILURE';
  }
}

// Step 4: Implement Action (the "actually do something" node)
// 🎯 PURPOSE: "Perform a concrete action"
// REAL WORLD: "evacuateImmediately", "followCrowd", "helpOthers"
class Action extends BehaviorNode {
  // Store the function that performs the action
  private actionFunction: (agent: CivilianAgent) => Promise<void>;

  constructor(actionFunction: (agent: CivilianAgent) => Promise<void>) {
    super();
    this.actionFunction = actionFunction; // Store what to do
  }

  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    try {
      // 🚀 EXECUTE: Actually perform the action
      // Example: actionFunction might be "evacuateImmediately(agent)"
      // The agent parameter gives the action access to agent's state, position, etc.
      await this.actionFunction(agent);
      return 'SUCCESS'; // Action completed successfully
    } catch (error) {
      console.error('Action failed:', error);
      return 'FAILURE'; // Something went wrong
    }
  }
}
```

### Why We Use `this.normalBehavior(agent)` Instead of `agent.normalBehavior()`

**The Key Concept: Behavior Tree vs Agent Separation**

```typescript
// ❌ WRONG WAY - mixing behavior logic with agent state
class CivilianAgent {
  personality = { courage: 0.7 };

  // Don't put behavior logic directly in the agent
  evacuateImmediately() { /* evacuation logic */ }
  followCrowd() { /* crowd following logic */ }
  normalBehavior() { /* normal behavior logic */ }
}

// ✅ CORRECT WAY - behavior tree owns the decision logic
class CivilianBehaviorTree {
  // Behavior tree contains the "how to decide" logic
  normalBehavior(agent: CivilianAgent) {
    // Access agent state via parameter, but logic lives in behavior tree
    if (agent.personality.sociability > 0.6) {
      agent.moveTo("social_area");
    } else {
      agent.moveTo("quiet_area");
    }
  }

  // When we call this.normalBehavior(agent):
  // - 'this' = the behavior tree instance (contains decision logic)
  // - 'agent' = the agent instance (contains state/data)
}
```

**Why This Separation Matters:**
1. **Reusability**: Same behavior tree can work with different agent types
2. **Modularity**: Behavior logic separate from agent data
3. **Testing**: Can test behavior logic independently
4. **KADI Architecture**: Behavior trees are internal components, not KADI abilities

#### 3.2 Build Personality-Driven Trees
```typescript
// Type definitions for better TypeScript support
interface PersonalityTraits {
  courage: number;
  sociability: number;
  agility: number;
  helpfulness: number;
  panic_threshold: number;
  alertness: number;
}

interface VisionResult {
  hazards: Array<{
    id: string;
    type: string;
    distance: number;
    position: { lat: number; lon: number };
  }>;
  agents: Array<{
    id: string;
    type: string;
    distance: number;
    isMoving: boolean;
  }>;
}

class CivilianBehaviorTree {
  private personality: PersonalityTraits;
  private tree: BehaviorNode;

  constructor(personality: PersonalityTraits) {
    this.personality = personality;
    this.tree = this.buildTree();
  }

  // Main execution method - THIS IS WHERE THE AGENT IS PASSED IN
  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    // The agent parameter comes from the civilian agent calling this method
    return await this.tree.execute(agent);
  }

  private buildTree(): BehaviorNode {
    return new Selector([
      // Priority 1: Emergency Response
      new Condition(
        // The agent parameter flows down from execute() method above
        async (agent: CivilianAgent) => this.isInImmediateDanger(agent),
        [new Action(async (agent: CivilianAgent) => this.emergencyEvacuation(agent))]
      ),

      // Priority 2: Panic Response (personality-dependent)
      new Condition(
        async (agent: CivilianAgent) => this.shouldPanic(agent),
        [
          new Selector([
            // Brave people help when panicked
            new Condition(
              async (agent: CivilianAgent) => this.personality.courage > 0.7,
              [new Action(async (agent: CivilianAgent) => this.helpOthersEvacuate(agent))]
            ),
            // Others flee when panicked
            new Action(async (agent: CivilianAgent) => this.fleeInPanic(agent))
          ])
        ]
      ),

      // Priority 3: Social Response
      new Condition(
        async (agent: CivilianAgent) => this.seesOtherCivilians(agent),
        [
          new Selector([
            // Highly social people follow crowds
            new Condition(
              async (agent: CivilianAgent) => this.personality.sociability > 0.6,
              [new Action(async (agent: CivilianAgent) => this.followCrowd(agent))]
            ),
            // Less social people maintain distance
            new Action(async (agent: CivilianAgent) => this.maintainPersonalSpace(agent))
          ])
        ]
      ),

      // Default: Normal behavior
      new Action(async (agent: CivilianAgent) => this.normalBehavior(agent))
    ]);
  }

  // Condition check methods - these receive the agent from the behavior tree execution
  private async isInImmediateDanger(agent: CivilianAgent): Promise<boolean> {
    const vision = await agent.getVision();
    const dangerThreshold = 25 + (1 - this.personality.courage) * 25;
    return vision.hazards.some(h => h.type === 'fire' && h.distance < dangerThreshold);
  }

  private async shouldPanic(agent: CivilianAgent): Promise<boolean> {
    const stressLevel = agent.calculateStressLevel();
    return stressLevel > this.personality.panic_threshold;
  }

  private async seesOtherCivilians(agent: CivilianAgent): Promise<boolean> {
    const vision = await agent.getVision();
    return vision.agents.filter(a => a.type === 'civilian').length > 0;
  }

  // Action methods - these also receive the agent parameter
  private async emergencyEvacuation(agent: CivilianAgent): Promise<void> {
    console.log(`${agent.agentId}: EMERGENCY EVACUATION!`);
    // Use agent to call world simulator for movement
    await agent.moveTo({ lat: 32.7767, lon: -96.7970 }, 'emergency');
  }

  private async helpOthersEvacuate(agent: CivilianAgent): Promise<void> {
    console.log(`${agent.agentId}: Helping others evacuate (brave personality)`);
    // Agent-specific logic for helping others
  }

  private async fleeInPanic(agent: CivilianAgent): Promise<void> {
    console.log(`${agent.agentId}: Fleeing in panic!`);
    await agent.moveTo({ lat: 32.7767, lon: -96.7970 }, 'panic');
  }

  private async followCrowd(agent: CivilianAgent): Promise<void> {
    console.log(`${agent.agentId}: Following crowd (social personality)`);
    // Logic to follow nearby civilians
  }

  private async maintainPersonalSpace(agent: CivilianAgent): Promise<void> {
    console.log(`${agent.agentId}: Maintaining personal space`);
    // Logic to avoid crowds
  }

  private async normalBehavior(agent: CivilianAgent): Promise<void> {
    console.log(`${agent.agentId}: Normal behavior - staying alert`);
    // Default behavior
  }
}
```

### Phase 4: Advanced Features (Days 7-8)

#### 4.1 Memory System
```typescript
class AgentMemory {
  constructor() {
    this.recentEvents = []; // Last 30 seconds of observations
    this.knownHazards = new Map(); // Fires I've seen
    this.trustedResponders = []; // Responders I've met
    this.socialConnections = []; // Civilians I'm following
  }

  rememberEvent(event) {
    this.recentEvents.push({
      ...event,
      timestamp: Date.now()
    });

    // Keep only last 30 seconds
    const cutoff = Date.now() - 30000;
    this.recentEvents = this.recentEvents.filter(e => e.timestamp > cutoff);
  }

  hasSeenHazard(hazardId) {
    return this.knownHazards.has(hazardId);
  }
}
```

#### 4.2 Emotional State System
```typescript
class EmotionalState {
  constructor() {
    this.fear = 0.0;      // 0.0 to 1.0
    this.stress = 0.0;    // 0.0 to 1.0
    this.confidence = 0.5; // 0.0 to 1.0
    this.fatigue = 0.0;   // 0.0 to 1.0
  }

  updateEmotion(type, delta, maxValue = 1.0) {
    this[type] = Math.max(0, Math.min(maxValue, this[type] + delta));
  }

  // Emotions affect decision making
  getEffectivePersonality(basePersonality) {
    return {
      ...basePersonality,
      courage: basePersonality.courage * (1 - this.fear * 0.5),
      agility: basePersonality.agility * (1 - this.fatigue * 0.3)
    };
  }
}
```

### Phase 5: Social Behaviors (Days 9-10)

#### 5.1 Crowd Following Behavior
```typescript
// CONCEPTUAL SNIPPET - shows the idea for crowd following logic
async function followCrowd(agent) {
  const vision = await agent.getVision();
  const nearbyCivilians = vision.agents.filter(a =>
    a.type === 'civilian' && a.distance < agent.personality.follow_distance
  );

  if (nearbyCivilians.length >= 2) {
    // Calculate crowd center
    const crowdCenter = calculateCrowdCenter(nearbyCivilians);

    // Move toward crowd center but maintain some personal space
    const personalSpace = 3 + (1 - agent.personality.sociability) * 5; // 3-8 meters
    const targetPosition = calculateTargetNearCrowd(crowdCenter, personalSpace);

    await agent.moveToward(targetPosition);
  }
}
```

### Phase 6: Testing & Refinement (Days 11-12)

#### 6.1 Scenario Testing
Create specific test scenarios:

1. **Fire Spreads Through Building**
   - Spawn 50 civilians in building
   - Start fire at one end
   - Verify different archetypes behave distinctly

2. **Multiple Exit Points**
   - Test pathfinding preferences
   - Verify crowd dynamics at bottlenecks

3. **Responder Interaction**
   - Add firefighter agents
   - Test civilian trust/following behavior

#### 6.2 Behavior Validation Metrics
```typescript
const behaviorMetrics = {
  // Archetype validation
  heroHelped: 0,        // How many times heroes helped others
  cowardsFleed: 0,      // How many times cowards fled immediately
  followersGrouped: 0,  // How many times followers joined crowds

  // Emergence validation
  crowdFormation: [],   // Locations where crowds naturally formed
  evacTimeByType: {},   // Evacuation times by personality type
  survivalRate: 0.95    // Target: 95% of civilians reach safety
};
```

### Phase 7: Performance Optimization (Days 13-14)

**Why We Need These Optimizations:**

When you're running 500+ civilian agents for your hackathon demo, performance becomes critical. Each agent runs behavior trees every 100-500ms, and with hundreds of agents making decisions simultaneously, you'll hit bottlenecks without optimization.

#### 7.1 Behavior Tree Caching - Used by: **Civilian Agents**

**Problem**: Each civilian agent recalculates behavior tree decisions every tick, even when nothing has changed.
**Solution**: Cache decisions for short periods when world state is stable.
**When You Need This**: 200+ agents start showing noticeable lag.

```typescript
// COMPLETE WORKING EXAMPLE - Add this to your CivilianAgent class
class BehaviorCache {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 500; // 500ms cache lifetime
  }

  getCachedDecision(agentId, worldState) {
    const key = `${agentId}_${worldState.hash}`;
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.decision;
    }

    return null;
  }

  setCachedDecision(agentId, worldState, decision) {
    const key = `${agentId}_${worldState.hash}`;
    this.cache.set(key, {
      decision,
      timestamp: Date.now()
    });
  }
}

// HOW CIVILIAN AGENTS USE THIS:
class CivilianAgent {
  constructor() {
    this.behaviorCache = new BehaviorCache(); // Add cache to each agent
  }

  async onWorldTick() {
    const worldState = await this.getVision();

    // Check cache first before running expensive behavior tree
    const cachedDecision = this.behaviorCache.getCachedDecision(this.agentId, worldState);
    if (cachedDecision) {
      return cachedDecision; // Skip behavior tree calculation
    }

    // Only run behavior tree if no cache hit
    const decision = await this.behaviorTree.execute(this);
    this.behaviorCache.setCachedDecision(this.agentId, worldState, decision);
    return decision;
  }
}
```

**Performance Impact**: Reduces CPU usage by 40-60% when agents are in stable situations.

#### 7.2 Efficient Vision Queries - Used by: **World Simulator Agent**

**Problem**: Each `world.whatDoISee()` call searches through ALL agents to find nearby ones. With 500 agents, that's 250,000 distance calculations per second.
**Solution**: Spatial partitioning divides the world into grid cells, only checking relevant areas.
**When You Need This**: 100+ agents start showing vision query lag.

```typescript
// COMPLETE WORKING EXAMPLE - Add this to your World Simulator Agent
class SpatialGrid {
  constructor(cellSize = 50) {
    this.cellSize = cellSize; // 50-meter grid cells
    this.grid = new Map(); // Map of "x,y" -> [agents in that cell]
  }

  // Called by World Simulator when agents move
  updateAgentPosition(agent, oldPosition, newPosition) {
    if (oldPosition) {
      this.removeFromCell(agent, oldPosition);
    }
    this.addToCell(agent, newPosition);
  }

  // Used by world.whatDoISee() instead of checking all agents
  getNearbyAgents(position, radius) {
    // Only check relevant grid cells (huge performance win)
    const relevantCells = this.getRelevantCells(position, radius);
    const nearbyAgents = [];

    for (const cell of relevantCells) {
      nearbyAgents.push(...this.getAgentsInCell(cell));
    }

    // Final distance check only on candidates from relevant cells
    return nearbyAgents.filter(agent =>
      calculateDistance(position, agent.position) <= radius
    );
  }

  private addToCell(agent, position) {
    const cellKey = this.getCellKey(position);
    if (!this.grid.has(cellKey)) {
      this.grid.set(cellKey, []);
    }
    this.grid.get(cellKey).push(agent);
  }

  private getCellKey(position) {
    const cellX = Math.floor(position.x / this.cellSize);
    const cellY = Math.floor(position.y / this.cellSize);
    return `${cellX},${cellY}`;
  }
}

// HOW WORLD SIMULATOR USES THIS:
class WorldSimulatorAgent {
  constructor() {
    this.spatialGrid = new SpatialGrid(50); // 50m grid cells
    this.allAgents = new Map(); // agentId -> agent data
  }

  // KADI tool called by civilian agents
  async whatDoISee(agentId, visionRadius = 100) {
    const agent = this.allAgents.get(agentId);

    // OLD WAY (slow): Check distance to every single agent
    // const nearby = Array.from(this.allAgents.values()).filter(other =>
    //   calculateDistance(agent.position, other.position) <= visionRadius
    // );

    // NEW WAY (fast): Only check agents in nearby grid cells
    const nearby = this.spatialGrid.getNearbyAgents(agent.position, visionRadius);

    return {
      agents: nearby,
      fires: this.getFiresInRadius(agent.position, visionRadius),
      exits: this.getExitsInRadius(agent.position, visionRadius)
    };
  }

  // Called when agents move via world.moveMe()
  async moveMe(agentId, newPosition) {
    const agent = this.allAgents.get(agentId);
    const oldPosition = agent.position;

    agent.position = newPosition;

    // Update spatial grid for efficient vision queries
    this.spatialGrid.updateAgentPosition(agent, oldPosition, newPosition);
  }
}
```

**Performance Impact**: Vision queries go from O(n²) to O(k) where k = agents in nearby cells. 10x-100x faster with 500+ agents.

#### 7.3 When to Apply These Optimizations

```typescript
// PERFORMANCE MONITORING - Add to your dashboard
class PerformanceMonitor {
  measureBehaviorTreeTime() {
    // If average > 10ms per agent, enable behavior caching
  }

  measureVisionQueryTime() {
    // If average > 5ms per query, enable spatial partitioning
  }

  measureOverallTick() {
    // If tick time > 100ms, you need both optimizations
  }
}
```

**Optimization Timeline for Hackathon:**
- **50 agents**: No optimizations needed
- **100 agents**: Add spatial partitioning to World Simulator
- **200 agents**: Add behavior caching to Civilian Agents
- **500+ agents**: Both optimizations required

---

## Code Examples

## How the Agent Parameter Flows Through the System

Here's the complete flow showing where the `agent` parameter comes from:

```typescript
// 1. CIVILIAN AGENT TICK - This is where it all starts
class CivilianAgent {
  async onWorldTick(): Promise<void> {
    // THE AGENT PASSES ITSELF (this) TO THE BEHAVIOR TREE
    await this.behaviorTree.execute(this); // <-- "this" becomes the "agent" parameter
  }
}

// 2. BEHAVIOR TREE EXECUTION - Receives the agent and passes it down
class CivilianBehaviorTree {
  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    // Agent parameter received from civilian agent above
    return await this.tree.execute(agent); // <-- Passes agent to root node
  }
}

// 3. SELECTOR NODE - Passes agent to each child
class Selector extends BehaviorNode {
  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    for (const child of this.children) {
      const result = await child.execute(agent); // <-- Agent flows to each child
      if (result === 'SUCCESS') return 'SUCCESS';
    }
    return 'FAILURE';
  }
}

// 4. CONDITION NODE - Uses agent to check conditions
class Condition extends BehaviorNode {
  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    // Agent is passed to the condition function
    const conditionMet = await this.checkFunction(agent); // <-- Agent used here

    if (conditionMet && this.children.length > 0) {
      return await this.children[0].execute(agent); // <-- Agent flows to actions
    }
    return conditionMet ? 'SUCCESS' : 'FAILURE';
  }
}

// 5. ACTION NODE - Uses agent to perform actions
class Action extends BehaviorNode {
  async execute(agent: CivilianAgent): Promise<BehaviorResult> {
    // Agent is passed to the action function
    await this.actionFunction(agent); // <-- Agent used to perform actions
    return 'SUCCESS';
  }
}
```

**Summary**: The agent starts as `this` in the civilian agent's `onWorldTick()` method and flows down through every node in the behavior tree, allowing each condition and action to access the agent's state and methods.

### Complete Civilian Agent Implementation

```typescript
#!/usr/bin/env node
import { KadiClient } from '@kadi.build/core';

// Import our behavior system
import { CivilianBehaviorTree } from './behavior-tree.js';
import { generatePersonality, CIVILIAN_ARCHETYPES } from './personality.js';
import { AgentMemory } from './memory.js';
import { EmotionalState } from './emotions.js';

const brokerUrl = process.env.KADI_BROKER_URL || 'ws://localhost:8080';

class CivilianAgent {
  constructor(agentId, archetype = null) {
    this.agentId = agentId;

    // Initialize KADI client
    this.client = new KadiClient({
      name: agentId,
      role: 'agent',
      transport: 'broker',
      brokers: { local: brokerUrl },
      defaultBroker: 'local',
      networks: ['global']
    });

    // Generate personality
    this.personality = archetype ?
      { ...CIVILIAN_ARCHETYPES[archetype] } :
      generatePersonality();

    // Initialize behavior systems
    this.behaviorTree = new CivilianBehaviorTree(this.personality);
    this.memory = new AgentMemory();
    this.emotions = new EmotionalState();

    // Agent state
    this.isMoving = false;
    this.currentGoal = 'normal';

    console.log(`🧑 ${agentId} spawned with ${archetype || 'random'} personality:`, {
      courage: this.personality.courage.toFixed(2),
      sociability: this.personality.sociability.toFixed(2),
      agility: this.personality.agility.toFixed(2)
    });
  }

  async start() {
    await this.client.connectToBrokers();

    // Listen for world events
    await this.client.subscribeToEvent('world.tick', () => this.onWorldTick());
    await this.client.subscribeToEvent('agent.position.updated', (event) => {
      if (event.agentId === this.agentId) {
        this.onPositionUpdate(event);
      }
    });

    console.log(`✅ ${this.agentId} connected and ready`);
  }

  async onWorldTick() {
    try {
      // Execute behavior tree to make decision
      await this.behaviorTree.execute(this);

      // Update emotional state over time
      this.updateEmotions();

    } catch (error) {
      console.error(`❌ ${this.agentId} decision error:`, error);
    }
  }

  onPositionUpdate(event) {
    console.log(`📍 ${this.agentId} moved to ${event.lat.toFixed(4)}, ${event.lon.toFixed(4)}`);
    this.isMoving = event.moving;
  }

  // Vision wrapper (delegates to world simulator)
  async getVision() {
    const visionRange = 30 + (this.personality.alertness * 40);
    return await this.client.call('world.whatDoISee', {
      agentId: this.agentId,
      visionRange
    });
  }

  // Movement wrapper (delegates to world simulator)
  async moveTo(destination, urgency = 'normal') {
    const result = await this.client.call('world.moveMe', {
      agentId: this.agentId,
      destination,
      profile: 'walking',
      urgency
    });

    if (result.success) {
      this.isMoving = true;
    }

    return result;
  }

  // Emotional state management
  updateEmotions() {
    // Gradually reduce stress and fear over time
    this.emotions.updateEmotion('stress', -0.01);
    this.emotions.updateEmotion('fear', -0.02);

    // Increase fatigue when moving
    if (this.isMoving) {
      this.emotions.updateEmotion('fatigue', 0.005);
    } else {
      this.emotions.updateEmotion('fatigue', -0.01);
    }
  }

  // Stress calculation for behavior tree
  calculateStressLevel() {
    return (this.emotions.fear + this.emotions.stress + this.emotions.fatigue) / 3;
  }

  // Personality modified by current emotional state
  getEffectivePersonality() {
    return this.emotions.getEffectivePersonality(this.personality);
  }
}

// Usage example
async function main() {
  // Create civilians with different archetypes
  const hero = new CivilianAgent('civilian-hero-001', 'hero');
  const coward = new CivilianAgent('civilian-coward-001', 'coward');
  const follower = new CivilianAgent('civilian-follower-001', 'follower');
  const randomCivilian = new CivilianAgent('civilian-random-001');

  // Start all agents
  await Promise.all([
    hero.start(),
    coward.start(),
    follower.start(),
    randomCivilian.start()
  ]);

  console.log('🎭 All civilian agents started with diverse personalities!');
}

main().catch(console.error);
```

---

## Success Metrics

### Behavioral Diversity Validation

1. **Visual Clustering**: Agents with high sociability should cluster together
2. **Evacuation Patterns**: Different archetypes should take different routes
3. **Response Times**: Cowards flee immediately, heroes help first
4. **Group Formation**: Natural crowd formation without explicit programming

### Performance Targets

- **50+ agents** running simultaneously
- **Decision latency** < 100ms per agent
- **Realistic movement** following Dallas street network
- **95% survival rate** in standard fire scenario

This system creates civilians that feel like real people with distinct personalities, all while maintaining KADI's clean architecture of reusable abilities and stateful agents.