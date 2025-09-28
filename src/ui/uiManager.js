/**
 * Keeps DOM elements synchronized with the current game state.
 */
export class UIManager {
  constructor(gameState) {
    this.gameState = gameState;
    this.elements = this.#cacheElements();
    this.hasSpeedBoost = () => false;
    this.#initializeBindings();
  }

  setSpeedBoostChecker(fn) {
    this.hasSpeedBoost = fn;
  }

  get elementsMap() {
    return this.elements;
  }

  #cacheElements() {
    return {
      ui: document.getElementById('ui'),
      score: document.getElementById('score'),
      time: document.getElementById('time'),
      level: document.getElementById('level'),
      health: document.getElementById('health'),
      energy: document.getElementById('energy'),
      position: document.getElementById('position'),
      jumpStatus: document.getElementById('jump-status'),
      damageFlash: document.getElementById('damageFlash'),
      loading: document.getElementById('loading'),
      progress: document.getElementById('progress'),
      loadingStatus: document.getElementById('loading-status'),
      minimap: document.getElementById('minimap'),
      audioButton: document.getElementById('audio-button'),
      restartButton: document.getElementById('restartButton'),
      restartButtonWon: document.getElementById('restartButtonWon'),
      gameOverScreen: document.getElementById('gameOverScreen'),
      gameWonScreen: document.getElementById('gameWonScreen'),
      finalScore: document.getElementById('finalScore'),
      finalScoreWon: document.getElementById('finalScoreWon'),
    };
  }

  #initializeBindings() {
    const { score, level, health, energy } = this.elements;
    this.gameState.on('scoreChanged', (value) => {
      score.textContent = value.toLocaleString();
    });
    this.gameState.on('levelChanged', (value) => {
      level.textContent = value;
    });
    this.gameState.on('healthChanged', (value) => {
      const percent = Math.floor(value);
      const emoji = percent > 60 ? '💚' : percent > 30 ? '💛' : '❤️';
      health.textContent = `${emoji} ${percent}%`;
      health.style.color = percent > 60 ? '#00ff80' : percent > 30 ? '#ffff00' : '#ff4040';
    });
    this.gameState.on('energyChanged', (value) => {
      const percent = Math.floor(value);
      const speedBonus = this.hasSpeedBoost() ? '🚀' : '';
      energy.textContent = `⚡ ${percent}% ${speedBonus}`;
    });

    this.gameState.emit('scoreChanged', this.gameState.score);
    this.gameState.emit('levelChanged', this.gameState.level);
    this.gameState.emit('healthChanged', this.gameState.health);
    this.gameState.emit('energyChanged', this.gameState.energy);
  }

  async runLoadingSequence() {
    const steps = [
      { progress: 10, status: 'Calibrating physics engine...' },
      { progress: 70, status: 'Initializing particle systems...' },
      { progress: 100, status: 'NEXUS MAZE ready!' },
    ];

    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      this.elements.progress.style.width = `${step.progress}%`;
      this.elements.loadingStatus.textContent = step.status;
    }

    await new Promise((resolve) => {
      setTimeout(() => {
        this.elements.loading.style.opacity = '0';
        setTimeout(() => {
          this.elements.loading.style.display = 'none';
          this.elements.ui.style.display = 'block';
          this.elements.minimap.style.display = 'block';
          this.elements.audioButton.style.display = 'flex';
          resolve();
        }, 500);
      }, 200);
    });
  }

  updateRuntimeUI(game) {
    if (!game.ecs.entityExists(game.world, game.state.playerEid)) return;
    const playerPos = game.Position.get(game.state.playerEid);
    this.elements.time.textContent =
      `${Math.floor((Date.now() - game.state.startTime) / 1000)}s`;
    this.elements.position.textContent = `(${playerPos.x.toFixed(1)}, ${playerPos.z.toFixed(1)})`;

    const jumpColor = game.state.jumpReady ? '#00f4ff' : '#ff6b00';
    this.elements.jumpStatus.innerHTML =
      `<strong>PHASE DASH:</strong> <span style="color: ${jumpColor};">${
        game.state.jumpReady ? 'READY' : 'RECHARGING'
      }</span>`;

    let powerUpText = '';
    if (game.ecs.hasComponent(game.world, game.InvulnerabilityShield, game.state.playerEid)) {
      powerUpText += '🛡️ SHIELD ';
    }
    if (game.ecs.hasComponent(game.world, game.ScoreMultiplierEffect, game.state.playerEid)) {
      powerUpText += '✨ MULTIPLIER ';
    }
    if (game.ecs.hasComponent(game.world, game.SpeedBoost, game.state.playerEid)) {
      powerUpText += '🚀 SPEED ';
    }
    if (powerUpText) {
      this.elements.jumpStatus.innerHTML += `\n<span style="color: #ff00ff; font-size: 10px;">${powerUpText}</span>`;
    }
  }

  flashDamage() {
    const { damageFlash } = this.elements;
    damageFlash.style.display = 'block';
    damageFlash.style.opacity = '1';
    setTimeout(() => {
      damageFlash.style.opacity = '0';
      setTimeout(() => {
        damageFlash.style.display = 'none';
      }, 100);
    }, 75);
  }
}
