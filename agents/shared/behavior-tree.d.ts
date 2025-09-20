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
    moveTo(destination: {
        lat: number;
        lon: number;
    }, urgency?: string): Promise<MovementResult>;
}
/**
 * Generic vision result - what any agent can see
 */
export interface VisionResult {
    hazards: Array<{
        id: string;
        type: string;
        distance: number;
        position: {
            lat: number;
            lon: number;
        };
        intensity: number;
        radius: number;
    }>;
    agents: Array<{
        id: string;
        type: string;
        distance: number;
        position: {
            lat: number;
            lon: number;
        };
        isMoving: boolean;
        status: string;
    }>;
    exits: Array<{
        id: string;
        type: string;
        distance: number;
        position: {
            lat: number;
            lon: number;
        };
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
export declare abstract class BehaviorNode {
    protected children: BehaviorNode[];
    abstract execute(agent: Agent): Promise<BehaviorResult>;
}
/**
 * Selector - tries children in order until one succeeds
 * Think: "Try these options in priority order until one works"
 */
export declare class Selector extends BehaviorNode {
    constructor(children: BehaviorNode[]);
    execute(agent: Agent): Promise<BehaviorResult>;
}
/**
 * Sequence - all children must succeed in order
 * Think: "Do all of these things in sequence, stop if any fails"
 */
export declare class Sequence extends BehaviorNode {
    constructor(children: BehaviorNode[]);
    execute(agent: Agent): Promise<BehaviorResult>;
}
/**
 * Condition - checks if something is true, then optionally executes children
 * Think: "Ask a yes/no question, then maybe do something if yes"
 */
export declare class Condition extends BehaviorNode {
    private checkFunction;
    constructor(checkFunction: (agent: Agent) => Promise<boolean>, children?: BehaviorNode[]);
    execute(agent: Agent): Promise<BehaviorResult>;
}
/**
 * Action - performs a concrete behavior
 * Think: "Actually do something specific"
 */
export declare class Action extends BehaviorNode {
    private actionFunction;
    constructor(actionFunction: (agent: Agent) => Promise<void>);
    execute(agent: Agent): Promise<BehaviorResult>;
}
/**
 * Inverter - inverts the result of its child
 * Think: "Do the opposite of what the child says"
 */
export declare class Inverter extends BehaviorNode {
    constructor(child: BehaviorNode);
    execute(agent: Agent): Promise<BehaviorResult>;
}
/**
 * Abstract base class for agent-specific behavior trees
 * Each agent type should extend this class
 */
export declare abstract class AgentBehaviorTree {
    protected tree: BehaviorNode;
    constructor();
    /**
     * Execute the behavior tree for this agent
     */
    execute(agent: Agent): Promise<BehaviorResult>;
    /**
     * Abstract method - each agent type must implement their own tree structure
     */
    protected abstract buildTree(): BehaviorNode;
}
