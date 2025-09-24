
# KADI FirstNet Project

## Overview
KADI FirstNet is an agent-based simulation platform for modeling emergency response scenarios. It features autonomous agents (civilians, firefighters, commanders) operating in a dynamic world, using behavior trees and AI logic to simulate realistic decision-making and interactions. The project aims to support research, training, and development in emergency management, agent-based modeling, and crisis response strategies.

---

## Project Structure

```
agents/           # Core agent logic and simulation engine
  civilian/       # Civilian agent logic, behavior trees, and tests
  firefighter/    # Firefighter agent logic and behaviors
  commander/      # Commander agent logic and coordination
  shared/         # Shared behavior tree code and event definitions
  world-simulator/# Main simulation engine and world state
frontend/         # Next.js frontend for visualization and control
docs/             # Documentation and design notes
extra-agents/     # Experimental or alternative agent implementations
```

### Folder Details
- **agents/**: Contains all core logic for agent types and the simulation world. Each agent type (civilian, firefighter, commander) is modularized with its own code, dependencies, and configuration. The `shared/` folder provides reusable behavior tree logic and event definitions. The `world-simulator/` runs the main simulation loop, manages agent states, and handles world events.
- **frontend/**: A modern React/Next.js web application for visualizing the simulation, controlling parameters, and interacting with agents. Includes UI components, map visualizations, and dashboards.
- **docs/**: Contains detailed documentation, including the civilian agent behavior system and design notes.
- **extra-agents/**: Houses experimental, test, or alternative agent implementations for rapid prototyping or research.

---

## Agent Types & Simulation Flow

### Civilian Agents
- Simulate non-expert individuals in emergency scenarios.
- Behaviors include evacuation, panic, seeking help, and following instructions.
- Driven by personality traits and behavior trees (see `docs/KADI-Civilian-Agent-Behavior-System.md`).

### Firefighter Agents
- Represent professional responders.
- Behaviors include fire suppression, rescue, and coordination with commanders.
- Use behavior trees and event-driven logic.

### Commander Agents
- Oversee and coordinate firefighter teams.
- Make strategic decisions, allocate resources, and communicate with other agents.

### World Simulator
- Manages the environment, events (e.g., fire spread), and agent interactions.
- Provides APIs for agent communication and state updates.

---

## Requirements

- **Node.js** (v18 or higher recommended)
- **npm** or **yarn** for package management
- **TypeScript** (for development)
- **Next.js** (for the frontend)
- **Modern browser** (for frontend visualization)

Each agent submodule and the world simulator has its own `package.json`. Install dependencies in each subfolder:

```sh
cd agents/civilian && npm install
cd agents/firefighter && npm install
cd agents/commander && npm install
cd agents/world-simulator && npm install
cd frontend && npm install
```

---

## Running the Project

1. **Install all dependencies** as described above.
2. **Start the world simulator**:
   ```sh
   cd agents/world-simulator
   npm start
   ```
   (See `agents/world-simulator/README.md` for more details and options.)
3. **Start the frontend**:
   ```sh
   cd frontend
   npm run dev
   ```
4. Open your browser and go to [http://localhost:3000](http://localhost:3000) to view and interact with the simulation.

---

## Goals and Vision

- **Simulate realistic emergency scenarios** with autonomous, AI-driven agents.
- **Model complex agent behaviors** using modular behavior trees and event-driven logic.
- **Support research and training** in emergency response, agent-based modeling, and crisis management.
- **Enable visualization and interaction** with the simulation through a modern, extensible web frontend.
- **Facilitate rapid prototyping** of new agent types, behaviors, and world events.

---

## Documentation

- See `docs/KADI-Civilian-Agent-Behavior-System.md` for a deep dive into the civilian agent behavior system.
- Each agent and simulator module may have additional documentation in their respective folders.
- The frontend includes a `README.md` for UI and development notes.

---

## License

This project is provided for research and educational purposes. See individual files or folders for license details if present.
