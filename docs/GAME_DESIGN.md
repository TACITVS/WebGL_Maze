# Nexus Depths — game design

`dungeon.html` is a playable first-person dungeon crawler built on the generator
described in [DUNGEON_GENERATION.md](./DUNGEON_GENERATION.md). This document
covers the game layer: the loop, the mechanics, how it is balanced, and how the
balance was actually measured.

## The loop

> Descend four floors. Find the keys that open the way down. Kill the Warden.

One run is one generated dungeon, about two to three minutes if you are quick.
The minute-to-minute loop is:

1. **Explore** a floor, revealing it on the automap.
2. **Fight** what notices you — and monsters call their neighbours, so fights
   escalate rather than queueing up politely.
3. **Collect** the key drops and health/charge that kills leave behind.
4. **Descend**, which heals you 25, refills your charge, and pays 750 points.

The hook is the **combo multiplier**: kills within four seconds of each other
chain, up to ×5. It decays fast and resets completely when you take a hit, so the
scoring rewards moving forward and killing cleanly rather than retreating down a
corridor and plinking. Score and best-score persist between runs, which is what
makes "one more run" a real question.

## Mechanics

**Movement** — WASD, `Shift` to sprint. The same collision query the dungeon
validator uses, so you can never clip a wall or fall through a staircase.

**Pulse** (left click) — hitscan, 17 damage, 7 charge, ~7 shots/second. Your
bread and butter.

**Blast** (right click / `Space`) — 52 direct plus 34 splash in a 3.3 m radius,
34 charge, with knockback. Charge regenerates at 24/s after a short delay, so the
real decision every fight is *when to spend a blast* — dumping it on one crawler
means you have nothing when three wraiths round the corner.

**Charge** replaces ammo. You are never out of bullets, but you can be caught
mid-reload-by-another-name, which keeps pressure on without the frustration of
scavenging.

**Health** does not regenerate. It comes from drops and from descending. Pickups
drift toward you once you are within 2.8 m — a reward you have to walk exactly
over is a reward most players never collect.

## Enemies

| | HP | Speed | Attack | Role |
| --- | --- | --- | --- | --- |
| **Crawler** | 26 | 3.8 | melee 8 | Fast, weak, arrives in numbers |
| **Sentinel** | 78 | 1.45 | projectile 11 | Slow artillery; punishes standing still |
| **Wraith** | 44 | 2.5 (lunges) | melee 15 | Closes fast, hits hard |
| **The Warden** | 620 | 1.7 | 3-shot spread, 17 each | The boss |

Every attack is **telegraphed**: the enemy swells, glows, lights the room and
plays a rising warning tone during its wind-up. Hitting an enemy mid-wind-up
staggers it and cancels the attack, so aggression is rewarded and the fights stay
readable rather than random. The boss is the exception — it cannot be staggered.

The mix shifts with depth: depth 1 is mostly crawlers, depth 4 is mostly
sentinels and wraiths, and enemy count scales from 7 to 19 per floor.

## Direction and readability

Getting lost is not difficulty, it is just tedium. So:

- a **compass chevron** points at the nearest way down, or at the Warden;
- the **automap** reveals as you go, colour-codes rooms by type, and marks
  stairwells, keys and locked doors;
- the **objective line** always names the next concrete thing to do;
- each floor has its own **palette and name**, so depth is legible at a glance.

## Art direction

The whole frame is drawn at **340 pixels tall** and scaled up with
nearest-neighbour filtering. The pixels are real, not a shader imitating them —
which also means the game renders roughly 2.5x fewer fragments than at native
resolution.

### One palette, used everywhere

Every colour in the game comes from `palette.js` and nowhere else: sprites,
masonry, props, HUD, menus. Eight ramps of four or five steps, ~39 colours
total. This is the single biggest reason the game reads as authored rather than
assembled — a shared, constrained set forces each new element to be described in
terms of what already exists, which is exactly the working principle behind
DawnBringer's classic palettes and the reason art made with them has "an
attractive sense of consistency".

Each ramp runs dark to light and **shifts hue as it climbs**: shadows lean cool
toward violet-blue, highlights lean warm toward cream, saturation peaks in the
midtones. Shading by value alone — just darkening and lightening one colour — is
the quickest way to make pixel art look flat.

### The rule that keeps things readable

**Walls are drawn from steps 0–3 of their ramp; creatures from steps 2–4 of
theirs.** A monster is always lighter than the masonry behind it.

This came directly out of a bug. The Emberforge was built of blood-red stone and
the Warden is a blood-red construct, so the boss dissolved into his own arena.
The standard check for this is to desaturate a screenshot: if you cannot instantly
find the character, the values are too close. Dropping the walls to `blood 0`
fixed it, and the same rule applied to the other three floors caught the same
latent problem — bone-coloured crawlers on bone-coloured walls in the galleries,
verdigris sentinels on verdigris walls in the works.

### The cast is one family

Nothing down here is an animal. Every creature is a **bound construct** built
from the same three materials: a body of pale bone, clamped with bands of
corroded verdigris metal, animated by an ember core. They differ by silhouette
and by how much of each material they carry — the Crawler is nearly all bone,
the Sentinel nearly all metal, the Wraith a shroud over a bone mask, the Warden
all three at scale.

The shared language does gameplay work as well as aesthetic work: **the glowing
part is the part you shoot**, and that reads across the entire cast without a
tutorial.

### Light, outlines and the ember core

- **Light falls from the upper left on every sprite, always.** Consistency here
  is most of what separates a set of sprites from a pile of them.
- **Selective outlining**: a lit edge along the top-left, the dark silhouette
  line along the bottom-right. Locking the shape with a hard dark line where the
  sprite meets the background while letting the lit side blend is what keeps a
  sprite readable against both a torch-lit wall and a black floor. In this
  codebase it is applied by rule in `paintForm`, not by hand, which is why eleven
  sprites look like one artist drew them.
- **The ember core is a separate quad** drawn on top of the body with lighting
  switched off, so it stays visible in an unlit corridor — the 2D equivalent of
  a rim light for luminance separation. It brightens as a creature winds up,
  making the aim point and the attack telegraph the same pixel.
- **Restraint**: at these sizes more colours make noise, not detail. Each sprite
  uses one shadow tone, one core tone and one highlight from a single ramp, plus
  the shared verdigris and ember accents.

### Everything else

- **Colour is quantised to 18 levels through a 4x4 ordered dither**, built from
  two nested 2x2 matrices because GLSL ES 1.0 dislikes array indexing.
  Posterising alone painted concentric contour rings across every flat wall.
- **The HUD is drawn as pixels too**, on its own canvas at the same resolution,
  with a 5x7 bitmap font in `hudfont.js`. Bars are segmented into discrete cells,
  which read as a quantity at a glance in a way a smooth fill never does.
  Scanlines are drawn over everything from the same canvas.
- **The art is code.** `sprites.js` paints every sprite at boot with integer
  `fillRect` calls onto a canvas that becomes the atlas texture. There are no
  binary assets in the repository. `lab-sprites.html` is the reference page: the
  palette with hex values, the full cast, and the rationale.

## Audio

Everything is synthesised at runtime with the Web Audio API — no files, no
libraries. The music is a step sequencer whose layers fade in with combat
intensity: a drone always, a kick and bass line under it, hats once things get
dangerous, and a restless arpeggio only when enemies are actually on you. The
root note drops with each depth, and the boss adds a tritone. It reacts to what
you are doing instead of looping obliviously underneath it.

## How the balance was measured

The tuning was not guesswork. `botrun.mjs` plays complete runs headlessly: a bot
follows the solution route, shoots whatever it can see, uses a blast when three
or more enemies cluster, and **never dodges**. That makes it a deliberately
pessimistic proxy — if the bot usually survives, a human who strafes definitely
can.

The first pass was revealing:

```
outcomes: { died: 6 }
seed 1: died, depth 4, damage taken 132, healed 0, route progress 0.96
seed 2: died, depth 4, damage taken 132, healed 0, route progress 0.97
...
```

Every run died at the boss, at 96–98% of the route, having taken *exactly* 132
damage and healed *zero*. Two design faults, both invisible from playing it by
hand for a minute:

1. The boss was a wall — 900 HP and 22 damage per shot in a three-shot spread
   meant six landed hits killed you, and there was no window to fight back.
2. Health drops sat where enemies died, and players walk past them.

Fixing those (boss to 620 HP / 17 damage / slower projectiles, pickup magnetism,
supplies in the arena) moved it to 6/6 wins — which was then *too* easy for a bot
that never dodges. Adding aggro propagation so fights escalate, and widening the
notice range, landed it at:

```
outcomes: { won: 9, died: 1 }
```

with most wins finishing between 18 and 35 HP out of 120. That is the target: a
non-dodging bot barely survives, so a real player has room to be good.

## Extending it

- **New enemy**: one entry in `ENEMY_TYPES`, a weight in `budgetFor`, and three
  poses in `sprites.js` named `<kind>0`, `<kind>1`, `<kind>2`. The AI, telegraph,
  rendering and drops all key off the type.
- **New weapon**: follow `firePulse` / `fireBlast` in `game.js` — the raycast,
  wall trace and splash helpers are already there.
- **Tuning**: the `PLAYER`, `PULSE` and `BLAST` constants at the top of
  `game.js`, and `ENEMY_TYPES` in `entities.js`.
- Re-run the bot after any change. It takes seconds and it will tell you things
  playing the game yourself will not.
