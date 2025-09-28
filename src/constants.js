/**
 * Core configuration constants shared across the entire game.
 * The values are grouped for readability and to centralize tuning knobs.
 */
export const GAME_CONSTANTS = Object.freeze({
  INITIAL_MAZE_SIZE: 31,
  CELL_SIZE: 2.5,
  WALL_HEIGHT: 3,
  PLAYER_RADIUS: 0.5,
  PLAYER_STARTING_Y: 1.2,
  PLAYER_FORCE: 40.0,
  JUMP_FORCE: 30.0,
  JUMP_COST: 25,
  JUMP_COOLDOWN: 1500,
  BOOST_MULTIPLIER: 2.5,
  ENERGY_REGEN_RATE: 0.2,
  ENERGY_BOOST_COST: 0.5,
  WALL_RESTITUTION: 0.4,
  FRICTION: 0.96,
  COLLECTIBLE_PICKUP_RADIUS: 1.0,
  POWERUP_PICKUP_RADIUS: 1.2,
  POWERUP_SPAWN_Y: 1.5,
  GOAL_ACTIVATION_RADIUS: 2.0,
  PARTICLE_POOL_SIZE: 300,
  PARTICLE_BASE_LIFE: 20,
  PARTICLE_LIFE_VARIANCE: 20,
  PARTICLE_GRAVITY: 0.008,
  ENEMY_CONTACT_RADIUS: 1.0,
  ENEMY_CONTACT_DAMAGE: 20,
  ENEMY_KNOCKBACK_FORCE: 15.0,
  CHASER_BASE_SPEED: 2.0,
  PATROL_BASE_SPEED: 1.5,
  CHASER_SPEED_MULTIPLIER: 1.5,
  AI_CHASE_RADIUS: 10.0,
  AI_PATROL_RADIUS: 15.0,
  SHIELD_DURATION_MS: 8000,
  SPEED_DURATION_MS: 10000,
  MULTIPLIER_DURATION_MS: 15000,
  MULTIPLIER_AMOUNT: 3,
  POST_DAMAGE_IFRAMES_MS: 2000,
  LEVEL_UP_HEAL_AMOUNT: 25,
  VICTORY_LEVEL: 20,
  MINIMAP_UPDATE_INTERVAL: 5,
  AI_DIRECTION_CHANGE_INTERVAL: 120,
  MOVE_SOUND_INTERVAL: 12,
  FOG_OF_WAR_RADIUS: 2,
});

/** Palette used for all visual and audio cues. */
export const COLORS = Object.freeze({
  primary: 0x00f4ff,
  secondary: 0x0080ff,
  accent: 0x8000ff,
  warning: 0xff6b00,
  success: 0x00ff80,
  wall: 0x2a4858,
  ground: 0x1a2332,
  sparks: 0xffd700,
});

/** Maps keyboard events to the logical input actions used by the game. */
export const ACTION_BINDINGS = Object.freeze({
  KeyW: 'MOVE_FORWARD',
  ArrowUp: 'MOVE_FORWARD',
  KeyS: 'MOVE_BACK',
  ArrowDown: 'MOVE_BACK',
  KeyA: 'MOVE_LEFT',
  ArrowLeft: 'MOVE_LEFT',
  KeyD: 'MOVE_RIGHT',
  ArrowRight: 'MOVE_RIGHT',
  Space: 'JUMP',
  ShiftLeft: 'BOOST',
  ShiftRight: 'BOOST',
});

/** Predefined power-up colors for quick lookups. */
export const POWER_UP_COLORS = Object.freeze({
  speed: 0x00ffff,
  energy: 0xffff00,
  shield: 0x00ff00,
  multiplier: 0xff00ff,
});
