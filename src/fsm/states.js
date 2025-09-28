import { GAME_CONSTANTS } from '../constants.js';

const THREE = window.THREE;

/** Base class for enemy AI states. */
export class FSMState {
  constructor(fsm) {
    this.fsm = fsm;
  }

  enter() {}
  exit() {}
  update() {}
}

/** Enemy patrol state responsible for random wandering. */
export class PatrollingState extends FSMState {
  enter() {
    const { ai } = this.fsm;
    ai.path = null;
    ai.pathIndex = 0;
    this.#findNewPatrolPoint();
  }

  update(playerPos) {
    const { ai, enemy, velocity, position, game } = this.fsm;
    const distanceToPlayer = Math.hypot(
      playerPos.x - position.x,
      playerPos.z - position.z,
    );
    if (
      enemy.type === 'chaser' &&
      distanceToPlayer < GAME_CONSTANTS.AI_CHASE_RADIUS
    ) {
      this.fsm.currentState = new ChasingState(this.fsm);
      return;
    }

    if (!ai.path || ai.pathIndex >= ai.path.length) {
      this.#findNewPatrolPoint();
      if (!ai.path) return;
    }

    const targetNode = ai.path[ai.pathIndex];
    const targetPos = game.gridToWorld(targetNode.x, targetNode.z);
    const distToTarget = Math.hypot(
      targetPos.x - position.x,
      targetPos.z - position.z,
    );

    if (distToTarget < 1.0) {
      ai.pathIndex += 1;
      if (ai.pathIndex >= ai.path.length) {
        this.#findNewPatrolPoint();
      }
      return;
    }

    const moveSpeed = enemy.speed;
    velocity.x = ((targetPos.x - position.x) / distToTarget) * moveSpeed;
    velocity.z = ((targetPos.z - position.z) / distToTarget) * moveSpeed;
  }

  #findNewPatrolPoint() {
    const { ai, game, position } = this.fsm;
    const size = game.state.currentMazeSize;
    let targetX;
    let targetZ;
    do {
      targetX = Math.floor(Math.random() * size);
      targetZ = Math.floor(Math.random() * size);
    } while (game.state.maze[targetZ][targetX] !== 0);

    const startNode = game.worldToGrid(position.x, position.z);
    ai.path = game.findPath(startNode, { x: targetX, z: targetZ });
    ai.pathIndex = 0;
  }
}

/** Enemy chasing behaviour with adaptive path finding. */
export class ChasingState extends FSMState {
  enter() {
    const { ai, game } = this.fsm;
    game.audio.play('enemyAlert');
    ai.path = null;
    ai.pathIndex = 0;
  }

  update(playerPos, deltaTime) {
    const { enemy, velocity, position, game, ai } = this.fsm;
    const distanceToPlayer = Math.hypot(
      playerPos.x - position.x,
      playerPos.z - position.z,
    );

    if (distanceToPlayer > GAME_CONSTANTS.AI_PATROL_RADIUS) {
      this.fsm.currentState = new PatrollingState(this.fsm);
      return;
    }

    if (ai.timer % 30 === 0) {
      const startNode = game.worldToGrid(position.x, position.z);
      const endNode = game.worldToGrid(playerPos.x, playerPos.z);
      ai.path = game.findPath(startNode, endNode);
      ai.pathIndex = 0;
    }

    if (ai.path && ai.path.length > 0) {
      const targetNode = ai.path[ai.pathIndex];
      const targetPos = game.gridToWorld(targetNode.x, targetNode.z);
      const distanceToTarget = Math.hypot(
        targetPos.x - position.x,
        targetPos.z - position.z,
      );

      if (distanceToTarget < 1.0) {
        ai.pathIndex += 1;
        if (ai.pathIndex >= ai.path.length) {
          ai.path = null;
        }
        return;
      }

      const chaseSpeed = enemy.speed * GAME_CONSTANTS.CHASER_SPEED_MULTIPLIER;
      velocity.x = ((targetPos.x - position.x) / distanceToTarget) * chaseSpeed;
      velocity.z = ((targetPos.z - position.z) / distanceToTarget) * chaseSpeed;
      return;
    }

    const chaseSpeed = enemy.speed * GAME_CONSTANTS.CHASER_SPEED_MULTIPLIER;
    velocity.x = ((playerPos.x - position.x) / distanceToPlayer) * chaseSpeed;
    velocity.z = ((playerPos.z - position.z) / distanceToPlayer) * chaseSpeed;
  }
}

export const ENEMY_STATES = Object.freeze({
  patrolling: PatrollingState,
  chasing: ChasingState,
});
