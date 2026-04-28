(function () {
  const ROOM_API = "/.netlify/functions/rooms";
  const ROOM_SESSION_KEY = "mini-arcade-xiangqi-room-v1";
  const PLAYER_KEY = "mini-arcade-player-v1";
  const files = "abcdefghi";

  const pieceLabels = {
    "r:k": "\u5e25",
    "r:a": "\u4ed5",
    "r:b": "\u76f8",
    "r:n": "\u508c",
    "r:r": "\u4fe5",
    "r:c": "\u70ae",
    "r:p": "\u5175",
    "b:k": "\u5c07",
    "b:a": "\u58eb",
    "b:b": "\u8c61",
    "b:n": "\u99ac",
    "b:r": "\u8eca",
    "b:c": "\u7832",
    "b:p": "\u5352",
  };

  const pieceNames = {
    k: "Tướng",
    a: "Sĩ",
    b: "Tượng",
    n: "Mã",
    r: "Xe",
    c: "Pháo",
    p: "Tốt",
  };

  function sideName(color) {
    if (color === "draw") {
      return "Hòa";
    }
    return color === "r" ? "Đỏ" : "Đen";
  }

  function opposite(color) {
    return color === "r" ? "b" : "r";
  }

  function squareFor(row, col) {
    return `${files[col]}${9 - row}`;
  }

  function hasState(game, method) {
    return typeof game[method] === "function" && game[method]();
  }

  function cleanName(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24);
  }

  function playerName() {
    return cleanName(localStorage.getItem(PLAYER_KEY) ?? "");
  }

  function moveLabel(move, index) {
    const number = Math.floor(index / 2) + 1;
    const marker = index % 2 === 0 ? "." : "...";
    const capture = String(move.flags ?? "").includes("c") ? "x" : "-";
    const piece = pieceNames[String(move.piece).toLowerCase()] ?? "Quân";
    return `${number}${marker} ${sideName(move.color)} ${piece} ${move.from}${capture}${move.to}`;
  }

  function readSavedRoom() {
    try {
      return JSON.parse(localStorage.getItem(ROOM_SESSION_KEY) ?? "null");
    } catch {
      return null;
    }
  }

  function saveRoomSession(room, token) {
    localStorage.setItem(ROOM_SESSION_KEY, JSON.stringify({ code: room.code, token }));
  }

  function clearRoomSession() {
    localStorage.removeItem(ROOM_SESSION_KEY);
  }

  async function roomRequest(payload) {
    const response = await fetch(ROOM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không kết nối được phòng online.");
    }

    if (!data.room) {
      throw new Error("Online cần chạy trên Netlify đã deploy hoặc netlify dev.");
    }

    return data;
  }

  async function getRoomState(code, token) {
    const url = `${ROOM_API}?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không tải được phòng.");
    }

    if (!data.room) {
      throw new Error("Online cần chạy trên Netlify đã deploy hoặc netlify dev.");
    }

    return data;
  }

  function startXiangqiGame() {
    const stage = document.querySelector("#stage-body");
    const XiangqiCtor = typeof Xiangqi === "function" ? Xiangqi : null;

    if (!XiangqiCtor) {
      stage.innerHTML = `
        <div class="game-board">
          <div class="game-stack">
            <p class="game-prompt">Không tải được luật cờ tướng</p>
            <p class="sub-prompt">Kiểm tra file vendor/xiangqi.min.js rồi tải lại trang.</p>
          </div>
        </div>
      `;
      return;
    }

    let game = new XiangqiCtor();
    let selected = null;
    let legalTargets = new Set();
    let flipped = false;
    let finished = false;
    let statusOverride = "";
    let lastMove = null;
    let mode = "local";
    let online = {
      code: "",
      token: "",
      color: null,
      room: null,
      error: "",
      busy: false,
      poller: null,
    };

    function stopPolling() {
      if (online.poller) {
        clearInterval(online.poller);
        online.poller = null;
      }
    }

    if (typeof window.registerGameCleanup === "function") {
      window.registerGameCleanup(stopPolling);
    }

    function startPolling() {
      stopPolling();
      online.poller = setInterval(() => {
        refreshOnlineRoom(false);
      }, 1500);
    }

    function loadFen(fen) {
      if (fen) {
        game.load(fen);
      }
    }

    function applyRoom(room) {
      online.room = room;
      online.code = room.code;
      online.color = room.playerColor;
      loadFen(room.fen);
      lastMove = room.lastMove;
      finished = room.status === "ended";
      flipped = room.playerColor === "b";
      selected = null;
      legalTargets = new Set();
      statusOverride = "";
    }

    function localStatusText() {
      if (statusOverride) {
        return statusOverride;
      }

      if (hasState(game, "in_checkmate")) {
        finished = true;
        return `${sideName(opposite(game.turn()))} thắng, chiếu bí.`;
      }

      if (hasState(game, "in_stalemate")) {
        finished = true;
        return "Hết nước đi, ván hòa.";
      }

      if (hasState(game, "in_draw")) {
        finished = true;
        return "Ván hòa.";
      }

      if (typeof game.game_over === "function" && game.game_over()) {
        finished = true;
        return `${sideName(opposite(game.turn()))} thắng.`;
      }

      if (hasState(game, "in_check")) {
        return `${sideName(game.turn())} đang bị chiếu.`;
      }

      return `Đến lượt ${sideName(game.turn())}.`;
    }

    function onlineStatusText() {
      if (online.error) {
        return online.error;
      }

      const room = online.room;
      if (!room) {
        return "Tạo phòng hoặc nhập mã phòng để chơi online.";
      }

      if (room.status === "waiting") {
        return `Phòng ${room.code} đang chờ người thứ 2.`;
      }

      if (room.status === "ended") {
        return room.result || `${sideName(room.winner)} thắng.`;
      }

      if (room.turn === online.color) {
        return `Đến lượt bạn (${sideName(online.color)}).`;
      }

      return `Chờ ${sideName(room.turn)} đi.`;
    }

    function statusText() {
      return mode === "online" ? onlineStatusText() : localStatusText();
    }

    function canMoveSelectedPiece(piece) {
      if (!piece || finished) {
        return false;
      }

      if (mode === "local") {
        return piece.color === game.turn();
      }

      return online.room?.status === "active" && piece.color === online.color && game.turn() === online.color;
    }

    function refreshTargets() {
      legalTargets = new Set();
      if (!selected || finished) {
        return;
      }

      const moves = game.moves({ square: selected, verbose: true });
      legalTargets = new Set(moves.map((move) => move.to));
    }

    function boardHtml() {
      const board = game.board();
      const rows = flipped ? [9, 8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const cols = flipped ? [8, 7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7, 8];

      return rows
        .map((row, rowIndex) =>
          cols
            .map((col, colIndex) => {
              const square = squareFor(row, col);
              const piece = board[row][col];
              const classes = [
                "xq-square",
                selected === square ? "selected" : "",
                legalTargets.has(square) ? "legal" : "",
                legalTargets.has(square) && piece ? "capture" : "",
                lastMove?.from === square || lastMove?.to === square ? "last" : "",
              ]
                .filter(Boolean)
                .join(" ");

              const pieceClasses = piece
                ? ["xq-piece", piece.color === "r" ? "red" : "black", lastMove?.to === square ? "moved" : ""].filter(Boolean).join(" ")
                : "";
              const pieceHtml = piece ? `<span class="${pieceClasses}">${pieceLabels[`${piece.color}:${piece.type}`]}</span>` : "";

              return `
                <button class="${classes}" style="--x:${colIndex};--y:${rowIndex}" type="button" data-square="${square}" aria-label="${square}" ${finished ? "disabled" : ""}>
                  <span class="xq-coord">${square}</span>
                  ${pieceHtml}
                </button>
              `;
            })
            .join(""),
        )
        .join("");
    }

    function historyHtml() {
      const history = mode === "online" && online.room ? online.room.moves : game.history({ verbose: true });
      if (!history.length) {
        return `<li class="xq-empty-history">Chưa có nước đi.</li>`;
      }

      return history
        .slice(-16)
        .map((move, index) => `<li>${moveLabel(move, history.length - Math.min(16, history.length) + index)}</li>`)
        .join("");
    }

    function onlinePanelHtml() {
      const defaultName = playerName();
      const room = online.room;
      const saved = readSavedRoom();

      if (!room) {
        return `
          <div class="xq-online-box">
            <label for="xq-online-name">Tên online</label>
            <input id="xq-online-name" maxlength="24" placeholder="Tên người chơi" value="${defaultName}" />
            <button class="primary-button" id="xq-create-room" type="button" ${online.busy ? "disabled" : ""}>Tạo phòng</button>
            <div class="xq-join-row">
              <input id="xq-room-code" maxlength="6" placeholder="Mã phòng" value="${saved?.code ?? ""}" />
              <button class="ghost-button" id="xq-join-room" type="button" ${online.busy ? "disabled" : ""}>Vào</button>
            </div>
            ${
              saved?.code
                ? `<button class="ghost-button" id="xq-resume-room" type="button" ${online.busy ? "disabled" : ""}>Tiếp tục phòng ${saved.code}</button>`
                : ""
            }
          </div>
        `;
      }

      return `
        <div class="xq-online-box">
          <div class="xq-room-code">
            <span>Mã phòng</span>
            <strong>${room.code}</strong>
            <button class="ghost-button" id="xq-copy-code" type="button">Copy</button>
          </div>
          <div class="xq-room-players">
            <span class="${online.color === "r" ? "me" : ""}">Đỏ: ${room.players.r?.name ?? "..."}</span>
            <span class="${online.color === "b" ? "me" : ""}">Đen: ${room.players.b?.name ?? "Đang chờ"}</span>
          </div>
          <div class="xq-online-actions">
            <button class="ghost-button" id="xq-refresh-room" type="button" ${online.busy ? "disabled" : ""}>Tải lại</button>
            <button class="ghost-button danger" id="xq-leave-room" type="button">Rời phòng</button>
          </div>
        </div>
      `;
    }

    function render() {
      refreshTargets();
      const history = mode === "online" && online.room ? online.room.moves : game.history();
      const canResetOnline = mode === "online" && online.color === "r" && online.room;
      const canResignOnline = mode === "online" && online.room?.status === "active";

      stage.innerHTML = `
        <div class="xiangqi-layout">
          <section class="xiangqi-table" aria-label="Bàn cờ tướng">
            <div class="xiangqi-mode-tabs">
              <button class="${mode === "local" ? "active" : ""}" id="xq-mode-local" type="button">Chơi cùng máy</button>
              <button class="${mode === "online" ? "active" : ""}" id="xq-mode-online" type="button">Online 1v1</button>
            </div>
            <div class="xiangqi-board-wrap">
              <div class="xiangqi-board" id="xiangqi-board">
                ${boardHtml()}
                <div class="xq-palace top" aria-hidden="true"></div>
                <div class="xq-palace bottom" aria-hidden="true"></div>
                <div class="xq-river" aria-hidden="true">SÔNG</div>
              </div>
            </div>
          </section>

          <aside class="xiangqi-panel">
            <div class="xq-status-card">
              <span class="hud-label">Trạng thái</span>
              <strong>${statusText()}</strong>
            </div>
            <div class="xq-turns">
              <span class="${game.turn() === "r" ? "active" : ""}">Đỏ</span>
              <span class="${game.turn() === "b" ? "active" : ""}">Đen</span>
            </div>
            <div class="xq-controls">
              <button class="ghost-button" id="xq-new" type="button" ${mode === "online" && !canResetOnline ? "disabled" : ""}>Ván mới</button>
              <button class="ghost-button" id="xq-undo" type="button" ${mode === "online" || history.length === 0 ? "disabled" : ""}>Hoàn tác</button>
              <button class="ghost-button" id="xq-flip" type="button">Đổi góc</button>
              <button class="ghost-button danger" id="xq-resign" type="button" ${
                mode === "online" ? (canResignOnline ? "" : "disabled") : finished ? "disabled" : ""
              }>Đầu hàng</button>
            </div>
            ${mode === "online" ? onlinePanelHtml() : ""}
            <div class="xq-help">
              <p>${mode === "online" ? "Đỏ tạo phòng, Đen nhập mã phòng. Mỗi máy tự đồng bộ sau vài giây." : "Chạm quân đúng lượt để xem nước hợp lệ, rồi chạm ô muốn đi."}</p>
            </div>
            <ol class="xq-history">${historyHtml()}</ol>
          </aside>
        </div>
      `;

      stage.querySelector("#xiangqi-board").addEventListener("click", onBoardClick);
      stage.querySelector("#xq-mode-local").addEventListener("click", switchLocal);
      stage.querySelector("#xq-mode-online").addEventListener("click", switchOnline);
      stage.querySelector("#xq-new").addEventListener("click", newGame);
      stage.querySelector("#xq-undo").addEventListener("click", undoMove);
      stage.querySelector("#xq-flip").addEventListener("click", flipBoard);
      stage.querySelector("#xq-resign").addEventListener("click", resign);

      if (mode === "online") {
        bindOnlineControls();
      }
    }

    async function onBoardClick(event) {
      const squareButton = event.target.closest(".xq-square");
      if (!squareButton || finished || online.busy) {
        return;
      }

      const square = squareButton.dataset.square;
      const piece = game.get(square);

      if (selected && legalTargets.has(square)) {
        if (mode === "online") {
          await sendOnlineMove(selected, square);
          return;
        }

        const move = game.move({ from: selected, to: square });
        if (move) {
          lastMove = { from: move.from, to: move.to };
          selected = null;
          statusOverride = "";
          render();
        }
        return;
      }

      if (canMoveSelectedPiece(piece)) {
        selected = selected === square ? null : square;
      } else {
        selected = null;
      }

      render();
    }

    function resetLocalGame() {
      game = new XiangqiCtor();
      selected = null;
      legalTargets = new Set();
      finished = false;
      statusOverride = "";
      lastMove = null;
    }

    function switchLocal() {
      mode = "local";
      stopPolling();
      resetLocalGame();
      render();
    }

    function switchOnline() {
      mode = "online";
      selected = null;
      online.error = "";
      render();
    }

    async function newGame() {
      if (mode === "online") {
        await onlineAction(() => roomRequest({ action: "reset", code: online.code, token: online.token }));
        return;
      }

      resetLocalGame();
      render();
    }

    function undoMove() {
      if (mode === "online" || typeof game.undo !== "function") {
        return;
      }

      game.undo();
      selected = null;
      legalTargets = new Set();
      finished = false;
      statusOverride = "";

      const history = game.history({ verbose: true });
      const previous = history[history.length - 1];
      lastMove = previous ? { from: previous.from, to: previous.to } : null;
      render();
    }

    function flipBoard() {
      flipped = !flipped;
      render();
    }

    async function resign() {
      if (mode === "online") {
        await onlineAction(() => roomRequest({ action: "resign", code: online.code, token: online.token }));
        return;
      }

      statusOverride = `${sideName(opposite(game.turn()))} thắng do ${sideName(game.turn())} đầu hàng.`;
      finished = true;
      selected = null;
      legalTargets = new Set();
      render();
    }

    function bindOnlineControls() {
      const createButton = stage.querySelector("#xq-create-room");
      const joinButton = stage.querySelector("#xq-join-room");
      const resumeButton = stage.querySelector("#xq-resume-room");
      const refreshButton = stage.querySelector("#xq-refresh-room");
      const leaveButton = stage.querySelector("#xq-leave-room");
      const copyButton = stage.querySelector("#xq-copy-code");

      createButton?.addEventListener("click", createOnlineRoom);
      joinButton?.addEventListener("click", joinOnlineRoom);
      resumeButton?.addEventListener("click", resumeOnlineRoom);
      refreshButton?.addEventListener("click", () => refreshOnlineRoom(true));
      leaveButton?.addEventListener("click", leaveOnlineRoom);
      copyButton?.addEventListener("click", () => navigator.clipboard?.writeText(online.code));
    }

    function onlineNameInput() {
      return cleanName(stage.querySelector("#xq-online-name")?.value || playerName());
    }

    async function onlineAction(action) {
      if (online.busy) {
        return;
      }

      online.busy = true;
      online.error = "";
      render();

      try {
        const data = await action();
        if (data.room) {
          applyRoom(data.room);
          if (data.token) {
            online.token = data.token;
            saveRoomSession(data.room, data.token);
          }
          startPolling();
        }
      } catch (error) {
        online.error = error.message;
      } finally {
        online.busy = false;
        render();
      }
    }

    async function createOnlineRoom() {
      const name = onlineNameInput();
      if (!name) {
        online.error = "Nhập tên trước khi tạo phòng.";
        render();
        return;
      }

      await onlineAction(() => roomRequest({ action: "create", name }));
    }

    async function joinOnlineRoom() {
      const name = onlineNameInput();
      const code = String(stage.querySelector("#xq-room-code")?.value || "").toUpperCase().trim();

      if (!name || !code) {
        online.error = "Nhập tên và mã phòng.";
        render();
        return;
      }

      await onlineAction(() => roomRequest({ action: "join", name, code }));
    }

    async function resumeOnlineRoom() {
      const saved = readSavedRoom();
      if (!saved?.code || !saved?.token) {
        return;
      }

      online.code = saved.code;
      online.token = saved.token;
      await refreshOnlineRoom(true);
      startPolling();
    }

    function leaveOnlineRoom() {
      stopPolling();
      clearRoomSession();
      online = {
        code: "",
        token: "",
        color: null,
        room: null,
        error: "",
        busy: false,
        poller: null,
      };
      resetLocalGame();
      mode = "online";
      render();
    }

    async function refreshOnlineRoom(showBusy) {
      if (!online.code || !online.token || online.busy) {
        return;
      }

      const previousVersion = online.room?.version;
      online.busy = Boolean(showBusy);
      if (showBusy) {
        render();
      }

      try {
        const data = await getRoomState(online.code, online.token);
        if (data.room.version !== previousVersion || showBusy) {
          applyRoom(data.room);
        }
      } catch (error) {
        online.error = error.message;
      } finally {
        online.busy = false;
        if (showBusy || online.error || online.room?.version !== previousVersion) {
          render();
        }
      }
    }

    async function sendOnlineMove(from, to) {
      await onlineAction(() => roomRequest({ action: "move", code: online.code, token: online.token, from, to }));
    }

    const savedRoom = readSavedRoom();
    if (savedRoom?.code && savedRoom?.token) {
      mode = "online";
      online.code = savedRoom.code;
      online.token = savedRoom.token;
      refreshOnlineRoom(true).then(startPolling);
    }

    render();
  }

  window.startXiangqiGame = startXiangqiGame;
})();
