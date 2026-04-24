const API_URL = "/.netlify/functions/scores";
const PLAYER_KEY = "mini-arcade-player-v1";
const LOCAL_SCORES_KEY = "mini-arcade-scores-v1";

const gameGrid = document.querySelector("#game-grid");
const gameCount = document.querySelector("#game-count");
const homeView = document.querySelector("#home-view");
const playView = document.querySelector("#play-view");
const stageBody = document.querySelector("#stage-body");
const activeGameTitle = document.querySelector("#active-game-title");
const activeGameKicker = document.querySelector("#active-game-kicker");
const restartButton = document.querySelector("#restart-game");
const backToGamesButton = document.querySelector("#back-to-games");
const playerForm = document.querySelector("#player-form");
const playerNameInput = document.querySelector("#player-name");
const playerStatus = document.querySelector("#player-status");
const leaderboardFilter = document.querySelector("#leaderboard-filter");
const scoreList = document.querySelector("#score-list");
const scoreSource = document.querySelector("#score-source");
const refreshScoresButton = document.querySelector("#refresh-scores");
const scoreDialog = document.querySelector("#score-dialog");
const scoreForm = document.querySelector("#score-form");
const scoreNameInput = document.querySelector("#score-name");
const resultTitle = document.querySelector("#result-title");
const resultScore = document.querySelector("#result-score");
const resultDetail = document.querySelector("#result-detail");
const closeScoreDialogButton = document.querySelector("#close-score-dialog");
const skipScoreButton = document.querySelector("#skip-score");

const games = [
  {
    id: "xiangqi",
    code: "XQ",
    title: "Cờ tướng",
    description: "Đấu 2 người, đúng luật cờ tướng.",
    start: startXiangqiGame,
  },
  {
    id: "reaction",
    code: "RT",
    title: "Phản xạ",
    description: "Chờ tín hiệu rồi bấm thật nhanh.",
    start: startReactionGame,
  },
  {
    id: "bubble",
    code: "BP",
    title: "Bắn bóng",
    description: "Chạm mục tiêu càng nhiều càng tốt.",
    start: startBubbleGame,
  },
  {
    id: "math",
    code: "MS",
    title: "Toán nhanh",
    description: "Giải phép tính trong 30 giây.",
    start: startMathGame,
  },
  {
    id: "memory",
    code: "MC",
    title: "Lật thẻ",
    description: "Tìm đủ các cặp giống nhau.",
    start: startMemoryGame,
  },
  {
    id: "color",
    code: "CM",
    title: "Màu chữ",
    description: "Chọn đúng màu đang hiển thị.",
    start: startColorGame,
  },
  {
    id: "typing",
    code: "TB",
    title: "Gõ chữ",
    description: "Gõ đúng từ xuất hiện trên màn hình.",
    start: startTypingGame,
  },
  {
    id: "number",
    code: "NM",
    title: "Nhớ số",
    description: "Nhớ và nhập lại dãy số.",
    start: startNumberMemoryGame,
  },
  {
    id: "grid",
    code: "SG",
    title: "Ô sáng",
    description: "Bấm đúng ô đang sáng.",
    start: startStarGridGame,
  },
  {
    id: "higher",
    code: "HL",
    title: "Cao thấp",
    description: "Đoán số tiếp theo cao hay thấp.",
    start: startHigherLowerGame,
  },
  {
    id: "order",
    code: "OT",
    title: "Xếp số",
    description: "Bấm các số theo thứ tự tăng dần.",
    start: startOrderTapGame,
  },
];

let activeGame = null;
let currentResult = null;
let cleanupTasks = [];
let leaderboardScores = [];

window.registerGameCleanup = (cleanup) => {
  if (typeof cleanup === "function") {
    cleanupTasks.push(cleanup);
  }
};

function sanitizeName(value) {
  return value.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getPlayerName() {
  return sanitizeName(localStorage.getItem(PLAYER_KEY) ?? "");
}

function setPlayerName(name) {
  const cleanName = sanitizeName(name);
  localStorage.setItem(PLAYER_KEY, cleanName);
  playerNameInput.value = cleanName;
  playerStatus.textContent = cleanName ? `Đang chơi: ${cleanName}` : "Chưa có tên";
  return cleanName;
}

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clearActiveGame() {
  for (const cleanup of cleanupTasks.splice(0)) {
    cleanup();
  }
}

function renderWelcomeStage() {
  activeGameTitle.textContent = "Chọn một game";
  activeGameKicker.textContent = "Sẵn sàng";
  restartButton.disabled = true;
  stageBody.innerHTML = `
    <div class="welcome-board">
      <span class="welcome-mark">MA</span>
      <p>Chọn game bất kỳ để bắt đầu.</p>
    </div>
  `;
}

function showHomeView() {
  clearActiveGame();
  activeGame = null;
  homeView.hidden = false;
  playView.hidden = true;
  renderWelcomeStage();

  document.querySelectorAll(".game-card").forEach((button) => {
    button.classList.remove("active");
  });

  window.scrollTo(0, 0);
}

function showPlayView(game, pushHistory = true) {
  homeView.hidden = true;
  playView.hidden = false;

  if (pushHistory) {
    history.pushState({ gameId: game.id }, "", `#${game.id}`);
  }

  window.scrollTo(0, 0);
}

function trackTimeout(callback, delay) {
  const id = window.setTimeout(callback, delay);
  cleanupTasks.push(() => window.clearTimeout(id));
  return id;
}

function trackInterval(callback, delay) {
  const id = window.setInterval(callback, delay);
  cleanupTasks.push(() => window.clearInterval(id));
  return id;
}

function startCountdown(seconds, onTick, onDone) {
  let remaining = seconds;
  let ended = false;
  onTick(remaining);

  const id = window.setInterval(() => {
    remaining -= 1;
    onTick(Math.max(remaining, 0));

    if (remaining <= 0 && !ended) {
      ended = true;
      window.clearInterval(id);
      onDone();
    }
  }, 1000);

  cleanupTasks.push(() => {
    ended = true;
    window.clearInterval(id);
  });

  return () => {
    if (!ended) {
      ended = true;
      window.clearInterval(id);
      onDone();
    }
  };
}

function setActiveGame(game, options = {}) {
  const pushHistory = options.pushHistory ?? true;
  clearActiveGame();
  activeGame = game;
  activeGameTitle.textContent = game.title;
  activeGameKicker.textContent = "Đang chơi";
  restartButton.disabled = false;
  showPlayView(game, pushHistory);

  document.querySelectorAll(".game-card").forEach((button) => {
    button.classList.toggle("active", button.dataset.gameId === game.id);
  });

  game.start();
}

function routeFromHash() {
  const gameId = decodeURIComponent(location.hash.replace(/^#/, ""));
  const game = games.find((item) => item.id === gameId);

  if (game) {
    setActiveGame(game, { pushHistory: false });
  } else {
    showHomeView();
  }
}

function renderHud(items) {
  return `
    <div class="hud">
      ${items
        .map(
          (item) => `
            <div class="hud-item">
              <span class="hud-label">${item.label}</span>
              <span class="hud-value" id="${item.id}">${item.value}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderGameShell(hudItems, boardHtml) {
  stageBody.innerHTML = `
    ${renderHud(hudItems)}
    <div class="game-board">${boardHtml}</div>
  `;
}

function finishGame(score, detail) {
  clearActiveGame();
  stageBody.querySelectorAll("button, input").forEach((element) => {
    element.disabled = true;
  });

  const finalScore = Math.max(0, Math.round(score));
  currentResult = {
    gameId: activeGame.id,
    gameTitle: activeGame.title,
    score: finalScore,
    detail,
  };

  resultTitle.textContent = activeGame.title;
  resultScore.textContent = String(finalScore);
  resultDetail.textContent = detail;
  scoreNameInput.value = getPlayerName();
  scoreDialog.showModal();
}

function updateValue(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) {
    element.textContent = String(value);
  }
}

function startReactionGame() {
  renderGameShell(
    [
      { id: "reaction-score", label: "Điểm", value: "0" },
      { id: "reaction-time", label: "Phản xạ", value: "-" },
      { id: "reaction-state", label: "Trạng thái", value: "Chờ" },
    ],
    `
      <div class="game-stack">
        <p class="game-prompt">Bấm khi nút xanh</p>
        <p class="sub-prompt">Bấm sớm sẽ mất lượt.</p>
        <button class="game-button" id="reaction-button" type="button">Bắt đầu</button>
      </div>
    `,
  );

  const button = document.querySelector("#reaction-button");
  let state = "idle";
  let readyAt = 0;

  button.addEventListener("click", () => {
    if (state === "idle") {
      state = "waiting";
      button.textContent = "Đợi...";
      button.classList.remove("ready");
      updateValue("reaction-state", "Đợi");

      trackTimeout(() => {
        state = "ready";
        readyAt = performance.now();
        button.textContent = "BẤM NGAY";
        button.classList.add("ready");
        updateValue("reaction-state", "Bấm");
      }, randomInt(900, 2600));
      return;
    }

    if (state === "waiting") {
      finishGame(0, "Bạn bấm hơi sớm.");
      return;
    }

    if (state === "ready") {
      const reactionMs = Math.round(performance.now() - readyAt);
      const score = Math.max(50, 1300 - reactionMs);
      updateValue("reaction-score", score);
      updateValue("reaction-time", `${reactionMs}ms`);
      finishGame(score, `Phản xạ ${reactionMs}ms.`);
    }
  });
}

function startBubbleGame() {
  renderGameShell(
    [
      { id: "bubble-score", label: "Điểm", value: "0" },
      { id: "bubble-hits", label: "Trúng", value: "0" },
      { id: "bubble-time", label: "Giây", value: "20" },
    ],
    `
      <div class="target-zone" id="target-zone">
        <button class="target" id="target" type="button" aria-label="Mục tiêu"></button>
      </div>
    `,
  );

  const zone = document.querySelector("#target-zone");
  const target = document.querySelector("#target");
  let hits = 0;

  function moveTarget() {
    const size = randomInt(42, 76);
    const rect = zone.getBoundingClientRect();
    target.style.width = `${size}px`;
    target.style.height = `${size}px`;
    target.style.left = `${randomInt(0, Math.max(0, Math.floor(rect.width - size)))}px`;
    target.style.top = `${randomInt(0, Math.max(0, Math.floor(rect.height - size)))}px`;
  }

  target.addEventListener("click", () => {
    hits += 1;
    const score = hits * 100;
    updateValue("bubble-hits", hits);
    updateValue("bubble-score", score);
    moveTarget();
  });

  moveTarget();
  startCountdown(
    20,
    (remaining) => updateValue("bubble-time", remaining),
    () => finishGame(hits * 100, `Bạn bấm trúng ${hits} mục tiêu.`),
  );
}

function startMathGame() {
  renderGameShell(
    [
      { id: "math-score", label: "Điểm", value: "0" },
      { id: "math-correct", label: "Đúng", value: "0" },
      { id: "math-time", label: "Giây", value: "30" },
    ],
    `
      <form class="game-stack" id="math-form" autocomplete="off">
        <p class="game-prompt" id="math-question">0 + 0</p>
        <div class="math-row">
          <input id="math-answer" inputmode="numeric" placeholder="Đáp án" />
          <button class="game-button" type="submit">Trả lời</button>
        </div>
        <p class="sub-prompt" id="math-feedback">Sẵn sàng.</p>
      </form>
    `,
  );

  const form = document.querySelector("#math-form");
  const question = document.querySelector("#math-question");
  const answer = document.querySelector("#math-answer");
  const feedback = document.querySelector("#math-feedback");
  let correct = 0;
  let wrong = 0;
  let currentAnswer = 0;

  function nextQuestion() {
    const a = randomInt(4, 39);
    const b = randomInt(3, 28);
    const op = Math.random() > 0.46 ? "+" : "-";
    currentAnswer = op === "+" ? a + b : a - b;
    question.textContent = `${a} ${op} ${b}`;
    answer.value = "";
    answer.focus();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = Number(answer.value.trim());
    if (!Number.isFinite(value)) {
      return;
    }

    if (value === currentAnswer) {
      correct += 1;
      feedback.textContent = "Đúng.";
    } else {
      wrong += 1;
      feedback.textContent = `Sai, đáp án là ${currentAnswer}.`;
    }

    const score = Math.max(0, correct * 120 - wrong * 35);
    updateValue("math-correct", correct);
    updateValue("math-score", score);
    nextQuestion();
  });

  nextQuestion();
  startCountdown(
    30,
    (remaining) => updateValue("math-time", remaining),
    () => finishGame(Math.max(0, correct * 120 - wrong * 35), `${correct} đúng, ${wrong} sai.`),
  );
}

function startMemoryGame() {
  const symbols = shuffle(["A", "B", "C", "D", "E", "F", "G", "H"]).slice(0, 6);
  const cards = shuffle([...symbols, ...symbols]).map((symbol, index) => ({
    id: index,
    symbol,
    open: false,
    matched: false,
  }));

  renderGameShell(
    [
      { id: "memory-score", label: "Cặp", value: "0" },
      { id: "memory-moves", label: "Lượt", value: "0" },
      { id: "memory-time", label: "Giây", value: "0" },
    ],
    `<div class="memory-grid" id="memory-grid"></div>`,
  );

  const grid = document.querySelector("#memory-grid");
  let openCards = [];
  let matched = 0;
  let moves = 0;
  let seconds = 0;
  let locked = false;

  const interval = trackInterval(() => {
    seconds += 1;
    updateValue("memory-time", seconds);
  }, 1000);

  function renderCards() {
    grid.innerHTML = "";
    for (const card of cards) {
      const button = document.createElement("button");
      button.className = `memory-card${card.open ? " open" : ""}${card.matched ? " matched" : ""}`;
      button.type = "button";
      button.textContent = card.open || card.matched ? card.symbol : "?";
      button.disabled = locked || card.open || card.matched;
      button.addEventListener("click", () => flipCard(card.id));
      grid.append(button);
    }
  }

  function flipCard(id) {
    const card = cards.find((item) => item.id === id);
    if (!card || locked) {
      return;
    }

    card.open = true;
    openCards.push(card);
    renderCards();

    if (openCards.length === 2) {
      moves += 1;
      updateValue("memory-moves", moves);
      locked = true;

      trackTimeout(() => {
        const [first, second] = openCards;
        if (first.symbol === second.symbol) {
          first.matched = true;
          second.matched = true;
          matched += 1;
          updateValue("memory-score", matched);
        } else {
          first.open = false;
          second.open = false;
        }

        openCards = [];
        locked = false;
        renderCards();

        if (matched === symbols.length) {
          window.clearInterval(interval);
          const score = 1800 - moves * 55 - seconds * 14 + matched * 100;
          finishGame(score, `${moves} lượt trong ${seconds} giây.`);
        }
      }, 650);
    }
  }

  renderCards();
}

function startColorGame() {
  const colors = [
    { name: "Đỏ", value: "#dc4c3e" },
    { name: "Xanh", value: "#155e75" },
    { name: "Lục", value: "#16a34a" },
    { name: "Vàng", value: "#f59e0b" },
  ];

  renderGameShell(
    [
      { id: "color-score", label: "Điểm", value: "0" },
      { id: "color-round", label: "Lượt", value: "1/15" },
      { id: "color-streak", label: "Chuỗi", value: "0" },
    ],
    `
      <div class="game-stack">
        <p class="game-prompt" id="color-word">Đỏ</p>
        <p class="sub-prompt">Chọn màu của chữ.</p>
        <div class="answer-grid" id="color-options"></div>
      </div>
    `,
  );

  const word = document.querySelector("#color-word");
  const options = document.querySelector("#color-options");
  let round = 1;
  let correct = 0;
  let streak = 0;
  let targetColor = colors[0];

  function nextRound() {
    if (round > 15) {
      finishGame(correct * 100 + streak * 20, `${correct}/15 lượt đúng.`);
      return;
    }

    const textColor = colors[randomInt(0, colors.length - 1)];
    targetColor = colors[randomInt(0, colors.length - 1)];
    word.textContent = textColor.name;
    word.style.color = targetColor.value;
    updateValue("color-round", `${round}/15`);
    updateValue("color-score", correct * 100 + streak * 20);
    updateValue("color-streak", streak);
  }

  for (const color of colors) {
    const button = document.createElement("button");
    button.className = "answer-button";
    button.type = "button";
    button.textContent = color.name;
    button.addEventListener("click", () => {
      if (color.name === targetColor.name) {
        correct += 1;
        streak += 1;
      } else {
        streak = 0;
      }
      round += 1;
      nextRound();
    });
    options.append(button);
  }

  nextRound();
}

function startTypingGame() {
  const words = [
    "nang",
    "bien",
    "may",
    "song",
    "lua",
    "gio",
    "sach",
    "trang",
    "xanh",
    "nhanh",
    "vui",
    "code",
    "diem",
    "game",
    "sang",
  ];

  renderGameShell(
    [
      { id: "typing-score", label: "Điểm", value: "0" },
      { id: "typing-words", label: "Từ", value: "0" },
      { id: "typing-time", label: "Giây", value: "30" },
    ],
    `
      <div class="game-stack">
        <p class="game-prompt" id="typing-word">word</p>
        <div class="word-input-row">
          <input id="typing-input" autocapitalize="none" autocomplete="off" placeholder="Gõ từ này" />
          <button class="game-button" id="typing-skip" type="button">Đổi</button>
        </div>
      </div>
    `,
  );

  const word = document.querySelector("#typing-word");
  const input = document.querySelector("#typing-input");
  const skip = document.querySelector("#typing-skip");
  let typed = 0;
  let mistakes = 0;
  let current = "";

  function nextWord() {
    current = words[randomInt(0, words.length - 1)];
    word.textContent = current;
    input.value = "";
    input.focus();
  }

  input.addEventListener("input", () => {
    if (input.value.trim().toLowerCase() === current) {
      typed += 1;
      const score = typed * 110 - mistakes * 20;
      updateValue("typing-words", typed);
      updateValue("typing-score", Math.max(0, score));
      nextWord();
    }
  });

  skip.addEventListener("click", () => {
    mistakes += 1;
    nextWord();
  });

  nextWord();
  startCountdown(
    30,
    (remaining) => updateValue("typing-time", remaining),
    () => finishGame(Math.max(0, typed * 110 - mistakes * 20), `Gõ đúng ${typed} từ.`),
  );
}

function startNumberMemoryGame() {
  renderGameShell(
    [
      { id: "number-score", label: "Điểm", value: "0" },
      { id: "number-level", label: "Cấp", value: "1" },
      { id: "number-length", label: "Độ dài", value: "3" },
    ],
    `
      <form class="game-stack" id="number-form" autocomplete="off">
        <p class="game-prompt" id="number-sequence">---</p>
        <p class="sub-prompt" id="number-status">Nhớ dãy số.</p>
        <div class="number-input-row">
          <input id="number-answer" inputmode="numeric" disabled placeholder="Nhập lại" />
          <button class="game-button" type="submit" disabled id="number-submit">Gửi</button>
        </div>
      </form>
    `,
  );

  const form = document.querySelector("#number-form");
  const sequenceText = document.querySelector("#number-sequence");
  const status = document.querySelector("#number-status");
  const input = document.querySelector("#number-answer");
  const submit = document.querySelector("#number-submit");
  let level = 1;
  let sequence = "";

  function showLevel() {
    const length = level + 2;
    sequence = Array.from({ length }, () => randomInt(0, 9)).join("");
    updateValue("number-level", level);
    updateValue("number-length", length);
    updateValue("number-score", (level - 1) * 220);
    sequenceText.textContent = sequence;
    status.textContent = "Nhớ dãy số.";
    input.disabled = true;
    submit.disabled = true;
    input.value = "";

    trackTimeout(() => {
      sequenceText.textContent = "••••••";
      status.textContent = "Nhập lại dãy số.";
      input.disabled = false;
      submit.disabled = false;
      input.focus();
    }, Math.min(2300, 900 + length * 220));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (input.value.trim() === sequence) {
      level += 1;
      showLevel();
    } else {
      finishGame((level - 1) * 220, `Bạn vượt qua ${level - 1} cấp.`);
    }
  });

  showLevel();
}

function startStarGridGame() {
  renderGameShell(
    [
      { id: "grid-score", label: "Điểm", value: "0" },
      { id: "grid-hits", label: "Trúng", value: "0" },
      { id: "grid-time", label: "Giây", value: "20" },
    ],
    `<div class="grid-game" id="grid-game"></div>`,
  );

  const grid = document.querySelector("#grid-game");
  const cells = [];
  let active = 0;
  let hits = 0;
  let misses = 0;

  function setActive(index) {
    active = index;
    cells.forEach((cell, cellIndex) => {
      cell.classList.toggle("active", cellIndex === active);
      cell.textContent = cellIndex === active ? "✓" : "";
    });
  }

  for (let index = 0; index < 16; index += 1) {
    const button = document.createElement("button");
    button.className = "grid-cell";
    button.type = "button";
    button.addEventListener("click", () => {
      if (index === active) {
        hits += 1;
        setActive(randomInt(0, 15));
      } else {
        misses += 1;
      }

      updateValue("grid-hits", hits);
      updateValue("grid-score", Math.max(0, hits * 90 - misses * 20));
    });
    cells.push(button);
    grid.append(button);
  }

  setActive(randomInt(0, 15));
  startCountdown(
    20,
    (remaining) => updateValue("grid-time", remaining),
    () => finishGame(Math.max(0, hits * 90 - misses * 20), `${hits} trúng, ${misses} trượt.`),
  );
}

function startHigherLowerGame() {
  renderGameShell(
    [
      { id: "higher-score", label: "Điểm", value: "0" },
      { id: "higher-streak", label: "Chuỗi", value: "0" },
      { id: "higher-time", label: "Giây", value: "30" },
    ],
    `
      <div class="game-stack">
        <p class="game-prompt" id="higher-number">50</p>
        <p class="sub-prompt">Số tiếp theo sẽ cao hơn hay thấp hơn?</p>
        <div class="answer-grid">
          <button class="answer-button" id="higher-up" type="button">Cao hơn</button>
          <button class="answer-button" id="higher-down" type="button">Thấp hơn</button>
        </div>
      </div>
    `,
  );

  const number = document.querySelector("#higher-number");
  const up = document.querySelector("#higher-up");
  const down = document.querySelector("#higher-down");
  let current = randomInt(10, 90);
  let streak = 0;
  let score = 0;
  let done = false;

  function draw() {
    number.textContent = current;
  }

  function guess(direction) {
    if (done) {
      return;
    }

    let next = randomInt(1, 99);
    while (next === current) {
      next = randomInt(1, 99);
    }

    const correct = direction === "up" ? next > current : next < current;
    current = next;
    draw();

    if (!correct) {
      done = true;
      finishGame(score, `Chuỗi đúng dài nhất: ${streak}.`);
      return;
    }

    streak += 1;
    score += 60 + streak * 15;
    updateValue("higher-score", score);
    updateValue("higher-streak", streak);
  }

  up.addEventListener("click", () => guess("up"));
  down.addEventListener("click", () => guess("down"));
  draw();

  startCountdown(
    30,
    (remaining) => updateValue("higher-time", remaining),
    () => {
      done = true;
      finishGame(score, `Chuỗi đúng dài nhất: ${streak}.`);
    },
  );
}

function startOrderTapGame() {
  const numbers = shuffle(Array.from({ length: 12 }, () => randomInt(1, 99)));
  const sorted = [...numbers].sort((a, b) => a - b);

  renderGameShell(
    [
      { id: "order-score", label: "Điểm", value: "0" },
      { id: "order-next", label: "Số kế", value: sorted[0] },
      { id: "order-time", label: "Giây", value: "0" },
    ],
    `<div class="order-grid" id="order-grid"></div>`,
  );

  const grid = document.querySelector("#order-grid");
  let index = 0;
  let mistakes = 0;
  let seconds = 0;
  let ended = false;

  const interval = trackInterval(() => {
    seconds += 1;
    updateValue("order-time", seconds);
  }, 1000);

  for (const number of numbers) {
    const button = document.createElement("button");
    button.className = "order-number";
    button.type = "button";
    button.textContent = number;
    button.addEventListener("click", () => {
      if (ended || button.classList.contains("done")) {
        return;
      }

      if (number === sorted[index]) {
        button.classList.add("done");
        index += 1;
        updateValue("order-next", sorted[index] ?? "Xong");
        updateValue("order-score", index * 120);
      } else {
        mistakes += 1;
        button.classList.add("wrong");
        trackTimeout(() => button.classList.remove("wrong"), 220);
      }

      if (index === sorted.length) {
        ended = true;
        window.clearInterval(interval);
        const score = 1600 - seconds * 22 - mistakes * 90;
        finishGame(score, `${seconds} giây, ${mistakes} lỗi.`);
      }
    });
    grid.append(button);
  }
}

function loadLocalScores() {
  try {
    const scores = JSON.parse(localStorage.getItem(LOCAL_SCORES_KEY) ?? "[]");
    return Array.isArray(scores) ? scores : [];
  } catch {
    return [];
  }
}

function saveLocalScore(entry) {
  const scores = [entry, ...loadLocalScores()]
    .sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 300);
  localStorage.setItem(LOCAL_SCORES_KEY, JSON.stringify(scores));
}

function getFilteredScores(scores) {
  const filter = leaderboardFilter.value;
  const filtered = filter === "all" ? scores : scores.filter((score) => score.gameId === filter);
  return [...filtered].sort((a, b) => b.score - a.score || new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30);
}

function renderScores(source = "local") {
  const scores = getFilteredScores(leaderboardScores);
  scoreList.innerHTML = "";

  if (scores.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-scores";
    empty.textContent = "Chưa có điểm.";
    scoreList.append(empty);
  } else {
    scores.forEach((score, index) => {
      const item = document.createElement("li");
      item.className = "score-item";

      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(index + 1);

      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "score-name";
      name.textContent = score.name;

      const game = document.createElement("span");
      game.className = "score-game";
      game.textContent = `${score.gameTitle} · ${formatDate(score.createdAt)}`;

      const points = document.createElement("strong");
      points.className = "score-points";
      points.textContent = String(score.score);

      text.append(name, game);
      item.append(rank, text, points);
      scoreList.append(item);
    });
  }

  scoreSource.textContent =
    source === "netlify"
      ? "Bảng điểm online từ Netlify Blobs."
      : "Đang dùng bảng điểm local trên máy này.";
}

async function loadScores() {
  const selectedGame = leaderboardFilter.value;
  const query = selectedGame && selectedGame !== "all" ? `?game=${encodeURIComponent(selectedGame)}` : "";

  try {
    const response = await fetch(`${API_URL}${query}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Scores API unavailable");
    }
    const data = await response.json();
    leaderboardScores = Array.isArray(data.scores) ? data.scores : [];
    renderScores("netlify");
  } catch {
    leaderboardScores = loadLocalScores();
    renderScores("local");
  }
}

async function submitScore(result, name) {
  const entry = {
    id: createId(),
    name,
    gameId: result.gameId,
    gameTitle: result.gameTitle,
    score: result.score,
    detail: result.detail,
    createdAt: new Date().toISOString(),
  };

  saveLocalScore(entry);
  leaderboardScores = loadLocalScores();
  renderScores("local");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      throw new Error("Could not save online score");
    }
    const data = await response.json();
    leaderboardScores = Array.isArray(data.scores) ? data.scores : [entry];
    renderScores("netlify");
  } catch {
    scoreSource.textContent = "Đã lưu local. Khi deploy Netlify, điểm sẽ lưu online.";
  }
}

function renderGamePicker() {
  gameGrid.innerHTML = "";
  for (const game of games) {
    const button = document.createElement("button");
    button.className = "game-card";
    button.type = "button";
    button.dataset.gameId = game.id;
    button.innerHTML = `
      <span class="game-icon">${game.code}</span>
      <span>
        <span class="game-title">${game.title}</span>
        <span class="game-desc">${game.description}</span>
      </span>
    `;
    button.addEventListener("click", () => setActiveGame(game));
    gameGrid.append(button);
  }
  gameCount.textContent = `${games.length} game`;
}

function renderLeaderboardFilters() {
  leaderboardFilter.innerHTML = `
    <option value="all">Tất cả game</option>
    ${games.map((game) => `<option value="${game.id}">${game.title}</option>`).join("")}
  `;
}

playerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = setPlayerName(playerNameInput.value);
  if (!name) {
    playerNameInput.focus();
  }
});

restartButton.addEventListener("click", () => {
  if (activeGame) {
    setActiveGame(activeGame, { pushHistory: false });
  }
});

backToGamesButton.addEventListener("click", () => {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  showHomeView();
});

window.addEventListener("popstate", routeFromHash);
window.addEventListener("hashchange", routeFromHash);

refreshScoresButton.addEventListener("click", () => loadScores());
leaderboardFilter.addEventListener("change", () => loadScores());

scoreForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = setPlayerName(scoreNameInput.value);
  const result = currentResult;

  if (!name || !result) {
    scoreNameInput.focus();
    return;
  }

  currentResult = null;
  scoreDialog.close();
  submitScore(result, name);
});

function closeScoreDialog() {
  currentResult = null;
}

closeScoreDialogButton.addEventListener("click", () => {
  closeScoreDialog();
  scoreDialog.close();
});

skipScoreButton.addEventListener("click", () => {
  closeScoreDialog();
  scoreDialog.close();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}

setPlayerName(getPlayerName());
renderGamePicker();
renderLeaderboardFilters();
loadScores();
routeFromHash();
