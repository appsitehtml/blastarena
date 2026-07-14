import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors());

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

const TILE_EMPTY = ".";
const TILE_WALL = "#";
const TILE_BOX = "x";
const TICK_MS = 120;

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

const BOMB_SLIDE_MS = 90;
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

  if (trap.type === "slowTrap") {
    player.slowUntil =
      Date.now() + 10_000;

    const targetSocket =
      io.sockets.sockets.get(
        player.id
      );

    targetSocket?.emit(
      "trapMessage",
      "Você caiu em uma poção de lentidão!"
    );
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
slowTrapCount: p.slowTrapCount || 0,
slowed: Date.now() < (p.slowUntil || 0),
isBot: Boolean(p.isBot),
      team: p.team
    })),
    bombs: room.bombs,
    explosions: room.explosions,
    powerUps: room.powerUps,
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
  player.lastDirection = null;
player.escapePath = [];
player.goalPath = [];
}

function createRoom(socket, modeRaw = "1v1") {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();

  const mode = modeRaw === "duoBots" ? "duoBots" : "1v1";

  const room = {
    code,
    mode,
    started: false,
    winner: null,
    map: createRandomMap(),
    players: [],
    bombs: [],
    explosions: [],
    powerUps: [],
    hiddenTraps: [],
    chatMessages: [],
  };

  rooms.set(code, room);
  addHumanToRoom(socket, room);
  socket.emit("roomCreated", code);
  emitRoom(room);
}

function addHumanToRoom(socket, room) {
  const humanCount = room.players.filter(p => !p.isBot).length;
  const number = humanCount + 1;
  const spawn = SPAWNS[number - 1];

  room.players.push({
    id: socket.id,
    number,
    name: `Jogador ${number}`,
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
  if (room.bombs.some(b => b.x === x && b.y === y)) return false;
  if (isBlockedByPlayer(room, x, y, ignoreId)) return false;
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
  if (now - (player.lastMoveAt || 0) < getMoveDelay(player)) return;

  if (moveEntity(room, player, dir)) {
  player.lastMoveAt = now;

  collectPowerUp(room, player);
  triggerHiddenTrap(room, player);

  checkWinner(room);
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
  if (Math.random() > 0.38) return;

  const types = [
    "range",
    "bomb",
    "speed",
    "shield",
    "kick",
    "slowTrap",
  ];

  const type =
    types[Math.floor(Math.random() * types.length)];

  room.powerUps.push({
    id: `${Date.now()}-${Math.random()}`,
    x,
    y,
    type
  });
}

function collectPowerUp(room, player) {
  const index = room.powerUps.findIndex(p => p.x === player.x && p.y === player.y);
  if (index === -1) return;

  const power = room.powerUps[index];
  room.powerUps.splice(index, 1);

  if (power.type === "range") {
    player.bombRange = Math.min(player.bombRange + 1, 6);
  }

  if (power.type === "bomb") {
    player.maxBombs = Math.min(player.maxBombs + 1, 4);
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

  const playerBlocking = room.players.some(player => {
    return (
      player.alive &&
      player.id !== bot.id &&
      player.x === x &&
      player.y === y
    );
  });

  if (playerBlocking) return false;

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

function checkWinner(room) {
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

  if (alive.length === 1 && room.players.length >= 2) {
    room.winner = `Jogador ${alive[0].number}`;
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
  room.map = createRandomMap();
  room.bombs = [];
  room.explosions = [];
  room.powerUps = [];
  room.chatMessages = [];
  room.hiddenTraps = [];

  room.players.forEach(resetPlayer);

  if (room.mode === "duoBots") {
    addBots(room);
  }

  emitRoom(room);
}

function placeHiddenTrap(socket, trapType) {
  const room = findRoomBySocket(socket);

  if (!room || !room.started || room.winner) {
    return;
  }

  const player = findPlayer(room, socket.id);

  if (!player || !player.alive || player.isBot) {
    return;
  }

  const validTypes = ["slowTrap"];

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

  socket.on("joinRoom", codeRaw => {
    const code = String(codeRaw || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return socket.emit("errorMessage", "Sala não encontrada.");
    if (room.started) return socket.emit("errorMessage", "Essa sala já começou.");

    const humanCount = room.players.filter(p => !p.isBot).length;
    if (humanCount >= 2) return socket.emit("errorMessage", "Sala cheia.");

    addHumanToRoom(socket, room);
    socket.emit("joinedRoom", code);
    emitRoom(room);
  });

  socket.on("startGame", () => {
    const room = findRoomBySocket(socket);
    if (!room) return;

    const humanCount = room.players.filter(p => !p.isBot).length;
    if (humanCount < 2) return socket.emit("errorMessage", "Aguarde o segundo jogador entrar.");

    if (room.mode === "duoBots") addBots(room);

    room.started = true;
    room.winner = null;
    emitRoom(room);
  });

  socket.on("restartGame", () => {
    const room = findRoomBySocket(socket);
    if (!room) return;
    restartRoom(room);
  });

  socket.on("move", dir => movePlayer(socket, dir));
  socket.on("bomb", () => placeBombBySocket(socket));

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
  for (const room of rooms.values()) updateBots(room);
}, TICK_MS);

app.get("/", (req, res) => res.send("Servidor do Blast Arena funcionando."));

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});