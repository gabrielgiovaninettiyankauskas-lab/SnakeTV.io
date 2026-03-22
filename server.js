"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const RANKING_FILE = path.join(__dirname, "global-ranking.json");
const GRID_SIZE = 38;
const TICK_MS = 180;
const COUNTDOWN_MS = 10000;
const IMMUNITY_MS = 3000;
const ENDGAME_REVEAL_MS = 3000;
const ROUND_DURATION_MS = 3 * 60 * 1000;
const RANKING_RESET_MS = 7 * 24 * 60 * 60 * 1000;
const START_LIVES = 2;
const MAX_PLAYERS = 4;
const BASE_FOOD_COUNT = 2;
const MAX_FOOD_ON_MAP = 5;
const BOOST_FOOD_MS = 5000;
const SPEED_BOOST_MS = 3000;
const BOOST_SPEED_MULTIPLIER = 1.45;
const BLUE_FOOD_EVERY = 5;
const MIN_SHOOT_LENGTH = 4;
const SHOT_DISTANCE = 4;
const SHOT_FLASH_MS = 220;
const SHOT_LIMIT = 3;
const SHOT_LIMIT_WINDOW_MS = 7000;
const PROTECTED_BODY_SEGMENTS = 3;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PLAYER_COLORS = [
  "#ff6b6b",
  "#34c759",
  "#00a6fb",
  "#ffd166",
  "#c77dff",
  "#ff8fab",
  "#00c2a8",
  "#f97316"
];
const OPPOSITES = {
  up: "down",
  down: "up",
  left: "right",
  right: "left"
};
const DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
const SPAWN_POINTS = [
  { head: { x: 5, y: 5 }, direction: "right" },
  { head: { x: GRID_SIZE - 6, y: GRID_SIZE - 6 }, direction: "left" },
  { head: { x: GRID_SIZE - 6, y: 5 }, direction: "left" },
  { head: { x: 5, y: GRID_SIZE - 6 }, direction: "right" }
];
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};
const STATIC_FILES = new Map([
  ["/", path.join(__dirname, "index.html")],
  ["/index.html", path.join(__dirname, "index.html")],
  ["/favicon.svg", path.join(__dirname, "favicon.svg")],
  ["/favicon.ico", path.join(__dirname, "favicon.svg")],
  ["/style.css", path.join(__dirname, "style.css")],
  ["/script.js", path.join(__dirname, "script.js")],
  ["/styles.css", path.join(__dirname, "style.css")],
  ["/app.js", path.join(__dirname, "script.js")]
]);

const clients = new Set();
const rooms = new Map();
let rankingStore = loadRankingStore();
let rankingCache = buildRankingCache(rankingStore);

const server = http.createServer((request, response) => {
  serveStatic(request, response);
});

server.on("upgrade", (request, socket) => {
  try {
    upgradeToWebSocket(request, socket);
  } catch (error) {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log("SnakeTV online server listening on port " + PORT);
});

function serveStatic(request, response) {
  let pathname = "/";

  try {
    pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  } catch (error) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const filePath = STATIC_FILES.get(pathname);

  if (!filePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const extname = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extname] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  });
}

function upgradeToWebSocket(request, socket) {
  const upgradeHeader = String(request.headers.upgrade || "").toLowerCase();
  const wsKey = request.headers["sec-websocket-key"];

  if (upgradeHeader !== "websocket" || !wsKey) {
    socket.destroy();
    return;
  }

  const acceptValue = crypto
    .createHash("sha1")
    .update(wsKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: " + acceptValue,
      "\r\n"
    ].join("\r\n")
  );

  socket.setNoDelay(true);
  socket._wsBuffer = Buffer.alloc(0);
  socket._playerId = null;
  socket._roomCode = null;
  socket._roomCleanupDone = false;
  clients.add(socket);

  socket.on("data", (chunk) => {
    handleSocketData(socket, chunk);
  });

  socket.on("close", () => {
    handleSocketClose(socket);
  });

  socket.on("end", () => {
    handleSocketClose(socket);
  });

  socket.on("error", () => {
    handleSocketClose(socket);
  });

  sendJson(socket, {
    type: "connected",
    gridSize: GRID_SIZE,
    tickMs: TICK_MS
  });
  sendRoomsOverview(socket);
}

function handleSocketData(socket, chunk) {
  socket._wsBuffer = Buffer.concat([socket._wsBuffer, chunk]);

  while (true) {
    const frame = extractFrame(socket._wsBuffer);

    if (!frame) {
      break;
    }

    socket._wsBuffer = frame.remaining;

    if (frame.opcode === 0x8) {
      sendFrame(socket, Buffer.alloc(0), 0x8);
      socket.end();
      return;
    }

    if (frame.opcode === 0x9) {
      sendFrame(socket, frame.payload, 0xA);
      continue;
    }

    if (frame.opcode === 0xA || frame.opcode !== 0x1) {
      continue;
    }

    let payload;

    try {
      payload = JSON.parse(frame.payload.toString("utf8"));
    } catch (error) {
      sendError(socket, "Mensagem invalida.");
      continue;
    }

    handleClientMessage(socket, payload);
  }
}

function handleClientMessage(socket, payload) {
  const message = payload || {};

  if (message.type === "ping") {
    sendJson(socket, { type: "pong", at: Date.now() });
    return;
  }

  if (message.type === "leave_room") {
    leaveCurrentRoom(socket);
    sendJson(socket, { type: "left_room" });
    return;
  }

  if (message.type === "create_room") {
    leaveCurrentRoom(socket);
    createRoom(
      socket,
      sanitizeName(message.name),
      sanitizeColor(message.color)
    );
    return;
  }

  if (message.type === "join_room") {
    leaveCurrentRoom(socket);
    joinRoom(
      socket,
      sanitizeRoomCode(message.code),
      sanitizeName(message.name),
      sanitizeColor(message.color)
    );
    return;
  }

  const room = getSocketRoom(socket);

  if (!room) {
    sendError(socket, "Entre em uma sala primeiro.");
    return;
  }

  if (message.type === "start_game") {
    if (room.hostId !== socket._playerId) {
      sendError(socket, "So o host pode iniciar.");
      return;
    }

    beginCountdown(room);
    return;
  }

  if (message.type === "steer") {
    const player = room.players.get(socket._playerId);

    if (!player || !player.alive || room.status !== "playing") {
      return;
    }

    const direction = String(message.direction || "");

    if (!DIRECTIONS[direction] || OPPOSITES[player.direction] === direction) {
      return;
    }

    player.pendingDirection = direction;
    return;
  }

  if (message.type === "shoot") {
    const player = room.players.get(socket._playerId);

    if (!player || !player.alive || room.status !== "playing") {
      return;
    }

    if (firePlayerShot(room, player)) {
      sendRoomState(room);
    }

    return;
  }

  sendError(socket, "Acao desconhecida.");
}

function createRoom(socket, name, desiredColor) {
  const roomCode = generateRoomCode();
  const room = {
    code: roomCode,
    countdownEndsAt: null,
    countdownId: null,
    createdAt: Date.now(),
    endReason: null,
    endedAt: null,
    foodSpawnCount: 0,
    foods: [],
    hostId: null,
    loopId: null,
    players: new Map(),
    roundEndsAt: null,
    showGameOverAt: null,
    shots: [],
    status: "lobby",
    winnerId: null
  };

  const color = pickPlayerColor(room, desiredColor);
  const player = buildPlayer(name, color, socket);

  room.hostId = player.id;
  room.players.set(player.id, player);
  rooms.set(room.code, room);
  attachSocket(socket, room.code, player.id);
  sendRoomState(room);
  broadcastRoomsOverview();
}

function joinRoom(socket, roomCode, name, desiredColor) {
  if (!roomCode) {
    sendError(socket, "Digite um codigo de sala.");
    return;
  }

  const room = rooms.get(roomCode);

  if (!room) {
    sendError(socket, "Sala nao encontrada.");
    return;
  }

  if (room.status === "countdown") {
    sendError(socket, "A contagem ja comecou. Aguarde a proxima rodada.");
    return;
  }

  if (room.status === "playing") {
    sendError(socket, "A partida ja comecou.");
    return;
  }

  if (room.players.size >= MAX_PLAYERS) {
    sendError(socket, "Sala cheia.");
    return;
  }

  const color = pickPlayerColor(room, desiredColor);
  const player = buildPlayer(name, color, socket);

  room.players.set(player.id, player);
  attachSocket(socket, room.code, player.id);
  sendRoomState(room);
  broadcastRoomsOverview();
}

function beginCountdown(room) {
  if (
    !room ||
    room.players.size === 0 ||
    room.status === "countdown" ||
    room.status === "playing"
  ) {
    return;
  }

  stopRoomLoop(room);
  stopRoomCountdown(room);

  room.status = "countdown";
  room.endReason = null;
  room.endedAt = null;
  room.roundEndsAt = null;
  room.showGameOverAt = null;
  room.winnerId = null;
  room.countdownEndsAt = Date.now() + COUNTDOWN_MS;

  preparePlayersForRound(room);

  room.countdownId = setTimeout(() => {
    launchGame(room.code);
  }, COUNTDOWN_MS);

  sendRoomState(room);
  broadcastRoomsOverview();
}

function preparePlayersForRound(room) {
  const players = Array.from(room.players.values());

  room.foodSpawnCount = 0;
  room.foods = [];
  room.shots = [];

  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];

    player.score = 0;
    player.lives = START_LIVES;
    player.maxLives = START_LIVES;
    player.recentShots = [];
    placePlayerAtSpawn(player, index, 0);
  }

  ensureBaseFood(room);
}

function launchGame(roomCode) {
  const room = rooms.get(roomCode);

  if (!room || room.status !== "countdown") {
    return;
  }

  room.status = "playing";
  room.countdownEndsAt = null;
  room.countdownId = null;
  room.endReason = null;
  room.roundEndsAt = Date.now() + ROUND_DURATION_MS;
  applyRoundSpawnImmunity(room);
  room.loopId = setInterval(() => {
    tickRoom(room.code);
  }, TICK_MS);

  sendRoomState(room);
  broadcastRoomsOverview();
}

function tickRoom(roomCode) {
  const room = rooms.get(roomCode);

  if (!room || room.status !== "playing") {
    return;
  }

  const now = Date.now();

  if (room.roundEndsAt && now >= room.roundEndsAt) {
    endGame(room, resolveScoreWinnerId(room), "timeout");
    return;
  }

  trimExpiredShots(room, now);
  const players = Array.from(room.players.values());
  const alivePlayers = players.filter((player) => player.alive);

  if (alivePlayers.length === 0) {
    endGame(room, null, "elimination");
    return;
  }

  for (const player of alivePlayers) {
    player.moveCharge = (player.moveCharge || 0) + getPlayerSpeedMultiplier(player, now);
  }

  let stepCount = 0;

  while (hasPlayersReadyToMove(players) && stepCount < 4) {
    stepCount += 1;
    advanceMovementStep(room, players, now);

    const stepSurvivors = players.filter((player) => player.alive);

    if (players.length === 1) {
      if (stepSurvivors.length === 0) {
        endGame(room, null, "elimination");
        return;
      }

      continue;
    }

    if (stepSurvivors.length <= 1) {
      endGame(
        room,
        stepSurvivors[0] ? stepSurvivors[0].id : null,
        "elimination"
      );
      return;
    }
  }

  ensureBaseFood(room);
  trimOverflowFoods(room);

  const survivors = players.filter((player) => player.alive);

  if (players.length === 1) {
    if (survivors.length === 0) {
      endGame(room, null, "elimination");
      return;
    }

    sendRoomState(room);
    return;
  }

  if (survivors.length <= 1) {
    endGame(
      room,
      survivors[0] ? survivors[0].id : null,
      "elimination"
    );
    return;
  }

  sendRoomState(room);
}

function endGame(room, winnerId, endReason) {
  const winner = winnerId ? room.players.get(winnerId) : null;

  room.status = "over";
  room.endReason = endReason || "elimination";
  room.endedAt = Date.now();
  room.roundEndsAt = null;
  room.showGameOverAt = room.endedAt + ENDGAME_REVEAL_MS;
  room.winnerId = winnerId;
  room.countdownEndsAt = null;
  stopRoomLoop(room);
  stopRoomCountdown(room);

  if (winner && winner.name) {
    awardRankingPoint(winner.name);
  }

  sendRoomState(room);
  broadcastRoomsOverview();
}

function leaveCurrentRoom(socket) {
  const room = getSocketRoom(socket);

  if (!room) {
    return;
  }

  const playerId = socket._playerId;
  room.players.delete(playerId);
  clearSocketIdentity(socket);

  if (room.hostId === playerId) {
    const nextHost = Array.from(room.players.values())[0];
    room.hostId = nextHost ? nextHost.id : null;
  }

  if (room.players.size === 0) {
    destroyRoom(room);
    return;
  }

  if (room.status === "playing") {
    const survivors = Array.from(room.players.values()).filter(
      (player) => player.alive
    );

    if (survivors.length <= 1) {
      endGame(
        room,
        survivors[0] ? survivors[0].id : null,
        "elimination"
      );
      return;
    }
  }

  sendRoomState(room);
  broadcastRoomsOverview();
}

function handleSocketClose(socket) {
  if (socket._roomCleanupDone) {
    return;
  }

  socket._roomCleanupDone = true;
  clients.delete(socket);
  leaveCurrentRoom(socket);
}

function sendRoomState(room) {
  const snapshot = serializeRoom(room);

  for (const player of room.players.values()) {
    sendJson(player.socket, {
      type: "room_state",
      room: Object.assign({}, snapshot, {
        ranking: getRankingSnapshot(player.name)
      }),
      you: player.id
    });
  }
}

function sendRoomsOverview(socket) {
  sendJson(socket, {
    type: "rooms_overview",
    ranking: getRankingSnapshot(""),
    rooms: serializeRoomsOverview()
  });
}

function broadcastRoomsOverview() {
  const payload = {
    type: "rooms_overview",
    ranking: getRankingSnapshot(""),
    rooms: serializeRoomsOverview()
  };

  for (const socket of clients) {
    if (!socket || socket.destroyed) {
      clients.delete(socket);
      continue;
    }

    sendJson(socket, payload);
  }
}

function serializeRoomsOverview() {
  return Array.from(rooms.values())
    .filter((room) => room.players.size > 0)
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((room) => {
      return {
        code: room.code,
        isFull: room.players.size >= MAX_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        playerCount: room.players.size,
        status: room.status
      };
    });
}

function serializeRoom(room) {
  const now = Date.now();
  trimExpiredShots(room, now);

  return {
    code: room.code,
    countdownEndsAt: room.countdownEndsAt,
    endReason: room.endReason,
    endedAt: room.endedAt,
    food: room.foods[0] || null,
    foods: room.foods.map((food) => {
      return {
        boostUntil: food.boostUntil,
        x: food.x,
        y: food.y
      };
    }),
    gridSize: GRID_SIZE,
    hostId: room.hostId,
    maxPlayers: MAX_PLAYERS,
    roundDurationMs: ROUND_DURATION_MS,
    roundEndsAt: room.roundEndsAt,
    shotLimit: SHOT_LIMIT,
    shotWindowMs: SHOT_LIMIT_WINDOW_MS,
    shots: room.shots.map((shot) => {
      return {
        color: shot.color,
        expiresAt: shot.expiresAt,
        points: shot.points
      };
    }),
    showGameOverAt: room.showGameOverAt,
    status: room.status,
    tickMs: TICK_MS,
    winnerId: room.winnerId,
    players: Array.from(room.players.values()).map((player) => {
      trimPlayerShots(player, now);

      return {
        alive: player.alive,
        color: player.color,
        id: player.id,
        immuneUntil: player.immuneUntil,
        isHost: player.id === room.hostId,
        lives: player.lives,
        maxLives: player.maxLives,
        recentShots: player.recentShots.slice(),
        speedBoostUntil: player.speedBoostUntil,
        name: player.name,
        score: player.score,
        segments: player.segments
      };
    })
  };
}

function spawnFood(room) {
  const blocked = new Set();

  for (const player of room.players.values()) {
    for (const segment of player.segments) {
      blocked.add(positionKey(segment));
    }
  }

  for (const food of room.foods || []) {
    blocked.add(positionKey(food));
  }

  if (blocked.size >= GRID_SIZE * GRID_SIZE) {
    return null;
  }

  for (let attempt = 0; attempt < 400; attempt += 1) {
    const cell = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE)
    };

    if (!blocked.has(positionKey(cell))) {
      return cell;
    }
  }

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const cell = { x, y };

      if (!blocked.has(positionKey(cell))) {
        return cell;
      }
    }
  }

  return null;
}

function buildSpawnSegments(head, directionName) {
  const direction = DIRECTIONS[directionName];
  const segments = [];

  for (let index = 0; index < 4; index += 1) {
    segments.push({
      x: head.x - direction.x * index,
      y: head.y - direction.y * index
    });
  }

  return segments;
}

function buildPlayer(name, color, socket) {
  return {
    alive: false,
    color,
    direction: "right",
    id: createId(),
    immuneUntil: 0,
    lives: START_LIVES,
    maxLives: START_LIVES,
    moveCharge: 0,
    name,
    pendingDirection: null,
    recentShots: [],
    score: 0,
    segments: [],
    speedBoostUntil: 0,
    spawnSlot: 0,
    socket
  };
}

function placePlayerAtSpawn(player, spawnSlot, immuneUntil) {
  const safeSlot = Math.max(0, Math.min(SPAWN_POINTS.length - 1, spawnSlot));
  const spawn = SPAWN_POINTS[safeSlot];

  player.alive = true;
  player.direction = spawn.direction;
  player.pendingDirection = null;
  player.segments = buildSpawnSegments(spawn.head, spawn.direction);
  player.moveCharge = 0;
  player.speedBoostUntil = 0;
  player.spawnSlot = safeSlot;
  player.immuneUntil = immuneUntil;
}

function applyRoundSpawnImmunity(room) {
  const immuneUntil = Date.now() + IMMUNITY_MS;

  for (const player of room.players.values()) {
    if (player.alive) {
      player.immuneUntil = immuneUntil;
    }
  }
}

function hasPlayersReadyToMove(players) {
  return players.some(
    (player) => player.alive && (player.moveCharge || 0) >= 1
  );
}

function advanceMovementStep(room, players, now) {
  const alivePlayers = players.filter((player) => player.alive);
  const activePlayers = alivePlayers.filter(
    (player) => (player.moveCharge || 0) >= 1
  );

  if (!activePlayers.length) {
    return;
  }

  const activeIds = new Set(activePlayers.map((player) => player.id));
  const immunePlayers = new Set();
  const nextHeads = new Map();
  const willGrow = new Set();
  const eatenFoodByPlayer = new Map();
  const headCounts = new Map();
  const deaths = new Set();
  const stalledPlayers = new Set();

  for (const player of alivePlayers) {
    if (isPlayerImmune(player, now)) {
      immunePlayers.add(player.id);
    }
  }

  for (const player of activePlayers) {
    if (
      player.pendingDirection &&
      OPPOSITES[player.direction] !== player.pendingDirection
    ) {
      player.direction = player.pendingDirection;
    }

    player.pendingDirection = null;

    const direction = DIRECTIONS[player.direction];
    const currentHead = player.segments[0];
    const nextHead = {
      x: currentHead.x + direction.x,
      y: currentHead.y + direction.y
    };
    const immune = immunePlayers.has(player.id);

    if (immune && isOutOfBounds(nextHead)) {
      stalledPlayers.add(player.id);
      nextHeads.set(player.id, currentHead);
      continue;
    }

    nextHeads.set(player.id, nextHead);

    const eatenFoodIndex = findFoodIndexAt(room.foods, nextHead);

    if (eatenFoodIndex !== -1) {
      willGrow.add(player.id);
      eatenFoodByPlayer.set(player.id, eatenFoodIndex);
    }

    if (!immune && isOutOfBounds(nextHead)) {
      deaths.add(player.id);
    }

    if (!immune) {
      const key = positionKey(nextHead);
      headCounts.set(key, (headCounts.get(key) || 0) + 1);
    }
  }

  for (const [key, count] of headCounts.entries()) {
    if (count > 1) {
      for (const [playerId, nextHead] of nextHeads.entries()) {
        if (positionKey(nextHead) === key) {
          deaths.add(playerId);
        }
      }
    }
  }

  const blocked = new Set();

  for (const player of players) {
    if (!player.alive || immunePlayers.has(player.id)) {
      continue;
    }

    const ignoreTail = activeIds.has(player.id) && !willGrow.has(player.id);

    for (let index = 0; index < player.segments.length; index += 1) {
      if (ignoreTail && index === player.segments.length - 1) {
        continue;
      }

      blocked.add(positionKey(player.segments[index]));
    }
  }

  for (const player of activePlayers) {
    if (immunePlayers.has(player.id)) {
      continue;
    }

    const nextHead = nextHeads.get(player.id);

    if (blocked.has(positionKey(nextHead))) {
      deaths.add(player.id);
    }
  }

  const eatenFoodIndexes = new Set();

  for (const player of activePlayers) {
    player.moveCharge = Math.max(0, (player.moveCharge || 0) - 1);

    if (deaths.has(player.id)) {
      applyPlayerHit(player, now);
      continue;
    }

    if (stalledPlayers.has(player.id)) {
      continue;
    }

    player.segments.unshift(nextHeads.get(player.id));

    if (willGrow.has(player.id)) {
      const eatenFoodIndex = eatenFoodByPlayer.get(player.id);
      const eatenFood =
        eatenFoodIndex === undefined ? null : room.foods[eatenFoodIndex];

      player.score += 1;

      if (isBoostFood(eatenFood, now)) {
        applySpeedBoost(player, now);
      }

      eatenFoodIndexes.add(eatenFoodIndex);
    } else {
      player.segments.pop();
    }
  }

  if (eatenFoodIndexes.size) {
    room.foods = room.foods.filter((food, index) => !eatenFoodIndexes.has(index));
  }

  ensureBaseFood(room);
  trimOverflowFoods(room);
}

function firePlayerShot(room, player) {
  if (!player || !player.alive || player.segments.length < MIN_SHOOT_LENGTH) {
    return false;
  }

  const now = Date.now();

  if (!canPlayerShoot(player, now)) {
    return false;
  }

  const path = buildShotPath(player);

  if (!path.length) {
    return false;
  }

  recordPlayerShot(player, now);
  const landingCell = path[path.length - 1];
  const cut = findCutTarget(room, player.id, path, now);

  player.segments.pop();

  room.shots.push({
    color: player.color,
    expiresAt: now + SHOT_FLASH_MS,
    points: path
  });

  if (cut) {
    splitSnakeIntoFood(room, cut.player, cut.segmentIndex);
  }

  addFoodCell(room, landingCell, {
    boostUntil: now + BOOST_FOOD_MS,
    source: "drop"
  });
  ensureBaseFood(room);
  trimOverflowFoods(room);
  trimExpiredShots(room, now);
  return true;
}

function buildShotPath(player) {
  const direction = DIRECTIONS[player.direction];
  const path = [];
  let current = player.segments[0];

  for (let step = 0; step < SHOT_DISTANCE; step += 1) {
    current = {
      x: current.x + direction.x,
      y: current.y + direction.y
    };

    if (isOutOfBounds(current)) {
      break;
    }

    path.push(current);
  }

  return path;
}

function findCutTarget(room, shooterId, path, now) {
  for (const point of path) {
    for (const player of room.players.values()) {
      if (!player.alive || player.id === shooterId || isPlayerImmune(player, now)) {
        continue;
      }

      for (
        let index = PROTECTED_BODY_SEGMENTS + 1;
        index < player.segments.length;
        index += 1
      ) {
        if (samePosition(point, player.segments[index])) {
          return {
            player,
            segmentIndex: index
          };
        }
      }
    }
  }

  return null;
}

function splitSnakeIntoFood(room, player, segmentIndex) {
  if (!player || segmentIndex <= PROTECTED_BODY_SEGMENTS) {
    return;
  }

  const droppedSegments = player.segments.slice(segmentIndex);
  player.segments = player.segments.slice(0, segmentIndex);

  for (const segment of droppedSegments) {
    addFoodCell(room, segment, { source: "drop" });
  }

  trimOverflowFoods(room);
}

function ensureBaseFood(room) {
  if (!room.foods) {
    room.foods = [];
  }

  while (countBaseFoods(room.foods) < BASE_FOOD_COUNT) {
    const nextFood = spawnFood(room);

    if (!nextFood) {
      break;
    }

    room.foods.push(createFood(room, nextFood, {
      createdAt: Date.now(),
      source: "base"
    }));
  }
}

function addFoodCell(room, cell, options) {
  if (!cell || isOutOfBounds(cell)) {
    return false;
  }

  if (findFoodIndexAt(room.foods, cell) !== -1 || isCellOccupiedBySnake(room, cell)) {
    return false;
  }

  room.foods.push(
    createFood(room, cell, {
      boostUntil: options && options.boostUntil,
      createdAt: Date.now(),
      source: (options && options.source) || "drop"
    })
  );
  return true;
}

function createFood(room, cell, options) {
  const createdAt = (options && options.createdAt) || Date.now();
  const source = (options && options.source) || "drop";
  const explicitBoostUntil = (options && options.boostUntil) || 0;
  const autoBoostUntil = getAutoBoostUntil(room, createdAt);
  const boostUntil = explicitBoostUntil || autoBoostUntil;

  return {
    boostUntil,
    createdAt,
    source,
    x: cell.x,
    y: cell.y
  };
}

function getAutoBoostUntil(room, now) {
  if (!room) {
    return 0;
  }

  room.foodSpawnCount = (room.foodSpawnCount || 0) + 1;

  if (room.foodSpawnCount % BLUE_FOOD_EVERY === 0) {
    return now + BOOST_FOOD_MS;
  }

  return 0;
}

function countBaseFoods(foods) {
  let total = 0;

  for (const food of foods || []) {
    if (food.source === "base") {
      total += 1;
    }
  }

  return total;
}

function findFoodIndexAt(foods, point) {
  if (!Array.isArray(foods)) {
    return -1;
  }

  for (let index = 0; index < foods.length; index += 1) {
    if (samePosition(foods[index], point)) {
      return index;
    }
  }

  return -1;
}

function isCellOccupiedBySnake(room, point) {
  for (const player of room.players.values()) {
    for (const segment of player.segments) {
      if (samePosition(segment, point)) {
        return true;
      }
    }
  }

  return false;
}

function trimOverflowFoods(room) {
  if (!room || !Array.isArray(room.foods) || room.foods.length <= MAX_FOOD_ON_MAP) {
    return;
  }

  while (room.foods.length > MAX_FOOD_ON_MAP) {
    let oldestDropIndex = -1;
    let oldestCreatedAt = Infinity;

    for (let index = 0; index < room.foods.length; index += 1) {
      const food = room.foods[index];

      if (food.source === "base") {
        continue;
      }

      if (food.createdAt < oldestCreatedAt) {
        oldestCreatedAt = food.createdAt;
        oldestDropIndex = index;
      }
    }

    if (oldestDropIndex === -1) {
      break;
    }

    room.foods.splice(oldestDropIndex, 1);
  }
}

function trimExpiredShots(room, now) {
  if (!room || !room.shots) {
    return;
  }

  room.shots = room.shots.filter((shot) => shot.expiresAt > now);
}

function canPlayerShoot(player, now) {
  trimPlayerShots(player, now);
  return player.recentShots.length < SHOT_LIMIT;
}

function recordPlayerShot(player, now) {
  trimPlayerShots(player, now);
  player.recentShots.push(now);
}

function trimPlayerShots(player, now) {
  if (!player) {
    return;
  }

  player.recentShots = (player.recentShots || []).filter(
    (shotAt) => now - shotAt < SHOT_LIMIT_WINDOW_MS
  );
}

function isBoostFood(food, now) {
  return !!food && !!food.boostUntil && food.boostUntil > now;
}

function applySpeedBoost(player, now) {
  player.speedBoostUntil = now + SPEED_BOOST_MS;
}

function getPlayerSpeedMultiplier(player, now) {
  return isPlayerSpeedBoosted(player, now) ? BOOST_SPEED_MULTIPLIER : 1;
}

function isPlayerSpeedBoosted(player, now) {
  return !!player && !!player.alive && !!player.speedBoostUntil && player.speedBoostUntil > now;
}

function applyPlayerHit(player, now) {
  player.lives = Math.max(0, (player.lives || 0) - 1);

  if (player.lives > 0) {
    placePlayerAtSpawn(player, player.spawnSlot || 0, now + IMMUNITY_MS);
    return;
  }

  player.alive = false;
  player.immuneUntil = 0;
  player.moveCharge = 0;
  player.segments = [];
  player.speedBoostUntil = 0;
}

function isPlayerImmune(player, now) {
  return player.alive && player.immuneUntil && player.immuneUntil > now;
}

function pickPlayerColor(room, desiredColor) {
  const usedColors = new Set(
    Array.from(room.players.values()).map((player) => player.color.toLowerCase())
  );

  if (desiredColor && !usedColors.has(desiredColor.toLowerCase())) {
    return desiredColor;
  }

  for (const color of PLAYER_COLORS) {
    if (!usedColors.has(color.toLowerCase())) {
      return color;
    }
  }

  return desiredColor || PLAYER_COLORS[0];
}

function attachSocket(socket, roomCode, playerId) {
  socket._roomCode = roomCode;
  socket._playerId = playerId;
}

function clearSocketIdentity(socket) {
  socket._roomCode = null;
  socket._playerId = null;
}

function getSocketRoom(socket) {
  if (!socket._roomCode) {
    return null;
  }

  return rooms.get(socket._roomCode) || null;
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let roomCode = "";

    for (let index = 0; index < 4; index += 1) {
      const position = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
      roomCode += ROOM_CODE_ALPHABET[position];
    }

    if (!rooms.has(roomCode)) {
      return roomCode;
    }
  }

  throw new Error("Could not create room code");
}

function createId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return crypto.randomBytes(16).toString("hex");
}

function resolveScoreWinnerId(room) {
  const players = Array.from((room && room.players && room.players.values()) || []);

  if (!players.length) {
    return null;
  }

  players.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (Number(right.alive) !== Number(left.alive)) {
      return Number(right.alive) - Number(left.alive);
    }

    return left.name.localeCompare(right.name, "pt-BR");
  });

  return players[0].id || null;
}

function loadRankingStore() {
  const now = Date.now();
  let parsed = null;

  try {
    parsed = JSON.parse(fs.readFileSync(RANKING_FILE, "utf8"));
  } catch (error) {
    parsed = null;
  }

  const store = {
    periodStartedAt:
      parsed && Number.isFinite(parsed.periodStartedAt)
        ? parsed.periodStartedAt
        : now,
    scores:
      parsed && parsed.scores && typeof parsed.scores === "object"
        ? parsed.scores
        : {}
  };

  if (now - store.periodStartedAt >= RANKING_RESET_MS) {
    return {
      periodStartedAt: now,
      scores: {}
    };
  }

  return store;
}

function persistRankingStore() {
  try {
    fs.writeFileSync(
      RANKING_FILE,
      JSON.stringify(rankingStore, null, 2),
      "utf8"
    );
  } catch (error) {
    return;
  }
}

function buildRankingCache(store) {
  const entries = Object.entries((store && store.scores) || {})
    .map(([name, points]) => {
      return {
        name: sanitizeName(name),
        points: Math.max(0, Number(points) || 0)
      };
    })
    .filter((entry) => entry.name && entry.points > 0)
    .sort((left, right) => {
      if (right.points !== left.points) {
        return right.points - left.points;
      }

      return left.name.localeCompare(right.name, "pt-BR");
    })
    .map((entry, index) => {
      return {
        name: entry.name,
        points: entry.points,
        position: index + 1
      };
    });
  const positions = Object.create(null);
  const pointsByName = Object.create(null);

  entries.forEach((entry) => {
    positions[entry.name] = entry.position;
    pointsByName[entry.name] = entry.points;
  });

  return {
    pointsByName,
    positions,
    top: entries.slice(0, 10)
  };
}

function ensureRankingPeriod() {
  const now = Date.now();

  if (now - rankingStore.periodStartedAt < RANKING_RESET_MS) {
    return;
  }

  rankingStore = {
    periodStartedAt: now,
    scores: {}
  };
  rankingCache = buildRankingCache(rankingStore);
  persistRankingStore();
}

function awardRankingPoint(name) {
  const safeName = sanitizeName(name);

  if (!safeName) {
    return;
  }

  ensureRankingPeriod();
  rankingStore.scores[safeName] = (rankingStore.scores[safeName] || 0) + 1;
  rankingCache = buildRankingCache(rankingStore);
  persistRankingStore();
}

function getRankingSnapshot(playerName) {
  const safeName = sanitizeName(playerName || "");

  ensureRankingPeriod();

  return {
    cycleStartedAt: rankingStore.periodStartedAt,
    cycleEndsAt: rankingStore.periodStartedAt + RANKING_RESET_MS,
    top: rankingCache.top.map((entry) => {
      return {
        name: entry.name,
        points: entry.points,
        position: entry.position
      };
    }),
    you:
      safeName && rankingCache.positions[safeName] > 10
        ? {
            name: safeName,
            points: rankingCache.pointsByName[safeName] || 0,
            position: rankingCache.positions[safeName]
          }
        : null
  };
}

function sanitizeName(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 18);

  return cleaned || "Jogador";
}

function sanitizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 4);
}

function sanitizeColor(value) {
  const normalized = String(value || "").trim().toLowerCase();

  for (const color of PLAYER_COLORS) {
    if (color.toLowerCase() === normalized) {
      return color;
    }
  }

  return null;
}

function samePosition(first, second) {
  return !!first && !!second && first.x === second.x && first.y === second.y;
}

function isOutOfBounds(point) {
  return point.x < 0 || point.x >= GRID_SIZE || point.y < 0 || point.y >= GRID_SIZE;
}

function positionKey(point) {
  return point.x + ":" + point.y;
}

function stopRoomLoop(room) {
  if (room.loopId) {
    clearInterval(room.loopId);
    room.loopId = null;
  }
}

function stopRoomCountdown(room) {
  if (room.countdownId) {
    clearTimeout(room.countdownId);
    room.countdownId = null;
  }

  room.countdownEndsAt = null;
}

function destroyRoom(room) {
  stopRoomLoop(room);
  stopRoomCountdown(room);
  rooms.delete(room.code);
  broadcastRoomsOverview();
}

function sendError(socket, message) {
  sendJson(socket, { type: "error", message });
}

function sendJson(socket, payload) {
  if (!socket || socket.destroyed) {
    return;
  }

  sendFrame(socket, Buffer.from(JSON.stringify(payload), "utf8"), 0x1);
}

function sendFrame(socket, payload, opcode) {
  if (!socket || socket.destroyed) {
    return;
  }

  const header = [];
  const length = payload.length;
  header.push(0x80 | opcode);

  if (length < 126) {
    header.push(length);
  } else if (length < 65536) {
    header.push(126, (length >> 8) & 0xff, length & 0xff);
  } else {
    const extended = Buffer.alloc(8);
    extended.writeUInt32BE(0, 0);
    extended.writeUInt32BE(length, 4);
    header.push(127);
    socket.write(Buffer.concat([Buffer.from(header), extended, payload]));
    return;
  }

  socket.write(Buffer.concat([Buffer.from(header), payload]));
}

function extractFrame(buffer) {
  if (!buffer || buffer.length < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) === 0x80;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }

    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }

    const highBits = buffer.readUInt32BE(offset);

    if (highBits !== 0) {
      throw new Error("Large frames are not supported");
    }

    payloadLength = buffer.readUInt32BE(offset + 4);
    offset += 8;
  }

  let maskingKey = null;

  if (masked) {
    if (buffer.length < offset + 4) {
      return null;
    }

    maskingKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) {
    return null;
  }

  let payload = buffer.subarray(offset, offset + payloadLength);

  if (masked && maskingKey) {
    const output = Buffer.alloc(payloadLength);

    for (let index = 0; index < payloadLength; index += 1) {
      output[index] = payload[index] ^ maskingKey[index % 4];
    }

    payload = output;
  }

  return {
    opcode,
    payload,
    remaining: buffer.subarray(offset + payloadLength)
  };
}
