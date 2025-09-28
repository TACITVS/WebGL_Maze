# Nexus Maze Architecture Reference

This document provides an in-depth description of the Nexus Maze codebase. It covers
how modules cooperate, details every class, and explains the responsibility of each
significant function.

## Application startup flow

1. **`index.html`** loads the external Three.js and Tone.js bundles and then imports
   the ES module entrypoint `src/main.js`.
2. **`src/main.js`** waits for the `DOMContentLoaded` event, verifies that both
   Three and Tone are available on the `window`, instantiates
   `NexusMazeGame`, and calls `initialize()` to boot the experience.
3. **`NexusMazeGame.initialize()`** coordinates user-interface setup,
   renderer creation, ECS entity construction, and kicks off the animation loop.

The remainder of the codebase is organized into focused modules that the
`NexusMazeGame` orchestrator composes together.

## Constants (`src/constants.js`)

The constants module centralizes configuration parameters. `GAME_CONSTANTS`
exposes gameplay tuning knobs (e.g., maze size, physics coefficients, particle
limits, power-up durations), `COLORS` defines the global palette, `ACTION_BINDINGS`
maps keyboard codes to input actions, and `POWER_UP_COLORS` gives a lookup of
render colors for each power-up type.【F:src/constants.js†L1-L54】 Centralizing these
values makes balancing gameplay and reusing shared colors straightforward.

## Core utilities (`src/core`)

### `Emitter`

`Emitter` is a minimal publish/subscribe helper used primarily by the UI and game
state managers. It stores event listeners in a `Map` of `Set`s, allowing multiple
handlers per event. `on(event, listener)` registers a listener, while
`emit(event, payload)` invokes all listeners registered to `event` with a payload.
No removal method is required in current usage.【F:src/core/emitter.js†L1-L31】

### `SimpleECS`

`SimpleECS` implements a lightweight entity-component system tailored to the game.
It tracks entity ids, component definitions, and cached queries. Key capabilities:

- `createWorld()` returns the ECS instance acting as a world handle.【F:src/core/simpleEcs.js†L14-L16】
- `addEntity()` generates incrementing numeric ids and registers them in the world.【F:src/core/simpleEcs.js†L18-L23】
- `defineComponent()` creates a component descriptor with helpers to add, get,
  remove, and check component data while updating cached queries when entities
  change membership.【F:src/core/simpleEcs.js†L31-L64】
- `defineQuery(components)` produces a cached set of entity ids that contain the
  requested component combination; caches are invalidated when component data
  changes.【F:src/core/simpleEcs.js†L52-L79】
- `removeEntity`, `addComponent`, `removeComponent`, `hasComponent`, and
  `entityExists` are thin helpers around the component registry or entity set,
  ensuring caches stay synchronized.【F:src/core/simpleEcs.js†L23-L50】【F:src/core/simpleEcs.js†L79-L100】

The ECS is intentionally simple yet expressive enough for the game’s needs.

## State management (`src/state/gameStateManager.js`)

`GameStateManager` extends `Emitter`, providing observable properties for score,
health, energy, and level. Getters expose private fields, while setters clamp
values, avoid redundant notifications, and emit change events to update the UI.
`addScore(points, multiplier)` applies a multiplier before delegating to the score
setter, and `reset()` restores the default values used when restarting the game.【F:src/state/gameStateManager.js†L1-L46】

## Audio subsystem (`src/audio/audioManager.js`)

`AudioManager` encapsulates Tone.js usage, handling initialization, playback cues,
and cleanup:

- `initialize()` lazily starts the Tone.js context, creates synth sources, and
  begins the ambient layer.【F:src/audio/audioManager.js†L8-L37】【F:src/audio/audioManager.js†L120-L178】
- `toggleMute(button)` flips the mute flag, updates the Tone master mute, refreshes
  the button label, and attempts to initialize audio on first unmute.【F:src/audio/audioManager.js†L23-L36】
- `dispose()` tears down Tone instruments when recreating the level.【F:src/audio/audioManager.js†L38-L46】
- `play(event)` routes named gameplay cues to Tone synths (movement ticks, jump
  bursts, collectibles, power-ups, damage, etc.) with randomized accents for
  variation.【F:src/audio/audioManager.js†L48-L116】
- `updateAmbient(level, health, state)` smoothly retunes a low-pass filter on the
  ambient bed based on level difficulty, player health, and whether the game is
  paused or playing.【F:src/audio/audioManager.js†L118-L131】

Private helpers `#createSources()` and `#startAmbient()` instantiate the Tone
node graph and launch long-running oscillators.【F:src/audio/audioManager.js†L133-L210】

## UI subsystem (`src/ui`)

`UIManager` binds DOM nodes to the reactive game state:

- Construction caches all relevant elements, wires up event listeners for
  game-state change events, and primes the UI with initial values.【F:src/ui/uiManager.js†L1-L55】
- `setSpeedBoostChecker(fn)` lets the gameplay code provide a predicate to display
  active speed boost indicators.【F:src/ui/uiManager.js†L12-L14】
- `runLoadingSequence()` performs a staged progress animation before revealing the
  HUD once assets are ready.【F:src/ui/uiManager.js†L57-L87】
- `updateRuntimeUI(game)` renders the in-game HUD each frame, including elapsed
  time, player coordinates, jump cooldown, and any active power-up badges.【F:src/ui/uiManager.js†L89-L116】
- `flashDamage()` temporarily overlays a red flash when the player takes a hit.【F:src/ui/uiManager.js†L118-L128】

`cursor.js` adds a lightweight custom cursor that follows pointer movement via
`requestAnimationFrame` to keep the UI responsive.【F:src/ui/cursor.js†L1-L20】

## Enemy finite state machine (`src/fsm`)

Enemy behavior uses a simple finite state machine (FSM):

- `FiniteStateMachine` stores references to ECS component data for an enemy and
  starts in `PatrollingState`. Its `update(playerPos, deltaTime)` delegates to the
  current state, and `cleanup()` clears references when disposing of enemies.【F:src/fsm/finiteStateMachine.js†L1-L29】
- `FSMState` is an abstract base; concrete states override `enter`, `update`, and
  optionally `exit`.【F:src/fsm/states.js†L1-L15】
- `PatrollingState` picks random reachable tiles, requests an A* path via
  `game.findPath`, and steers along it. Chaser-type enemies switch to chasing when
  the player is within the chase radius.【F:src/fsm/states.js†L17-L63】
- `ChasingState` periodically recomputes a path toward the player, accelerates the
  enemy, and reverts to patrol when the player escapes the patrol radius.【F:src/fsm/states.js†L65-L114】

The states manipulate shared ECS components directly, minimizing allocations.

## Gameplay orchestrator (`src/game/nexusMazeGame.js`)

`NexusMazeGame` coordinates rendering, ECS, UI, audio, and state transitions.
Key responsibilities are grouped below.

### Construction and initialization

- The constructor creates core subsystems (`SimpleECS`, `AudioManager`, `GameStateManager`,
  `UIManager`), registers a callback to expose the speed boost flag to the UI,
  prepares the initial mutable state object, caches FSM references and particle
  pools, and declares ECS components and queries via `#defineComponents()` and
  `#defineQueries()`.【F:src/game/nexusMazeGame.js†L12-L76】
- `initialize()` installs the custom cursor, hooks the mute button to the audio
  manager, plays the loading animation, registers input listeners, sets up the
  Three.js renderer, allocates the particle pool, generates the first maze, and
  launches the animation loop.【F:src/game/nexusMazeGame.js†L78-L119】

### Input and event binding

- `#registerInputListeners()` listens for the first user gesture to initialize
  audio, wires restart buttons, maps keyboard presses/releases to logical actions,
  toggles features (restart, camera mode, mute), and resizes the renderer when the
  window changes dimensions.【F:src/game/nexusMazeGame.js†L121-L191】

### Rendering setup

- `#initializeRenderer()` constructs the Three.js scene, fog, camera, renderer,
  lighting, and minimap canvas sizing.【F:src/game/nexusMazeGame.js†L193-L228】
- `#initializeParticlePool()` pre-allocates sphere meshes for particles, registers
  ECS components for them, and stores entity ids for reuse.【F:src/game/nexusMazeGame.js†L230-L252】

### Level lifecycle

- `#createLevel()` resets audio, disposes existing FSMs and non-particle entities,
  recalculates maze size based on level, generates maze geometry, populates
  visited cell tracking, builds ground/grid visuals, repopulates walls, player,
  goal, enemies, power-ups, and collectibles, and transitions into the playing
  state.【F:src/game/nexusMazeGame.js†L260-L396】
- `#restartGame()` hides end-game overlays, resets the observable game state, and
  recreates the level while marking the game as active.【F:src/game/nexusMazeGame.js†L254-L268】
- `#disposeAudio()` is a small helper to release Tone.js nodes between levels.【F:src/game/nexusMazeGame.js†L270-L274】

### Entity creation helpers

The class provides dedicated methods to spawn each entity archetype, ensuring ECS
components and Three.js meshes stay synchronized:

- `#createPlayer`, `#createTrail`, `#createWall`, and `#createGoal` create their
  respective meshes, attach ECS components, and register them in tracking maps.【F:src/game/nexusMazeGame.js†L398-L475】
- `#createCollectible`, `#createPowerUp`, and `#createEnemy` initialize items and
  AI-driven adversaries. Enemy creation instantiates a `FiniteStateMachine` and
  stores it in `fsmInstances` for updates and cleanup.【F:src/game/nexusMazeGame.js†L477-L548】

### Maze utilities

- `#generateMaze(width, height)` uses a randomized depth-first search to carve a
  perfect maze and adds a few extra openings for variety.【F:src/game/nexusMazeGame.js†L550-L586】
- Coordinate conversion helpers `#worldToGrid`, `gridToWorld`, and `worldToGrid`
  translate between world coordinates and maze grid indices, which is essential
  for AI pathfinding and minimap drawing.【F:src/game/nexusMazeGame.js†L588-L609】
- `findPath(start, end)` implements A* search across walkable tiles to feed enemy
  AI state transitions.【F:src/game/nexusMazeGame.js†L611-L658】

### Particle effects

- `#spawnParticle()` pulls a pooled particle entity, configures position, velocity,
  lifetime, and mesh appearance, and marks it visible.【F:src/game/nexusMazeGame.js†L660-L683】
- `#createParticleBurst()` repeatedly calls `#spawnParticle()` with randomized
  velocity vectors for impact effects.【F:src/game/nexusMazeGame.js†L685-L699】
- `#particleSystem()` ticks particle lifetimes, hides expired meshes, and returns
  entities to the pool.【F:src/game/nexusMazeGame.js†L1035-L1052】

### Player input, movement, and physics

- `#inputSystem(deltaTime)` computes movement vectors relative to the camera,
  applies boosts, handles jump cooldowns, drains or regenerates energy, plays
  movement and boost sounds, and spawns jump particles.【F:src/game/nexusMazeGame.js†L701-L780】
- `#movementSystem(deltaTime)` applies friction to regular entities, gravity to
  particles, and integrates velocities into positions.【F:src/game/nexusMazeGame.js†L782-L797】
- `#collisionSystem(deltaTime)` resolves wall collisions, handles collectible and
  power-up pickups (including duration timers), processes enemy contact damage and
  knockback, prevents enemy overlap, detects goal completion, and triggers level
  transitions or victory conditions.【F:src/game/nexusMazeGame.js†L799-L964】
- `#effectsSystem()` expires temporary effect components (shield, speed boost,
  score multiplier) when their timers elapse.【F:src/game/nexusMazeGame.js†L966-L978】

### Enemy AI and rendering hooks

- `#aiSystem(deltaTime)` calls each enemy’s FSM `update` method, passing the
  player position so states can steer accordingly.【F:src/game/nexusMazeGame.js†L1054-L1063】
- `#trailSystem()` stores the player path for rendering a trailing line.【F:src/game/nexusMazeGame.js†L1065-L1080】
- `#animationSystem()` animates collectibles, power-ups, goals, and enemies by
  adjusting rotation and hover offsets based on each entity’s animation component.【F:src/game/nexusMazeGame.js†L1082-L1106】
- `#renderSystem(deltaTime)` synchronizes mesh transforms with ECS positions and
  imparts rolling motion to the player sphere based on velocity.【F:src/game/nexusMazeGame.js†L1108-L1130】
- `#cameraSystem()` positions the camera in third- or first-person-style views,
  adds procedural screen shake, and keeps the camera focused on the player.【F:src/game/nexusMazeGame.js†L1132-L1158】
- `#uiSystem()` delegates to `UIManager` to refresh the HUD each frame.【F:src/game/nexusMazeGame.js†L1160-L1162】

### Exploration aids

- `#fogOfWarSystem()` marks tiles within a circular radius of the player as
  visited for minimap rendering.【F:src/game/nexusMazeGame.js†L1164-L1179】
- `#minimapSystem()` redraws the minimap on a cadence, showing visited tiles,
  the player marker, and visible enemies.【F:src/game/nexusMazeGame.js†L1181-L1222】

### Game loop

- `#triggerScreenShake(intensity)` stores a shake magnitude consumed by the camera
  system.【F:src/game/nexusMazeGame.js†L1224-L1227】
- `#animate()` is the main loop driven by `requestAnimationFrame`. It aborts if the
  game is over, computes `deltaTime`, steps gameplay systems when in the `playing`
  state, then runs visual systems, updates audio ambiance, and finally renders the
  Three.js scene.【F:src/game/nexusMazeGame.js†L1229-L1269】

Together, these systems create a cohesive loop where input drives ECS updates,
AI reacts, collisions reward or punish the player, the UI and audio respond to
state changes, and rendering presents the evolving maze environment.
