/**
 * Procedurally generated capabilities.
 *
 * A weapon is not picked from a list - it is *built* from three independent
 * parts and then rolled: a core that decides how it fires, an element that
 * decides what happens on hit, and a prefix that bends the numbers. Eight cores
 * times six elements times twelve prefixes times four rarities is 2,304 distinct
 * weapons, each with nine levels of stat growth on top - which is why no two runs
 * hand you the same toolkit.
 *
 * The same idea drives relics, so the passive half of a build is generated too.
 */

import { rgb } from './palette.js';

/** How a weapon fires. This is the part the player feels most. */
export const CORES = {
  bolt: {
    name: 'Bolt', aim: 'target', cooldown: 0.42, damage: 15, count: 1,
    speed: 30, size: 0.34, pierce: 0, spread: 0.05, life: 2.2,
    blurb: 'a single fast round',
  },
  scatter: {
    name: 'Scatter', aim: 'target', cooldown: 0.82, damage: 8, count: 5,
    speed: 22, size: 0.30, pierce: 0, spread: 0.40, life: 0.9,
    blurb: 'a cone of shards',
  },
  lance: {
    name: 'Lance', aim: 'target', cooldown: 1.25, damage: 24, count: 1,
    speed: 46, size: 0.40, pierce: 8, spread: 0, life: 1.4,
    blurb: 'a piercing spike',
  },
  nova: {
    name: 'Nova', aim: 'radial', cooldown: 2.0, damage: 11, count: 12,
    speed: 15, size: 0.34, pierce: 1, spread: Math.PI * 2, life: 1.3,
    blurb: 'a ring in every direction',
  },
  seeker: {
    name: 'Seeker', aim: 'nearest', cooldown: 0.88, damage: 16, count: 2,
    speed: 17, size: 0.34, pierce: 0, spread: 0.9, life: 3.2, homing: 7,
    blurb: 'rounds that chase',
  },
  chain: {
    name: 'Chain', aim: 'nearest', cooldown: 1.3, damage: 16, count: 1,
    speed: 34, size: 0.32, pierce: 0, spread: 0, life: 2.0, chain: 3,
    blurb: 'arcs between bodies',
  },
  orbit: {
    name: 'Orbit', aim: 'orbit', cooldown: 0, damage: 9, count: 3,
    speed: 2.4, size: 0.44, pierce: 99, spread: 0, life: 0,
    blurb: 'shards that circle you',
  },
  mortar: {
    name: 'Mortar', aim: 'target', cooldown: 1.7, damage: 20, count: 1,
    speed: 18, size: 0.44, pierce: 0, spread: 0.12, life: 2.4, blast: 2.8,
    blurb: 'a shell that bursts',
  },
};

/** What happens when it lands. */
export const ELEMENTS = {
  ember: { name: 'Ember', ramp: 'ember', blast: 1.6, burn: 0, sfx: 'hitEmber', blurb: 'bursts on impact' },
  frost: { name: 'Frost', ramp: 'ice', slow: 0.5, sfx: 'hitFrost', blurb: 'slows what it touches' },
  arc: { name: 'Arc', ramp: 'ice', chain: 2, sfx: 'hitArc', blurb: 'leaps to a second target' },
  void: { name: 'Void', ramp: 'arcane', pull: 5.5, sfx: 'hitVoid', blurb: 'drags bodies inward' },
  bone: { name: 'Bone', ramp: 'bone', crit: 0.22, sfx: 'hitBone', blurb: 'strikes for double' },
  rot: { name: 'Rot', ramp: 'verdigris', burn: 5, sfx: 'hitRot', blurb: 'corrodes over time' },
};

/** How the numbers bend. */
export const PREFIXES = [
  { name: 'Rapid', cooldown: 0.66, damage: 0.85 },
  { name: 'Heavy', cooldown: 1.35, damage: 1.75, size: 1.25 },
  { name: 'Twin', addCount: 1, cooldown: 1.12 },
  { name: 'Vast', size: 1.7, blast: 1.6, damage: 1.1 },
  { name: 'Cruel', damage: 1.3, crit: 0.12 },
  { name: 'Endless', addCount: 2, cooldown: 1.3, damage: 0.8 },
  { name: 'Keen', speed: 1.5, damage: 1.15, size: 0.85 },
  { name: 'Wailing', addPierce: 3, damage: 0.9 },
  { name: 'Hollow', cooldown: 0.8, addPierce: 1 },
  { name: 'Gilded', damage: 1.2, xp: 1.1 },
  { name: 'Ravenous', damage: 1.15, lifesteal: 0.02 },
  { name: 'Ruined', damage: 1.45, cooldown: 1.15, size: 1.15 },
];

export const RARITIES = [
  { name: 'Common', tier: 0, mult: 1.0, weight: 62, colour: 'stone' },
  { name: 'Rare', tier: 1, mult: 1.22, weight: 26, colour: 'ice' },
  { name: 'Epic', tier: 2, mult: 1.5, weight: 9, colour: 'arcane' },
  { name: 'Relic', tier: 3, mult: 1.9, weight: 3, colour: 'ember' },
];

/** Passive effects. Names are generated, so relics feel found rather than listed. */
export const RELICS = [
  { key: 'haste', stat: 'moveSpeed', per: 0.10, noun: 'Spur', blurb: '+10% move speed' },
  { key: 'lodestone', stat: 'pickupRadius', per: 0.45, noun: 'Lodestone', blurb: '+45% pickup range' },
  { key: 'ward', stat: 'maxHull', per: 22, noun: 'Ward', blurb: '+22 max hull' },
  { key: 'focus', stat: 'damage', per: 0.14, noun: 'Focus', blurb: '+14% damage' },
  { key: 'greed', stat: 'xpGain', per: 0.18, noun: 'Sigil', blurb: '+18% essence' },
  { key: 'thorn', stat: 'crit', per: 0.07, noun: 'Fang', blurb: '+7% critical chance' },
  { key: 'cell', stat: 'haste', per: 0.11, noun: 'Cell', blurb: '+11% fire rate' },
  { key: 'siphon', stat: 'lifesteal', per: 0.015, noun: 'Leech', blurb: '+1.5% life steal' },
  { key: 'reach', stat: 'area', per: 0.16, noun: 'Lens', blurb: '+16% projectile size' },
  { key: 'aegis', stat: 'armour', per: 0.08, noun: 'Aegis', blurb: '-8% damage taken' },
];

const RELIC_ADJECTIVES = [
  'Corroded', 'Gilded', 'Drowned', 'Ashen', 'Hollow', 'Bound', 'Sunken',
  'Fevered', 'Cracked', 'Whispering', 'Brazen', 'Withered', 'Molten', 'Pale',
];

const WEAPON_EPITHETS = [
  'of the Undercroft', 'of Ash', 'of the Deep Gallery', 'of Rust', 'of the Ninth Kiln',
  'of Salt', 'of the Drowned Choir', 'of Cinders', 'of the Long Dark',
];

function pickWeighted(rng, list, weightOf) {
  const total = list.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = rng.next() * total;
  for (const item of list) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }
  return list[list.length - 1];
}

/** Deeper floors bias the roll upward without ever guaranteeing anything. */
function rollRarity(rng, depth) {
  return pickWeighted(rng, RARITIES, (r) => Math.max(0.4, r.weight * (1 + r.tier * depth * 0.42)));
}

let nextId = 1;

/**
 * Build one weapon. Everything downstream - damage, visuals, the sound it
 * makes - is derived from these three parts, so a new core or element
 * propagates through the whole game without touching anything else.
 */
export function generateWeapon(rng, depth = 0) {
  const coreKey = rng.pick(Object.keys(CORES));
  const elementKey = rng.pick(Object.keys(ELEMENTS));
  const prefix = rng.pick(PREFIXES);
  const rarity = rollRarity(rng, depth);
  const core = CORES[coreKey];
  const element = ELEMENTS[elementKey];

  const weapon = {
    id: nextId++,
    kind: 'weapon',
    coreKey,
    elementKey,
    prefixName: prefix.name,
    prefix,
    rarity,
    level: 1,
    cooldownLeft: rng.float(0, 0.4),
    orbitPhase: rng.float(0, Math.PI * 2),
    name: `${prefix.name} ${element.name} ${core.name}`,
    epithet: rarity.tier >= 2 ? rng.pick(WEAPON_EPITHETS) : '',
    blurb: `${core.blurb}, ${element.blurb}`,
  };
  recomputeWeapon(weapon);
  return weapon;
}

/** Stats are always recomputed from parts + level, never mutated in place. */
export function recomputeWeapon(weapon) {
  const core = CORES[weapon.coreKey];
  const element = ELEMENTS[weapon.elementKey];
  const prefix = weapon.prefix;
  const mult = weapon.rarity.mult;
  const level = weapon.level;
  // Levels add damage everywhere and an extra projectile every third one.
  const levelDamage = 1 + (level - 1) * 0.22;
  const levelCount = Math.floor((level - 1) / 3);

  weapon.stats = {
    aim: core.aim,
    damage: core.damage * (prefix.damage || 1) * mult * levelDamage,
    cooldown: core.cooldown * (prefix.cooldown || 1) / (1 + (level - 1) * 0.05),
    count: Math.max(1, core.count + (prefix.addCount || 0) + levelCount),
    speed: core.speed * (prefix.speed || 1),
    size: core.size * (prefix.size || 1),
    pierce: core.pierce + (prefix.addPierce || 0),
    spread: core.spread,
    life: core.life,
    homing: core.homing || 0,
    chain: (core.chain || 0) + (element.chain || 0),
    blast: (core.blast || 0) * (prefix.blast || 1) + (element.blast || 0),
    crit: (prefix.crit || 0) + (element.crit || 0),
    lifesteal: prefix.lifesteal || 0,
    slow: element.slow || 0,
    pull: element.pull || 0,
    burn: element.burn || 0,
    ramp: element.ramp,
    colour: rgb(element.ramp, 3),
    trail: rgb(element.ramp, 4),
    sfx: element.sfx,
  };
  return weapon;
}

/** Build one relic. */
export function generateRelic(rng, depth = 0) {
  const base = rng.pick(RELICS);
  const rarity = rollRarity(rng, depth);
  const adjective = rng.pick(RELIC_ADJECTIVES);
  const amount = base.per * rarity.mult;
  return {
    id: nextId++,
    kind: 'relic',
    relicKey: base.key,
    stat: base.stat,
    amount,
    rarity,
    level: 1,
    name: `${adjective} ${base.noun}`,
    blurb: base.blurb,
  };
}

/**
 * The player's build: the weapons they carry and the totals from their relics.
 */
export class Loadout {
  constructor(rng) {
    this.rng = rng;
    this.weapons = [];
    this.relics = [];
    this.maxWeapons = 5;
    this.stats = this.emptyStats();
  }

  emptyStats() {
    return {
      moveSpeed: 0, pickupRadius: 0, maxHull: 0, damage: 0,
      xpGain: 0, crit: 0, haste: 0, lifesteal: 0, area: 0, armour: 0,
    };
  }

  addWeapon(weapon) {
    if (this.weapons.length >= this.maxWeapons) return false;
    this.weapons.push(weapon);
    return true;
  }

  addRelic(relic) {
    const existing = this.relics.find((r) => r.relicKey === relic.relicKey && r.name === relic.name);
    if (existing) {
      existing.level += 1;
      existing.amount += relic.amount * 0.7;
    } else {
      this.relics.push(relic);
    }
    this.recomputeStats();
  }

  recomputeStats() {
    const stats = this.emptyStats();
    for (const relic of this.relics) stats[relic.stat] += relic.amount;
    this.stats = stats;
  }

  /** Weapons eligible to be levelled, i.e. ones already carried. */
  upgradable() {
    return this.weapons.filter((w) => w.level < 9);
  }

  /**
   * Three cards. The mix is deliberate: while there is room for a new weapon the
   * offer leans toward breadth, and once the rack is full it leans toward depth,
   * so a build converges instead of sprawling.
   */
  offer(depth) {
    const rng = this.rng;
    const cards = [];
    const roomForWeapon = this.weapons.length < this.maxWeapons;
    const upgradable = this.upgradable();

    const makeCard = (type) => {
      if (type === 'weapon') {
        const weapon = generateWeapon(rng, depth);
        return {
          type: 'weapon', item: weapon, title: weapon.name,
          subtitle: weapon.epithet || 'NEW WEAPON',
          lines: describeWeapon(weapon),
          rarity: weapon.rarity,
        };
      }
      if (type === 'upgrade' && upgradable.length) {
        const target = rng.pick(upgradable);
        const preview = { ...target, level: target.level + 1, stats: null };
        recomputeWeapon(preview);
        return {
          type: 'upgrade', item: target, title: target.name,
          subtitle: `LEVEL ${target.level} -> ${target.level + 1}`,
          lines: [
            `DAMAGE ${Math.round(target.stats.damage)} -> ${Math.round(preview.stats.damage)}`,
            `SHOTS ${target.stats.count} -> ${preview.stats.count}`,
            target.stats.aim === 'orbit'
              ? `SPIN ${target.stats.speed.toFixed(1)} -> ${preview.stats.speed.toFixed(1)}`
              : `RATE ${target.stats.cooldown.toFixed(2)}S -> ${preview.stats.cooldown.toFixed(2)}S`,
          ],
          rarity: target.rarity,
        };
      }
      const relic = generateRelic(rng, depth);
      return {
        type: 'relic', item: relic, title: relic.name,
        subtitle: 'RELIC',
        lines: [relic.blurb.toUpperCase()],
        rarity: relic.rarity,
      };
    };

    const pool = [];
    // Never offer a weapon the rack cannot hold - a dead card is worse than no
    // card, and once full the run is about deepening what you already carry.
    if (roomForWeapon) pool.push('weapon', 'weapon');
    if (upgradable.length) pool.push('upgrade', 'upgrade', 'upgrade');
    pool.push('relic', 'relic');

    const used = new Set();
    // The first few levels always show a weapon. A bullet heaven only sings once
    // there are several things firing at once, and a rack that fills by chance
    // leaves too many runs stuck on the one gun you started with.
    if (roomForWeapon && this.weapons.length < 3) {
      const card = makeCard('weapon');
      used.add(`${card.type}:${card.title}`);
      cards.push(card);
    }
    let guard = 0;
    while (cards.length < 3 && guard < 40) {
      guard += 1;
      const card = makeCard(rng.pick(pool));
      if (!card) continue;
      const key = `${card.type}:${card.title}`;
      if (used.has(key)) continue;
      used.add(key);
      cards.push(card);
    }
    return cards;
  }

  take(card) {
    if (card.type === 'weapon') this.addWeapon(card.item);
    else if (card.type === 'upgrade') {
      card.item.level += 1;
      recomputeWeapon(card.item);
    } else this.addRelic(card.item);
  }
}

/** Human-readable stat lines for a card. */
export function describeWeapon(weapon) {
  const s = weapon.stats;
  // An orbit has no fire rate - it is simply always there - so printing one
  // reads as a bug rather than as a stat.
  const rate = s.aim === 'orbit' ? 'CONSTANT' : `${s.cooldown.toFixed(2)}S`;
  const lines = [`${Math.round(s.damage)} DMG X${s.count}  ${rate}`];
  const traits = [];
  if (s.pierce > 0) traits.push(`PIERCE ${s.pierce}`);
  if (s.blast > 0) traits.push('BLAST');
  if (s.chain > 0) traits.push(`CHAIN ${s.chain}`);
  if (s.homing > 0) traits.push('HOMING');
  if (s.slow > 0) traits.push('SLOW');
  if (s.pull > 0) traits.push('PULL');
  if (s.burn > 0) traits.push('ROT');
  if (s.crit > 0) traits.push(`CRIT ${Math.round(s.crit * 100)}%`);
  if (traits.length) lines.push(traits.join('  '));
  lines.push(weapon.blurb.toUpperCase());
  return lines;
}
