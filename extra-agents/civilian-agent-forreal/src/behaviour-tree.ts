/**
 * Behavior Tree Framework
 * 
 * Generic behavior tree implementation that can be used by any agent type.
 * Provides the core building blocks for decision-making logic through
 * composable nodes that can succeed, fail, or continue running.
 */

// Result types for behavior tree node execution
export type BehaviorResult = 'SUCCESS' | 'FAILURE' | 'RUNNING';

// Generic agent interface that behavior trees can operate on
export interface Agent {
  agentId: string;
  [key: string]: any; // Allow any additional properties
}

/**
 * Abstract base class for all behavior tree nodes
 * Every node must implement the execute method
 */
export abstract class BehaviorNode {
  protected children: BehaviorNode[] = [];

  // Every node must define how it executes with an agent
  abstract execute(agent: Agent): Promise<BehaviorResult>;

  // Helper method to add child nodes
  addChild(child: BehaviorNode): void {
    this.children.push(child);
  }
}

/**
 * Selector Node - "Try each child until one succeeds"
 * 
 * Executes children in order, returning SUCCESS as soon as one child
 * succeeds. If all children fail, returns FAILURE.
 * 
 * Use case: Priority lists (try emergency response, then social response, etc.)
 */
export class Selector extends BehaviorNode {
  constructor(children: BehaviorNode[] = []) {
    super();
    this.children = children;
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    // Try each child in order
    for (const child of this.children) {
      const result = await child.execute(agent);
      
      if (result === 'SUCCESS') {
        return 'SUCCESS'; // Found one that worked!
      }
      
      if (result === 'RUNNING') {
        return 'RUNNING'; // Child is still processing
      }
      
      // If FAILURE, continue to next child
    }
    
    return 'FAILURE'; // All children failed
  }
}

/**
 * Sequence Node - "Do all children in order, stop if any fails"
 * 
 * Executes children in order, returning FAILURE as soon as one child
 * fails. If all children succeed, returns SUCCESS.
 * 
 * Use case: Multi-step actions (check safety, then move, then notify others)
 */
export class Sequence extends BehaviorNode {
  constructor(children: BehaviorNode[] = []) {
    super();
    this.children = children;
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    // Execute each child in order
    for (const child of this.children) {
      const result = await child.execute(agent);
      
      if (result === 'FAILURE') {
        return 'FAILURE'; // One failed, whole sequence fails
      }
      
      if (result === 'RUNNING') {
        return 'RUNNING'; // Still working on this step
      }
      
      // If SUCCESS, continue to next child
    }
    
    return 'SUCCESS'; // All children succeeded
  }
}

/**
 * Condition Node - "Check if something is true, then optionally do actions"
 * 
 * Evaluates a condition function. If true and has children, executes them.
 * Returns SUCCESS if condition is true, FAILURE if false.
 * 
 * Use case: "If in danger, then evacuate" or "If sees crowd, then follow"
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
    // Evaluate the condition
    const conditionMet = await this.checkFunction(agent);
    
    if (conditionMet) {
      // Condition is true
      if (this.children.length > 0) {
        // Execute child action(s)
        return await this.children[0].execute(agent);
      } else {
        // No children, just return success
        return 'SUCCESS';
      }
    } else {
      // Condition is false
      return 'FAILURE';
    }
  }
}

/**
 * Action Node - "Perform a specific action"
 * 
 * Executes a concrete action function. Actions are the "leaves" of the
 * behavior tree that actually do something in the world.
 * 
 * Use case: "Move to exit", "Call for help", "Follow crowd"
 */
export class Action extends BehaviorNode {
  private actionFunction: (agent: Agent) => Promise<void>;
  private actionName: string;

  constructor(
    actionName: string,
    actionFunction: (agent: Agent) => Promise<void>
  ) {
    super();
    this.actionName = actionName;
    this.actionFunction = actionFunction;
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    try {
      // Execute the action
      await this.actionFunction(agent);
      return 'SUCCESS';
    } catch (error) {
      console.error(`❌ Action '${this.actionName}' failed for ${agent.agentId}:`, error);
      return 'FAILURE';
    }
  }
}

/**
 * Inverter Node - "Flip the result"
 * 
 * Inverts the result of its child node. SUCCESS becomes FAILURE,
 * FAILURE becomes SUCCESS. RUNNING stays RUNNING.
 * 
 * Use case: "If NOT in danger, then do normal behavior"
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
 * Always Succeed Node - "Never fail"
 * 
 * Always returns SUCCESS regardless of child result.
 * Useful for actions that should never block the behavior tree.
 * 
 * Use case: Optional actions like "try to help others" that shouldn't
 * prevent fallback behaviors if they fail.
 */
export class AlwaysSucceed extends BehaviorNode {
  constructor(child: BehaviorNode) {
    super();
    this.children = [child];
  }

  async execute(agent: Agent): Promise<BehaviorResult> {
    await this.children[0].execute(agent);
    return 'SUCCESS'; // Always succeed
  }
}
