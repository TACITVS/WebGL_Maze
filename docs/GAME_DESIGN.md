# Nexus Depths — game design

`dungeon.html` is a playable first-person dungeon crawler built on the generator
described in [DUNGEON_GENERATION.md](./DUNGEON_GENERATION.md). This document
covers the game layer: the loop, the mechanics, how it is balanced, and how the
balance was actually measured.

## The loop

> Kill the quota. Take the way down, or stay and get stronger. Kill the Warden.

Nexus Depths is a **bullet heaven in first person**. Your weapons fire
themselves. Your job is where you stand, where you look, and what you pick up.

One floor is one turn of the loop:

1. **Purge the quota** — 34 kills on depth 1, rising by 22 each floor. Every
   kill drops essence; essence fills a bar across the bottom of the screen.
2. **Level** whenever the bar fills, which is every few seconds. Time stops and
   three procedurally generated capabilities are dealt face up. Press 1, 2 or 3.
3. **The rift opens** when the quota is met, and the compass points at it.
4. **Choose**: descend, which heals you 30, refills your charge and pays 1200 —
   or stay. Staying is how you get stronger. Staying is also how you die: the
   spawn rate keeps climbing the whole time you are on a floor, and it climbs
   *faster* once the rift is open.

That choice, every ninety seconds or so, is the game. Descending is safety and
resets the pressure; staying is power at compounding risk.

### The chain

Kills inside a short window chain. The multiplier climbs to ×2.6 on score and
×1.8 on essence, and the window **tightens** as the chain grows — 2.2 seconds
from cold, 1.05 seconds once you are deep into one. Taking a hit costs you half
the chain.

The meter only ever falls. That is the point: it is the thing that makes you
push into the next room instead of backing into a corridor, and the reason the
run summary reports your best chain alongside your score.

## Procedurally generated capabilities

No two runs hand you the same tools. A weapon is assembled from parts:

| Part | Count | What it decides |
| --- | --- | --- |
| **Core** | 8 | How it fires — bolt, scatter, lance, nova, seeker, chain, orbit, mortar |
| **Element** | 6 | Colour, sound, and the on-hit effect — burn, slow, pull, arc… |
| **Prefix** | 12 | The stat it bends — Rapid, Heavy, Twin, Vast, Cruel, Endless… |
| **Rarity** | 4 | A flat multiplier, weighted toward the good ones as you descend |

That is 2,304 base identities before rarity, each levelling nine times, plus ten
relic families that roll their own magnitudes. `Ravenous Frost Orbit` and
`Wailing Void Chain` are not hand-written entries in a table; they are rolled,
named and costed at the moment they are offered, and their card text is
generated from the stats they actually have.

Two rules keep the offer honest:

- **While the rack has room, one of the three cards is always a weapon.** A
  bullet heaven only sings once several things are firing at once, and a rack
  that filled by chance left too many runs stuck on the gun they started with.
- **Once the rack is full at five, weapons stop being offered at all.** A card
  you cannot take is worse than no card, so the late offer is upgrades and
  relics — the build converges instead of sprawling.

## Mechanics

**Movement** — WASD, `Shift` to sprint. Crawlers run at 4.35 m/s and you walk at
3.9, so **walking is never an escape and sprinting always is**. That is a
deliberate line: the horde closes on anyone who stands and shoots, and breaking
away is always available and always costs you your firing position.

**Auto-fire** — every weapon fires on its own cooldown at whatever is in front
of you, with a generous aim cone. You never click to shoot.

**Surge** (left click, 26 charge) — resets every weapon's cooldown and fires the
whole rack at once. The alpha strike.

**Blast** (right click / `Space`, 38 charge) — 60 damage in a 4.2 m radius with
heavy knockback. The panic button: it buys space rather than kills.

**Charge** regenerates at 19/s. Health does not regenerate — it comes from
drops, from descending, and from levelling.

**Levelling heals a quarter of what is missing**, not a flat amount. Near death a
level is a genuine rescue; at full hull it is worth nothing. The flat version did
the opposite: levels arrive fastest when you are killing well, so it pinned a
strong build at maximum hull and the fight stopped being able to threaten it.

**Desperation drops** — the lower your hull, the more often a kill leaves health
behind. A run that is nearly over can still be clawed back, and clawing it back
is the thing players replay for.

## Enemies

| | HP | Speed | Attack | Role |
| --- | --- | --- | --- | --- |
| **Crawler** | 17 | 4.35 | melee 5 | Fast, weak, arrives in numbers |
| **Wraith** | 34 | 3.5 (lunges) | melee 9 | Closes fast, hits hard |
| **Sentinel** | 62 | 1.6 | projectile 8 | Slow artillery; punishes standing still |
| **The Warden** | scaled | 1.9 | 3-shot spread, 16 each | The boss |

Enemy HP is low and counts are high — up to 150 live at once, with a live
ceiling per floor that ramps from 34 to about 118 as you linger. Elites roll in
at 3.5% and up, with 3.2× health and five times the essence.

**Monsters hear you.** Sight wakes one instantly; anything within 26 m wakes
after 1.8 seconds whether or not it has line of sight. Your weapons never stop
firing, so anything sharing a room-and-a-half with you is coming. Without this a
player who held one corner simply ran out of enemies — see the measurement
section below.

**The Warden scales to whatever walks into the room.** Builds arriving at depth 4
range from a level-eight scrape to a level-thirty engine of destruction, and a
fixed pool cannot serve both: the 1500 hit points that are a wall for one are two
and a half seconds for the other. Its health is set when it wakes, against your
level.

## Direction and readability

Getting lost is not difficulty, it is just tedium. So:

- a **compass chevron** points at the nearest way down, or at the Warden;
- the **automap** reveals as you go, colour-codes rooms by type, and marks
  stairwells;
- the **objective line** always names the next concrete thing to do — how many
  are left to purge, or that the way down is open;
- the **quota pips and essence bar** are the two things you glance at, and they
  sit where the eye already is: the bar runs the full width above the console;
- each floor has its own **palette and name**, so depth is legible at a glance.

The game runs the generator with `locks: 0`. Keys and locked doors still exist —
the generator places them on graph bridges and `lab.html` still exercises them —
but the descent here is gated on kills, not on searching. Hunting for a key is a
different game to the one the auto-fire loop is asking you to play.

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

Tuning was not guesswork, and the instrument matters more than the numbers it
produced. `bhsim.mjs` runs the entire loop headlessly at a true 60 fps —
movement, auto-fire, orbits, essence, level-ups, card picks, spawn waves,
descent — with no renderer in the way. This was built after discovering that the
in-browser test ran at roughly 5 fps under software rasterisation and was
therefore reporting the pacing at half speed.

The bot sprints when kited, blasts when three enemies close, and dumps a surge
when charge is banked, so it is a fair proxy rather than a pessimistic one.

The check that mattered most was not "does the bot win" but **"does the fight
ever go quiet"**: over any fifteen-second window, did the kill count move? Four
separate bugs turned up under that single question, none of which was visible
from playing the game by hand:

1. **The flow field pathed through tiles bodies cannot occupy.** It asked
   `plan.walkable`, which is a question about the tile map; the movement code
   asks `canOccupy`, which takes a radius and a height. About 7% of walkable
   tiles are not standable, and monsters routed into one would press against it
   forever. Fixed by cutting a passability mask with the same query the movers
   use, so pathing and movement agree by construction.
2. **The 150-monster cap was being spent on monsters the player would never
   meet** — dormant and aggro'd leftovers on floors already descended past. The
   swarm would sit at its cap with two thirds of it three floors up while the
   floor underfoot went silent. Off-floor monsters are now budgeted to 24 and
   the rest forgotten; the spawner refills any floor you walk back onto within
   seconds, so nothing observable is lost.
3. **Separation beat the chase vector.** An unbounded sum of push-apart forces
   overwhelms a single unit vector as soon as a body has four neighbours, so the
   horde jammed into a static ring a few metres out and milled there. Separation
   is now normalised and weighted below the chase.
4. **Sleeping monsters never came.** A player holding a corner ran the floor dry.
   Hence hearing.

The spawner now also refuses to place a monster that cannot reach you — the flow
field is already a reachability map from the player, so it is one array lookup —
and relaxes its distance and line-of-sight rules across three passes rather than
giving up its budget.

After those fixes, across twelve seeds at four minutes each:

```
seed  1: survived 240s | level 17 | kills  496 | depth 4 | dead-windows 0
seed  2: DIED at 129.8s | level 16 | kills  392 | depth 3 | dead-windows 0
seed  4: survived 240s | level 31 | kills 1497 | depth 4 | dead-windows 0
...
PASS: no seed went quiet
```

Nine of twelve survive four minutes, every seed reaches depth 3 or 4, and the
kill rate at depth 4 is around six a second. The swarm costs 0.047 ms per frame
at 98 live monsters, so the frame budget is spent on rasterisation, not on AI.

The Warden was measured separately, against builds a level-twenty run actually
produces: it now takes 12–39 seconds and 10–74 hull to kill, against 2.5–5.9
seconds before it was scaled.

The general lesson is the one the generator taught first: **a bot that replays
the player's own rules finds faults inspection cannot.** The original prototype's
validator sampled a hand-authored centreline and passed 200/200 while producing
an unplayable lattice. Every real bug in this project — geometry and balance
alike — was caught by re-asking the exact question the game asks.

## Extending it

- **New enemy**: one entry in `ENEMY_TYPES`, a weight in `pickKind`, and three
  poses in `sprites.js` named `<kind>0`, `<kind>1`, `<kind>2`. The AI, telegraph,
  rendering and drops all key off the type.
- **New weapon core**: one entry in `CORES` in `loadout.js`. It immediately
  crosses with all six elements, twelve prefixes and four rarities, and
  `describeWeapon` writes its card text from the stats it ends up with. If it
  needs firing behaviour that does not exist yet, add an `aim` case in
  `fireWeapon`.
- **New element or relic**: entries in `ELEMENTS` / `RELICS`. Elements need a
  matching impact sound in `audio.js` and a case in `applyImpact`.
- **Tuning**: `PLAYER`, `SURGE`, `BLAST` and `xpForLevel` at the top of
  `game.js`; `ENEMY_TYPES`, the spawn ramp and the live ceiling in
  `entities.js`; the quota in `setQuota`.
- Re-run `bhsim.mjs` after any change, and check dead windows as well as
  outcomes. It takes seconds and it will tell you things playing the game
  yourself will not.
