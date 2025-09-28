import { NexusMazeGame } from './game/nexusMazeGame.js';

window.addEventListener('DOMContentLoaded', () => {
  if (!window.THREE || !window.Tone) {
    console.error('Three.js or Tone.js failed to load');
    return;
  }
  const game = new NexusMazeGame();
  game.initialize();
});
