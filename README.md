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
├── index.html          # Nexus Maze: bootstraps the UI shell and loads the entrypoint
├── dungeon.html        # Nexus Depths: the procedural 3D dungeon generator
├── styles/             # Global styling resources
├── src/
│   ├── audio/          # Tone.js integration and sound design
│   ├── core/           # ECS and event emitter utilities
│   ├── dungeon/        # Procedural 3D dungeon generator (standalone, no Three.js)
│   ├── fsm/            # Enemy AI state machine definitions
│   ├── game/           # Main NexusMazeGame class and gameplay systems
│   ├── state/          # Game state managers
│   ├── ui/             # UI orchestration helpers
│   └── main.js         # Application entrypoint
├── docs/
│   ├── ARCHITECTURE.md         # Nexus Maze reference
│   └── DUNGEON_GENERATION.md   # How the dungeon generator works
└── README.md
```

## Nexus Depths — procedural 3D dungeon generator

Open `http://localhost:8000/dungeon.html` for the second prototype in this
repository: a seeded roguelike dungeon generator you can walk around in.

Each floor is a tile map built by BSP partitioning, with rooms of varied size and
shape, corridors from a minimum spanning tree plus extra links for loops, and
negative space between them. Floors are stitched together by **switchback stair
towers** placed wherever rooms on adjacent floors overlap — real staircases you
walk down, not teleports. Rooms are typed from their place in the graph
(entrance, vaults, crypts, a boss chamber at the deepest point), furnished
accordingly, and lit by torches. Locked doors are placed only on bridges of the
room graph, with their keys hidden in the region still reachable without them,
so every dungeon is solvable.

The panel on the right runs the invariants. They flood-fill the compiled world
using the same collision query the player's own movement uses, so a pass means
the dungeon is genuinely walkable end to end — see
[docs/DUNGEON_GENERATION.md](docs/DUNGEON_GENERATION.md).

Controls: **WASD** move · **Shift** run · **M** cutaway view · **Esc** release the
mouse. *Auto-walk* plays the dungeon through, collecting keys and opening doors
on the way to the goal.

It shares no code with Nexus Maze and needs no external libraries — it renders
with raw WebGL.

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
