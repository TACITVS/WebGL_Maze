import { ACTION_BINDINGS, COLORS, GAME_CONSTANTS, POWER_UP_COLORS } from '../constants.js';
import { SimpleECS } from '../core/simpleEcs.js';
import { GameStateManager } from '../state/gameStateManager.js';
import { FiniteStateMachine } from '../fsm/finiteStateMachine.js';
import { AudioManager } from '../audio/audioManager.js';
import { UIManager } from '../ui/uiManager.js';
import { initializeCustomCursor } from '../ui/cursor.js';

const THREE = window.THREE;

/**
 * Main orchestrator that wires together ECS, rendering, audio and UI.
 */
export class NexusMazeGame {
  constructor() {
    this.ecs = new SimpleECS();
    this.world = this.ecs.createWorld();
    this.audio = new AudioManager();
    this.gameState = new GameStateManager();
    this.ui = new UIManager(this.gameState);
    this.ui.setSpeedBoostChecker(() =>
      this.ecs.entityExists(this.world, this.state.playerEid) &&
      this.ecs.hasComponent(this.world, this.SpeedBoost, this.state.playerEid),
    );

    this.state = {
      scene: null,
      camera: null,
      renderer: null,
      playerEid: -1,
      maze: [],
      visitedCells: [],
      startTime: null,
      lastTime: 0,
      frameCount: 0,
      cameraMode: 'third',
      currentMazeSize: GAME_CONSTANTS.INITIAL_MAZE_SIZE,
      groundMesh: null,
      gridHelper: null,
      jumpReady: true,
      minimapCanvas: null,
      minimapCtx: null,
      audioInitialized: false,
      screenShake: 0,
      moveTimer: 0,
      isBoosting: false,
      effectsQueue: [],
      gameState: 'loading',
    };

    this.fsmInstances = new Map();
    this.particlePool = [];
    this.threeJSObjectMap = new Map();
    this.activeActions = new Set();

    this.#defineComponents();
    this.#defineQueries();
  }

  async initialize() {
    initializeCustomCursor();
    const { audioButton } = this.ui.elementsMap;
    audioButton.addEventListener('click', () => this.audio.toggleMute(audioButton));
    await this.ui.runLoadingSequence();
    this.#registerInputListeners();
    this.#initializeRenderer();
    this.#initializeParticlePool();
    this.#createLevel();
    this.state.startTime = Date.now();
    this.#animate(0);
  }

  /** Component definitions for the ECS. */
  #defineComponents() {
    this.Position = this.ecs.defineComponent();
    this.Velocity = this.ecs.defineComponent();
    this.ThreeJSObject = this.ecs.defineComponent();
    this.Player = this.ecs.defineComponent();
    this.Wall = this.ecs.defineComponent();
    this.Collectible = this.ecs.defineComponent();
    this.Goal = this.ecs.defineComponent();
    this.Particle = this.ecs.defineComponent();
    this.Trail = this.ecs.defineComponent();
    this.Animation = this.ecs.defineComponent();
    this.Enemy = this.ecs.defineComponent();
    this.PowerUp = this.ecs.defineComponent();
    this.MovingWall = this.ecs.defineComponent();
    this.Health = this.ecs.defineComponent();
    this.AI = this.ecs.defineComponent();
    this.Effect = this.ecs.defineComponent();
    this.Timer = this.ecs.defineComponent();
    this.EffectTimer = this.ecs.defineComponent();
    this.SpeedBoost = this.ecs.defineComponent();
    this.InvulnerabilityShield = this.ecs.defineComponent();
    this.ScoreMultiplierEffect = this.ecs.defineComponent();
  }

  /** Frequently used ECS queries. */
  #defineQueries() {
    this.queries = {
      player: this.ecs.defineQuery([this.Player, this.Position, this.Velocity]),
      moving: this.ecs.defineQuery([this.Position, this.Velocity]),
      collectibles: this.ecs.defineQuery([this.Collectible, this.Position]),
      goals: this.ecs.defineQuery([this.Goal, this.Position]),
      enemies: this.ecs.defineQuery([this.Enemy, this.Position, this.Velocity]),
      powerUps: this.ecs.defineQuery([this.PowerUp, this.Position]),
      particles: this.ecs.defineQuery([this.Particle, this.Position, this.Velocity]),
      timers: this.ecs.defineQuery([this.EffectTimer]),
      enemyAI: this.ecs.defineQuery([this.AI]),
      trails: this.ecs.defineQuery([this.Trail, this.ThreeJSObject]),
      animated: this.ecs.defineQuery([this.Position, this.Animation, this.ThreeJSObject]),
      rendered: this.ecs.defineQuery([this.Position, this.ThreeJSObject]),
    };
  }

  #registerInputListeners() {
    const gestureHandler = async () => {
      if (!this.state.audioInitialized && !this.audio.muted) {
        await this.audio.initialize();
        this.state.audioInitialized = true;
      }
      document.removeEventListener('keydown', gestureHandler);
      document.removeEventListener('click', gestureHandler);
      document.removeEventListener('touchstart', gestureHandler);
    };
    document.addEventListener('keydown', gestureHandler);
    document.addEventListener('click', gestureHandler);
    document.addEventListener('touchstart', gestureHandler);

    const { restartButton, restartButtonWon } = this.ui.elementsMap;
    restartButton.addEventListener('click', () => this.#restartGame());
    restartButtonWon.addEventListener('click', () => this.#restartGame());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyR') {
        this.#createLevel();
        this.gameState.score = Math.max(0, this.gameState.score - 50);
      } else if (event.code === 'KeyC') {
        this.state.cameraMode = this.state.cameraMode === 'third' ? 'first' : 'third';
      } else if (event.code === 'KeyM') {
        this.audio.toggleMute(this.ui.elementsMap.audioButton);
      }

      const action = ACTION_BINDINGS[event.code];
      if (action) {
        this.activeActions.add(action);
      }
    });

    window.addEventListener('keyup', (event) => {
      const action = ACTION_BINDINGS[event.code];
      if (action) {
        this.activeActions.delete(action);
      }
      if (action === 'BOOST' && !this.activeActions.has('BOOST')) {
        this.audio.play('boostEnd');
        this.state.isBoosting = false;
      }
    });

    window.addEventListener('resize', () => {
      if (this.state.camera && this.state.renderer) {
        this.state.camera.aspect = window.innerWidth / window.innerHeight;
        this.state.camera.updateProjectionMatrix();
        this.state.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    });
  }

  #initializeRenderer() {
    this.state.scene = new THREE.Scene();
    this.state.scene.background = new THREE.Color(0x0a0f1a);
    this.state.scene.fog = new THREE.FogExp2(0x0a0f1a, 0.02);

    this.state.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );

    this.state.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.state.renderer.setSize(window.innerWidth, window.innerHeight);
    this.state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.state.renderer.shadowMap.enabled = true;
    this.state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(this.state.renderer.domElement);

    this.state.scene.add(new THREE.AmbientLight(COLORS.primary, 0.3));
    const directional = new THREE.DirectionalLight(COLORS.primary, 1.5);
    directional.position.set(50, 100, 50);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    this.state.scene.add(directional);

    this.state.minimapCanvas = this.ui.elementsMap.minimap;
    this.state.minimapCtx = this.state.minimapCanvas.getContext('2d');
    this.state.minimapCanvas.width = 180;
    this.state.minimapCanvas.height = 180;
  }

  #initializeParticlePool() {
    const geometry = new THREE.SphereGeometry(0.05, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
    for (let i = 0; i < GAME_CONSTANTS.PARTICLE_POOL_SIZE; i += 1) {
      const eid = this.ecs.addEntity(this.world);
      const mesh = new THREE.Mesh(geometry, material.clone());
      mesh.visible = false;
      this.state.scene.add(mesh);
      this.threeJSObjectMap.set(eid, mesh);

      this.ecs.addComponent(this.world, this.Particle, eid, {
        active: false,
        life: 0,
        maxLife: 60,
      });
      this.ecs.addComponent(this.world, this.Position, eid, { x: 0, y: 0, z: 0 });
      this.ecs.addComponent(this.world, this.Velocity, eid, { x: 0, y: 0, z: 0 });
      this.ecs.addComponent(this.world, this.ThreeJSObject, eid, { eid });
      this.particlePool.push(eid);
    }
  }

  #restartGame() {
    this.ui.elementsMap.gameOverScreen.style.display = 'none';
    this.ui.elementsMap.gameWonScreen.style.display = 'none';
    this.gameState.reset();
    this.#createLevel();
    this.state.startTime = Date.now();
    this.state.gameState = 'playing';
  }

  #disposeAudio() {
    this.audio.dispose();
    this.state.audioInitialized = false;
  }

  #createLevel() {
    this.#disposeAudio();
    if (!this.audio.muted) {
      this.audio.initialize().then(() => {
        this.state.audioInitialized = true;
        this.audio.updateAmbient(this.gameState.level, this.gameState.health, 'playing');
      });
    }

    for (const fsm of this.fsmInstances.values()) {
      fsm.cleanup();
    }
    this.fsmInstances.clear();

    for (const eid of [...this.queries.timers(this.world)]) {
      this.ecs.removeEntity(this.world, eid);
    }

    for (const eid of [...this.ecs.entities]) {
      if (this.ecs.hasComponent(this.world, this.Particle, eid)) continue;
      const mesh = this.threeJSObjectMap.get(eid);
      if (mesh) this.state.scene.remove(mesh);
      this.ecs.removeEntity(this.world, eid);
      this.threeJSObjectMap.delete(eid);
    }

    if (this.state.groundMesh) this.state.scene.remove(this.state.groundMesh);
    if (this.state.gridHelper) this.state.scene.remove(this.state.gridHelper);

    const mazeSize = Math.min(
      GAME_CONSTANTS.INITIAL_MAZE_SIZE + Math.floor(this.gameState.level / 2) * 4,
      71,
    );
    this.state.currentMazeSize = mazeSize;
    this.state.maze = this.#generateMaze(mazeSize, mazeSize);
    this.state.visitedCells = Array.from({ length: mazeSize }, () =>
      Array(mazeSize).fill(false),
    );

    this.#createGround(mazeSize);
    this.#populateMaze(mazeSize);
    this.state.gameState = 'playing';
    this.audio.updateAmbient(this.gameState.level, this.gameState.health, 'playing');
  }

  #createGround(size) {
    const totalSize = size * GAME_CONSTANTS.CELL_SIZE;
    this.state.groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(totalSize, totalSize),
      new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 0.8 }),
    );
    this.state.groundMesh.rotation.x = -Math.PI / 2;
    this.state.groundMesh.receiveShadow = true;
    this.state.scene.add(this.state.groundMesh);

    this.state.gridHelper = new THREE.GridHelper(
      totalSize,
      size * 2,
      COLORS.primary,
      COLORS.primary,
    );
    this.state.gridHelper.material.opacity = 0.1;
    this.state.gridHelper.material.transparent = true;
    this.state.scene.add(this.state.gridHelper);
  }

  #populateMaze(size) {
    const startX = 1;
    const startZ = 1;
    const goalX = size - 2;
    const goalZ = size - 2;

    const openCells = [];
    for (let z = 1; z < size - 1; z += 1) {
      for (let x = 1; x < size - 1; x += 1) {
        if (this.state.maze[z][x] === 0) {
          openCells.push({ x, z });
        }
      }
    }

    const popCell = () => {
      if (openCells.length === 0) return null;
      const index = Math.floor(Math.random() * openCells.length);
      return openCells.splice(index, 1)[0];
    };

    this.state.playerEid = this.#createPlayer(
      (startX - size / 2) * GAME_CONSTANTS.CELL_SIZE,
      GAME_CONSTANTS.PLAYER_STARTING_Y,
      (startZ - size / 2) * GAME_CONSTANTS.CELL_SIZE,
    );
    this.#createTrail();

    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        if (this.state.maze[z][x] === 1) {
          this.#createWall(
            (x - size / 2) * GAME_CONSTANTS.CELL_SIZE,
            (z - size / 2) * GAME_CONSTANTS.CELL_SIZE,
          );
        }
      }
    }

    this.#createGoal(
      (goalX - size / 2) * GAME_CONSTANTS.CELL_SIZE,
      (goalZ - size / 2) * GAME_CONSTANTS.CELL_SIZE,
    );

    const enemyCount = Math.floor(this.gameState.level * 1.5 + 2);
    for (let i = 0; i < enemyCount; i += 1) {
      const cell = popCell();
      if (!cell || (Math.abs(cell.x - startX) < 5 && Math.abs(cell.z - startZ) < 5)) continue;
      this.#createEnemy(
        (cell.x - size / 2) * GAME_CONSTANTS.CELL_SIZE,
        1,
        (cell.z - size / 2) * GAME_CONSTANTS.CELL_SIZE,
        Math.random() < 0.7 ? 'patrol' : 'chaser',
      );
    }

    const powerUpCount = Math.floor(this.gameState.level * 0.8 + 1);
    const powerTypes = ['speed', 'energy', 'shield', 'multiplier'];
    for (let i = 0; i < powerUpCount; i += 1) {
      const cell = popCell();
      if (!cell) continue;
      const type = powerTypes[Math.floor(Math.random() * powerTypes.length)];
      this.#createPowerUp(
        (cell.x - size / 2) * GAME_CONSTANTS.CELL_SIZE,
        GAME_CONSTANTS.POWERUP_SPAWN_Y,
        (cell.z - size / 2) * GAME_CONSTANTS.CELL_SIZE,
        type,
      );
    }

    const collectibleCount = Math.floor(size * 1.2);
    for (let i = 0; i < collectibleCount; i += 1) {
      const cell = popCell();
      if (!cell) continue;
      this.#createCollectible(
        (cell.x - size / 2) * GAME_CONSTANTS.CELL_SIZE,
        1,
        (cell.z - size / 2) * GAME_CONSTANTS.CELL_SIZE,
        i,
      );
    }
  }

  #createPlayer(x, y, z) {
    const eid = this.ecs.addEntity(this.world);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(GAME_CONSTANTS.PLAYER_RADIUS, 32, 32),
      new THREE.MeshStandardMaterial({
        color: COLORS.primary,
        emissive: COLORS.primary,
        emissiveIntensity: 0.4,
        metalness: 0.8,
      }),
    );
    mesh.castShadow = true;
    mesh.add(new THREE.PointLight(COLORS.primary, 2, 15));

    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 16, 16),
      new THREE.MeshBasicMaterial({ color: COLORS.primary, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
    );
    mesh.add(aura);

    this.state.scene.add(mesh);
    this.threeJSObjectMap.set(eid, mesh);
    this.ecs.addComponent(this.world, this.Player, eid);
    this.ecs.addComponent(this.world, this.Position, eid, { x, y, z });
    this.ecs.addComponent(this.world, this.Velocity, eid, { x: 0, y: 0, z: 0 });
    this.ecs.addComponent(this.world, this.ThreeJSObject, eid, { eid });
    return eid;
  }

  #createTrail() {
    const eid = this.ecs.addEntity(this.world);
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: COLORS.primary, transparent: true, opacity: 0.6 }),
    );
    line.points = [];
    this.state.scene.add(line);
    this.threeJSObjectMap.set(eid, line);
    this.ecs.addComponent(this.world, this.Trail, eid);
    this.ecs.addComponent(this.world, this.ThreeJSObject, eid, { eid });
  }

  #createWall(x, z) {
    const eid = this.ecs.addEntity(this.world);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(GAME_CONSTANTS.CELL_SIZE, GAME_CONSTANTS.WALL_HEIGHT, GAME_CONSTANTS.CELL_SIZE),
      new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.6 }),
    );
    mesh.castShadow = true;
    mesh.position.set(x, GAME_CONSTANTS.WALL_HEIGHT / 2, z);
    this.state.scene.add(mesh);
    this.threeJSObjectMap.set(eid, mesh);
    this.ecs.addComponent(this.world, this.Wall, eid, { halfSize: GAME_CONSTANTS.CELL_SIZE / 2 });
    this.ecs.addComponent(this.world, this.Position, eid, {
      x,
      y: GAME_CONSTANTS.WALL_HEIGHT / 2,
      z,
    });
  }

  #createGoal(x, z) {
    const eid = this.ecs.addEntity(this.world);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.8, 0.3, 16),
      new THREE.MeshStandardMaterial({ color: COLORS.success, emissive: COLORS.success, emissiveIntensity: 0.5 }),
    );
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 1.5, 8, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: COLORS.success, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    beam.position.y = 4;
    mesh.add(beam);
    this.state.scene.add(mesh);
    this.threeJSObjectMap.set(eid, mesh);
    this.ecs.addComponent(this.world, this.Goal, eid);
    this.ecs.addComponent(this.world, this.Position, eid, { x, y: 0.15, z });
    this.ecs.addComponent(this.world, this.Animation, eid, { speed: 0.02, phase: 0 });
    this.ecs.addComponent(this.world, this.ThreeJSObject, eid, { eid });
  }

  #createCollectible(x, y, z, phase) {
    const eid = this.ecs.addEntity(this.world);
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.4),
      new THREE.MeshStandardMaterial({
        color: COLORS.accent,
        emissive: COLORS.accent,
        emissiveIntensity: 0.4,
        metalness: 0.9,
      }),
    );
    this.state.scene.add(mesh);
    this.threeJSObjectMap.set(eid, mesh);
    this.ecs.addComponent(this.world, this.Collectible, eid);
    this.ecs.addComponent(this.world, this.Position, eid, { x, y, z });
    this.ecs.addComponent(this.world, this.Animation, eid, { speed: 0.002, phase });
    this.ecs.addComponent(this.world, this.ThreeJSObject, eid, { eid });
  }

  #createPowerUp(x, y, z, type) {
    const eid = this.ecs.addEntity(this.world);
    const mesh = new THREE.Mesh(
      new THREE.TetrahedronGeometry(0.6),
      new THREE.MeshStandardMaterial({
        color: POWER_UP_COLORS[type],
        emissive: POWER_UP_COLORS[type],
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.state.scene.add(mesh);
    this.threeJSObjectMap.set(eid, mesh);
    this.ecs.addComponent(this.world, this.PowerUp, eid, { type });
    this.ecs.addComponent(this.world, this.Position, eid, { x, y, z });
    this.ecs.addComponent(this.world, this.Animation, eid, {
      speed: 0.01,
      phase: Math.random() * Math.PI * 2,
    });
    this.ecs.addComponent(this.world, this.ThreeJSObject, eid, { eid });
  }

  #createEnemy(x, y, z, type) {
    const eid = this.ecs.addEntity(this.world);
    let mesh;
    if (type === 'patrol') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        new THREE.MeshStandardMaterial({ color: COLORS.warning, emissive: COLORS.warning, emissiveIntensity: 0.3 }),
      );
    } else {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: 0xff0066, emissive: 0xff0066, emissiveIntensity: 0.4 }),
      );
    }
    mesh.castShadow = true;
    this.state.scene.add(mesh);
    this.threeJSObjectMap.set(eid, mesh);

    const speed =
      type === 'chaser' ? GAME_CONSTANTS.CHASER_BASE_SPEED : GAME_CONSTANTS.PATROL_BASE_SPEED;

    this.ecs.addComponent(this.world, this.Enemy, eid, { type, speed });
    this.ecs.addComponent(this.world, this.Position, eid, { x, y, z });
    this.ecs.addComponent(this.world, this.Velocity, eid, { x: 0, y: 0, z: 0 });
    this.ecs.addComponent(this.world, this.Animation, eid, {
      speed: 0.05,
      phase: Math.random() * Math.PI * 2,
    });
    this.ecs.addComponent(this.world, this.ThreeJSObject, eid, { eid });
    this.ecs.addComponent(this.world, this.AI, eid, {
      timer: 0,
      path: null,
      pathIndex: 0,
    });

    const fsm = new FiniteStateMachine(this, eid);
    this.AI.get(eid).fsm = fsm;
    this.fsmInstances.set(eid, fsm);
  }

  #generateMaze(width, height) {
    const maze = Array.from({ length: height }, () => Array(width).fill(1));
    const stack = [{ x: 1, y: 1 }];
    maze[1][1] = 0;

    while (stack.length > 0) {
      const cell = stack[stack.length - 1];
      const neighbours = [];
      const directions = [
        { x: 0, y: -2 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        { x: -2, y: 0 },
      ];

      for (const dir of directions) {
        const nx = cell.x + dir.x;
        const ny = cell.y + dir.y;
        if (nx > 0 && nx < width - 1 && ny > 0 && ny < height - 1 && maze[ny][nx] === 1) {
          neighbours.push({ x: nx, y: ny, dir });
        }
      }

      if (neighbours.length > 0) {
        const chosen = neighbours[Math.floor(Math.random() * neighbours.length)];
        maze[chosen.y][chosen.x] = 0;
        maze[cell.y + chosen.dir.y / 2][cell.x + chosen.dir.x / 2] = 0;
        stack.push(chosen);
      } else {
        stack.pop();
      }
    }

    const randomOpenings = Math.floor(width * height * 0.003);
    for (let i = 0; i < randomOpenings; i += 1) {
      const x = 2 + Math.floor(Math.random() * (width - 4));
      const y = 2 + Math.floor(Math.random() * (height - 4));
      if (x % 2 === 0 && y % 2 === 1) maze[y][x] = 0;
      if (x % 2 === 1 && y % 2 === 0) maze[y][x] = 0;
    }
    return maze;
  }

  #worldToGrid(wx, wz) {
    const size = this.state.currentMazeSize;
    const cs = GAME_CONSTANTS.CELL_SIZE;
    return { x: Math.floor(wx / cs + size / 2), z: Math.floor(wz / cs + size / 2) };
  }

  gridToWorld(gx, gz) {
    const size = this.state.currentMazeSize;
    const cs = GAME_CONSTANTS.CELL_SIZE;
    return { x: (gx - size / 2) * cs + cs / 2, z: (gz - size / 2) * cs + cs / 2 };
  }

  worldToGrid(wx, wz) {
    return this.#worldToGrid(wx, wz);
  }

  findPath(start, end) {
    const maze = this.state.maze;
    const open = [];
    const closed = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const heuristic = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
    const key = (node) => `${node.x},${node.z}`;

    gScore.set(key(start), 0);
    fScore.set(key(start), heuristic(start, end));
    open.push(start);

    while (open.length > 0) {
      open.sort((a, b) => fScore.get(key(a)) - fScore.get(key(b)));
      const current = open.shift();
      if (current.x === end.x && current.z === end.z) {
        const path = [];
        let node = current;
        while (node) {
          path.unshift(node);
          node = cameFrom.get(key(node));
        }
        return path;
      }

      closed.add(key(current));
      const neighbours = [
        { x: current.x, z: current.z - 1 },
        { x: current.x, z: current.z + 1 },
        { x: current.x - 1, z: current.z },
        { x: current.x + 1, z: current.z },
      ];

      for (const neighbour of neighbours) {
        if (
          neighbour.z < 0 ||
          neighbour.z >= maze.length ||
          neighbour.x < 0 ||
          neighbour.x >= maze[0].length ||
          maze[neighbour.z][neighbour.x] === 1
        ) {
          continue;
        }
        if (closed.has(key(neighbour))) continue;

        const tentativeG = gScore.get(key(current)) + 1;
        if (!gScore.has(key(neighbour)) || tentativeG < gScore.get(key(neighbour))) {
          cameFrom.set(key(neighbour), current);
          gScore.set(key(neighbour), tentativeG);
          fScore.set(key(neighbour), tentativeG + heuristic(neighbour, end));
          if (!open.some((node) => node.x === neighbour.x && node.z === neighbour.z)) {
            open.push(neighbour);
          }
        }
      }
    }
    return null;
  }

  #spawnParticle(x, y, z, color, life, velocity) {
    if (this.particlePool.length === 0) return;
    const eid = this.particlePool.pop();
    const particle = this.Particle.get(eid);
    particle.active = true;
    particle.life = life;
    particle.maxLife = life;

    const position = this.Position.get(eid);
    position.x = x;
    position.y = y;
    position.z = z;

    const vel = this.Velocity.get(eid);
    vel.x = velocity.x;
    vel.y = velocity.y;
    vel.z = velocity.z;

    const mesh = this.threeJSObjectMap.get(eid);
    mesh.material.color.set(color);
    mesh.material.opacity = 1;
    mesh.visible = true;
  }

  #createParticleBurst(x, y, z, color, count) {
    for (let i = 0; i < count; i += 1) {
      const velocity = {
        x: (Math.random() - 0.5) * 3,
        y: (Math.random() - 0.5) * 3,
        z: (Math.random() - 0.5) * 3,
      };
      const life = GAME_CONSTANTS.PARTICLE_BASE_LIFE +
        Math.random() * GAME_CONSTANTS.PARTICLE_LIFE_VARIANCE;
      this.#spawnParticle(x, y, z, color, life, velocity);
    }
  }

  #inputSystem(deltaTime) {
    if (!this.ecs.entityExists(this.world, this.state.playerEid)) return;
    const velocity = this.Velocity.get(this.state.playerEid);
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    if (this.state.cameraMode === 'third') {
      this.state.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
    } else {
      forward.set(0, 0, -1);
      right.set(1, 0, 0);
    }

    const speedBonus = this.ecs.hasComponent(
      this.world,
      this.SpeedBoost,
      this.state.playerEid,
    )
      ? 1.5
      : 1;

    const boosting = this.activeActions.has('BOOST') &&
      this.gameState.energy >= GAME_CONSTANTS.ENERGY_BOOST_COST;

    const finalMultiplier = (boosting ? GAME_CONSTANTS.BOOST_MULTIPLIER : 1) * speedBonus;
    const force = GAME_CONSTANTS.PLAYER_FORCE * finalMultiplier * deltaTime;

    let applied = false;
    if (this.activeActions.has('MOVE_FORWARD')) {
      velocity.x += forward.x * force;
      velocity.z += forward.z * force;
      applied = true;
    }
    if (this.activeActions.has('MOVE_BACK')) {
      velocity.x -= forward.x * force;
      velocity.z -= forward.z * force;
      applied = true;
    }
    if (this.activeActions.has('MOVE_LEFT')) {
      velocity.x -= right.x * force;
      velocity.z -= right.z * force;
      applied = true;
    }
    if (this.activeActions.has('MOVE_RIGHT')) {
      velocity.x += right.x * force;
      velocity.z += right.z * force;
      applied = true;
    }

    if (applied) {
      this.state.moveTimer += 1;
      if (this.state.moveTimer % GAME_CONSTANTS.MOVE_SOUND_INTERVAL === 0) {
        this.audio.play('move');
      }
      if (boosting) {
        this.gameState.energy -= GAME_CONSTANTS.ENERGY_BOOST_COST;
        if (!this.state.isBoosting) {
          this.audio.play('boost');
          this.state.isBoosting = true;
        }
      } else {
        this.gameState.energy += GAME_CONSTANTS.ENERGY_REGEN_RATE;
        if (this.state.isBoosting) {
          this.audio.play('boostEnd');
          this.state.isBoosting = false;
        }
      }
    } else {
      this.gameState.energy += GAME_CONSTANTS.ENERGY_REGEN_RATE;
      if (this.state.isBoosting) {
        this.audio.play('boostEnd');
        this.state.isBoosting = false;
      }
    }

    if (
      this.activeActions.has('JUMP') &&
      this.gameState.energy >= GAME_CONSTANTS.JUMP_COST &&
      this.state.jumpReady
    ) {
      this.state.jumpReady = false;
      setTimeout(() => {
        this.state.jumpReady = true;
      }, GAME_CONSTANTS.JUMP_COOLDOWN);

      this.gameState.energy -= GAME_CONSTANTS.JUMP_COST;
      this.audio.play('jump');
      this.#triggerScreenShake(5);

      const dash = new THREE.Vector3(velocity.x, 0, velocity.z);
      if (dash.lengthSq() < 0.01) {
        dash.copy(forward);
      }
      dash.normalize();
      velocity.x += dash.x * GAME_CONSTANTS.JUMP_FORCE;
      velocity.z += dash.z * GAME_CONSTANTS.JUMP_FORCE;

      const position = this.Position.get(this.state.playerEid);
      this.#createParticleBurst(position.x, position.y, position.z, COLORS.primary, 8);
    }
  }

  #movementSystem(deltaTime) {
    const friction = Math.pow(GAME_CONSTANTS.FRICTION, deltaTime * 60);
    for (const eid of this.queries.moving(this.world)) {
      const position = this.Position.get(eid);
      const velocity = this.Velocity.get(eid);
      if (this.ecs.hasComponent(this.world, this.Particle, eid)) {
        velocity.y -= GAME_CONSTANTS.PARTICLE_GRAVITY;
      } else {
        velocity.x *= friction;
        velocity.z *= friction;
      }
      position.x += velocity.x * deltaTime;
      position.y += velocity.y * deltaTime;
      position.z += velocity.z * deltaTime;
    }
  }

  #collisionSystem(deltaTime) {
    const players = this.queries.player(this.world);
    if (players.size === 0) return;
    const playerEid = players.values().next().value;
    const playerPos = this.Position.get(playerEid);
    const playerVel = this.Velocity.get(playerEid);

    const size = this.state.currentMazeSize;
    const halfSize = size / 2;
    const cellSize = GAME_CONSTANTS.CELL_SIZE;
    const halfCell = cellSize / 2;
    const gridX = Math.floor(playerPos.x / cellSize + halfSize);
    const gridZ = Math.floor(playerPos.z / cellSize + halfSize);

    for (let z = Math.max(0, gridZ - 1); z <= Math.min(size - 1, gridZ + 1); z += 1) {
      for (let x = Math.max(0, gridX - 1); x <= Math.min(size - 1, gridX + 1); x += 1) {
        if (!this.state.maze[z] || !this.state.maze[z][x]) continue;
        const worldX = (x - halfSize) * cellSize;
        const worldZ = (z - halfSize) * cellSize;
        const closestX = Math.max(worldX - halfCell, Math.min(playerPos.x, worldX + halfCell));
        const closestZ = Math.max(worldZ - halfCell, Math.min(playerPos.z, worldZ + halfCell));
        const dx = playerPos.x - closestX;
        const dz = playerPos.z - closestZ;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < GAME_CONSTANTS.PLAYER_RADIUS ** 2) {
          const distance = Math.sqrt(distanceSq) || 1;
          const normX = dx / distance;
          const normZ = dz / distance;
          const penetration = GAME_CONSTANTS.PLAYER_RADIUS - distance;
          playerPos.x += normX * penetration;
          playerPos.z += normZ * penetration;
          const dot = playerVel.x * normX + playerVel.z * normZ;
          playerVel.x -= (1 + GAME_CONSTANTS.WALL_RESTITUTION) * dot * normX;
          playerVel.z -= (1 + GAME_CONSTANTS.WALL_RESTITUTION) * dot * normZ;
          if (Math.hypot(playerVel.x, playerVel.z) > 2) {
            this.#createParticleBurst(closestX, playerPos.y, closestZ, COLORS.sparks, 1);
            if (Math.random() > 0.8) this.audio.play('scrape');
          }
        }
      }
    }

    for (const eid of [...this.queries.collectibles(this.world)]) {
      const pos = this.Position.get(eid);
      if (Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z) < GAME_CONSTANTS.COLLECTIBLE_PICKUP_RADIUS) {
        const multiplier = this.ecs.hasComponent(this.world, this.ScoreMultiplierEffect, playerEid)
          ? this.ScoreMultiplierEffect.get(playerEid).value
          : 1;
        const scoreAward = 25 * this.gameState.level;
        this.gameState.addScore(scoreAward, multiplier);
        this.gameState.energy += 10;
        this.audio.play('collect');
        this.#createParticleBurst(pos.x, pos.y, pos.z, COLORS.accent, 5);
        const mesh = this.threeJSObjectMap.get(eid);
        if (mesh) this.state.scene.remove(mesh);
        this.threeJSObjectMap.delete(eid);
        this.ecs.removeEntity(this.world, eid);
      }
    }

    for (const eid of [...this.queries.powerUps(this.world)]) {
      const pos = this.Position.get(eid);
      if (Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z) < GAME_CONSTANTS.POWERUP_PICKUP_RADIUS) {
        const power = this.PowerUp.get(eid);
        let duration = 0;
        let component = null;

        switch (power.type) {
          case 'speed':
            duration = GAME_CONSTANTS.SPEED_DURATION_MS;
            component = this.SpeedBoost;
            this.ecs.addComponent(this.world, component, playerEid);
            break;
          case 'shield':
            duration = GAME_CONSTANTS.SHIELD_DURATION_MS;
            component = this.InvulnerabilityShield;
            this.ecs.addComponent(this.world, component, playerEid);
            break;
          case 'multiplier':
            duration = GAME_CONSTANTS.MULTIPLIER_DURATION_MS;
            component = this.ScoreMultiplierEffect;
            this.ecs.addComponent(this.world, component, playerEid, {
              value: GAME_CONSTANTS.MULTIPLIER_AMOUNT,
            });
            break;
          case 'energy':
            this.gameState.energy = 100;
            break;
          default:
            break;
        }

        if (component) {
          const timerEid = this.ecs.addEntity(this.world);
          this.ecs.addComponent(this.world, this.EffectTimer, timerEid, {
            target: playerEid,
            component,
            expiration: Date.now() + duration,
          });
        }

        this.audio.play('powerUp');
        this.#triggerScreenShake(8);
        this.#createParticleBurst(pos.x, pos.y, pos.z, 0xffffff, 12);
        const mesh = this.threeJSObjectMap.get(eid);
        if (mesh) this.state.scene.remove(mesh);
        this.threeJSObjectMap.delete(eid);
        this.ecs.removeEntity(this.world, eid);
      }
    }

    const enemies = [...this.queries.enemies(this.world)];
    if (!this.ecs.hasComponent(this.world, this.InvulnerabilityShield, playerEid)) {
      for (const eid of enemies) {
        const pos = this.Position.get(eid);
        if (Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z) < GAME_CONSTANTS.ENEMY_CONTACT_RADIUS) {
          this.gameState.health -= GAME_CONSTANTS.ENEMY_CONTACT_DAMAGE;
          this.ui.flashDamage();
          this.audio.play('damage');
          this.#triggerScreenShake(15);
          this.#createParticleBurst(playerPos.x, playerPos.y, playerPos.z, 0xff0000, 8);

          const enemyVel = this.Velocity.get(eid);
          const knockX = playerPos.x - pos.x;
          const knockZ = playerPos.z - pos.z;
          const dist = Math.hypot(knockX, knockZ) || 1;
          const normX = knockX / dist;
          const normZ = knockZ / dist;
          playerVel.x += normX * GAME_CONSTANTS.ENEMY_KNOCKBACK_FORCE;
          playerVel.z += normZ * GAME_CONSTANTS.ENEMY_KNOCKBACK_FORCE;
          enemyVel.x -= normX * GAME_CONSTANTS.ENEMY_KNOCKBACK_FORCE * 0.5;
          enemyVel.z -= normZ * GAME_CONSTANTS.ENEMY_KNOCKBACK_FORCE * 0.5;

          if (this.gameState.health <= 0) {
            this.state.gameState = 'gameOver';
            this.ui.elementsMap.finalScore.textContent =
              `FINAL SCORE: ${this.gameState.score.toLocaleString()}`;
            this.ui.elementsMap.gameOverScreen.style.display = 'flex';
          }

          this.ecs.addComponent(this.world, this.InvulnerabilityShield, playerEid);
          const timerEid = this.ecs.addEntity(this.world);
          this.ecs.addComponent(this.world, this.EffectTimer, timerEid, {
            target: playerEid,
            component: this.InvulnerabilityShield,
            expiration: Date.now() + GAME_CONSTANTS.POST_DAMAGE_IFRAMES_MS,
          });
          break;
        }
      }
    }

    for (let i = 0; i < enemies.length; i += 1) {
      for (let j = i + 1; j < enemies.length; j += 1) {
        const eid1 = enemies[i];
        const eid2 = enemies[j];
        const pos1 = this.Position.get(eid1);
        const pos2 = this.Position.get(eid2);
        const dx = pos1.x - pos2.x;
        const dz = pos1.z - pos2.z;
        const distSq = dx * dx + dz * dz;
        const radius = 1.0;
        if (distSq < radius * radius && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          pos1.x += nx * overlap * 0.5;
          pos1.z += nz * overlap * 0.5;
          pos2.x -= nx * overlap * 0.5;
          pos2.z -= nz * overlap * 0.5;
        }
      }
    }

    const goals = this.queries.goals(this.world);
    if (goals.size > 0 && this.state.gameState === 'playing') {
      const goalEid = goals.values().next().value;
      const goalPos = this.Position.get(goalEid);
      if (Math.hypot(playerPos.x - goalPos.x, playerPos.z - goalPos.z) < GAME_CONSTANTS.GOAL_ACTIVATION_RADIUS) {
        const multiplier = this.ecs.hasComponent(this.world, this.ScoreMultiplierEffect, playerEid)
          ? this.ScoreMultiplierEffect.get(playerEid).value
          : 1;
        const scoreAward = 200 * this.gameState.level;
        this.gameState.addScore(scoreAward, multiplier);
        this.gameState.level += 1;
        this.gameState.health += GAME_CONSTANTS.LEVEL_UP_HEAL_AMOUNT;

        if (this.gameState.level >= GAME_CONSTANTS.VICTORY_LEVEL) {
          this.state.gameState = 'gameWon';
          this.ui.elementsMap.finalScoreWon.textContent =
            `FINAL SCORE: ${this.gameState.score.toLocaleString()}`;
          this.ui.elementsMap.gameWonScreen.style.display = 'flex';
        } else {
          this.state.gameState = 'transitioning';
          this.audio.play('levelUp');
          this.#triggerScreenShake(12);
          setTimeout(() => this.#createLevel(), 2000);
        }
      }
    }
  }

  #effectsSystem() {
    const now = Date.now();
    for (const eid of [...this.queries.timers(this.world)]) {
      const timer = this.EffectTimer.get(eid);
      if (now > timer.expiration) {
        if (this.ecs.entityExists(this.world, timer.target)) {
          this.ecs.removeComponent(this.world, timer.component, timer.target);
        }
        this.ecs.removeEntity(this.world, eid);
      }
    }
  }

  #particleSystem() {
    for (const eid of this.queries.particles(this.world)) {
      const particle = this.Particle.get(eid);
      if (!particle.active) continue;
      particle.life -= 1;
      if (particle.life <= 0) {
        particle.active = false;
        const mesh = this.threeJSObjectMap.get(eid);
        if (mesh) {
          mesh.visible = false;
        }
        this.particlePool.push(eid);
      } else {
        const mesh = this.threeJSObjectMap.get(eid);
        if (mesh) {
          mesh.material.opacity = particle.life / particle.maxLife;
        }
      }
    }
  }

  #aiSystem(deltaTime) {
    if (!this.ecs.entityExists(this.world, this.state.playerEid)) return;
    const playerPos = this.Position.get(this.state.playerEid);
    for (const eid of this.queries.enemyAI(this.world)) {
      const ai = this.AI.get(eid);
      ai.timer += 1;
      if (ai.fsm) {
        ai.fsm.update(playerPos, deltaTime);
      }
    }
  }

  #trailSystem() {
    if (!this.ecs.entityExists(this.world, this.state.playerEid)) return;
    const playerPos = this.Position.get(this.state.playerEid);
    for (const eid of this.queries.trails(this.world)) {
      const line = this.threeJSObjectMap.get(eid);
      if (!line || !line.points) continue;
      line.points.push(new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z));
      while (line.points.length > 60) {
        line.points.shift();
      }
      if (line.points.length > 1) {
        line.geometry.setFromPoints(line.points);
      }
    }
  }

  #animationSystem() {
    const now = Date.now();
    for (const eid of this.queries.animated(this.world)) {
      const pos = this.Position.get(eid);
      const anim = this.Animation.get(eid);
      const mesh = this.threeJSObjectMap.get(eid);
      if (!mesh) continue;

      if (this.ecs.hasComponent(this.world, this.Collectible, eid) ||
        this.ecs.hasComponent(this.world, this.PowerUp, eid)) {
        mesh.rotation.y += anim.speed * 100;
        pos.y = GAME_CONSTANTS.POWERUP_SPAWN_Y + Math.sin(now * anim.speed + anim.phase) * 0.4;
      }

      if (this.ecs.hasComponent(this.world, this.Goal, eid) && mesh.children[0]) {
        mesh.children[0].rotation.y += anim.speed;
        mesh.children[0].material.opacity = 0.3 + Math.sin(now * 0.003) * 0.2;
      }

      if (this.ecs.hasComponent(this.world, this.Enemy, eid)) {
        mesh.rotation.y += anim.speed;
        pos.y = 1 + Math.sin(now * anim.speed * 2 + anim.phase) * 0.1;
      }
    }
  }

  #renderSystem(deltaTime) {
    for (const eid of this.queries.rendered(this.world)) {
      const pos = this.Position.get(eid);
      const mesh = this.threeJSObjectMap.get(eid);
      if (!mesh || this.ecs.hasComponent(this.world, this.Trail, eid)) continue;
      mesh.position.set(pos.x, pos.y, pos.z);
      if (this.ecs.hasComponent(this.world, this.Player, eid)) {
        const vel = this.Velocity.get(eid);
        const speed = Math.hypot(vel.x, vel.z);
        if (speed > 0.01) {
          const axis = new THREE.Vector3(vel.z, 0, -vel.x).normalize();
          const angle = speed / GAME_CONSTANTS.PLAYER_RADIUS;
          const rotation = new THREE.Quaternion();
          rotation.setFromAxisAngle(axis, angle * deltaTime);
          mesh.quaternion.premultiply(rotation);
        }
      }
    }
  }

  #cameraSystem() {
    if (!this.ecs.entityExists(this.world, this.state.playerEid)) return;
    const playerPos = this.Position.get(this.state.playerEid);
    const target = new THREE.Vector3();
    const lookAt = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);

    if (this.state.screenShake > 0) {
      const intensity = this.state.screenShake * 0.1;
      lookAt.x += (Math.random() - 0.5) * intensity;
      lookAt.y += (Math.random() - 0.5) * intensity;
      this.state.screenShake *= 0.9;
      if (this.state.screenShake < 0.1) this.state.screenShake = 0;
    }

    if (this.state.cameraMode === 'third') {
      const height = Math.max(12, this.state.currentMazeSize * 0.4);
      const distance = Math.max(10, this.state.currentMazeSize * 0.3);
      target.set(lookAt.x, lookAt.y + height, lookAt.z + distance);
      this.state.camera.position.lerp(target, 0.05);
    } else {
      const height = Math.max(30, this.state.currentMazeSize * 1.2);
      target.set(lookAt.x, lookAt.y + height, lookAt.z);
      this.state.camera.position.copy(target);
    }
    this.state.camera.lookAt(lookAt);
  }

  #uiSystem() {
    this.ui.updateRuntimeUI(this);
  }

  #fogOfWarSystem() {
    if (!this.ecs.entityExists(this.world, this.state.playerEid)) return;
    const playerPos = this.Position.get(this.state.playerEid);
    const { x, z } = this.#worldToGrid(playerPos.x, playerPos.z);
    const radius = GAME_CONSTANTS.FOG_OF_WAR_RADIUS;
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const cellX = x + dx;
        const cellZ = z + dz;
        if (
          cellZ >= 0 &&
          cellZ < this.state.currentMazeSize &&
          cellX >= 0 &&
          cellX < this.state.currentMazeSize &&
          Math.hypot(dx, dz) <= radius + 0.5
        ) {
          this.state.visitedCells[cellZ][cellX] = true;
        }
      }
    }
  }

  #minimapSystem() {
    if (
      this.state.frameCount % GAME_CONSTANTS.MINIMAP_UPDATE_INTERVAL !== 0 ||
      !this.state.minimapCtx ||
      !this.ecs.entityExists(this.world, this.state.playerEid)
    ) {
      return;
    }

    const ctx = this.state.minimapCtx;
    const canvas = this.state.minimapCanvas;
    const size = this.state.currentMazeSize;
    const cellSize = canvas.width / size;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let z = 0; z < size; z += 1) {
      for (let x = 0; x < size; x += 1) {
        if (this.state.visitedCells[z][x]) {
          ctx.fillStyle = this.state.maze[z][x] === 1
            ? 'rgba(0, 244, 255, 0.8)'
            : 'rgba(0, 100, 150, 0.5)';
          ctx.fillRect(x * cellSize, z * cellSize, cellSize, cellSize);
        }
      }
    }

    const playerPos = this.Position.get(this.state.playerEid);
    const playerGrid = this.#worldToGrid(playerPos.x, playerPos.z);
    ctx.fillStyle = `#${COLORS.success.toString(16)}`;
    ctx.beginPath();
    ctx.arc(
      playerGrid.x * cellSize + cellSize / 2,
      playerGrid.z * cellSize + cellSize / 2,
      cellSize,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.fillStyle = `#${COLORS.warning.toString(16)}`;
    for (const eid of this.queries.enemies(this.world)) {
      const pos = this.Position.get(eid);
      const grid = this.#worldToGrid(pos.x, pos.z);
      if (this.state.visitedCells[grid.z]?.[grid.x]) {
        ctx.beginPath();
        ctx.arc(
          grid.x * cellSize + cellSize / 2,
          grid.z * cellSize + cellSize / 2,
          cellSize * 0.6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  #triggerScreenShake(intensity = 10) {
    this.state.screenShake = intensity;
  }

  #animate() {
    if (this.state.gameState === 'gameOver' || this.state.gameState === 'gameWon') {
      return;
    }
    requestAnimationFrame(this.#animate.bind(this));
    const now = performance.now();
    const deltaTime = Math.min(0.05, (now - this.state.lastTime) / 1000);
    this.state.lastTime = now;
    this.state.frameCount += 1;

    if (this.state.gameState === 'playing') {
      this.#inputSystem(deltaTime);
      this.#aiSystem(deltaTime);
      this.#movementSystem(deltaTime);
      this.#collisionSystem(deltaTime);
      this.#effectsSystem();
      this.#fogOfWarSystem();
    }

    this.#particleSystem();
    this.#trailSystem();
    this.#animationSystem();
    this.#renderSystem(deltaTime);
    this.#cameraSystem();
    this.#uiSystem();
    this.#minimapSystem();
    this.audio.updateAmbient(this.gameState.level, this.gameState.health, this.state.gameState);

    this.state.renderer.render(this.state.scene, this.state.camera);
  }
}
