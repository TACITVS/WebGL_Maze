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
├── dungeon.html        # Nexus Depths: the playable dungeon crawler
├── lab.html            # Nexus Depths: generator + validation tooling
├── lab-sprites.html    # Nexus Depths: palette + sprite reference
├── styles/             # Global styling resources
├── src/
│   ├── audio/          # Tone.js integration and sound design
│   ├── core/           # ECS and event emitter utilities
│   ├── dungeon/        # Nexus Depths: generator, game, audio (standalone, no Three.js)
│   ├── fsm/            # Enemy AI state machine definitions
│   ├── game/           # Main NexusMazeGame class and gameplay systems
│   ├── state/          # Game state managers
│   ├── ui/             # UI orchestration helpers
│   └── main.js         # Application entrypoint
├── docs/
│   ├── ARCHITECTURE.md         # Nexus Maze reference
│   ├── DUNGEON_GENERATION.md   # How the dungeon generator works
│   └── GAME_DESIGN.md          # The game loop, enemies and balance
└── README.md
```

## Nexus Depths — playable dungeon crawler

Open `http://localhost:8000/dungeon.html` and press **Descend**.

A first-person roguelike run: four floors down, keys to find, monsters that call
their neighbours when they spot you, and the Warden waiting in the deepest
chamber. Kills within four seconds chain into a score multiplier up to ×5, so the
loop rewards pushing forward rather than retreating. Runs last two to three
minutes and your best score persists.

- **WASD** move · **Shift** sprint · **mouse** look
- **Left click** pulse · **Right click** / **Space** blast · **Esc** pause

It renders at 340p and scales up with nearest-neighbour filtering, so the pixels
are real. Every colour — sprites, masonry, props, HUD, menus — comes from one
39-colour palette of hue-shifted ramps, and every creature is built from the same
three materials: bone, corroded verdigris and an ember core. The core is drawn on
its own unlit layer, so the aim point and the attack telegraph are the same pixel.

Enemies are billboard sprites, the HUD is drawn with a 5x7 bitmap font onto its
own canvas, and every sprite is painted at boot with `fillRect` calls — there are
no binary assets in the repository. Music and every sound effect are synthesised
at runtime with the Web Audio API, so there are no audio files or libraries either.

Design notes, enemy stats, the art direction and how the balance was measured are
in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md). `lab-sprites.html` is the art
reference: the palette with hex values and the full cast at 5x.

## The generator underneath

Open `http://localhost:8000/lab.html` for the generator lab: the same dungeons
with the layout tooling exposed — cutaway view, solution route, and the
validation panel.

Each floor is a tile map built by BSP partitioning, with rooms of varied size and
shape, corridors from a minimum spanning tree plus extra links for loops, and
negative space between them. Floors are stitched together by **switchback stair
towers** placed wherever rooms on adjacent floors overlap — real staircases you
walk down, not teleports. Rooms are typed from their place in the graph
(entrance, vaults, crypts, a boss chamber at the deepest point), furnished
accordingly, and lit by torches. Locked doors are placed only on bridges of the
room graph, with their keys hidden in the region still reachable without them,
so every dungeon is solvable.

The validation panel flood-fills the compiled world using the same collision
query the player's own movement uses, so a pass means the dungeon is genuinely
walkable end to end — see
[docs/DUNGEON_GENERATION.md](docs/DUNGEON_GENERATION.md).

Lab controls: **WASD** move · **M** cutaway view · *Auto-walk* plays the dungeon
through, collecting keys and opening doors on the way to the goal.

Both pages share no code with Nexus Maze and need no external libraries — they
render with raw WebGL.

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
