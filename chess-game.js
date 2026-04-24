(function () {
  const ROOM_API = "/.netlify/functions/rooms";
  const ROOM_SESSION_KEY = "mini-arcade-chess-room-v1";
  const PLAYER_KEY = "mini-arcade-player-v1";
  const files = "abcdefgh";

  const pieces = {
    "w:k": "♔",
    "w:q": "♕",
    "w:r": "♖",
    "w:b": "♗",
    "w:n": "♘",
    "w:p": "♙",
    "b:k": "♚",
    "b:q": "♛",
    "b:r": "♜",
    "b:b": "♝",
    "b:n": "♞",
    "b:p": "♟",
  };

  const names = { k: "Vua", q: "Hậu", r: "Xe", b: "Tượng", n: "Mã", p: "Tốt" };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function cleanName(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
  }

  function playerName() {
    return cleanName(localStorage.getItem(PLAYER_KEY) ?? "");
  }

  function sideName(color) {
    if (color === "draw") return "Hòa";
    return color === "r" || color === "w" ? "Trắng" : "Đen";
  }

  function other(color) {
    return color === "r" ? "b" : "r";
  }

  function squareFor(row, col) {
    return `${files[col]}${8 - row}`;
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
    if (!response.ok) throw new Error(data.error || "Không kết nối được phòng online.");
    if (!data.room) throw new Error("Online cần chạy trên Netlify đã deploy hoặc netlify dev.");
    return data;
  }

  async function getRoomState(code, token) {
    const response = await fetch(`${ROOM_API}?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Không tải được phòng.");
    if (!data.room) throw new Error("Online cần chạy trên Netlify đã deploy hoặc netlify dev.");
    return data;
  }

  async function startChessGame() {
    const stage = document.querySelector("#stage-body");
    let ChessCtor = null;
    try {
      ({ Chess: ChessCtor } = await import("./vendor/chess.mjs"));
    } catch {
      stage.innerHTML = `<div class="game-board"><div class="game-stack"><p class="game-prompt">Không tải được luật cờ vua</p><p class="sub-prompt">Kiểm tra file vendor/chess.mjs rồi tải lại trang.</p></div></div>`;
      return;
    }

    let chess = new ChessCtor();
    let selected = null;
    let legalTargets = new Set();
    let flipped = false;
    let lastMove = null;
    let localResult = "";
    let mode = "local";
    let online = { code: "", token: "", color: null, room: null, error: "", busy: false, poller: null };

    function stopPolling() {
      if (online.poller) clearInterval(online.poller);
      online.poller = null;
    }

    if (typeof window.registerGameCleanup === "function") window.registerGameCleanup(stopPolling);

    function startPolling() {
      stopPolling();
      online.poller = setInterval(() => refreshOnlineRoom(false), 1400);
    }

    function localColor() {
      return chess.turn() === "w" ? "r" : "b";
    }

    function loadFen(fen) {
      if (fen) chess = new ChessCtor(fen);
    }

    function applyRoom(room) {
      online.room = room;
      online.code = room.code;
      online.color = room.playerColor;
      loadFen(room.fen);
      lastMove = room.lastMove;
      selected = null;
      legalTargets = new Set();
      flipped = room.playerColor === "b";
    }

    function statusText() {
      if (mode === "online") {
        if (online.error) return online.error;
        if (!online.room) return "Tạo phòng hoặc nhập mã phòng để chơi cờ vua online.";
        if (online.room.status === "waiting") return `Phòng ${online.room.code} đang chờ người thứ 2.`;
        if (online.room.status === "ended") return online.room.result || `${sideName(online.room.winner)} thắng.`;
        return online.room.turn === online.color ? `Đến lượt bạn (${sideName(online.color)}).` : `Chờ ${sideName(online.room.turn)} đi.`;
      }
      if (localResult) return localResult;
      if (chess.isCheckmate()) return `${sideName(other(localColor()))} thắng chiếu bí.`;
      if (chess.isDraw()) return "Ván hòa.";
      if (chess.isCheck()) return `${sideName(localColor())} đang bị chiếu.`;
      return `Đến lượt ${sideName(localColor())}.`;
    }

    function canMovePiece(piece) {
      if (!piece) return false;
      if (mode === "online") return online.room?.status === "active" && online.color === localColor() && piece.color === chess.turn();
      return piece.color === chess.turn();
    }

    function refreshTargets() {
      legalTargets = new Set();
      if (!selected || chess.isGameOver()) return;
      legalTargets = new Set(chess.moves({ square: selected, verbose: true }).map((move) => move.to));
    }

    function boardHtml() {
      refreshTargets();
      const board = chess.board();
      const rows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
      const cols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

      return rows
        .map((row) =>
          cols
            .map((col) => {
              const square = squareFor(row, col);
              const piece = board[row][col];
              const dark = (row + col) % 2 === 1;
              const isLast = lastMove?.from === square || lastMove?.to === square;
              const pieceHtml = piece ? `<span class="chess-piece ${piece.color === "w" ? "white" : "black"}">${pieces[`${piece.color}:${piece.type}`]}</span>` : "";
              return `<button class="chess-cell ${dark ? "dark" : "light"} ${selected === square ? "selected" : ""} ${legalTargets.has(square) ? "legal" : ""} ${isLast ? "last" : ""}" type="button" data-square="${square}"><span class="chess-coord">${square}</span>${pieceHtml}</button>`;
            })
            .join(""),
        )
        .join("");
    }

    function historyHtml() {
      const history = mode === "online" && online.room ? online.room.moves : chess.history({ verbose: true });
      if (!history.length) return `<li class="xq-empty-history">Chưa có nước đi.</li>`;
      return history
        .slice(-18)
        .map((move, index) => {
          const number = history.length - Math.min(18, history.length) + index + 1;
          const label = move.san || `${names[move.piece] ?? "Quân"} ${move.from}-${move.to}`;
          return `<li>${number}. ${sideName(move.color)} ${escapeHtml(label)}</li>`;
        })
        .join("");
    }

    function onlinePanelHtml() {
      const saved = readSavedRoom();
      if (!online.room) {
        return `
          <div class="xq-online-box">
            <label for="chess-online-name">Tên online</label>
            <input id="chess-online-name" maxlength="24" placeholder="Tên người chơi" value="${escapeHtml(playerName())}" />
            <button class="primary-button" id="chess-create-room" type="button" ${online.busy ? "disabled" : ""}>Tạo phòng</button>
            <div class="xq-join-row">
              <input id="chess-room-code" maxlength="6" placeholder="Mã phòng" value="${escapeHtml(saved?.code ?? "")}" />
              <button class="ghost-button" id="chess-join-room" type="button" ${online.busy ? "disabled" : ""}>Vào</button>
            </div>
            ${saved?.code ? `<button class="ghost-button" id="chess-resume-room" type="button">Tiếp tục phòng ${escapeHtml(saved.code)}</button>` : ""}
          </div>
        `;
      }
      return `
        <div class="xq-online-box">
          <div class="xq-room-code"><span>Mã phòng</span><strong>${escapeHtml(online.room.code)}</strong><button class="ghost-button" id="chess-copy-code" type="button">Copy</button></div>
          <div class="xq-room-players">
            <span class="${online.color === "r" ? "me" : ""}">Trắng: ${escapeHtml(online.room.players.r?.name ?? "...")}</span>
            <span class="${online.color === "b" ? "me" : ""}">Đen: ${escapeHtml(online.room.players.b?.name ?? "Đang chờ")}</span>
          </div>
          <div class="xq-online-actions">
            <button class="ghost-button" id="chess-refresh-room" type="button" ${online.busy ? "disabled" : ""}>Tải lại</button>
            <button class="ghost-button danger" id="chess-leave-room" type="button">Rời phòng</button>
          </div>
        </div>
      `;
    }

    function render() {
      const canResignOnline = mode === "online" && online.room?.status === "active";
      stage.innerHTML = `
        <div class="boardgame-layout">
          <section class="boardgame-table chess-table">
            <div class="xiangqi-mode-tabs">
              <button class="${mode === "local" ? "active" : ""}" id="chess-mode-local" type="button">Chơi cùng máy</button>
              <button class="${mode === "online" ? "active" : ""}" id="chess-mode-online" type="button">Online 1v1</button>
            </div>
            <div class="chess-board" id="chess-board">${boardHtml()}</div>
          </section>
          <aside class="xiangqi-panel">
            <div class="xq-status-card"><span class="hud-label">Trạng thái</span><strong>${escapeHtml(statusText())}</strong></div>
            <div class="xq-turns"><span class="${localColor() === "r" ? "active" : ""}">Trắng</span><span class="${localColor() === "b" ? "active" : ""}">Đen</span></div>
            <div class="xq-controls">
              <button class="ghost-button" id="chess-new" type="button" ${mode === "online" && online.color !== "r" ? "disabled" : ""}>Ván mới</button>
              <button class="ghost-button" id="chess-undo" type="button" ${mode === "online" || chess.history().length === 0 ? "disabled" : ""}>Hoàn tác</button>
              <button class="ghost-button" id="chess-flip" type="button">Đổi góc</button>
              <button class="ghost-button danger" id="chess-resign" type="button" ${mode === "online" ? (canResignOnline ? "" : "disabled") : chess.isGameOver() || localResult ? "disabled" : ""}>Đầu hàng</button>
            </div>
            ${mode === "online" ? onlinePanelHtml() : ""}
            <div class="xq-help"><p>${mode === "online" ? "Trắng tạo phòng, Đen nhập mã. Bên Đen sẽ tự xoay bàn cờ." : "Chạm quân đúng lượt để xem nước đi hợp lệ. Phong cấp mặc định thành Hậu."}</p></div>
            <ol class="xq-history">${historyHtml()}</ol>
          </aside>
        </div>
      `;

      stage.querySelector("#chess-board").addEventListener("click", onBoardClick);
      stage.querySelector("#chess-mode-local").addEventListener("click", switchLocal);
      stage.querySelector("#chess-mode-online").addEventListener("click", switchOnline);
      stage.querySelector("#chess-new").addEventListener("click", newGame);
      stage.querySelector("#chess-undo").addEventListener("click", undoMove);
      stage.querySelector("#chess-flip").addEventListener("click", () => {
        flipped = !flipped;
        render();
      });
      stage.querySelector("#chess-resign").addEventListener("click", resign);
      if (mode === "online") bindOnlineControls();
    }

    async function onBoardClick(event) {
      const cell = event.target.closest(".chess-cell");
      if (!cell || chess.isGameOver() || online.busy) return;
      const square = cell.dataset.square;
      const piece = chess.get(square);
      if (selected && legalTargets.has(square)) {
        if (mode === "online") {
          await onlineAction(() => roomRequest({ action: "move", game: "chess", code: online.code, token: online.token, from: selected, to: square, promotion: "q" }));
        } else {
          try {
            const move = chess.move({ from: selected, to: square, promotion: "q" });
            lastMove = { from: move.from, to: move.to };
          } catch {
            selected = null;
          }
          selected = null;
          render();
        }
        return;
      }
      selected = canMovePiece(piece) ? (selected === square ? null : square) : null;
      render();
    }

    function resetLocal() {
      chess = new ChessCtor();
      selected = null;
      legalTargets = new Set();
      lastMove = null;
      localResult = "";
    }

    function switchLocal() {
      mode = "local";
      stopPolling();
      resetLocal();
      render();
    }

    function switchOnline() {
      mode = "online";
      online.error = "";
      render();
    }

    async function newGame() {
      if (mode === "online") {
        await onlineAction(() => roomRequest({ action: "reset", code: online.code, token: online.token }));
      } else {
        resetLocal();
        render();
      }
    }

    function undoMove() {
      if (mode === "online") return;
      chess.undo();
      selected = null;
      const history = chess.history({ verbose: true });
      const previous = history[history.length - 1];
      lastMove = previous ? { from: previous.from, to: previous.to } : null;
      render();
    }

    async function resign() {
      if (mode === "online") {
        await onlineAction(() => roomRequest({ action: "resign", code: online.code, token: online.token }));
      } else {
        localResult = `${sideName(other(localColor()))} thắng do đối thủ đầu hàng.`;
        render();
      }
    }

    function bindOnlineControls() {
      stage.querySelector("#chess-create-room")?.addEventListener("click", createOnlineRoom);
      stage.querySelector("#chess-join-room")?.addEventListener("click", joinOnlineRoom);
      stage.querySelector("#chess-resume-room")?.addEventListener("click", resumeOnlineRoom);
      stage.querySelector("#chess-refresh-room")?.addEventListener("click", () => refreshOnlineRoom(true));
      stage.querySelector("#chess-leave-room")?.addEventListener("click", leaveOnlineRoom);
      stage.querySelector("#chess-copy-code")?.addEventListener("click", () => navigator.clipboard?.writeText(online.code));
    }

    function onlineNameInput() {
      return cleanName(stage.querySelector("#chess-online-name")?.value || playerName());
    }

    async function onlineAction(action) {
      if (online.busy) return;
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
      await onlineAction(() => roomRequest({ action: "create", game: "chess", name }));
    }

    async function joinOnlineRoom() {
      const name = onlineNameInput();
      const code = String(stage.querySelector("#chess-room-code")?.value || "").toUpperCase().trim();
      if (!name || !code) {
        online.error = "Nhập tên và mã phòng.";
        render();
        return;
      }
      await onlineAction(() => roomRequest({ action: "join", game: "chess", name, code }));
    }

    async function resumeOnlineRoom() {
      const saved = readSavedRoom();
      if (!saved?.code || !saved?.token) return;
      online.code = saved.code;
      online.token = saved.token;
      await refreshOnlineRoom(true);
      startPolling();
    }

    function leaveOnlineRoom() {
      stopPolling();
      clearRoomSession();
      online = { code: "", token: "", color: null, room: null, error: "", busy: false, poller: null };
      resetLocal();
      mode = "online";
      render();
    }

    async function refreshOnlineRoom(showBusy) {
      if (!online.code || !online.token || online.busy) return;
      const previousVersion = online.room?.version;
      online.busy = Boolean(showBusy);
      if (showBusy) render();
      try {
        const data = await getRoomState(online.code, online.token);
        if (data.room.version !== previousVersion || showBusy) applyRoom(data.room);
      } catch (error) {
        online.error = error.message;
      } finally {
        online.busy = false;
        if (showBusy || online.error || online.room?.version !== previousVersion) render();
      }
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

  window.startChessGame = startChessGame;
})();
