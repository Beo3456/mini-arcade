(function () {
  const files = "abcdefghi";

  const pieceLabels = {
    "r:k": "\u5e25",
    "r:a": "\u4ed5",
    "r:b": "\u76f8",
    "r:n": "\u509c",
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

  function moveLabel(move, index) {
    const number = Math.floor(index / 2) + 1;
    const marker = index % 2 === 0 ? "." : "...";
    const capture = String(move.flags ?? "").includes("c") ? "x" : "-";
    return `${number}${marker} ${sideName(move.color)} ${pieceNames[String(move.piece).toLowerCase()]} ${move.from}${capture}${move.to}`;
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

    function statusText() {
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
        .map((row) =>
          cols
            .map((col) => {
              const square = squareFor(row, col);
              const piece = board[row][col];
              const classes = [
                "xq-square",
                selected === square ? "selected" : "",
                legalTargets.has(square) ? "legal" : "",
                lastMove?.from === square || lastMove?.to === square ? "last" : "",
              ]
                .filter(Boolean)
                .join(" ");

              const pieceHtml = piece
                ? `<span class="xq-piece ${piece.color === "r" ? "red" : "black"}">${pieceLabels[`${piece.color}:${piece.type}`]}</span>`
                : "";

              return `
                <button class="${classes}" type="button" data-square="${square}" aria-label="${square}" ${finished ? "disabled" : ""}>
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
      const history = game.history({ verbose: true });
      if (history.length === 0) {
        return `<li class="xq-empty-history">Chưa có nước đi.</li>`;
      }

      return history
        .slice(-16)
        .map((move, index) => `<li>${moveLabel(move, history.length - Math.min(16, history.length) + index)}</li>`)
        .join("");
    }

    function render() {
      refreshTargets();
      const history = game.history();

      stage.innerHTML = `
        <div class="xiangqi-layout">
          <section class="xiangqi-table" aria-label="Bàn cờ tướng">
            <div class="xiangqi-board-wrap">
              <div class="xiangqi-board" id="xiangqi-board">
                ${boardHtml()}
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
              <button class="ghost-button" id="xq-new" type="button">Ván mới</button>
              <button class="ghost-button" id="xq-undo" type="button" ${history.length === 0 ? "disabled" : ""}>Hoàn tác</button>
              <button class="ghost-button" id="xq-flip" type="button">Đổi góc</button>
              <button class="ghost-button danger" id="xq-resign" type="button" ${finished ? "disabled" : ""}>Đầu hàng</button>
            </div>
            <div class="xq-help">
              <p>Chạm quân đúng lượt để xem nước hợp lệ, rồi chạm ô muốn đi.</p>
            </div>
            <ol class="xq-history">${historyHtml()}</ol>
          </aside>
        </div>
      `;

      stage.querySelector("#xiangqi-board").addEventListener("click", onBoardClick);
      stage.querySelector("#xq-new").addEventListener("click", newGame);
      stage.querySelector("#xq-undo").addEventListener("click", undoMove);
      stage.querySelector("#xq-flip").addEventListener("click", flipBoard);
      stage.querySelector("#xq-resign").addEventListener("click", resign);
    }

    function onBoardClick(event) {
      const squareButton = event.target.closest(".xq-square");
      if (!squareButton || finished) {
        return;
      }

      const square = squareButton.dataset.square;
      const piece = game.get(square);

      if (selected && legalTargets.has(square)) {
        const move = game.move({ from: selected, to: square });
        if (move) {
          lastMove = { from: move.from, to: move.to };
          selected = null;
          statusOverride = "";
          render();
        }
        return;
      }

      if (piece && piece.color === game.turn()) {
        selected = selected === square ? null : square;
      } else {
        selected = null;
      }

      render();
    }

    function newGame() {
      game = new XiangqiCtor();
      selected = null;
      legalTargets = new Set();
      finished = false;
      statusOverride = "";
      lastMove = null;
      render();
    }

    function undoMove() {
      if (typeof game.undo !== "function") {
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

    function resign() {
      statusOverride = `${sideName(opposite(game.turn()))} thắng do ${sideName(game.turn())} đầu hàng.`;
      finished = true;
      selected = null;
      legalTargets = new Set();
      render();
    }

    render();
  }

  window.startXiangqiGame = startXiangqiGame;
})();
