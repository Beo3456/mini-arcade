import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "mini-arcade-scores";
const SCORE_KEY = "scores.json";
const MAX_SCORES = 500;
const GAME_IDS = new Set([
  "xiangqi",
  "gomoku",
  "chess",
  "reaction",
  "bubble",
  "math",
  "memory",
  "color",
  "typing",
  "number",
  "grid",
  "higher",
  "order",
]);

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

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
}

function sortScores(scores) {
  return scores.sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt));
}

async function readScores(store) {
  const stored = await store.get(SCORE_KEY, { type: "json", consistency: "strong" });
  return Array.isArray(stored) ? stored : [];
}

function filterScores(scores, gameId) {
  const filtered = gameId && GAME_IDS.has(gameId) ? scores.filter((score) => score.gameId === gameId) : scores;
  return sortScores(filtered).slice(0, 100);
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const url = new URL(request.url);

  if (request.method === "GET") {
    const gameId = url.searchParams.get("game");
    const scores = await readScores(store);
    return json({ scores: filterScores(scores, gameId) });
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

  const name = cleanName(body.name);
  const gameId = cleanText(body.gameId);
  const gameTitle = cleanText(body.gameTitle, gameId);
  const detail = cleanText(body.detail);
  const score = Math.round(Number(body.score));

  if (!name) {
    return json({ error: "Name is required" }, 400);
  }

  if (!GAME_IDS.has(gameId)) {
    return json({ error: "Unknown game" }, 400);
  }

  if (!Number.isFinite(score) || score < 0 || score > 999999) {
    return json({ error: "Invalid score" }, 400);
  }

  const entry = {
    id: randomUUID(),
    name,
    gameId,
    gameTitle,
    detail,
    score,
    createdAt: new Date().toISOString(),
  };

  const scores = sortScores([entry, ...(await readScores(store))]).slice(0, MAX_SCORES);
  await store.setJSON(SCORE_KEY, scores);

  return json({ saved: true, entry, scores: filterScores(scores, gameId) }, 201);
};
