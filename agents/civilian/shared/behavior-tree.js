/**
 * Generic Behavior Tree Framework
 *
 * Reusable behavior tree system for all agent types (civilian, firefighter, police, EMS, etc.)
 * Each agent type will implement their own specific behavior tree using these building blocks.
 */
/**
 * Base class for all behavior tree nodes
 */
export class BehaviorNode {
    children = [];
}
/**
 * Selector - tries children in order until one succeeds
 * Think: "Try these options in priority order until one works"
 */
export class Selector extends BehaviorNode {
    constructor(children) {
        super();
        this.children = children;
    }
    async execute(agent) {
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
    constructor(children) {
        super();
        this.children = children;
    }
    async execute(agent) {
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
    checkFunction;
    constructor(checkFunction, children = []) {
        super();
        this.checkFunction = checkFunction;
        this.children = children;
    }
    async execute(agent) {
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
    actionFunction;
    constructor(actionFunction) {
        super();
        this.actionFunction = actionFunction;
    }
    async execute(agent) {
        try {
            await this.actionFunction(agent);
            return 'SUCCESS';
        }
        catch (error) {
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
    constructor(child) {
        super();
        this.children = [child];
    }
    async execute(agent) {
        const result = await this.children[0].execute(agent);
        if (result === 'SUCCESS')
            return 'FAILURE';
        if (result === 'FAILURE')
            return 'SUCCESS';
        return result; // RUNNING stays RUNNING
    }
}
/**
 * Abstract base class for agent-specific behavior trees
 * Each agent type should extend this class
 */
export class AgentBehaviorTree {
    tree;
    constructor() {
        this.tree = this.buildTree();
    }
    /**
     * Execute the behavior tree for this agent
     */
    async execute(agent) {
        return await this.tree.execute(agent);
    }
}
