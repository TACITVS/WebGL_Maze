# Nexus Maze

Nexus Maze is a WebGL powered maze runner built with Three.js and Tone.js. The
project demonstrates a modular architecture with an entity component system
(ECS), a finite state machine for enemy AI and a rich reactive UI.

## Development quick start

```bash
# Start a static file server (for example with Python)
python -m http.server 8000
# Then open http://localhost:8000/ in your browser
```

## Project structure

```
.
├── index.html          # Bootstraps the UI shell and loads the module entrypoint
├── styles/             # Global styling resources
├── src/
│   ├── audio/          # Tone.js integration and sound design
│   ├── core/           # ECS and event emitter utilities
│   ├── fsm/            # Enemy AI state machine definitions
│   ├── game/           # Main NexusMazeGame class and gameplay systems
│   ├── state/          # Game state managers
│   ├── ui/             # UI orchestration helpers
│   └── main.js         # Application entrypoint
└── README.md
```

## Key technologies

- **Three.js** for rendering the maze, particles and effects.
- **Tone.js** for reactive audio and ambient soundscapes.
- **Entity Component System** enabling data-oriented gameplay logic.
- **Finite State Machines** powering enemy behaviour transitions.

## Controls

- **Move:** WASD or arrow keys
- **Boost:** Hold Shift
- **Phase Dash:** Spacebar
- **Toggle Camera:** C
- **New Maze:** R
- **Toggle Sound:** M or click the speaker button

## Browser support

The game targets modern browsers with ES module and WebGL support. For the best
experience ensure hardware acceleration is enabled.
