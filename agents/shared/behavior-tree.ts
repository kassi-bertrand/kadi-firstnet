/**
 * Generic Behavior Tree Framework
 *
 * Reusable behavior tree system for all agent types (civilian, firefighter, police, EMS, etc.)
 * Each agent type will implement their own specific behavior tree using these building blocks.
 */

export type BehaviorResult = 'SUCCESS' | 'FAILURE' | 'RUNNING';

/**
 * Generic agent interface - all agents must implement these methods
 */
export interface Agent {
  agentId: string;
  getVision(): Promise<VisionResult>;
  moveTo(destination: { lat: number; lon: number }, urgency?: string): Promise<MovementResult>;
}

/**
 * Generic vision result - what any agent can see
 */
export interface VisionResult {
  hazards: Array<{
    id: string;
    type: string;
    distance: number;
    position: { lat: number; lon: number };
    intensity: number;
    radius: number;
  }>;
  agents: Array<{
    id: string;
    type: string;
    distance: number;
    position: { lat: number; lon: number };
    isMoving: boolean;
    status: string;
  }>;
  exits: Array<{
    id: string;
    type: string;
    distance: number;
    position: { lat: number; lon: number };
    name?: string;
  }>;
}

/**
 * Generic movement result
 */
export interface MovementResult {
  success: boolean;
  estimatedArrival?: number;
  estimatedDuration?: number;
  error?: string;
}

/**
 * Base class for all behavior tree nodes
 */
export abstract class BehaviorNode {
  protected children: BehaviorNode[] = [];

  abstract execute(agent: Agent): Promise<BehaviorResult>;
}

/**
 * Selector - tries children in order until one succeeds
 * Think: "Try these options in priority order until one works"
 */
export class Selector extends BehaviorNode {
  constructor(children: BehaviorNode[]) {
    super();
    this.children = children;
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    for (const child of this.children) {
      const result = await child.execute(agent);

      if (result === 'SUCCESS') {
        return 'SUCCESS'; // Found one that worked, we're done!
      }
      // If FAILURE, continue to next option (keep trying)
    }
    return 'FAILURE'; // All options failed
  }
}

/**
 * Sequence - all children must succeed in order
 * Think: "Do all of these things in sequence, stop if any fails"
 */
export class Sequence extends BehaviorNode {
  constructor(children: BehaviorNode[]) {
    super();
    this.children = children;
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    for (const child of this.children) {
      const result = await child.execute(agent);

      if (result !== 'SUCCESS') {
        return result; // Stop if any child fails or is running
      }
    }
    return 'SUCCESS'; // All children succeeded
  }
}

/**
 * Condition - checks if something is true, then optionally executes children
 * Think: "Ask a yes/no question, then maybe do something if yes"
 */
export class Condition extends BehaviorNode {
  private checkFunction: (agent: Agent) => Promise<boolean>;

  constructor(
    checkFunction: (agent: Agent) => Promise<boolean>,
    children: BehaviorNode[] = []
  ) {
    super();
    this.checkFunction = checkFunction;
    this.children = children;
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    // Ask the yes/no question
    const conditionMet = await this.checkFunction(agent);

    // If YES and we have child actions, do them
    if (conditionMet && this.children.length > 0) {
      return await this.children[0].execute(agent);
    }

    // Return result based on whether condition was met
    return conditionMet ? 'SUCCESS' : 'FAILURE';
  }
}

/**
 * Action - performs a concrete behavior
 * Think: "Actually do something specific"
 */
export class Action extends BehaviorNode {
  private actionFunction: (agent: Agent) => Promise<void>;

  constructor(actionFunction: (agent: Agent) => Promise<void>) {
    super();
    this.actionFunction = actionFunction;
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    try {
      await this.actionFunction(agent);
      return 'SUCCESS';
    } catch (error) {
      console.error('Action failed:', error);
      return 'FAILURE';
    }
  }
}

/**
 * Inverter - inverts the result of its child
 * Think: "Do the opposite of what the child says"
 */
export class Inverter extends BehaviorNode {
  constructor(child: BehaviorNode) {
    super();
    this.children = [child];
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    const result = await this.children[0].execute(agent);

    if (result === 'SUCCESS') return 'FAILURE';
    if (result === 'FAILURE') return 'SUCCESS';
    return result; // RUNNING stays RUNNING
  }
}

/**
 * Abstract base class for agent-specific behavior trees
 * Each agent type should extend this class
 */
export abstract class AgentBehaviorTree {
  protected tree: BehaviorNode;

  constructor() {
    this.tree = this.buildTree();
  }

  /**
   * Execute the behavior tree for this agent
   */
  async execute(agent: Agent): Promise<BehaviorResult> {
    return await this.tree.execute(agent);
  }

  /**
   * Abstract method - each agent type must implement their own tree structure
   */
  protected abstract buildTree(): BehaviorNode;
}