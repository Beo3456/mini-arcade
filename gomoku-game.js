(function () {
  const ROOM_API = "/.netlify/functions/rooms";
  const ROOM_SESSION_KEY = "mini-arcade-gomoku-room-v1";
  const PLAYER_KEY = "mini-arcade-player-v1";
  const SIZE = 15;

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
    return color === "r" ? "Đen" : "Trắng";
  }

  function other(color) {
    return color === "r" ? "b" : "r";
  }

  function emptyBoard() {
    return Array.from({ length: SIZE * SIZE }, () => "");
  }

  function winnerAt(board, row, col, color) {
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
        while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === color) {
          count += 1;
          r += dr * step;
          c += dc * step;
        }
      }
      if (count >= 5) return true;
    }
    return false;
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

  function startGomokuGame() {
    const stage = document.querySelector("#stage-body");
    let mode = "local";
    let board = emptyBoard();
    let turn = "r";
    let winner = null;
    let result = "";
    let lastMove = null;
    let moves = [];
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

    function applyRoom(room) {
      online.room = room;
      online.code = room.code;
      online.color = room.playerColor;
      board = Array.isArray(room.board) ? [...room.board] : emptyBoard();
      turn = room.turn;
      winner = room.winner;
      result = room.result || "";
      lastMove = room.lastMove;
      moves = room.moves || [];
    }

    function statusText() {
      if (mode === "online") {
        if (online.error) return online.error;
        if (!online.room) return "Tạo phòng hoặc nhập mã phòng để chơi caro online.";
        if (online.room.status === "waiting") return `Phòng ${online.room.code} đang chờ người thứ 2.`;
        if (online.room.status === "ended") return online.room.result || `${sideName(online.room.winner)} thắng.`;
        return online.room.turn === online.color ? `Đến lượt bạn (${sideName(online.color)}).` : `Chờ ${sideName(online.room.turn)} đi.`;
      }
      if (winner) return result || `${sideName(winner)} thắng.`;
      return `Đến lượt ${sideName(turn)}.`;
    }

    function boardHtml() {
      return board
        .map((value, index) => {
          const row = Math.floor(index / SIZE);
          const col = index % SIZE;
          const mark = value ? `<span class="gomoku-stone ${value === "r" ? "black" : "white"}"></span>` : "";
          const isLast = lastMove?.row === row && lastMove?.col === col;
          return `<button class="gomoku-cell ${isLast ? "last" : ""}" type="button" data-row="${row}" data-col="${col}" ${value || winner ? "disabled" : ""}>${mark}</button>`;
        })
        .join("");
    }

    function historyHtml() {
      if (!moves.length) return `<li class="xq-empty-history">Chưa có nước đi.</li>`;
      return moves
        .slice(-18)
        .map((move, index) => `<li>${moves.length - Math.min(18, moves.length) + index + 1}. ${sideName(move.color)} (${move.row + 1}, ${move.col + 1})</li>`)
        .join("");
    }

    function onlinePanelHtml() {
      const saved = readSavedRoom();
      if (!online.room) {
        return `
          <div class="xq-online-box">
            <label for="gomoku-online-name">Tên online</label>
            <input id="gomoku-online-name" maxlength="24" placeholder="Tên người chơi" value="${escapeHtml(playerName())}" />
            <button class="primary-button" id="gomoku-create-room" type="button" ${online.busy ? "disabled" : ""}>Tạo phòng</button>
            <div class="xq-join-row">
              <input id="gomoku-room-code" maxlength="6" placeholder="Mã phòng" value="${escapeHtml(saved?.code ?? "")}" />
              <button class="ghost-button" id="gomoku-join-room" type="button" ${online.busy ? "disabled" : ""}>Vào</button>
            </div>
            ${saved?.code ? `<button class="ghost-button" id="gomoku-resume-room" type="button">Tiếp tục phòng ${escapeHtml(saved.code)}</button>` : ""}
          </div>
        `;
      }
      return `
        <div class="xq-online-box">
          <div class="xq-room-code"><span>Mã phòng</span><strong>${escapeHtml(online.room.code)}</strong><button class="ghost-button" id="gomoku-copy-code" type="button">Copy</button></div>
          <div class="xq-room-players">
            <span class="${online.color === "r" ? "me" : ""}">Đen: ${escapeHtml(online.room.players.r?.name ?? "...")}</span>
            <span class="${online.color === "b" ? "me" : ""}">Trắng: ${escapeHtml(online.room.players.b?.name ?? "Đang chờ")}</span>
          </div>
          <div class="xq-online-actions">
            <button class="ghost-button" id="gomoku-refresh-room" type="button" ${online.busy ? "disabled" : ""}>Tải lại</button>
            <button class="ghost-button danger" id="gomoku-leave-room" type="button">Rời phòng</button>
          </div>
        </div>
      `;
    }

    function render() {
      stage.innerHTML = `
        <div class="boardgame-layout">
          <section class="boardgame-table gomoku-table">
            <div class="xiangqi-mode-tabs">
              <button class="${mode === "local" ? "active" : ""}" id="gomoku-mode-local" type="button">Chơi cùng máy</button>
              <button class="${mode === "online" ? "active" : ""}" id="gomoku-mode-online" type="button">Online 1v1</button>
            </div>
            <div class="gomoku-board" id="gomoku-board">${boardHtml()}</div>
          </section>
          <aside class="xiangqi-panel">
            <div class="xq-status-card"><span class="hud-label">Trạng thái</span><strong>${escapeHtml(statusText())}</strong></div>
            <div class="xq-turns"><span class="${turn === "r" ? "active" : ""}">Đen</span><span class="${turn === "b" ? "active" : ""}">Trắng</span></div>
            <div class="xq-controls">
              <button class="ghost-button" id="gomoku-new" type="button" ${mode === "online" && online.color !== "r" ? "disabled" : ""}>Ván mới</button>
              <button class="ghost-button" id="gomoku-flip" type="button" disabled>15x15</button>
              <button class="ghost-button danger" id="gomoku-resign" type="button" ${winner || (mode === "online" && online.room?.status !== "active") ? "disabled" : ""}>Đầu hàng</button>
            </div>
            ${mode === "online" ? onlinePanelHtml() : ""}
            <div class="xq-help"><p>${mode === "online" ? "Đen tạo phòng, Trắng nhập mã phòng. Ai có 5 quân liên tiếp sẽ thắng." : "Chạm vào ô trống để đặt quân. Đen đi trước."}</p></div>
            <ol class="xq-history">${historyHtml()}</ol>
          </aside>
        </div>
      `;

      stage.querySelector("#gomoku-board").addEventListener("click", onBoardClick);
      stage.querySelector("#gomoku-mode-local").addEventListener("click", switchLocal);
      stage.querySelector("#gomoku-mode-online").addEventListener("click", switchOnline);
      stage.querySelector("#gomoku-new").addEventListener("click", newGame);
      stage.querySelector("#gomoku-resign").addEventListener("click", resign);
      if (mode === "online") bindOnlineControls();
    }

    async function onBoardClick(event) {
      const cell = event.target.closest(".gomoku-cell");
      if (!cell || winner || online.busy) return;
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (mode === "online") {
        if (!online.room || online.room.status !== "active" || online.color !== turn) return;
        await onlineAction(() => roomRequest({ action: "move", game: "gomoku", code: online.code, token: online.token, row, col }));
        return;
      }
      const index = row * SIZE + col;
      if (board[index]) return;
      board[index] = turn;
      lastMove = { row, col };
      moves.push({ color: turn, row, col });
      if (winnerAt(board, row, col, turn)) {
        winner = turn;
        result = `${sideName(turn)} thắng với 5 quân liên tiếp.`;
      } else if (board.every(Boolean)) {
        winner = "draw";
        result = "Ván hòa, bàn đã đầy.";
      } else {
        turn = other(turn);
      }
      render();
    }

    function resetLocal() {
      board = emptyBoard();
      turn = "r";
      winner = null;
      result = "";
      lastMove = null;
      moves = [];
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

    async function resign() {
      if (mode === "online") {
        await onlineAction(() => roomRequest({ action: "resign", code: online.code, token: online.token }));
      } else {
        winner = other(turn);
        result = `${sideName(winner)} thắng do đối thủ đầu hàng.`;
        render();
      }
    }

    function bindOnlineControls() {
      stage.querySelector("#gomoku-create-room")?.addEventListener("click", createOnlineRoom);
      stage.querySelector("#gomoku-join-room")?.addEventListener("click", joinOnlineRoom);
      stage.querySelector("#gomoku-resume-room")?.addEventListener("click", resumeOnlineRoom);
      stage.querySelector("#gomoku-refresh-room")?.addEventListener("click", () => refreshOnlineRoom(true));
      stage.querySelector("#gomoku-leave-room")?.addEventListener("click", leaveOnlineRoom);
      stage.querySelector("#gomoku-copy-code")?.addEventListener("click", () => navigator.clipboard?.writeText(online.code));
    }

    function onlineNameInput() {
      return cleanName(stage.querySelector("#gomoku-online-name")?.value || playerName());
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
      await onlineAction(() => roomRequest({ action: "create", game: "gomoku", name }));
    }

    async function joinOnlineRoom() {
      const name = onlineNameInput();
      const code = String(stage.querySelector("#gomoku-room-code")?.value || "").toUpperCase().trim();
      if (!name || !code) {
        online.error = "Nhập tên và mã phòng.";
        render();
        return;
      }
      await onlineAction(() => roomRequest({ action: "join", game: "gomoku", name, code }));
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

  window.startGomokuGame = startGomokuGame;
})();
