import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://blastarenaclient.vercel.app"
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  })
);

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const ALLOWED_SKINS = [
  "stickman",
  "ninja",
  "iceMonster",
  "bear",
  "superSaiyan",
  "itadori",
  "gojo",
  "naruto",
  "rick",
  "morty",
  "pickleRick"
];

const MAP_THEMES = [
  "classic",
  "forest",
  "ice",
  "lava"
];

const ALLOWED_EMOJIS = [
  "😂",
  "😡",
  "😭",
  "🔥",
  "👍",
  "👎",
  "💣",
  "😱",
  "shiu",
  "drinking"
];

const TILE_EMPTY = ".";
const TILE_WALL = "#";
const TILE_BOX = "x";
const TICK_MS = 180;

const PAINT_SHOT_COOLDOWN_MS = 250;
const PAINT_RAPID_SHOT_COOLDOWN_MS = 110;
const PAINT_PROJECTILE_STEP_MS = 45;
const PAINT_PROJECTILE_SPEED = 0.42;
const PAINT_PROJECTILE_RANGE = 12;
const PAINT_MAX_HEALTH = 5;
const PAINT_MAX_AMMO = 10;
const PAINT_DOUBLE_AMMO = 20;
const PAINT_RELOAD_MS = 1500;
const PAINT_RESPAWN_MS = 2000;
const PAINT_POWER_DURATION_MS = 8000;
const PAINT_CAPTURE_TARGET = 3;
const PAINT_TIRE_COUNT = 14;
const PAINT_POWER_COUNT = 4;

const WIDTH = 13;
const HEIGHT = 11;

const BOMB_FUSE_MS = 2200;
const BOT_STEP_MS = 130;

const SPAWNS = [
  { x: 1, y: 1 },
  { x: 11, y: 9 },
  { x: 11, y: 1 },
  { x: 1, y: 9 }
];

const SAFE_CELLS = [
  "1,1", "2,1", "1,2",
  "11,9", "10,9", "11,8",
  "11,1", "10,1", "11,2",
  "1,9", "2,9", "1,8"
];

const rooms = new Map();

const HUNTER_STEP_MS = 260;
const HUNTER_LIFETIME_MS = 9000;
const HUNTER_PUSH_DISTANCE = 2;

const BOMB_SLIDE_MS = 130;
const bombSlideTimers = new Map();

function createRandomMap() {
  const map = [];

  for (let y = 0; y < HEIGHT; y++) {
    const row = [];

    for (let x = 0; x < WIDTH; x++) {
      const edge = x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1;
      const fixedWall = x % 2 === 0 && y % 2 === 0;

      if (edge || fixedWall) {
        row.push(TILE_WALL);
      } else if (SAFE_CELLS.includes(`${x},${y}`)) {
        row.push(TILE_EMPTY);
      } else {
        row.push(Math.random() < 0.65 ? TILE_BOX : TILE_EMPTY);
      }
    }

    map.push(row);
  }

  return map;
}

function createPaintMap() {
  const map = [];

  for (let y = 0; y < HEIGHT; y += 1) {
    const row = [];

    for (let x = 0; x < WIDTH; x += 1) {
      const edge =
        x === 0 ||
        y === 0 ||
        x === WIDTH - 1 ||
        y === HEIGHT - 1;

      row.push(
        edge
          ? TILE_WALL
          : TILE_EMPTY
      );
    }

    map.push(row);
  }

  return map;
}

function getPaintFlagBases() {
  return [
    {
      team: 1,
      x: 1,
      y: Math.floor(HEIGHT / 2)
    },
    {
      team: 2,
      x: WIDTH - 2,
      y: Math.floor(HEIGHT / 2)
    }
  ];
}

function isPaintReservedCell(x, y) {
  const reserved = [
    ...SPAWNS,
    ...getPaintFlagBases()
  ];

  return reserved.some(cell => {
    return (
      Math.abs(cell.x - x) <= 1 &&
      Math.abs(cell.y - y) <= 1
    );
  });
}

function createPaintBarriers() {
  const barriers = [];
  let attempts = 0;

  while (
    barriers.length < PAINT_TIRE_COUNT &&
    attempts < 500
  ) {
    attempts += 1;

    const x =
      2 +
      Math.floor(
        Math.random() * (WIDTH - 4)
      );

    const y =
      2 +
      Math.floor(
        Math.random() * (HEIGHT - 4)
      );

    if (isPaintReservedCell(x, y)) {
      continue;
    }

    const duplicate =
      barriers.some(barrier => {
        return (
          barrier.x === x &&
          barrier.y === y
        );
      });

    if (duplicate) {
      continue;
    }

    barriers.push({
      id: `tire-${x}-${y}-${Math.random()}`,
      x,
      y
    });
  }

  return barriers;
}

function createPaintFlags() {
  return getPaintFlagBases().map(base => ({
    team: base.team,
    baseX: base.x,
    baseY: base.y,
    x: base.x,
    y: base.y,
    carrierId: null,
    dropped: false
  }));
}

function isPaintBarrierAt(room, x, y) {
  return (room.paintBarriers || []).some(barrier => {
    return (
      barrier.x === x &&
      barrier.y === y
    );
  });
}

function isPaintOpenCell(room, x, y) {
  if (!isInside(room, x, y)) {
    return false;
  }

  if (room.map[y][x] !== TILE_EMPTY) {
    return false;
  }

  if (isPaintBarrierAt(room, x, y)) {
    return false;
  }

  return true;
}

function createPaintPowerUps(room) {
  const types = [
    "rapidFire",
    "armorVest",
    "heavyShot",
    "doubleMagazine"
  ];

  const powers = [];
  let attempts = 0;

  while (
    powers.length < PAINT_POWER_COUNT &&
    attempts < 300
  ) {
    attempts += 1;

    const x =
      1 +
      Math.floor(
        Math.random() * (WIDTH - 2)
      );

    const y =
      1 +
      Math.floor(
        Math.random() * (HEIGHT - 2)
      );

    if (
      !isPaintOpenCell(room, x, y) ||
      isPaintReservedCell(x, y)
    ) {
      continue;
    }

    const occupied =
      powers.some(power => {
        return (
          power.x === x &&
          power.y === y
        );
      });

    if (occupied) {
      continue;
    }

    powers.push({
      id: `paint-power-${Date.now()}-${Math.random()}`,
      x,
      y,
      type:
        types[
          Math.floor(
            Math.random() * types.length
          )
        ]
    });
  }

  return powers;
}

function triggerHiddenTrap(room, player) {
  const trapIndex =
    room.hiddenTraps.findIndex(trap => {
      const samePosition =
        trap.x === player.x &&
        trap.y === player.y;

      const isOwner =
        trap.ownerId === player.id;

      const isTeammate =
        room.mode === "duoBots" &&
        trap.ownerTeam &&
        player.team &&
        trap.ownerTeam === player.team;

      return (
        samePosition &&
        !isOwner &&
        !isTeammate
      );
    });

  if (trapIndex === -1) {
    return false;
  }

  const trap =
    room.hiddenTraps[trapIndex];

  room.hiddenTraps.splice(
    trapIndex,
    1
  );

  const targetSocket =
    io.sockets.sockets.get(player.id);

  let effectDuration = 0;

  if (trap.type === "slowTrap") {
    if (room.mapTheme === "ice") {
      effectDuration = 1500;

      player.frozenUntil =
        Date.now() + effectDuration;

      targetSocket?.emit(
        "trapMessage",
        "Você foi congelado!"
      );
    } else if (
      room.mapTheme === "forest"
    ) {
      effectDuration = 1500;

      player.rootedUntil =
        Date.now() + effectDuration;

      targetSocket?.emit(
        "trapMessage",
        "Você ficou preso em vinhas!"
      );
    } else {
      effectDuration = 10_000;

      player.slowUntil =
        Date.now() + effectDuration;

      targetSocket?.emit(
        "trapMessage",
        "Você caiu em uma poção de lentidão!"
      );
    }
  }

  if (trap.type === "visionTrap") {
  effectDuration = 7000;

  player.blindedUntil =
    Date.now() + effectDuration;

  targetSocket?.emit(
    "trapMessage",
    "Sua visão foi reduzida!"
  );

  const ownerSocket =
    io.sockets.sockets.get(
      trap.ownerId
    );

  ownerSocket?.emit(
    "opponentEffectMessage",
    `👁 ${player.name} está com a visão reduzida!`
  );
}

  if (effectDuration > 0) {
    setTimeout(() => {
      const currentRoom =
        rooms.get(room.code);

      if (!currentRoom) {
        return;
      }

      emitRoom(currentRoom);
    }, effectDuration + 100);
  }

  return true;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    mode: room.mode,
    gameMode: room.gameMode || "classic",

paintRoundWins: room.paintRoundWins || {
  player1: 0,
  player2: 0
},

paintFlagScores: room.paintFlagScores || {
  player1: 0,
  player2: 0
},

paintFlags: room.paintFlags || [],
paintBarriers: room.paintBarriers || [],
paintProjectiles:
  room.paintProjectiles || [],
    mapTheme: room.mapTheme,
score: room.score || {
  player1: 0,
  player2: 0
},
winStreak: room.winStreak || {
  playerNumber: null,
  count: 0
},
    started: room.started,
    winner: room.winner,
    map: room.map,
    players: room.players.map(p => ({
      id: p.id,
      number: p.number,
      name: p.name,
      x: p.x,
      y: p.y,
      alive: p.alive,
      bombRange: p.bombRange,
      maxBombs: p.maxBombs,
      speedLevel: p.speedLevel,
      shield: p.shield,
canKick: Boolean(p.canKick),
skin: p.skin || "stickman",
slowTrapCount: p.slowTrapCount || 0,
visionTrapCount: p.visionTrapCount || 0,

slowed:
  Date.now() < (p.slowUntil || 0),

frozen:
  Date.now() < (p.frozenUntil || 0),

rooted:
  Date.now() < (p.rootedUntil || 0),

blinded:
  Date.now() < (p.blindedUntil || 0),
emoji:
  Date.now() < (p.emojiUntil || 0)
    ? p.emoji
    : null,
paintHealth:
  p.paintHealth ?? PAINT_MAX_HEALTH,

paintAmmo:
  p.paintAmmo ?? PAINT_MAX_AMMO,

paintMaxAmmo:
  p.paintMaxAmmo ?? PAINT_MAX_AMMO,

paintReloading:
  Date.now() <
  (p.paintReloadingUntil || 0),

paintArmor:
  Boolean(p.paintArmor),

paintRapidFire:
  Date.now() <
  (p.paintRapidFireUntil || 0),

paintHeavyShot:
  Date.now() <
  (p.paintHeavyShotUntil || 0),

respawning:
  Date.now() <
  (p.respawningUntil || 0),

aimAngle:
  Number.isFinite(p.aimAngle)
    ? p.aimAngle
    : 0,

carryingFlagTeam:
  p.carryingFlagTeam || null,

lastDirection:
  p.lastDirection || (p.number === 1 ? "right" : "left"),

isBot: Boolean(p.isBot),
      team: p.team
    })),
    bombs: room.bombs,
    explosions: room.explosions,
    powerUps: room.powerUps,
    hunters: room.hunters || [],
    chatMessages: room.chatMessages || []
  };
}

function emitRoom(room) {
  io.to(room.code).emit("roomState", publicRoom(room));
}

function resetPlayer(player) {
  const spawn = SPAWNS[player.number - 1];

  player.x = spawn.x;
  player.y = spawn.y;
  player.alive = true;
  player.bombRange = 2;
  player.maxBombs = 1;
  player.speedLevel = 1;
  player.shield = false;
  player.canKick = false;
  player.slowTrapCount = 0;
player.slowUntil = 0;
  player.lastBombAt = 0;
player.escapePath = [];
player.goalPath = [];
player.emoji = null;
player.emojiUntil = 0;
player.visionTrapCount = 0;

player.frozenUntil = 0;
player.rootedUntil = 0;
player.blindedUntil = 0;

player.paintHealth = PAINT_MAX_HEALTH;
player.paintAmmo = PAINT_MAX_AMMO;
player.paintMaxAmmo = PAINT_MAX_AMMO;
player.lastShotAt = 0;
player.paintReloadingUntil = 0;
player.paintReloadToken = 0;
player.paintRapidFireUntil = 0;
player.paintHeavyShotUntil = 0;
player.paintArmor = false;
player.respawningUntil = 0;
player.carryingFlagTeam = null;
player.aimAngle =
  player.number === 1
    ? 0
    : Math.PI;
player.lastDirection =
  player.number === 1
    ? "right"
    : "left";
}

function createRoom(socket, optionsRaw = {}) {
  const options =
    typeof optionsRaw === "string"
      ? { mode: optionsRaw }
      : optionsRaw || {};

const playerNameRaw =
  options.playerName || "";
  const playerSkinRaw =
  options.playerSkin || "stickman";
  const modeRaw = options.mode || "1v1";
  const gameModeRaw =
  options.gameMode || "classic";

const gameMode =
  gameModeRaw === "paintball"
    ? "paintball"
    : "classic";
  const mapRaw = options.mapTheme || "random";
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();

  const mode = modeRaw === "duoBots" ? "duoBots" : "1v1";

  const mapTheme =
  mapRaw === "random"
    ? getRandomMapTheme()
    : MAP_THEMES.includes(mapRaw)
      ? mapRaw
      : "classic";

  const room = {
    code,
    mode,
    mapTheme,
    mapSelection: mapRaw,

score: {
  player1: 0,
  player2: 0
},

winStreak: {
  playerNumber: null,
  count: 0
},

roundScored: false,
    started: false,
    winner: null,
    map:
      gameMode === "paintball"
        ? createPaintMap()
        : createRandomMap(),
    players: [],
    bombs: [],
    explosions: [],
    powerUps: [],
    hunters: [],
    hiddenTraps: [],
    chatMessages: [],

    gameMode,

paintRoundWins: {
  player1: 0,
  player2: 0
},

paintFlagScores: {
  player1: 0,
  player2: 0
},

paintFlags: [],
paintBarriers: [],
paintProjectiles: [],
  };

  rooms.set(code, room);
  addHumanToRoom(
  socket,
  room,
  playerNameRaw,
  playerSkinRaw
);
  socket.emit("roomCreated", code);
  emitRoom(room);
}

function getRandomMapTheme() {
  return MAP_THEMES[
    Math.floor(
      Math.random() * MAP_THEMES.length
    )
  ];
}

function addHumanToRoom(
  socket,
  room,
  playerNameRaw = "",
  playerSkinRaw = "stickman"
) {
  const humanCount = room.players.filter(p => !p.isBot).length;
  const number = humanCount + 1;
  const spawn = SPAWNS[number - 1];
  const playerName =
  String(playerNameRaw || "")
    .trim()
    .slice(0, 15) ||
  `Jogador ${number}`;

  const playerSkin =
  ALLOWED_SKINS.includes(playerSkinRaw)
    ? playerSkinRaw
    : "stickman";

  room.players.push({
    id: socket.id,
    number,
    name: playerName,
    skin: playerSkin,
    x: spawn.x,
    y: spawn.y,
    alive: true,
    bombRange: 2,
    maxBombs: 1,
    speedLevel: 1,
    shield: false,
    canKick: false,
    slowTrapCount: 0,
slowUntil: 0,
    isBot: false,
    team: "human",
    emoji: null,
emojiUntil: 0,
visionTrapCount: 0,

frozenUntil: 0,
rootedUntil: 0,
blindedUntil: 0,

paintHealth: PAINT_MAX_HEALTH,
paintAmmo: PAINT_MAX_AMMO,
paintMaxAmmo: PAINT_MAX_AMMO,
lastShotAt: 0,
paintReloadingUntil: 0,
paintReloadToken: 0,
paintRapidFireUntil: 0,
paintHeavyShotUntil: 0,
paintArmor: false,
respawningUntil: 0,
carryingFlagTeam: null,
aimAngle:
  number === 1 ? 0 : Math.PI,
lastDirection:
  number === 1 ? "right" : "left",

    lastMoveAt: 0
  });

  socket.join(room.code);
  socket.data.roomCode = room.code;
}

function addBots(room) {
  if (room.players.some(p => p.isBot)) return;

  for (let number = 3; number <= 4; number++) {
    const spawn = SPAWNS[number - 1];

    room.players.push({
      id: `bot-${room.code}-${number}`,
      number,
      name: `Bot Hard ${number - 2}`,

      skin:
  number === 3
    ? "iceMonster"
    : "bear",

      x: spawn.x,
      y: spawn.y,
      alive: true,
      bombRange: 2,
      maxBombs: 1,
      speedLevel: 1,
      shield: false,
      canKick: false,
      slowTrapCount: 0,
slowUntil: 0,
      isBot: true,
      team: "bot",
      lastBombAt: 0,
      lastMoveAt: 0,
      lastDirection: null,
      emoji: null,
emojiUntil: 0,
visionTrapCount: 0,

frozenUntil: 0,
rootedUntil: 0,
blindedUntil: 0,

paintHealth: PAINT_MAX_HEALTH,
paintAmmo: PAINT_MAX_AMMO,
paintMaxAmmo: PAINT_MAX_AMMO,
lastShotAt: 0,
paintReloadingUntil: 0,
paintReloadToken: 0,
paintRapidFireUntil: 0,
paintHeavyShotUntil: 0,
paintArmor: false,
respawningUntil: 0,
carryingFlagTeam: null,
aimAngle: Math.PI,
lastDirection: "left",

escapePath: [],
goalPath: []
    });
  }
}

function findRoomBySocket(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function findPlayer(room, socketId) {
  return room.players.find(p => p.id === socketId);
}

function isInside(room, x, y) {
  return Boolean(room.map[y]?.[x]);
}

function isBlockedByPlayer(room, x, y, ignoreId = null) {
  return room.players.some(p => p.alive && p.id !== ignoreId && p.x === x && p.y === y);
}

function canMove(room, x, y, ignoreId = null) {
  if (!isInside(room, x, y)) return false;
  if (room.map[y][x] !== TILE_EMPTY) return false;

  if (
    room.gameMode === "paintball" &&
    isPaintBarrierAt(room, x, y)
  ) {
    return false;
  }

  if (room.bombs.some(b => b.x === x && b.y === y)) return false;
  return true;
}

function getMoveDelay(player) {
  let normalDelay;

  if (player.speedLevel >= 3) {
    normalDelay = 30;
  } else if (player.speedLevel === 2) {
    normalDelay = 60;
  } else {
    normalDelay = 90;
  }

  const isSlowed =
    Date.now() < (player.slowUntil || 0);

  if (isSlowed) {
    return Math.max(normalDelay * 6, 550);
  }

  return normalDelay;
}

function movePlayer(socket, dir) {
  const room = findRoomBySocket(socket);
  if (!room || !room.started || room.winner) return;

  const player = findPlayer(room, socket.id);
  if (!player || !player.alive || player.isBot) return;

const now = Date.now();

if (
  ["up", "down", "left", "right"]
    .includes(dir)
) {
  player.lastDirection = dir;
}

if (
  now < (player.frozenUntil || 0) ||
  now < (player.rootedUntil || 0)
) {
  return;
}

  if (now - (player.lastMoveAt || 0) < getMoveDelay(player)) return;

  if (moveEntity(room, player, dir)) {
    player.lastMoveAt = now;

    if (room.gameMode === "paintball") {
      processPaintPosition(
        room,
        player
      );
    } else {
      collectPowerUp(room, player);
      triggerHiddenTrap(room, player);
      checkWinner(room);
    }

    emitRoom(room);
  }
}

function stopBombSlide(bombId) {
  const timer = bombSlideTimers.get(bombId);

  if (timer) {
    clearInterval(timer);
    bombSlideTimers.delete(bombId);
  }
}

function canBombSlideTo(room, bomb, x, y) {
  if (!isInside(room, x, y)) return false;

  // Parede fixa, caixa ou outra barreira do mapa
  if (room.map[y][x] !== TILE_EMPTY) return false;

  // Outra bomba
  const hasAnotherBomb = room.bombs.some(otherBomb => {
    return (
      otherBomb.id !== bomb.id &&
      otherBomb.x === x &&
      otherBomb.y === y
    );
  });

  if (hasAnotherBomb) return false;

  // Jogador ou bot
  const hasPlayer = room.players.some(player => {
    return (
      player.alive &&
      player.x === x &&
      player.y === y
    );
  });

  if (hasPlayer) return false;

  return true;
}

function startBombSlide(room, bomb, direction) {
  if (bombSlideTimers.has(bomb.id)) return false;

  const delta = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  }[direction];

  if (!delta) return false;

  const firstX = bomb.x + delta.x;
  const firstY = bomb.y + delta.y;

  // Se já houver obstáculo na primeira casa, não chuta
  if (!canBombSlideTo(room, bomb, firstX, firstY)) {
    return false;
  }

  // Move imediatamente uma casa
  bomb.x = firstX;
  bomb.y = firstY;

  emitRoom(room);

  const timer = setInterval(() => {
    const currentRoom = rooms.get(room.code);

    if (!currentRoom) {
      stopBombSlide(bomb.id);
      return;
    }

    const currentBomb = currentRoom.bombs.find(item => {
      return item.id === bomb.id;
    });

    // A bomba já explodiu ou foi removida
    if (!currentBomb) {
      stopBombSlide(bomb.id);
      return;
    }

    const nextX = currentBomb.x + delta.x;
    const nextY = currentBomb.y + delta.y;

    if (
      !canBombSlideTo(
        currentRoom,
        currentBomb,
        nextX,
        nextY
      )
    ) {
      stopBombSlide(currentBomb.id);
      return;
    }

    currentBomb.x = nextX;
    currentBomb.y = nextY;

    emitRoom(currentRoom);
  }, BOMB_SLIDE_MS);

  bombSlideTimers.set(bomb.id, timer);

  return true;
}

function tryKickBomb(room, player, bombX, bombY, direction) {
  if (!player.canKick) return false;

  const bomb = room.bombs.find(item => {
    return item.x === bombX && item.y === bombY;
  });

  if (!bomb) return false;

  // Não permite chutar uma bomba que já está deslizando
  if (bombSlideTimers.has(bomb.id)) {
    return false;
  }

  return startBombSlide(room, bomb, direction);
}

function moveEntity(room, player, dir) {
  const delta = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  }[dir];

  if (!delta) return false;

  const nx = player.x + delta.x;
  const ny = player.y + delta.y;

  const bombAtDestination = room.bombs.find(bomb => {
    return bomb.x === nx && bomb.y === ny;
  });

  if (bombAtDestination) {
    const kicked = tryKickBomb(
      room,
      player,
      nx,
      ny,
      dir
    );

    if (!kicked) return false;
  }

  /*
    Depois que a bomba começa a deslizar, a antiga posição
    dela fica livre e o jogador entra naquela casa.
  */
  if (canMove(room, nx, ny, player.id)) {
    player.x = nx;
    player.y = ny;
    return true;
  }

  return false;
}

function placeBombBySocket(socket) {
  const room = findRoomBySocket(socket);
  if (!room || !room.started || room.winner) return;
  if (room.gameMode === "paintball") return;

  const player = findPlayer(room, socket.id);
  if (!player || !player.alive || player.isBot) return;

  placeBomb(room, player);
  emitRoom(room);
}

function placeBomb(room, player) {
  const activeBombs = room.bombs.filter(b => b.ownerId === player.id).length;
  if (activeBombs >= player.maxBombs) return false;
  if (room.bombs.some(b => b.x === player.x && b.y === player.y)) return false;

  const bomb = {
    id: `${Date.now()}-${Math.random()}`,
    ownerId: player.id,
    x: player.x,
    y: player.y,
    range: player.bombRange,
    explodeAt: Date.now() + 2200
  };

  room.bombs.push(bomb);
  setTimeout(() => explodeBomb(room.code, bomb.id), BOMB_FUSE_MS);
  return true;
}

function getExplosionCells(room, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];

  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  for (const dir of dirs) {
    for (let i = 1; i <= bomb.range; i++) {
      const x = bomb.x + dir.x * i;
      const y = bomb.y + dir.y * i;
      const tile = room.map[y]?.[x];

      if (!tile || tile === TILE_WALL) break;

      cells.push({ x, y });

      if (tile === TILE_BOX) break;
    }
  }

  return cells;
}

function maybeDropPowerUp(room, x, y) {
  /*
    Continua existindo 38% de chance de uma caixa
    deixar algum power-up.
  */
  if (Math.random() > 0.38) {
    return;
  }

  /*
    Entre os power-ups que aparecem:
    10% serão Caçador Selvagem.
  */
  const hunterAppears =
    Math.random() < 0.10;

  let type;

  if (hunterAppears) {
    type = "hunterSummon";
  } else {
    const normalTypes = [
      "range",
      "bomb",
      "speed",
      "shield",
      "kick",
      "slowTrap",
      "visionTrap"
    ];

    type =
      normalTypes[
        Math.floor(
          Math.random() *
          normalTypes.length
        )
      ];
  }

  room.powerUps.push({
    id: `${Date.now()}-${Math.random()}`,
    x,
    y,
    type
  });
}

function getHunterType(mapTheme) {
  if (mapTheme === "ice") {
    return "penguin";
  }

  if (mapTheme === "lava") {
    return "magmaLizard";
  }

  return "snake";
}

function canHunterPass(room, x, y) {
  if (!isInside(room, x, y)) {
    return false;
  }

  if (room.map[y][x] !== TILE_EMPTY) {
    return false;
  }

  const hasBomb =
    room.bombs.some(bomb => {
      return (
        bomb.x === x &&
        bomb.y === y
      );
    });

  if (hasBomb) {
    return false;
  }

  return true;
}

function findHunterTarget(room, owner) {
  const enemies =
    room.players.filter(player => {
      if (
        !player.alive ||
        player.id === owner.id
      ) {
        return false;
      }

      if (
        room.mode === "duoBots" &&
        player.team === owner.team
      ) {
        return false;
      }

      return true;
    });

  if (enemies.length === 0) {
    return null;
  }

  enemies.sort((a, b) => {
    return (
      distance(owner, a) -
      distance(owner, b)
    );
  });

  return enemies[0];
}

function findHunterSpawn(room, target) {
  const candidates = [];

  for (
    let y = 1;
    y < room.map.length - 1;
    y += 1
  ) {
    for (
      let x = 1;
      x < room.map[y].length - 1;
      x += 1
    ) {
      if (!canHunterPass(room, x, y)) {
        continue;
      }

      const distanceFromTarget =
        Math.abs(x - target.x) +
        Math.abs(y - target.y);

      /*
        Aproximadamente cinco blocos:
        aceita posições entre 4 e 6.
      */
      if (
        distanceFromTarget < 4 ||
        distanceFromTarget > 6
      ) {
        continue;
      }

      const occupied =
        room.players.some(player => {
          return (
            player.alive &&
            player.x === x &&
            player.y === y
          );
        });

      if (occupied) {
        continue;
      }

      const alreadyHasHunter =
        (room.hunters || []).some(hunter => {
          return (
            hunter.x === x &&
            hunter.y === y
          );
        });

      if (alreadyHasHunter) {
        continue;
      }

      candidates.push({
        x,
        y,
        distanceFromTarget
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  /*
    Prioriza distância exatamente igual a 5.
  */
  candidates.sort((a, b) => {
    return (
      Math.abs(a.distanceFromTarget - 5) -
      Math.abs(b.distanceFromTarget - 5)
    );
  });

  const bestDistance =
    Math.abs(
      candidates[0].distanceFromTarget - 5
    );

  const bestCandidates =
    candidates.filter(candidate => {
      return (
        Math.abs(
          candidate.distanceFromTarget - 5
        ) === bestDistance
      );
    });

  return bestCandidates[
    Math.floor(
      Math.random() *
      bestCandidates.length
    )
  ];
}

function summonHunter(room, owner) {
  const target =
    findHunterTarget(room, owner);

  if (!target) {
    return false;
  }

  const spawn =
    findHunterSpawn(room, target);

  if (!spawn) {
    return false;
  }

  const hunter = {
    id: `${Date.now()}-${Math.random()}`,
    type: getHunterType(room.mapTheme),
    ownerId: owner.id,
    targetId: target.id,
    x: spawn.x,
    y: spawn.y,
    createdAt: Date.now(),
    expiresAt:
      Date.now() + HUNTER_LIFETIME_MS,
    lastMoveAt: 0
  };

  room.hunters =
    room.hunters || [];

  room.hunters.push(hunter);

  const ownerSocket =
    io.sockets.sockets.get(owner.id);

  ownerSocket?.emit(
    "trapMessage",
    room.mapTheme === "ice"
      ? "🐧 Pinguim caçador ativado!"
      : room.mapTheme === "lava"
        ? "🦎 Salamandra de magma ativada!"
        : "🐍 Cobra caçadora ativada!"
  );

  const targetSocket =
    io.sockets.sockets.get(target.id);

  targetSocket?.emit(
    "trapMessage",
    room.mapTheme === "ice"
      ? "🐧 Um pinguim está perseguindo você!"
      : room.mapTheme === "lava"
        ? "🦎 Uma salamandra está perseguindo você!"
        : "🐍 Uma cobra está perseguindo você!"
  );

  return true;
}

function findHunterNextStep(
  room,
  hunter,
  target
) {
  const startKey =
    aiKey(hunter.x, hunter.y);

  const queue = [
    {
      x: hunter.x,
      y: hunter.y
    }
  ];

  const visited =
    new Set([startKey]);

  const cameFrom =
    new Map();

  let destinationKey = null;

  while (queue.length > 0) {
    const current =
      queue.shift();

    if (
      current.x === target.x &&
      current.y === target.y
    ) {
      destinationKey =
        aiKey(current.x, current.y);

      break;
    }

    for (
      const direction of AI_DIRECTIONS
    ) {
      const nextX =
        current.x + direction.x;

      const nextY =
        current.y + direction.y;

      const nextKey =
        aiKey(nextX, nextY);

      if (visited.has(nextKey)) {
        continue;
      }

      /*
        A casa do alvo pode ser alcançada
        mesmo estando ocupada pelo jogador.
      */
      const isTargetCell =
        nextX === target.x &&
        nextY === target.y;

      if (
        !isTargetCell &&
        !canHunterPass(
          room,
          nextX,
          nextY
        )
      ) {
        continue;
      }

      visited.add(nextKey);

      cameFrom.set(nextKey, {
        previousKey:
          aiKey(current.x, current.y),
        x: nextX,
        y: nextY
      });

      queue.push({
        x: nextX,
        y: nextY
      });
    }
  }

  if (!destinationKey) {
    return null;
  }

  let currentKey =
    destinationKey;

  let firstStep = null;

  while (
    cameFrom.has(currentKey)
  ) {
    const data =
      cameFrom.get(currentKey);

    firstStep = {
      x: data.x,
      y: data.y
    };

    if (
      data.previousKey === startKey
    ) {
      break;
    }

    currentKey =
      data.previousKey;
  }

  return firstStep;
}

function pushTargetTowardOwner(
  room,
  target,
  owner
) {
  for (
    let step = 0;
    step < HUNTER_PUSH_DISTANCE;
    step += 1
  ) {
    const dx =
      owner.x - target.x;

    const dy =
      owner.y - target.y;

    if (dx === 0 && dy === 0) {
      break;
    }

    let nextX = target.x;
    let nextY = target.y;

    /*
      Move primeiro pelo eixo
      que mais aproxima os jogadores.
    */
    if (
      Math.abs(dx) >= Math.abs(dy)
    ) {
      nextX += Math.sign(dx);
    } else {
      nextY += Math.sign(dy);
    }

    if (
      !canMove(
        room,
        nextX,
        nextY,
        target.id
      )
    ) {
      /*
        Tenta o outro eixo.
      */
      nextX = target.x;
      nextY = target.y;

      if (dy !== 0) {
        nextY += Math.sign(dy);
      } else if (dx !== 0) {
        nextX += Math.sign(dx);
      }

      if (
        !canMove(
          room,
          nextX,
          nextY,
          target.id
        )
      ) {
        break;
      }
    }

    target.x = nextX;
    target.y = nextY;

    collectPowerUp(room, target);
    triggerHiddenTrap(room, target);
  }
}

function updateHunters(room) {
  if (
    !room.started ||
    room.winner ||
    room.gameMode === "paintball" ||
    !room.hunters?.length
  ) {
    return;
  }

  const now = Date.now();
  let changed = false;

  for (
    const hunter of [...room.hunters]
  ) {
    if (now >= hunter.expiresAt) {
      room.hunters =
        room.hunters.filter(item => {
          return item.id !== hunter.id;
        });

      changed = true;
      continue;
    }

    if (
      now - (hunter.lastMoveAt || 0) <
      HUNTER_STEP_MS
    ) {
      continue;
    }

    const target =
      room.players.find(player => {
        return (
          player.id === hunter.targetId &&
          player.alive
        );
      });

    const owner =
      room.players.find(player => {
        return (
          player.id === hunter.ownerId &&
          player.alive
        );
      });

    if (!target || !owner) {
      room.hunters =
        room.hunters.filter(item => {
          return item.id !== hunter.id;
        });

      changed = true;
      continue;
    }

    const nextStep =
      findHunterNextStep(
        room,
        hunter,
        target
      );

    if (!nextStep) {
      continue;
    }

    hunter.x = nextStep.x;
    hunter.y = nextStep.y;
    hunter.lastMoveAt = now;

    changed = true;

    const touchedTarget =
      hunter.x === target.x &&
      hunter.y === target.y;

    if (!touchedTarget) {
      continue;
    }

    pushTargetTowardOwner(
      room,
      target,
      owner
    );

    const targetSocket =
      io.sockets.sockets.get(
        target.id
      );

    targetSocket?.emit(
      "trapMessage",
      "Você foi empurrado pelo Caçador Selvagem!"
    );

    const ownerSocket =
      io.sockets.sockets.get(
        owner.id
      );

    ownerSocket?.emit(
      "opponentEffectMessage",
      `${target.name} foi empurrado na sua direção!`
    );

    room.hunters =
      room.hunters.filter(item => {
        return item.id !== hunter.id;
      });
  }

  if (changed) {
    checkWinner(room);
    emitRoom(room);
  }
}


function getPaintRoundKey(player) {
  return player.number === 1
    ? "player1"
    : "player2";
}

function getPaintColor(player) {
  return player.number === 1
    ? "#4da3ff"
    : "#ff4d4d";
}

function removePaintProjectile(
  room,
  projectileId
) {
  room.paintProjectiles =
    room.paintProjectiles.filter(item => {
      return item.id !== projectileId;
    });
}

function resetFlagToBase(flag) {
  flag.x = flag.baseX;
  flag.y = flag.baseY;
  flag.carrierId = null;
  flag.dropped = false;
}

function dropCarriedFlag(
  room,
  player
) {
  if (!player.carryingFlagTeam) {
    return;
  }

  const flag =
    room.paintFlags.find(item => {
      return (
        item.team ===
        player.carryingFlagTeam
      );
    });

  if (flag) {
    flag.x = player.x;
    flag.y = player.y;
    flag.carrierId = null;
    flag.dropped = true;
  }

  player.carryingFlagTeam = null;
}

function schedulePaintPowerRespawn(room) {
  setTimeout(() => {
    const currentRoom =
      rooms.get(room.code);

    if (
      !currentRoom ||
      !currentRoom.started ||
      currentRoom.gameMode !== "paintball"
    ) {
      return;
    }

    if (
      currentRoom.powerUps.length <
      PAINT_POWER_COUNT
    ) {
      const additions =
        createPaintPowerUps(
          currentRoom
        );

      for (const power of additions) {
        const duplicate =
          currentRoom.powerUps.some(item => {
            return (
              item.x === power.x &&
              item.y === power.y
            );
          });

        if (
          !duplicate &&
          currentRoom.powerUps.length <
            PAINT_POWER_COUNT
        ) {
          currentRoom.powerUps.push(power);
        }
      }

      emitRoom(currentRoom);
    }
  }, 5000);
}

function collectPaintPowerUp(
  room,
  player
) {
  const index =
    room.powerUps.findIndex(power => {
      return (
        power.x === player.x &&
        power.y === player.y
      );
    });

  if (index === -1) {
    return false;
  }

  const power =
    room.powerUps[index];

  room.powerUps.splice(index, 1);

  const now = Date.now();

  if (power.type === "rapidFire") {
    player.paintRapidFireUntil =
      now + PAINT_POWER_DURATION_MS;
  }

  if (power.type === "armorVest") {
    player.paintArmor = true;
  }

  if (power.type === "heavyShot") {
    player.paintHeavyShotUntil =
      now + PAINT_POWER_DURATION_MS;
  }

  if (power.type === "doubleMagazine") {
    player.paintMaxAmmo =
      PAINT_DOUBLE_AMMO;

    player.paintAmmo =
      PAINT_DOUBLE_AMMO;
  }

  const playerSocket =
    io.sockets.sockets.get(player.id);

  const messages = {
    rapidFire:
      "⚡ Tiro rápido ativado!",
    armorVest:
      "🦺 Colete ativado!",
    heavyShot:
      "💥 Tiro pesado ativado!",
    doubleMagazine:
      "🔫 Carregador duplo ativado!"
  };

  playerSocket?.emit(
    "trapMessage",
    messages[power.type] ||
      "Power-up coletado!"
  );

  schedulePaintPowerRespawn(room);

  return true;
}

function processPaintPosition(
  room,
  player
) {
  collectPaintPowerUp(
    room,
    player
  );

  for (const flag of room.paintFlags || []) {
    const onFlag =
      flag.x === player.x &&
      flag.y === player.y;

    if (!onFlag) {
      continue;
    }

    if (
      flag.team === player.number &&
      flag.dropped
    ) {
      resetFlagToBase(flag);

      const playerSocket =
        io.sockets.sockets.get(player.id);

      playerSocket?.emit(
        "trapMessage",
        "🚩 Sua bandeira voltou para a base!"
      );

      continue;
    }

    if (
      flag.team !== player.number &&
      !flag.carrierId &&
      !player.carryingFlagTeam
    ) {
      flag.carrierId = player.id;
      flag.dropped = false;
      player.carryingFlagTeam =
        flag.team;

      const playerSocket =
        io.sockets.sockets.get(player.id);

      playerSocket?.emit(
        "trapMessage",
        "🚩 Você pegou a bandeira inimiga!"
      );
    }
  }

  if (!player.carryingFlagTeam) {
    return;
  }

  const ownFlag =
    room.paintFlags.find(flag => {
      return flag.team === player.number;
    });

  const reachedOwnBase =
    ownFlag &&
    player.x === ownFlag.baseX &&
    player.y === ownFlag.baseY;

  if (!reachedOwnBase) {
    return;
  }

  const scoreKey =
    getPaintRoundKey(player);

  room.paintFlagScores[scoreKey] =
    (room.paintFlagScores[scoreKey] || 0) + 1;

  const capturedFlag =
    room.paintFlags.find(flag => {
      return (
        flag.team ===
        player.carryingFlagTeam
      );
    });

  if (capturedFlag) {
    resetFlagToBase(capturedFlag);
  }

  player.carryingFlagTeam = null;

  const playerSocket =
    io.sockets.sockets.get(player.id);

  playerSocket?.emit(
    "trapMessage",
    "🏆 Bandeira capturada!"
  );

  if (
    room.paintFlagScores[scoreKey] >=
    PAINT_CAPTURE_TARGET
  ) {
    room.winner =
      player.name ||
      `Jogador ${player.number}`;

    room.paintRoundWins[scoreKey] =
      (room.paintRoundWins[scoreKey] || 0) + 1;

    room.paintProjectiles = [];

    emitRoom(room);
  }
}

function respawnPaintPlayer(
  room,
  player
) {
  if (
    !room ||
    room.winner ||
    room.gameMode !== "paintball"
  ) {
    return;
  }

  resetPlayer(player);

  const playerSocket =
    io.sockets.sockets.get(player.id);

  playerSocket?.emit(
    "trapMessage",
    "✅ Você voltou para a partida!"
  );

  emitRoom(room);
}

function pushPaintTarget(
  room,
  target,
  angle
) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  const stepX =
    Math.abs(dx) >= Math.abs(dy)
      ? Math.sign(dx)
      : 0;

  const stepY =
    Math.abs(dy) > Math.abs(dx)
      ? Math.sign(dy)
      : 0;

  const nextX =
    target.x + stepX;

  const nextY =
    target.y + stepY;

  if (
    canMove(
      room,
      nextX,
      nextY,
      target.id
    )
  ) {
    target.x = nextX;
    target.y = nextY;

    processPaintPosition(
      room,
      target
    );
  }
}

function hitPaintPlayer(
  room,
  target,
  shooter,
  projectile
) {
  if (
    !target.alive ||
    room.winner
  ) {
    return;
  }

  /*
    Quem estiver carregando a bandeira
    perde a bandeira com apenas um tiro
    e volta imediatamente para o spawn.
  */
  if (target.carryingFlagTeam) {
    const droppedFlagTeam =
      target.carryingFlagTeam;

    dropCarriedFlag(
      room,
      target
    );

    resetPlayer(target);

    const targetSocket =
      io.sockets.sockets.get(target.id);

    targetSocket?.emit(
      "trapMessage",
      "🚩 Você perdeu a bandeira e voltou para a base!"
    );

    const shooterSocket =
      io.sockets.sockets.get(shooter.id);

    shooterSocket?.emit(
      "opponentEffectMessage",
      `🎯 Você derrubou a bandeira de ${target.name}!`
    );

    const droppedFlag =
      room.paintFlags.find(flag => {
        return flag.team === droppedFlagTeam;
      });

    if (droppedFlag) {
      droppedFlag.carrierId = null;
      droppedFlag.dropped = true;
    }

    return;
  }

  if (target.paintArmor) {
    target.paintArmor = false;

    const targetSocket =
      io.sockets.sockets.get(target.id);

    targetSocket?.emit(
      "trapMessage",
      "🦺 Seu colete bloqueou o tiro!"
    );

    return;
  }

  target.paintHealth =
    Math.max(
      0,
      (target.paintHealth ?? PAINT_MAX_HEALTH) - 1
    );

  if (projectile.heavy) {
    pushPaintTarget(
      room,
      target,
      projectile.angle
    );
  }

  const targetSocket =
    io.sockets.sockets.get(target.id);

  if (target.paintHealth > 0) {
    targetSocket?.emit(
      "trapMessage",
      `🎯 Você foi atingido! Vidas: ${target.paintHealth}`
    );

    return;
  }

  dropCarriedFlag(
    room,
    target
  );

  target.alive = false;
  target.respawningUntil =
    Date.now() + PAINT_RESPAWN_MS;

  targetSocket?.emit(
    "trapMessage",
    "🎯 Eliminado! Voltando em 2 segundos."
  );

  const shooterSocket =
    io.sockets.sockets.get(shooter.id);

  shooterSocket?.emit(
    "opponentEffectMessage",
    `🎯 Você eliminou ${target.name}!`
  );

  setTimeout(() => {
    const currentRoom =
      rooms.get(room.code);

    if (!currentRoom) {
      return;
    }

    const currentTarget =
      currentRoom.players.find(player => {
        return player.id === target.id;
      });

    if (!currentTarget) {
      return;
    }

    respawnPaintPlayer(
      currentRoom,
      currentTarget
    );
  }, PAINT_RESPAWN_MS);
}

function startPaintRound(room) {
  room.winner = null;
  room.paintProjectiles = [];
  room.paintFlagScores = {
    player1: 0,
    player2: 0
  };
  room.paintFlags = createPaintFlags();
  room.paintBarriers =
    createPaintBarriers();

  room.powerUps =
    createPaintPowerUps(room);

  for (const player of room.players) {
    resetPlayer(player);
  }
}

function aimPaint(
  socket,
  angleRaw
) {
  const room =
    findRoomBySocket(socket);

  if (
    !room ||
    !room.started ||
    room.winner ||
    room.gameMode !== "paintball"
  ) {
    return;
  }

  const player =
    findPlayer(room, socket.id);

  if (
    !player ||
    !player.alive ||
    player.isBot
  ) {
    return;
  }

  const angle =
    Number(angleRaw);

  if (!Number.isFinite(angle)) {
    return;
  }

  player.aimAngle =
    Math.atan2(
      Math.sin(angle),
      Math.cos(angle)
    );
}

function shootPaint(
  socket,
  angleRaw
) {
  const room =
    findRoomBySocket(socket);

  if (
    !room ||
    !room.started ||
    room.winner ||
    room.gameMode !== "paintball"
  ) {
    return;
  }

  const player =
    findPlayer(room, socket.id);

  if (
    !player ||
    !player.alive ||
    player.isBot
  ) {
    return;
  }

  const now = Date.now();

  if (
    now <
    (player.paintReloadingUntil || 0)
  ) {
    return;
  }

  const rapid =
    now <
    (player.paintRapidFireUntil || 0);

  const cooldown =
    rapid
      ? PAINT_RAPID_SHOT_COOLDOWN_MS
      : PAINT_SHOT_COOLDOWN_MS;

  if (
    now - (player.lastShotAt || 0) <
    cooldown
  ) {
    return;
  }

  if ((player.paintAmmo || 0) <= 0) {
    socket.emit(
      "trapMessage",
      "🔫 Sem munição! Pressione R para recarregar."
    );

    return;
  }

  player.lastShotAt = now;
  player.paintAmmo -= 1;

  const receivedAngle =
    Number(angleRaw);

  if (Number.isFinite(receivedAngle)) {
    player.aimAngle =
      Math.atan2(
        Math.sin(receivedAngle),
        Math.cos(receivedAngle)
      );
  }

  const angle =
    Number.isFinite(player.aimAngle)
      ? player.aimAngle
      : player.number === 1
        ? 0
        : Math.PI;

  room.paintProjectiles.push({
    id: `${now}-${Math.random()}`,
    ownerId: player.id,
    playerNumber: player.number,
    color: getPaintColor(player),
    x: player.x + 0.5,
    y: player.y + 0.5,
    angle,
    remaining:
      PAINT_PROJECTILE_RANGE,
    heavy:
      now <
      (player.paintHeavyShotUntil || 0),
    lastMoveAt: now
  });

  emitRoom(room);
}

function reloadPaint(socket) {
  const room =
    findRoomBySocket(socket);

  if (
    !room ||
    !room.started ||
    room.winner ||
    room.gameMode !== "paintball"
  ) {
    return;
  }

  const player =
    findPlayer(room, socket.id);

  if (
    !player ||
    !player.alive ||
    player.isBot
  ) {
    return;
  }

  const now = Date.now();

  if (
    now <
    (player.paintReloadingUntil || 0)
  ) {
    return;
  }

  const maxAmmo =
    player.paintMaxAmmo ||
    PAINT_MAX_AMMO;

  if (
    (player.paintAmmo ?? maxAmmo) >=
    maxAmmo
  ) {
    socket.emit(
      "trapMessage",
      "🔫 O marcador já está carregado."
    );

    return;
  }

  const reloadToken =
    Date.now() + Math.random();

  player.paintReloadToken =
    reloadToken;

  player.paintReloadingUntil =
    now + PAINT_RELOAD_MS;

  socket.emit(
    "trapMessage",
    "🔄 Recarregando..."
  );

  emitRoom(room);

  setTimeout(() => {
    const currentRoom =
      rooms.get(room.code);

    if (!currentRoom) {
      return;
    }

    const currentPlayer =
      currentRoom.players.find(item => {
        return item.id === player.id;
      });

    if (
      !currentPlayer ||
      currentPlayer.paintReloadToken !==
        reloadToken ||
      !currentPlayer.alive
    ) {
      return;
    }

    currentPlayer.paintAmmo =
      currentPlayer.paintMaxAmmo ||
      PAINT_MAX_AMMO;

    currentPlayer.paintReloadingUntil = 0;
    currentPlayer.paintReloadToken = 0;

    const currentSocket =
      io.sockets.sockets.get(
        currentPlayer.id
      );

    currentSocket?.emit(
      "trapMessage",
      "✅ Marcador recarregado!"
    );

    emitRoom(currentRoom);
  }, PAINT_RELOAD_MS);
}

function projectileHitsBarrier(
  room,
  x,
  y
) {
  return (room.paintBarriers || []).some(barrier => {
    const dx =
      x - (barrier.x + 0.5);

    const dy =
      y - (barrier.y + 0.5);

    return (
      Math.hypot(dx, dy) <= 0.42
    );
  });
}

function updatePaintProjectiles(room) {
  if (
    !room.started ||
    room.winner ||
    room.gameMode !== "paintball" ||
    !room.paintProjectiles?.length
  ) {
    return;
  }

  const now = Date.now();
  let changed = false;

  for (
    const projectile of
    [...room.paintProjectiles]
  ) {
    if (
      now -
        (projectile.lastMoveAt || 0) <
      PAINT_PROJECTILE_STEP_MS
    ) {
      continue;
    }

    const stepX =
      Math.cos(projectile.angle) *
      PAINT_PROJECTILE_SPEED;

    const stepY =
      Math.sin(projectile.angle) *
      PAINT_PROJECTILE_SPEED;

    const nextX =
      projectile.x + stepX;

    const nextY =
      projectile.y + stepY;

    const tileX =
      Math.floor(nextX);

    const tileY =
      Math.floor(nextY);

    const tile =
      room.map[tileY]?.[tileX];

    if (
      !tile ||
      tile === TILE_WALL ||
      tile === TILE_BOX ||
      projectileHitsBarrier(
        room,
        nextX,
        nextY
      ) ||
      projectile.remaining <= 0
    ) {
      removePaintProjectile(
        room,
        projectile.id
      );

      changed = true;
      continue;
    }

    projectile.x = nextX;
    projectile.y = nextY;
    projectile.remaining -=
      PAINT_PROJECTILE_SPEED;

    projectile.lastMoveAt = now;

    const shooter =
      room.players.find(player => {
        return (
          player.id ===
          projectile.ownerId
        );
      });

    if (!shooter || !shooter.alive) {
      removePaintProjectile(
        room,
        projectile.id
      );

      changed = true;
      continue;
    }

    const target =
      room.players.find(player => {
        if (
          !player.alive ||
          player.id === shooter.id
        ) {
          return false;
        }

        const centerX =
          player.x + 0.5;

        const centerY =
          player.y + 0.5;

        return (
          Math.hypot(
            nextX - centerX,
            nextY - centerY
          ) <= 0.42
        );
      });

    if (target) {
      hitPaintPlayer(
        room,
        target,
        shooter,
        projectile
      );

      removePaintProjectile(
        room,
        projectile.id
      );
    } else if (
      projectile.remaining <= 0
    ) {
      removePaintProjectile(
        room,
        projectile.id
      );
    }

    changed = true;
  }

  if (changed) {
    emitRoom(room);
  }
}

function collectPowerUp(room, player) {
  const index =
    room.powerUps.findIndex(power => {
      return (
        power.x === player.x &&
        power.y === player.y
      );
    });

  if (index === -1) {
    return;
  }

  const power =
    room.powerUps[index];

  room.powerUps.splice(index, 1);

  if (power.type === "hunterSummon") {
    summonHunter(room, player);
    return;
  }

  if (power.type === "range") {
    player.bombRange = Math.min(player.bombRange + 1, 6);
  }

  if (power.type === "bomb") {
    player.maxBombs = Math.min(player.maxBombs + 1, 4);
  }

  if (power.type === "visionTrap") {
  player.visionTrapCount =
    (player.visionTrapCount || 0) + 1;
}

  if (power.type === "speed") {
    player.speedLevel = Math.min((player.speedLevel || 1) + 1, 3);
  }

  if (power.type === "shield") {
    player.shield = true;
  }

  if (power.type === "slowTrap") {
  player.slowTrapCount =
    (player.slowTrapCount || 0) + 1;
}

  if (power.type === "kick") {
  player.canKick = true;
}
}

function explodeBomb(code, bombId) {
  const room = rooms.get(code);
  if (!room || room.winner) return;

  const bomb = room.bombs.find(b => b.id === bombId);
  if (!bomb) return;

  stopBombSlide(bomb.id);

  room.bombs = room.bombs.filter(b => b.id !== bombId);

  const cells = getExplosionCells(room, bomb);

  for (const cell of cells) {
    if (room.map[cell.y]?.[cell.x] === TILE_BOX) {
      console.log("Caixa destruída em:", cell.x, cell.y);
      room.map[cell.y][cell.x] = TILE_EMPTY;
      maybeDropPowerUp(room, cell.x, cell.y);
    }
  }

  for (const player of room.players) {
    if (!player.alive) continue;

    if (cells.some(c => c.x === player.x && c.y === player.y)) {
      if (player.shield) {
        player.shield = false;
      } else {
        player.alive = false;
      }
    }
  }

  room.explosions = cells.map(c => ({
    ...c,
    id: `${bomb.id}-${c.x}-${c.y}`
  }));

  checkWinner(room);
  emitRoom(room);

  setTimeout(() => {
    const freshRoom = rooms.get(code);
    if (!freshRoom) return;
    freshRoom.explosions = [];
    emitRoom(freshRoom);
  }, 450);
}

const AI_DIRECTIONS = [
  { name: "up", x: 0, y: -1 },
  { name: "down", x: 0, y: 1 },
  { name: "left", x: -1, y: 0 },
  { name: "right", x: 1, y: 0 }
];

const AI_BOMB_FUSE = 2200;
const AI_EXPLOSION_TIME = 450;
const AI_SAFETY_MARGIN = 180;

function aiKey(x, y) {
  return `${x},${y}`;
}

function distance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function getBotStepTime(bot) {
  return getMoveDelay(bot);
}

/*
  Cria um mapa dizendo quando cada quadrado ficará perigoso.
  Assim o bot não olha apenas onde a bomba está: ele considera
  toda a cruz da futura explosão e o tempo que falta.
*/
function buildDangerMap(room, simulatedBomb = null) {
  const now = Date.now();
  const dangerMap = new Map();

  const bombs = simulatedBomb
    ? [...room.bombs, simulatedBomb]
    : [...room.bombs];

  for (const bomb of bombs) {
    const explodeIn = Math.max(
      0,
      (bomb.explodeAt || now + AI_BOMB_FUSE) - now
    );

    const cells = getExplosionCells(room, bomb);

    for (const cell of cells) {
      const cellKey = aiKey(cell.x, cell.y);
      const windows = dangerMap.get(cellKey) || [];

      windows.push({
        start: Math.max(0, explodeIn - AI_SAFETY_MARGIN),
        end:
          explodeIn +
          AI_EXPLOSION_TIME +
          AI_SAFETY_MARGIN
      });

      dangerMap.set(cellKey, windows);
    }
  }

  for (const explosion of room.explosions || []) {
    const cellKey = aiKey(explosion.x, explosion.y);
    const windows = dangerMap.get(cellKey) || [];

    windows.push({
      start: 0,
      end: AI_EXPLOSION_TIME + AI_SAFETY_MARGIN
    });

    dangerMap.set(cellKey, windows);
  }

  return dangerMap;
}

function isSafeAtTime(dangerMap, x, y, arrivalTime) {
  const dangerWindows = dangerMap.get(aiKey(x, y)) || [];

  return !dangerWindows.some(window => {
    return (
      arrivalTime >= window.start &&
      arrivalTime <= window.end
    );
  });
}

function isOutsideAllExplosions(dangerMap, x, y) {
  return !dangerMap.has(aiKey(x, y));
}

function canBotPass(room, bot, x, y, startX, startY) {
  if (!room.map[y]?.[x]) return false;
  if (room.map[y][x] !== TILE_EMPTY) return false;

  const bombBlocking = room.bombs.some(bomb => {
    return bomb.x === x && bomb.y === y;
  });

  /*
    O bot pode sair do quadrado onde acabou de deixar
    a bomba, mas não poderá entrar nele novamente.
  */
  if (
    bombBlocking &&
    !(x === startX && y === startY)
  ) {
    return false;
  }

  return true;
}

function reconstructBotPath(cameFrom, destinationKey) {
  const path = [];
  let currentKey = destinationKey;

  while (cameFrom.has(currentKey)) {
    const data = cameFrom.get(currentKey);

    path.push(data.direction);
    currentKey = data.previousKey;
  }

  return path.reverse();
}

/*
  Busca temporal de fuga.

  Não basta encontrar um quadrado fora da explosão.
  O bot precisa conseguir chegar nele antes da bomba explodir.
*/
function findBotEscapePath(
  room,
  bot,
  simulatedBomb = null
) {
  const dangerMap = buildDangerMap(
    room,
    simulatedBomb
  );

  const stepTime = getBotStepTime(bot);

  const queue = [
    {
      x: bot.x,
      y: bot.y,
      steps: 0,
      time: 0
    }
  ];

  const visited = new Map();
  const cameFrom = new Map();

  visited.set(aiKey(bot.x, bot.y), 0);

  while (queue.length > 0) {
    /*
      Prioriza posições totalmente fora das explosões
      e caminhos mais curtos.
    */
    queue.sort((a, b) => {
      const safetyA = isOutsideAllExplosions(
        dangerMap,
        a.x,
        a.y
      )
        ? 0
        : 1;

      const safetyB = isOutsideAllExplosions(
        dangerMap,
        b.x,
        b.y
      )
        ? 0
        : 1;

      return safetyA - safetyB || a.steps - b.steps;
    });

    const current = queue.shift();
    const currentKey = aiKey(current.x, current.y);

    if (
      current.steps > 0 &&
      isOutsideAllExplosions(
        dangerMap,
        current.x,
        current.y
      )
    ) {
      /*
        Evita considerar seguro um beco sem saída.
      */
      const exits = AI_DIRECTIONS.filter(direction => {
        return canBotPass(
          room,
          bot,
          current.x + direction.x,
          current.y + direction.y,
          bot.x,
          bot.y
        );
      });

      if (exits.length > 0) {
        return reconstructBotPath(
          cameFrom,
          currentKey
        );
      }
    }

    if (current.steps >= 18) continue;

    for (const direction of AI_DIRECTIONS) {
      const nextX = current.x + direction.x;
      const nextY = current.y + direction.y;
      const nextTime = current.time + stepTime;
      const nextKey = aiKey(nextX, nextY);

      if (
        !canBotPass(
          room,
          bot,
          nextX,
          nextY,
          bot.x,
          bot.y
        )
      ) {
        continue;
      }

      if (
        !isSafeAtTime(
          dangerMap,
          nextX,
          nextY,
          nextTime
        )
      ) {
        continue;
      }

      const previousTime = visited.get(nextKey);

      if (
        previousTime !== undefined &&
        previousTime <= nextTime
      ) {
        continue;
      }

      visited.set(nextKey, nextTime);

      cameFrom.set(nextKey, {
        previousKey: currentKey,
        direction: direction.name
      });

      queue.push({
        x: nextX,
        y: nextY,
        steps: current.steps + 1,
        time: nextTime
      });
    }
  }

  return null;
}

/*
  A* para perseguição, power-ups e deslocamento normal.
*/
function aiHeuristic(x, y, goals) {
  if (!goals.length) return 0;

  return Math.min(
    ...goals.map(goal => {
      return (
        Math.abs(goal.x - x) +
        Math.abs(goal.y - y)
      );
    })
  );
}

function findBotAStarPath(room, bot, goals) {
  if (!goals.length) return null;

  const dangerMap = buildDangerMap(room);
  const stepTime = getBotStepTime(bot);

  const startKey = aiKey(bot.x, bot.y);

  const open = [
    {
      x: bot.x,
      y: bot.y,
      g: 0,
      f: aiHeuristic(bot.x, bot.y, goals)
    }
  ];

  const closed = new Set();
  const cameFrom = new Map();
  const bestCost = new Map([[startKey, 0]]);

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);

    const current = open.shift();
    const currentKey = aiKey(current.x, current.y);

    if (closed.has(currentKey)) continue;

    closed.add(currentKey);

    const reachedGoal = goals.some(goal => {
      return (
        goal.x === current.x &&
        goal.y === current.y
      );
    });

    if (reachedGoal) {
      return reconstructBotPath(
        cameFrom,
        currentKey
      );
    }

    for (const direction of AI_DIRECTIONS) {
      const nextX = current.x + direction.x;
      const nextY = current.y + direction.y;
      const nextKey = aiKey(nextX, nextY);

      if (!canMove(room, nextX, nextY, bot.id)) {
        continue;
      }

      const nextCost = current.g + 1;
      const arrivalTime = nextCost * stepTime;

      if (
        !isSafeAtTime(
          dangerMap,
          nextX,
          nextY,
          arrivalTime
        )
      ) {
        continue;
      }

      const knownCost = bestCost.get(nextKey);

      if (
        knownCost !== undefined &&
        nextCost >= knownCost
      ) {
        continue;
      }

      bestCost.set(nextKey, nextCost);

      cameFrom.set(nextKey, {
        previousKey: currentKey,
        direction: direction.name
      });

      open.push({
        x: nextX,
        y: nextY,
        g: nextCost,
        f:
          nextCost +
          aiHeuristic(nextX, nextY, goals)
      });
    }
  }

  return null;
}

function getNearestHuman(room, bot) {
  const humans = room.players.filter(player => {
    return player.alive && !player.isBot;
  });

  humans.sort((a, b) => {
    return distance(bot, a) - distance(bot, b);
  });

  return humans[0] || null;
}

function hasAdjacentBox(room, bot) {
  return AI_DIRECTIONS.some(direction => {
    return (
      room.map[bot.y + direction.y]?.[
        bot.x + direction.x
      ] === TILE_BOX
    );
  });
}

function targetInLine(room, bot, target) {
  if (!target) return false;

  if (
    bot.x !== target.x &&
    bot.y !== target.y
  ) {
    return false;
  }

  if (distance(bot, target) > bot.bombRange) {
    return false;
  }

  const dx = Math.sign(target.x - bot.x);
  const dy = Math.sign(target.y - bot.y);

  let x = bot.x + dx;
  let y = bot.y + dy;

  while (x !== target.x || y !== target.y) {
    const tile = room.map[y]?.[x];

    if (
      !tile ||
      tile === TILE_WALL ||
      tile === TILE_BOX
    ) {
      return false;
    }

    x += dx;
    y += dy;
  }

  return true;
}

function createSimulatedBotBomb(bot) {
  return {
    id: `simulated-${bot.id}`,
    ownerId: bot.id,
    x: bot.x,
    y: bot.y,
    range: bot.bombRange,
    explodeAt: Date.now() + AI_BOMB_FUSE
  };
}

/*
  Impede que um bot coloque uma bomba sem conseguir fugir.
  Também evita sacrificar o outro bot da equipe.
*/
function getSafeBombEscape(room, bot) {
  const simulatedBomb =
    createSimulatedBotBomb(bot);

  const ownEscape = findBotEscapePath(
    room,
    bot,
    simulatedBomb
  );

  if (!ownEscape?.length) {
    return null;
  }

  const explosionCells = getExplosionCells(
    room,
    simulatedBomb
  );

  const teammates = room.players.filter(player => {
    return (
      player.alive &&
      player.isBot &&
      player.id !== bot.id
    );
  });

  for (const teammate of teammates) {
    const teammateIsThreatened =
      explosionCells.some(cell => {
        return (
          cell.x === teammate.x &&
          cell.y === teammate.y
        );
      });

    if (!teammateIsThreatened) continue;

    const teammateEscape = findBotEscapePath(
      room,
      teammate,
      simulatedBomb
    );

    if (!teammateEscape?.length) {
      return null;
    }
  }

  return ownEscape;
}

function followBotPath(
  room,
  bot,
  pathProperty,
  now
) {
  const path = bot[pathProperty];

  if (!Array.isArray(path) || path.length === 0) {
    return false;
  }

  const direction = path[0];

  if (!moveEntity(room, bot, direction)) {
    bot[pathProperty] = [];
    return false;
  }

  path.shift();

  bot.lastDirection = direction;
  bot.lastMoveAt = now;

  collectPowerUp(room, bot);

  triggerHiddenTrap(room, bot);

  return true;
}

function botIsThreatened(room, bot) {
  const dangerMap = buildDangerMap(room);

  return dangerMap.has(aiKey(bot.x, bot.y));
}

function getPowerUpGoals(room) {
  return (room.powerUps || []).map(powerUp => {
    return {
      x: powerUp.x,
      y: powerUp.y
    };
  });
}

function getHumanGoals(room) {
  return room.players
    .filter(player => {
      return player.alive && !player.isBot;
    })
    .map(player => {
      return {
        x: player.x,
        y: player.y
      };
    });
}

function getBoxAdjacentGoals(room) {
  const goals = [];

  for (let y = 1; y < room.map.length - 1; y++) {
    for (
      let x = 1;
      x < room.map[y].length - 1;
      x++
    ) {
      if (room.map[y][x] !== TILE_EMPTY) {
        continue;
      }

      const nearBox = AI_DIRECTIONS.some(
        direction => {
          return (
            room.map[y + direction.y]?.[
              x + direction.x
            ] === TILE_BOX
          );
        }
      );

      if (nearBox) {
        goals.push({ x, y });
      }
    }
  }

  return goals;
}

function planBotGoal(room, bot) {
  /*
    1. Power-ups próximos.
  */
  const powerPath = findBotAStarPath(
    room,
    bot,
    getPowerUpGoals(room)
  );

  if (
    powerPath?.length &&
    powerPath.length <= 7
  ) {
    return powerPath;
  }

  /*
    2. Perseguir humanos.
  */
  const humanPath = findBotAStarPath(
    room,
    bot,
    getHumanGoals(room)
  );

  if (humanPath?.length) {
    return humanPath;
  }

  /*
    3. Aproximar-se de uma caixa para abrir caminho.
  */
  return (
    findBotAStarPath(
      room,
      bot,
      getBoxAdjacentGoals(room)
    ) || []
  );
}

function updateBots(room) {
  if (
    !room.started ||
    room.winner ||
    room.gameMode === "paintball" ||
    room.mode !== "duoBots"
  ) {
    return;
  }

  const now = Date.now();
  let changed = false;

  const livingBots = room.players.filter(player => {
    return player.isBot && player.alive;
  });

  for (const bot of livingBots) {
if (
  now < (bot.frozenUntil || 0) ||
  now < (bot.rootedUntil || 0)
) {
  continue;
}

    if (
      now - (bot.lastMoveAt || 0) <
      getMoveDelay(bot)
    ) {
      continue;
    }

    if (botIsThreatened(room, bot)) {
      if (!bot.escapePath?.length) {
        bot.escapePath =
          findBotEscapePath(room, bot) || [];
      }

      const moved = followBotPath(
        room,
        bot,
        "escapePath",
        now
      );

      if (moved) changed = true;

      continue;
    }

    bot.escapePath = [];

    if (!bot.goalPath?.length) {
      bot.goalPath = planBotGoal(room, bot);
    }

    const moved = followBotPath(
      room,
      bot,
      "goalPath",
      now
    );

    if (moved) {
      changed = true;
    }
  }

  if (changed) {
    checkWinner(room);
    emitRoom(room);
  }
}

function registerRoundWinner(
  room,
  playerNumber
) {
  if (
    room.roundScored ||
    !playerNumber
  ) {
    return;
  }

  room.roundScored = true;

  const scoreKey =
    playerNumber === 1
      ? "player1"
      : "player2";

  room.score[scoreKey] =
    (room.score[scoreKey] || 0) + 1;

  if (
    room.winStreak.playerNumber ===
    playerNumber
  ) {
    room.winStreak.count += 1;
  } else {
    room.winStreak = {
      playerNumber,
      count: 1
    };
  }
}

function checkWinner(room) {
  if (room.gameMode === "paintball") {
    return;
  }

  const aliveHumans = room.players.filter(p => p.alive && !p.isBot);
  const aliveBots = room.players.filter(p => p.alive && p.isBot);

  if (!room.started) return;

  if (room.mode === "duoBots") {
    if (aliveHumans.length === 0 && aliveBots.length === 0) room.winner = "Empate";
    else if (aliveHumans.length === 0) room.winner = "Bots";
    else if (aliveBots.length === 0 && room.players.some(p => p.isBot)) room.winner = "Jogadores";
    return;
  }

  const alive = room.players.filter(p => p.alive);

  if (
  alive.length === 1 &&
  room.players.length >= 2
) {
  const winnerNumber =
    alive[0].number;

  room.winner =
    `Jogador ${winnerNumber}`;

  registerRoundWinner(
    room,
    winnerNumber
  );
}

  if (alive.length === 0) {
    room.winner = "Empate";
  }
}

function restartRoom(room) {
  for (const bomb of room.bombs) {
    stopBombSlide(bomb.id);
  }

  room.started = true;
  room.winner = null;
  room.roundScored = false;

  if (room.mapSelection === "random") {
    room.mapTheme = getRandomMapTheme();
  }

  room.map =
    room.gameMode === "paintball"
      ? createPaintMap()
      : createRandomMap();

  room.bombs = [];
  room.explosions = [];
  room.powerUps = [];
  room.hunters = [];
  room.chatMessages = [];
  room.hiddenTraps = [];
  room.paintProjectiles = [];

  room.players.forEach(resetPlayer);

  if (
    room.mode === "duoBots" &&
    room.gameMode !== "paintball"
  ) {
    addBots(room);
  }

  if (room.gameMode === "paintball") {
    startPaintRound(room);
  }

  emitRoom(room);
}

function placeHiddenTrap(socket, trapType) {
  const room = findRoomBySocket(socket);

  if (!room || !room.started || room.winner) {
    return;
  }

  if (room.gameMode === "paintball") {
    return;
  }

  const player = findPlayer(room, socket.id);

  if (!player || !player.alive || player.isBot) {
    return;
  }

  const validTypes = [
  "slowTrap",
  "visionTrap"
];

  if (!validTypes.includes(trapType)) {
    return;
  }

  const alreadyHasTrap = room.hiddenTraps.some(trap => {
    return (
      trap.x === player.x &&
      trap.y === player.y
    );
  });

  if (alreadyHasTrap) {
    socket.emit(
      "errorMessage",
      "Já existe uma armadilha neste local."
    );

    return;
  }

  const hasBomb = room.bombs.some(bomb => {
    return (
      bomb.x === player.x &&
      bomb.y === player.y
    );
  });

  if (hasBomb) {
    socket.emit(
      "errorMessage",
      "Não é possível colocar a armadilha sobre uma bomba."
    );

    return;
  }

  if (trapType === "slowTrap") {
    if ((player.slowTrapCount || 0) <= 0) {
      socket.emit(
        "errorMessage",
        "Você não possui poções de lentidão."
      );

      return;
    }

    player.slowTrapCount -= 1;
  }

  if (trapType === "visionTrap") {
  if (
    (player.visionTrapCount || 0) <= 0
  ) {
    socket.emit(
      "errorMessage",
      "Você não possui armadilhas de visão."
    );

    return;
  }

  player.visionTrapCount -= 1;
}

  room.hiddenTraps.push({
    id: `${Date.now()}-${Math.random()}`,
    type: trapType,
    ownerId: player.id,
    ownerTeam: player.team,
    x: player.x,
    y: player.y,
    createdAt: Date.now()
  });

  emitRoom(room);
}

io.on("connection", socket => {
  console.log("Conectou:", socket.id);

  socket.on("createRoom", mode => createRoom(socket, mode));

  socket.on("joinRoom", payload => {
  const codeRaw =
    typeof payload === "string"
      ? payload
      : payload?.code;

  const playerNameRaw =
    typeof payload === "object"
      ? payload?.playerName
      : "";

      const playerSkinRaw =
  typeof payload === "object"
    ? payload?.playerSkin
    : "stickman";

  const code =
    String(codeRaw || "")
      .trim()
      .toUpperCase();

  const room = rooms.get(code);

  if (!room) {
    return socket.emit(
      "errorMessage",
      "Sala não encontrada."
    );
  }

  if (room.started) {
    return socket.emit(
      "errorMessage",
      "Essa sala já começou."
    );
  }

  const humanCount =
    room.players.filter(
      player => !player.isBot
    ).length;

  if (humanCount >= 2) {
    return socket.emit(
      "errorMessage",
      "Sala cheia."
    );
  }

  addHumanToRoom(
  socket,
  room,
  playerNameRaw,
  playerSkinRaw
);

  socket.emit("joinedRoom", code);
  emitRoom(room);
});

  socket.on("startGame", () => {
    const room = findRoomBySocket(socket);
    if (!room) return;

    const humanCount = room.players.filter(p => !p.isBot).length;
    if (humanCount < 2) return socket.emit("errorMessage", "Aguarde o segundo jogador entrar.");

    if (
      room.mode === "duoBots" &&
      room.gameMode !== "paintball"
    ) {
      addBots(room);
    }

    room.started = true;
    room.winner = null;
    room.roundScored = false;

    if (room.gameMode === "paintball") {
      startPaintRound(room);
    }

    emitRoom(room);
  });

  socket.on("restartGame", () => {
    const room = findRoomBySocket(socket);
    if (!room) return;
    restartRoom(room);
  });

  socket.on("move", dir => movePlayer(socket, dir));
  socket.on("bomb", () => placeBombBySocket(socket));

  socket.on("aimPaint", angle => {
    aimPaint(socket, angle);
  });

  socket.on("shootPaint", angle => {
    shootPaint(
      socket,
      angle
    );
  });

  socket.on("reloadPaint", () => {
    reloadPaint(socket);
  });

  socket.on("placeHiddenTrap", trapType => {
  placeHiddenTrap(socket, trapType);
});

 socket.on("sendMessage", messageRaw => {
  const room = findRoomBySocket(socket);
  if (!room) return;

  const player = findPlayer(room, socket.id);
  if (!player || !player.alive) return;

  const text = String(messageRaw || "")
    .trim()
    .slice(0, 100);

  if (!text) return;

  const message = {
    id: `${Date.now()}-${socket.id}`,
    playerId: socket.id,
    playerName: player.name,
    text,
    createdAt: Date.now()
  };

  room.chatMessages = [
    ...(room.chatMessages || []),
    message
  ].slice(-4);

  emitRoom(room);
});

socket.on("sendEmoji", emojiRaw => {
  const room =
    findRoomBySocket(socket);

  if (
    !room ||
    !room.started ||
    room.winner
  ) {
    return;
  }

  const player =
    findPlayer(room, socket.id);

  if (!player || !player.alive) {
    return;
  }

  const emoji =
    String(emojiRaw || "");

  if (
    !ALLOWED_EMOJIS.includes(emoji)
  ) {
    return;
  }

  const emojiUntil =
    Date.now() + 5000;

  player.emoji = emoji;
  player.emojiUntil = emojiUntil;

  emitRoom(room);

  setTimeout(() => {
    const currentRoom =
      rooms.get(room.code);

    if (!currentRoom) {
      return;
    }

    const currentPlayer =
      currentRoom.players.find(
        item => item.id === player.id
      );

    if (
      !currentPlayer ||
      currentPlayer.emojiUntil !==
        emojiUntil
    ) {
      return;
    }

    currentPlayer.emoji = null;
    currentPlayer.emojiUntil = 0;

    emitRoom(currentRoom);
  }, 5100);
});

  socket.on("disconnect", () => {
    const room = findRoomBySocket(socket);
    if (!room) return;

    room.players = room.players.filter(p => p.id !== socket.id);

    if (room.players.filter(p => !p.isBot).length === 0) {
      rooms.delete(room.code);
    } else {
      emitRoom(room);
    }

    console.log("Saiu:", socket.id);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    updateBots(room);
    updateHunters(room);
    updatePaintProjectiles(room);
  }
}, TICK_MS);

app.get("/", (req, res) => {
  res.send("Servidor do Blast Arena funcionando.");
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});