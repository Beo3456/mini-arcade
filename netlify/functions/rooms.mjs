import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { getStore } from "@netlify/blobs";

const require = createRequire(import.meta.url);
const { Xiangqi } = require("./xiangqi.cjs");

const STORE_NAME = "xiangqi-rooms";
const ROOM_PREFIX = "rooms/";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_MOVES = 400;

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 24);
}

function cleanCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function cleanSquare(value) {
  const square = String(value ?? "").toLowerCase();
  return /^[a-i][0-9]$/.test(square) ? square : "";
}

function roomKey(code) {
  return `${ROOM_PREFIX}${code}.json`;
}

function randomCode() {
  const bytes = randomBytes(5);
  let code = "";
  for (let index = 0; index < 5; index += 1) {
    code += CODE_CHARS[bytes[index] % CODE_CHARS.length];
  }
  return code;
}

async function readRoom(store, code) {
  const room = await store.get(roomKey(code), { type: "json", consistency: "strong" });
  return room && room.code === code ? room : null;
}

async function saveRoom(store, room) {
  room.updatedAt = new Date().toISOString();
  room.version = Number(room.version ?? 0) + 1;
  await store.setJSON(roomKey(room.code), room);
  return room;
}

function colorForToken(room, token) {
  if (!token) {
    return null;
  }

  if (room.players.r?.token === token) {
    return "r";
  }

  if (room.players.b?.token === token) {
    return "b";
  }

  return null;
}

function publicRoom(room, token = "") {
  const color = colorForToken(room, token);

  return {
    code: room.code,
    status: room.status,
    fen: room.fen,
    turn: room.turn,
    winner: room.winner,
    result: room.result,
    version: room.version,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    lastMove: room.lastMove,
    playerColor: color,
    players: {
      r: room.players.r ? { name: room.players.r.name, connectedAt: room.players.r.connectedAt } : null,
      b: room.players.b ? { name: room.players.b.name, connectedAt: room.players.b.connectedAt } : null,
    },
    moves: room.moves.slice(-40),
  };
}

function statusAfterMove(game, movingColor) {
  if (typeof game.in_checkmate === "function" && game.in_checkmate()) {
    return { status: "ended", winner: movingColor, result: `${movingColor === "r" ? "Đỏ" : "Đen"} thắng chiếu bí.` };
  }

  if (typeof game.in_stalemate === "function" && game.in_stalemate()) {
    return { status: "ended", winner: "draw", result: "Hòa do hết nước đi." };
  }

  if (typeof game.in_draw === "function" && game.in_draw()) {
    return { status: "ended", winner: "draw", result: "Ván hòa." };
  }

  if (typeof game.game_over === "function" && game.game_over()) {
    return { status: "ended", winner: movingColor, result: `${movingColor === "r" ? "Đỏ" : "Đen"} thắng.` };
  }

  return { status: "active", winner: null, result: "" };
}

async function createRoom(store, name) {
  let code = randomCode();
  for (let attempt = 0; attempt < 8 && (await readRoom(store, code)); attempt += 1) {
    code = randomCode();
  }

  const game = new Xiangqi();
  const token = randomUUID();
  const now = new Date().toISOString();
  const room = {
    code,
    status: "waiting",
    fen: game.fen(),
    turn: game.turn(),
    winner: null,
    result: "",
    version: 0,
    createdAt: now,
    updatedAt: now,
    lastMove: null,
    players: {
      r: { name, token, connectedAt: now },
      b: null,
    },
    moves: [],
  };

  await saveRoom(store, room);
  return json({ token, room: publicRoom(room, token) }, 201);
}

async function joinRoom(store, code, name) {
  const room = await readRoom(store, code);
  if (!room) {
    return json({ error: "Không tìm thấy phòng." }, 404);
  }

  if (room.players.b) {
    return json({ error: "Phòng đã đủ 2 người." }, 409);
  }

  const token = randomUUID();
  const now = new Date().toISOString();
  room.players.b = { name, token, connectedAt: now };
  room.status = room.status === "waiting" ? "active" : room.status;
  room.turn = "r";

  await saveRoom(store, room);
  return json({ token, room: publicRoom(room, token) });
}

async function getRoomState(store, code, token) {
  const room = await readRoom(store, code);
  if (!room) {
    return json({ error: "Không tìm thấy phòng." }, 404);
  }

  return json({ room: publicRoom(room, token) });
}

async function moveRoom(store, body) {
  const code = cleanCode(body.code);
  const token = String(body.token ?? "");
  const from = cleanSquare(body.from);
  const to = cleanSquare(body.to);
  const room = await readRoom(store, code);

  if (!room) {
    return json({ error: "Không tìm thấy phòng." }, 404);
  }

  const color = colorForToken(room, token);
  if (!color) {
    return json({ error: "Bạn không thuộc phòng này." }, 403);
  }

  if (room.status !== "active") {
    return json({ error: "Ván chưa sẵn sàng hoặc đã kết thúc." }, 409);
  }

  if (room.turn !== color) {
    return json({ error: "Chưa đến lượt bạn." }, 409);
  }

  if (!from || !to) {
    return json({ error: "Nước đi không hợp lệ." }, 400);
  }

  const game = new Xiangqi(room.fen);
  const move = game.move({ from, to });

  if (!move) {
    return json({ error: "Nước đi sai luật." }, 400);
  }

  const endState = statusAfterMove(game, color);
  const moveEntry = {
    id: randomUUID(),
    color,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured ?? null,
    flags: move.flags ?? "",
    createdAt: new Date().toISOString(),
  };

  room.fen = game.fen();
  room.turn = game.turn();
  room.status = endState.status;
  room.winner = endState.winner;
  room.result = endState.result;
  room.lastMove = { from: move.from, to: move.to };
  room.moves = [...room.moves, moveEntry].slice(-MAX_MOVES);

  await saveRoom(store, room);
  return json({ room: publicRoom(room, token), move: moveEntry });
}

async function resignRoom(store, body) {
  const code = cleanCode(body.code);
  const token = String(body.token ?? "");
  const room = await readRoom(store, code);

  if (!room) {
    return json({ error: "Không tìm thấy phòng." }, 404);
  }

  const color = colorForToken(room, token);
  if (!color) {
    return json({ error: "Bạn không thuộc phòng này." }, 403);
  }

  if (room.status === "ended") {
    return json({ room: publicRoom(room, token) });
  }

  const winner = color === "r" ? "b" : "r";
  room.status = "ended";
  room.winner = winner;
  room.result = `${winner === "r" ? "Đỏ" : "Đen"} thắng do đối thủ đầu hàng.`;

  await saveRoom(store, room);
  return json({ room: publicRoom(room, token) });
}

async function resetRoom(store, body) {
  const code = cleanCode(body.code);
  const token = String(body.token ?? "");
  const room = await readRoom(store, code);

  if (!room) {
    return json({ error: "Không tìm thấy phòng." }, 404);
  }

  const color = colorForToken(room, token);
  if (color !== "r") {
    return json({ error: "Chỉ người tạo phòng màu Đỏ được tạo ván mới." }, 403);
  }

  const game = new Xiangqi();
  room.status = room.players.b ? "active" : "waiting";
  room.fen = game.fen();
  room.turn = game.turn();
  room.winner = null;
  room.result = "";
  room.lastMove = null;
  room.moves = [];

  await saveRoom(store, room);
  return json({ room: publicRoom(room, token) });
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const url = new URL(request.url);

  if (request.method === "GET") {
    return getRoomState(store, cleanCode(url.searchParams.get("code")), String(url.searchParams.get("token") ?? ""));
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = String(body.action ?? "");
  const name = cleanName(body.name);

  if ((action === "create" || action === "join") && !name) {
    return json({ error: "Tên người chơi là bắt buộc." }, 400);
  }

  if (action === "create") {
    return createRoom(store, name);
  }

  if (action === "join") {
    return joinRoom(store, cleanCode(body.code), name);
  }

  if (action === "move") {
    return moveRoom(store, body);
  }

  if (action === "resign") {
    return resignRoom(store, body);
  }

  if (action === "reset") {
    return resetRoom(store, body);
  }

  return json({ error: "Unknown action" }, 400);
};
