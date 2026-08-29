# 3D Dungeon Generation

`dungeon.html` is a self-contained roguelike dungeon generator: a multi-floor
dungeon built from a seed, compiled into WebGL geometry, and walkable in first
person. This document explains the algorithm and, more importantly, the
invariants that keep it honest.

Source lives in `src/dungeon/`.

## Why not a lattice

The obvious way to get a 3D maze is a cubic lattice: one cell per grid point,
edges to the six neighbours, a spanning tree over the whole thing. It generates
easily and it validates easily. It also *looks* like a lattice — every room on
the same pitch, every connection axis-aligned, no negative space. A dungeon
crawler needs rooms of different sizes in unpredictable places, corridors that
wander, dead ends worth exploring, and floors that do not resemble each other.

So the layout here is not a lattice. Each floor is an independent tile map, and
the third dimension comes from stair towers placed where floors happen to
overlap, rather than from a grid axis.

## Pipeline

```
seed ──> generator.js ──> compiler.js ──> physics.js ──> renderer.js
         (tile maps)      (boxes,          (walk query,   (WebGL)
                           walk surfaces)   collision)
                                │
                                └──> validate.js  (proves it is playable)
```

### 1. Floors (`generator.js`)

Each floor starts as solid rock on a 46×46 tile grid (1.7 m tiles, ~78 m across).

- **BSP partition.** The floor is recursively split into uneven leaves. The split
  ratio is random within `[0.36, 0.64]` and the longer axis is preferred, which
  keeps leaves usable without making them uniform.
- **Rooms.** Most leaves get one room, sized and positioned randomly inside the
  leaf. About 12% of leaves stay solid rock — that negative space is what makes
  the rest read as rooms rather than as a partition diagram. Shapes are plain
  rectangles, L-shapes with a corner bitten out, or ring-shaped vaults around a
  central plinth.
- **Corridors.** A minimum spanning tree over the room centres is carved as
  L-shaped corridors, plus roughly 35% extra edges so the dungeon has **loops**.
  A pure tree makes every wrong turn a backtrack; loops are what make a dungeon
  feel navigable.
- **Connectivity repair.** A flood fill checks the result; any stranded room is
  connected to its nearest reachable neighbour and the check repeats.

### 2. Stair towers

Floors are stitched together by switchback stair towers. A tower needs a 3×4
tile footprint that is plain room floor on *both* floors, with clear tiles in
front of its mouth on each.

A tower is a real piece of architecture, not a teleport:

- On the upper floor it punches a stairwell — those tiles become open void, all
  except the top landing, which stays walkable.
- On the lower floor it stands as a walled tower you can walk under and enter
  through its mouth.
- Inside are two flights and three landings: up one lane to a mid landing, back
  down the other. Risers stay under 19 cm and slope under 42°, which the
  validator checks.

Placement is rejected unless **both floors stay fully connected without routing
through the tower**. Three separate bugs during development came from getting
this wrong — see *Invariants* below.

### 3. Content

- **Room types** come from size and graph position: entrance, vaults on dead
  ends, crypts, cisterns, a boss chamber at the deepest point.
- **Locks** are placed only on **bridges of the room graph** — links whose
  removal actually separates the entrance from the goal. Anything else would be
  a lock you could walk around.
- **Keys** are placed in the region still reachable *before* that lock opens,
  processed in order, so every dungeon is solvable by construction. The
  validator re-derives this independently rather than trusting it.
- **Furniture** only lands on interior tiles fully surrounded by room floor, so
  a prop can never seal a room off. Torches are the main light source and the
  reason the place reads as three-dimensional.

### 4. Compilation (`compiler.js`)

Everything renderable is derived from the tile map, so geometry can never
disagree with the layout:

- Floor and ceiling slabs are **greedy-meshed** into a few dozen rectangles
  instead of thousands of tiles.
- Walls are emitted on every edge between open space and rock, merged into runs.
- **Lintels** close the gap wherever two adjacent tiles have different ceiling
  heights — without them you can see over a corridor's ceiling into the rock.
- The **cutaway** view is derived from the same boxes: roofs off, walls cut to
  knee height, floors pulled apart vertically, and each tower replaced by a
  single connector column.

## Invariants

The checks in the right-hand panel do not trust the generator. In particular,
`physicalReach` flood-fills the compiled world using the **same `canOccupy`
query the player's own movement uses**, so a pass means a person can really walk
the dungeon.

| Check | What it would catch |
| --- | --- |
| Entrance is standable | A stairwell punched through the spawn tile |
| Every room physically reachable | A tower casing sealing off a corridor |
| Goal reachable on foot | A floor cut in half by a stairwell |
| All floors reachable | A stair tower that cannot actually be descended |
| Stairs climbable | Risers or slopes no person could use |
| Keys obtainable before locks | A key locked behind the door it opens |

This distinction matters. An earlier version of this project validated a
hand-authored centreline through each connection — and passed on 200/200 seeds
while the geometry was fine but the *design* was a uniform lattice. A validator
that only checks what the generator intended will confirm whatever the generator
does. Walking the compiled world with the player's own collision query is what
turned up every real bug:

- stair towers on different floor pairs overlapping, so one tower's casing cut
  through another's staircase;
- a tower's casing sealing a corridor, because the tile map still showed those
  tiles as passable to later placement checks;
- routing *through* a tower's exit tile, which is only reachable via the mouth;
- and a flood fill that bucketed heights coarsely enough to merge a stair tread
  with the floor above it, silently pruning the way downstairs.

## Extending it

Reasonable next steps, roughly in order of effort:

- **Tuning:** `generateDungeon(seed, options)` takes `width`, `height`, `floors`,
  `storeyHeight`, `depth` (BSP recursion), `minLeaf`, `loopRatio` and `locks`.
- **New room types:** add to `ROOM_TYPE`, give it a case in `assignRoomTypes`
  and in `furnish`, and a colour in the automap's `ROOM_TINT`.
- **New props:** one case in `buildProp`. Pass `true` as the second argument to
  `push` for anything solid and it becomes a collider automatically.
- **Monsters and loot:** the room graph (`dungeon.links`), the distance map from
  the entrance and the room types are all the placement signal you need.
- **Bigger dungeons:** the tile grid and greedy meshing scale fine; the flood
  fill in `validate.js` is the slow part, at roughly a second per seed.
