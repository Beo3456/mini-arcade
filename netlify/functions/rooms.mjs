import { randomBytes, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import xiangqiModule from "./xiangqi.cjs";
import chessModule from "./chess.cjs";

const { Xiangqi } = xiangqiModule;
const { Chess } = chessModule;

const STORE_NAME = "board-game-rooms";
const ROOM_PREFIX = "rooms/";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_MOVES = 500;
const GAMES = new Set(["xiangqi", "gomoku", "chess"]);
const GOMOKU_SIZE = 15;

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

function cleanGame(value) {
  const game = String(value || "xiangqi").toLowerCase();
  return GAMES.has(game) ? game : "xiangqi";
}

function cleanSquare(value, game) {
  const square = String(value ?? "").toLowerCase();
  if (game === "xiangqi") return /^[a-i][0-9]$/.test(square) ? square : "";
  if (game === "chess") return /^[a-h][1-8]$/.test(square) ? square : "";
  return "";
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
  if (!token) return null;
  if (room.players.r?.token === token) return "r";
  if (room.players.b?.token === token) return "b";
  return null;
}

function publicRoom(room, token = "") {
  const color = colorForToken(room, token);
  return {
    code: room.code,
    game: room.game,
    status: room.status,
    fen: room.fen,
    board: room.board,
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
    moves: room.moves.slice(-60),
  };
}

function sideLabel(game, color) {
  if (color === "draw") return "Hòa";
  if (game === "chess") return color === "r" ? "Trắng" : "Đen";
  if (game === "gomoku") return color === "r" ? "Đen" : "Trắng";
  return color === "r" ? "Đỏ" : "Đen";
}

function emptyGomokuBoard() {
  return Array.from({ length: GOMOKU_SIZE * GOMOKU_SIZE }, () => "");
}

function createGameState(game) {
  if (game === "xiangqi") {
    const xiangqi = new Xiangqi();
    return { fen: xiangqi.fen(), board: null, turn: "r" };
  }

  if (game === "chess") {
    const chess = new Chess();
    return { fen: chess.fen(), board: null, turn: "r" };
  }

  return { fen: "", board: emptyGomokuBoard(), turn: "r" };
}

function other(color) {
  return color === "r" ? "b" : "r";
}

function statusAfterXiangqiMove(game, movingColor) {
  if (typeof game.in_checkmate === "function" && game.in_checkmate()) {
    return { status: "ended", winner: movingColor, result: `${sideLabel("xiangqi", movingColor)} thắng chiếu bí.` };
  }
  if (typeof game.in_stalemate === "function" && game.in_stalemate()) {
    return { status: "ended", winner: "draw", result: "Hòa do hết nước đi." };
  }
  if (typeof game.in_draw === "function" && game.in_draw()) {
    return { status: "ended", winner: "draw", result: "Ván hòa." };
  }
  if (typeof game.game_over === "function" && game.game_over()) {
    return { status: "ended", winner: movingColor, result: `${sideLabel("xiangqi", movingColor)} thắng.` };
  }
  return { status: "active", winner: null, result: "" };
}

function statusAfterChessMove(chess, movingColor) {
  if (chess.isCheckmate()) {
    return { status: "ended", winner: movingColor, result: `${sideLabel("chess", movingColor)} thắng chiếu bí.` };
  }
  if (chess.isDraw()) {
    return { status: "ended", winner: "draw", result: "Ván hòa." };
  }
  if (chess.isGameOver()) {
    return { status: "ended", winner: "draw", result: "Ván kết thúc." };
  }
  return { status: "active", winner: null, result: "" };
}

function gomokuWinner(board, row, col, color) {
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    let count = 1;
    for (const step of [-1, 1]) {
      let r = row + dr * step;
      let c = col + dc * step;
      while (r >= 0 && r < GOMOKU_SIZE && c >= 0 && c < GOMOKU_SIZE && board[r * GOMOKU_SIZE + c] === color) {
        count += 1;
        r += dr * step;
        c += dc * step;
      }
    }
    if (count >= 5) return true;
  }

  return false;
}

async function createRoom(store, game, name) {
  let code = randomCode();
  for (let attempt = 0; attempt < 8 && (await readRoom(store, code)); attempt += 1) {
    code = randomCode();
  }

  const token = randomUUID();
  const now = new Date().toISOString();
  const state = createGameState(game);
  const room = {
    code,
    game,
    status: "waiting",
    fen: state.fen,
    board: state.board,
    turn: state.turn,
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

async function joinRoom(store, code, name, game) {
  const room = await readRoom(store, code);
  if (!room) return json({ error: "Không tìm thấy phòng." }, 404);
  if (room.game !== game) return json({ error: "Mã phòng thuộc game khác." }, 409);
  if (room.players.b) return json({ error: "Phòng đã đủ 2 người." }, 409);

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
  if (!room) return json({ error: "Không tìm thấy phòng." }, 404);
  return json({ room: publicRoom(room, token) });
}

function moveXiangqi(room, color, body) {
  const from = cleanSquare(body.from, "xiangqi");
  const to = cleanSquare(body.to, "xiangqi");
  if (!from || !to) return { error: "Nước đi không hợp lệ.", status: 400 };

  const game = new Xiangqi(room.fen);
  const move = game.move({ from, to });
  if (!move) return { error: "Nước đi sai luật.", status: 400 };

  const endState = statusAfterXiangqiMove(game, color);
  return {
    fen: game.fen(),
    turn: game.turn(),
    board: null,
    endState,
    move: {
      id: randomUUID(),
      color,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured ?? null,
      flags: move.flags ?? "",
      createdAt: new Date().toISOString(),
    },
  };
}

function moveChess(room, color, body) {
  const from = cleanSquare(body.from, "chess");
  const to = cleanSquare(body.to, "chess");
  const promotion = String(body.promotion || "q").toLowerCase().replace(/[^qrbn]/g, "") || "q";
  if (!from || !to) return { error: "Nước đi không hợp lệ.", status: 400 };

  const chess = new Chess(room.fen);
  const expected = chess.turn() === "w" ? "r" : "b";
  if (expected !== color) return { error: "Chưa đến lượt bạn.", status: 409 };

  let move = null;
  try {
    move = chess.move({ from, to, promotion });
  } catch {
    return { error: "Nước đi sai luật.", status: 400 };
  }

  const endState = statusAfterChessMove(chess, color);
  return {
    fen: chess.fen(),
    turn: chess.turn() === "w" ? "r" : "b",
    board: null,
    endState,
    move: {
      id: randomUUID(),
      color,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured ?? null,
      flags: move.flags ?? "",
      san: move.san,
      promotion: move.promotion ?? null,
      createdAt: new Date().toISOString(),
    },
  };
}

function moveGomoku(room, color, body) {
  const row = Number(body.row);
  const col = Number(body.col);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= GOMOKU_SIZE || col < 0 || col >= GOMOKU_SIZE) {
    return { error: "Ô cờ không hợp lệ.", status: 400 };
  }

  const board = Array.isArray(room.board) ? [...room.board] : emptyGomokuBoard();
  const index = row * GOMOKU_SIZE + col;
  if (board[index]) return { error: "Ô này đã có quân.", status: 409 };

  board[index] = color;
  const won = gomokuWinner(board, row, col, color);
  const full = board.every(Boolean);
  const endState = won
    ? { status: "ended", winner: color, result: `${sideLabel("gomoku", color)} thắng với 5 quân liên tiếp.` }
    : full
      ? { status: "ended", winner: "draw", result: "Ván hòa, bàn đã đầy." }
      : { status: "active", winner: null, result: "" };

  return {
    fen: "",
    board,
    turn: other(color),
    endState,
    move: {
      id: randomUUID(),
      color,
      row,
      col,
      from: `${row},${col}`,
      to: `${row},${col}`,
      piece: color === "r" ? "x" : "o",
      captured: null,
      flags: "",
      createdAt: new Date().toISOString(),
    },
  };
}

async function moveRoom(store, body) {
  const code = cleanCode(body.code);
  const token = String(body.token ?? "");
  const room = await readRoom(store, code);
  if (!room) return json({ error: "Không tìm thấy phòng." }, 404);

  const color = colorForToken(room, token);
  if (!color) return json({ error: "Bạn không thuộc phòng này." }, 403);
  if (room.status !== "active") return json({ error: "Ván chưa sẵn sàng hoặc đã kết thúc." }, 409);
  if (room.turn !== color) return json({ error: "Chưa đến lượt bạn." }, 409);

  const result =
    room.game === "chess" ? moveChess(room, color, body) : room.game === "gomoku" ? moveGomoku(room, color, body) : moveXiangqi(room, color, body);

  if (result.error) return json({ error: result.error }, result.status);

  room.fen = result.fen;
  room.board = result.board;
  room.turn = result.turn;
  room.status = result.endState.status;
  room.winner = result.endState.winner;
  room.result = result.endState.result;
  room.lastMove = result.move;
  room.moves = [...room.moves, result.move].slice(-MAX_MOVES);

  await saveRoom(store, room);
  return json({ room: publicRoom(room, token), move: result.move });
}

async function resignRoom(store, body) {
  const code = cleanCode(body.code);
  const token = String(body.token ?? "");
  const room = await readRoom(store, code);
  if (!room) return json({ error: "Không tìm thấy phòng." }, 404);

  const color = colorForToken(room, token);
  if (!color) return json({ error: "Bạn không thuộc phòng này." }, 403);
  if (room.status === "ended") return json({ room: publicRoom(room, token) });

  const winner = other(color);
  room.status = "ended";
  room.winner = winner;
  room.result = `${sideLabel(room.game, winner)} thắng do đối thủ đầu hàng.`;

  await saveRoom(store, room);
  return json({ room: publicRoom(room, token) });
}

async function resetRoom(store, body) {
  const code = cleanCode(body.code);
  const token = String(body.token ?? "");
  const room = await readRoom(store, code);
  if (!room) return json({ error: "Không tìm thấy phòng." }, 404);

  const color = colorForToken(room, token);
  if (color !== "r") return json({ error: "Chỉ người tạo phòng được tạo ván mới." }, 403);

  const state = createGameState(room.game);
  room.status = room.players.b ? "active" : "waiting";
  room.fen = state.fen;
  room.board = state.board;
  room.turn = state.turn;
  room.winner = null;
  room.result = "";
  room.lastMove = null;
  room.moves = [];

  await saveRoom(store, room);
  return json({ room: publicRoom(room, token) });
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const url = new URL(request.url);

  if (request.method === "GET") {
    return getRoomState(store, cleanCode(url.searchParams.get("code")), String(url.searchParams.get("token") ?? ""));
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const action = String(body.action ?? "");
  const name = cleanName(body.name);
  const game = cleanGame(body.game);

  if ((action === "create" || action === "join") && !name) {
    return json({ error: "Tên người chơi là bắt buộc." }, 400);
  }

  if (action === "create") return createRoom(store, game, name);
  if (action === "join") return joinRoom(store, cleanCode(body.code), name, game);
  if (action === "move") return moveRoom(store, body);
  if (action === "resign") return resignRoom(store, body);
  if (action === "reset") return resetRoom(store, body);

  return json({ error: "Unknown action" }, 400);
};
