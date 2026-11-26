 
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  let socket;
  let roomCode = "";
  let isDealer = false;
  let isAI = false;
  let myId = "";
  let lastRoom = null;
  let topupPlayerId = null;

  const nameInput = $("name");
  const codeInput = $("code");

  function toast(message) {
    const el = $("toast");

    if (el) {
      el.textContent = message;
      el.classList.add("show");

      setTimeout(() => {
        el.classList.remove("show");
      }, 2600);
    } else {
      alert(message);
    }
  }

  function connect() {
    if (typeof io !== "function") {
      toast("Socket.IO belum dimuat.");
      return;
    }

    socket = io({
      transports: ["polling", "websocket"]
    });

    socket.on("connected", data => {
      myId = data.id;
    });

    socket.on("connect", () => {
      const status = $("connection");
      if (status) status.textContent = "Terhubung";
    });

    socket.on("disconnect", () => {
      const status = $("connection");
      if (status) status.textContent = "Terputus";
    });

    socket.on("toast", toast);

    socket.on("room:joined", data => {
      roomCode = data.code;
      isDealer = !!data.isDealer;
      isAI = !!data.aiMode;

      if ($("roomCode")) {
        $("roomCode").textContent = roomCode;
      }

      showGame();
      updateControls();
    });

    socket.on("room:update", renderRoom);

    socket.on("dealer:update", data => {
      if (!isDealer) return;
      renderDealer(data);
    });

    socket.on("topup:request", data => {
      topupPlayerId = data.id;
      showTopupPopup(data.name);
    });

    socket.on("room:closed", () => {
      toast("Room telah ditutup.");
      location.reload();
    });
  }

  function showGame() {
    if ($("lobby")) $("lobby").style.display = "none";
    if ($("game")) $("game").style.display = "block";

    if ($("dealerPanel")) {
      $("dealerPanel").style.display = isDealer ? "block" : "none";
    }

    if ($("topupControls")) {
      $("topupControls").style.display = isAI ? "block" : "none";
    }

    if ($("startControls")) {
      $("startControls").style.display = isDealer ? "block" : "none";
    }

    updateControls();
  }

  function updateControls() {
    const start = $("startRound");
    const next = $("nextRound");

    if (start) {
      start.style.display = isDealer ? "inline-flex" : "none";
    }

    if (next) {
      next.style.display = isDealer ? "inline-flex" : "none";
    }

    if ($("dealerPanel")) {
      $("dealerPanel").style.display = isDealer ? "block" : "none";
    }
  }

  function makeAIButton() {
    if (!$("join") || $("createAI")) return;

    const button = document.createElement("button");
    button.id = "createAI";
    button.type = "button";
    button.className = $("create").className;
    button.textContent = "VS AI";

    $("join").insertAdjacentElement("afterend", button);

    button.addEventListener("click", () => {
      if (!socket || !socket.connected) {
        toast("Menunggu koneksi...");
        return;
      }

      socket.emit("room:create-ai", {
        difficulty: "normal",
        aiCount: 4
      });
    });
  }

  function getName() {
    return nameInput?.value.trim() || "Player";
  }

  function createRoom() {
    if (!socket || !socket.connected) {
      toast("Koneksi belum siap.");
      return;
    }

    socket.emit("room:create");
  }

  function joinRoom() {
    if (!socket || !socket.connected) {
      toast("Koneksi belum siap.");
      return;
    }

    const code = codeInput?.value.trim().toUpperCase();

    if (!code) {
      toast("Masukkan kode room.");
      return;
    }

    socket.emit("room:join", {
      code,
      name: getName()
    });
  }

  function cardHTML(card, hidden = false) {
    if (hidden || !card) {
      return `<div class="playing-card card-back">?</div>`;
    }

    const red = card.suit === "♥" || card.suit === "♦";
    return `
      <div class="playing-card ${red ? "red" : "black"}">
        <span>${card.rank}</span>
        <span>${card.suit}</span>
      </div>
    `;
  }

  function renderCards(target, cards, hidden = false) {
    if (!target) return;

    target.innerHTML = "";

    (cards || []).forEach(card => {
      target.insertAdjacentHTML(
        "beforeend",
        cardHTML(card, hidden)
      );
    });
  }

  function renderPlayers(room) {
    const container = $("players");
    if (!container) return;

    container.innerHTML = "";

    room.players.forEach((player, index) => {
      const isMe = player.id === myId;
      const isTurn = player.id === room.turnId;
      const cards = player.hand || [];

      const avatar = player.avatar
        ? `<img src="${player.avatar}" alt="">`
        : `<span class="avatar-placeholder">${escapeHTML(player.name[0] || "?")}</span>`;

      const playerElement = document.createElement("div");
      playerElement.className = [
        "player-seat",
        isMe ? "my-seat" : "",
        isTurn ? "active-turn" : "",
        player.folded ? "folded" : "",
        player.isAI ? "ai-player" : ""
      ].join(" ");

      playerElement.innerHTML = `
        <div class="player-avatar">${avatar}</div>
        <div class="player-info">
          <strong>${escapeHTML(player.name)}</strong>
          ${player.isAI ? '<small class="ai-label">AI</small>' : ""}
          ${isMe ? '<small>YOU</small>' : ""}
          ${player.isDealer ? '<small>DEALER</small>' : ""}
          ${player.folded ? '<small>FOLD</small>' : ""}
          ${player.allIn ? '<small>ALL IN</small>' : ""}
          <div class="player-chips">${player.chips} chip</div>
          ${player.bet > 0 ? `<div class="player-bet">Bet: ${player.bet}</div>` : ""}
        </div>
        <div class="player-cards">
          ${
            cards.length
              ? cards.map(c => cardHTML(c)).join("")
              : room.phase !== "waiting"
                ? cardHTML(null, true) + cardHTML(null, true)
                : ""
          }
        </div>
      `;

      container.appendChild(playerElement);
    });
  }

  function renderCommunity(room) {
    const target = $("communityCards");
    if (!target) return;

    target.innerHTML = "";

    (room.community || []).forEach(card => {
      target.insertAdjacentHTML("beforeend", cardHTML(card));
    });

    if (room.phase !== "waiting") {
      for (let i = room.community.length; i < 5; i++) {
        target.insertAdjacentHTML(
          "beforeend",
          `<div class="playing-card card-empty"></div>`
        );
      }
    }
  }

  function renderMyHand(room) {
    const target = $("myHand");
    if (!target) return;

    const me = room.players.find(p => p.id === myId);
    renderCards(target, me?.hand || []);
  }

  function renderPot(room) {
    if ($("pot")) $("pot").textContent = room.pot ?? 0;
    if ($("potDisplay")) $("potDisplay").textContent = room.pot ?? 0;
    if ($("currentBet")) {
      $("currentBet").textContent = room.currentBet ?? 0;
    }

    if ($("round")) {
      $("round").textContent = room.round
        ? `Ronde ${room.round}`
        : "Menunggu ronde";
    }

    if ($("status")) {
      $("status").textContent = room.phase === "waiting"
        ? "Menunggu permainan"
        : room.phase === "showdown"
          ? "Ronde selesai"
          : `Tahap ${room.phase}`;
    }

    if ($("turnInfo")) {
      const current = room.players.find(p => p.id === room.turnId);

      $("turnInfo").textContent = current
        ? `Giliran: ${current.name}`
        : "";
    }
  }

  function renderActionControls(room) {
    const controls = $("actionControls");
    if (!controls) return;

    const me = room.players.find(p => p.id === myId);

    const myTurn = !!(
      me &&
      room.turnId === myId &&
      !me.folded &&
      !me.allIn &&
      room.phase !== "waiting" &&
      room.phase !== "showdown"
    );

    controls.style.display = myTurn ? "flex" : "none";

    if (!myTurn) return;

    const toCall = Math.max(0, room.currentBet - me.bet);

    if ($("call")) {
      $("call").textContent = toCall > 0
        ? `CALL ${Math.min(toCall, me.chips)}`
        : "CHECK";
    }

    if ($("check")) {
      $("check").style.display = toCall === 0 ? "inline-flex" : "none";
    }

    if ($("call")) {
      $("call").style.display = toCall > 0 ? "inline-flex" : "none";
    }

    if ($("raise")) {
      $("raise").disabled = me.chips <= toCall;
    }

    if ($("allin")) {
      $("allin").disabled = me.chips <= 0;
    }
  }

  function renderResults(room) {
    if (room.phase !== "showdown" || !room.results?.length) return;

    const winner = room.results
      .flatMap(result => result.winners || [])
      .join(", ");

    if ($("winnerText")) {
      $("winnerText").textContent = `Pemenang: ${winner}`;
    }

    if ($("popupWinner")) {
      $("popupWinner").textContent = winner;
    }

    if ($("popupHand")) {
      $("popupHand").textContent = room.results
        .map(result => `${result.hand} — ${result.amount} chip`)
        .join(" | ");
    }

    const popup = $("winnerPopup");
    if (popup) popup.style.display = "flex";

    const ranking = $("rankingList");
    if (ranking) {
      ranking.innerHTML = "";

      [...room.players]
        .sort((a, b) => b.chips - a.chips)
        .forEach((p, index) => {
          ranking.insertAdjacentHTML(
            "beforeend",
            `<li>${index + 1}. ${escapeHTML(p.name)} — ${p.chips} chip</li>`
          );
        });
    }
  }

  function renderRoom(room) {
    lastRoom = room;

    renderPlayers(room);
    renderCommunity(room);
    renderMyHand(room);
    renderPot(room);
    renderActionControls(room);
    renderResults(room);

    const me = room.players.find(p => p.id === myId);

    if ($("topupControls")) {
      $("topupControls").style.display =
        me && me.chips <= 0 ? "block" : "none";
    }

    if ($("startRound")) {
      $("startRound").style.display =
        isDealer && (room.phase === "waiting" || room.phase === "showdown")
          ? "inline-flex"
          : "none";
    }

    if ($("nextRound")) {
      $("nextRound").style.display =
        isDealer && room.phase === "showdown"
          ? "inline-flex"
          : "none";
    }
  }

  function renderDealer(data) {
    const target = $("dealerPlayers");
    if (!target) return;

    target.innerHTML = "";

    data.players.forEach(player => {
      const row = document.createElement("div");
      row.className = "dealer-player-row";

      row.innerHTML = `
        <span>
          ${escapeHTML(player.name)}
          ${player.isAI ? "(AI)" : ""}
          — ${player.chips} chip
        </span>
      `;

      target.appendChild(row);
    });
  }

  function sendAction(action, amount) {
    if (!socket || !socket.connected) return;

    socket.emit("player:action", {
      action,
      amount: Number(amount || 0)
    });
  }

  function showTopupPopup(name) {
    const popup = $("topupPopup");

    if ($("topupText")) {
      $("topupText").textContent =
        `${name} meminta tambahan chip virtual.`;
    }

    if (popup) popup.style.display = "flex";
  }

  function closeTopupPopup() {
    const popup = $("topupPopup");
    if (popup) popup.style.display = "none";
    topupPlayerId = null;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function bind(id, event, callback) {
    const element = $(id);
    if (element) element.addEventListener(event, callback);
  }

  function bindButtons() {
    bind("create", "click", createRoom);
    bind("join", "click", joinRoom);

    bind("startRound", "click", () => {
      socket?.emit("dealer:start");
    });

    bind("nextRound", "click", () => {
      socket?.emit("dealer:next");
      const popup = $("winnerPopup");
      if (popup) popup.style.display = "none";
    });

    bind("fold", "click", () => sendAction("fold"));
    bind("check", "click", () => sendAction("check"));
    bind("call", "click", () => sendAction("call"));
    bind("allin", "click", () => sendAction("allin"));

    bind("raise", "click", () => {
      const value = Number($("raiseTo")?.value || 0);
      sendAction("raise", value);
    });

    bind("topupRequest", "click", () => {
      socket?.emit("player:topup-request");
    });

    bind("topupRequest", "click", () => {
      socket?.emit("player:topup-request");
    });

    bind("approveTopup", "click", () => {
      if (!topupPlayerId) return;

      socket?.emit("dealer:topup-approve", {
        id: topupPlayerId
      });

      closeTopupPopup();
    });

    bind("closeTopup", "click", closeTopupPopup);

    bind("closePopup", "click", () => {
      const popup = $("winnerPopup");
      if (popup) popup.style.display = "none";
    });

    bind("copy", "click", async () => {
      try {
        await navigator.clipboard.writeText(roomCode);
        toast("Kode room berhasil disalin.");
      } catch {
        toast(`Kode room: ${roomCode}`);
      }
    });

    bind("saveProfile", "click", () => {
      const name = $("editName")?.value.trim();

      if (name) {
        socket?.emit("player:profile", { name });
      }

      toast("Profil diperbarui.");
    });

    bind("editName", "keydown", event => {
      if (event.key === "Enter") {
        $("saveProfile")?.click();
      }
    });
  }

  function setupAvatar(inputId, previewId) {
    const input = $(inputId);
    const preview = $(previewId);

    if (!input) return;

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast("Pilih file gambar.");
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        const image = new Image();

        image.onload = () => {
          const canvas = document.createElement("canvas");
          const max = 300;

          let width = image.width;
          let height = image.height;

          if (width > height && width > max) {
            height = Math.round(height * max / width);
            width = max;
          } else if (height > max) {
            width = Math.round(width * max / height);
            height = max;
          }

          canvas.width = width;
          canvas.height = height;

          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, width, height);

          const avatar = canvas.toDataURL("image/jpeg", 0.75);

          if (preview) {
            preview.src = avatar;
            preview.style.display = "block";
          }

          socket?.emit("player:profile", { avatar });
        };

        image.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  }

  function init() {
    connect();
    makeAIButton();
    bindButtons();

    setupAvatar("avatarInput", "lobbyAvatarPreview");
    setupAvatar("roomAvatarInput", "roomAvatarPreview");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
