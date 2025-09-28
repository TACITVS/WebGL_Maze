import { PatrollingState } from './states.js';

/**
 * Wraps enemy behaviour inside a modular state machine.
 */
export class FiniteStateMachine {
  constructor(game, entityId) {
    this.game = game;
    this.entityId = entityId;
    this.ai = game.AI.get(entityId);
    this.enemy = game.Enemy.get(entityId);
    this.velocity = game.Velocity.get(entityId);
    this.position = game.Position.get(entityId);
    this.currentState = new PatrollingState(this);
    this.currentState.enter();
  }

  update(playerPos, deltaTime) {
    if (this.currentState) {
      this.currentState.update(playerPos, deltaTime);
    }
  }

  cleanup() {
    this.currentState = null;
    this.ai = null;
    this.enemy = null;
    this.velocity = null;
    this.position = null;
    this.game = null;
  }
}
