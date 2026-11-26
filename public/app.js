

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  let socket;
  let roomCode = "";
  let isDealer = false;
  let isAI = false;
  let myId = "";
  let topupPlayerId = null;
  let lastRoom = null;
  let lastWinnerKey = "";

  function visible(id, show) {
    const el = $(id);
    if (!el) return;

    el.classList.toggle("hidden", !show);
    el.style.display = show ? "" : "none";
  }

  function toast(message) {
    const el = $("toast");

    if (!el) {
      alert(message);
      return;
    }

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(el._timer);

    el._timer = setTimeout(() => {
      el.classList.remove("show");
    }, 2600);
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
      if ($("connection")) {
        $("connection").textContent = "TERHUBUNG";
      }
    });

    socket.on("disconnect", () => {
      if ($("connection")) {
        $("connection").textContent = "TERPUTUS";
      }
    });

    socket.on("toast", toast);

    socket.on("room:joined", data => {
      roomCode = data.code;
      isDealer = !!data.isDealer;
      isAI = !!data.aiMode;
      lastWinnerKey = "";

      if ($("roomCode")) {
        $("roomCode").textContent = roomCode;
      }

      if ($("editName")) {
        $("editName").value = $("name")?.value || "";
      }

      visible("lobby", false);
      visible("game", true);

      // Pada VS AI, panel mengendalikan ronde AI Dealer,
      // bukan menjadikan pemain manusia sebagai dealer.
      visible("dealerPanel", isDealer || isAI);
      visible("startControls", isDealer || isAI);
      visible("topupControls", false);

      updateDealerUI();
    });

    socket.on("room:update", room => {
      renderRoom(room);
    });

    socket.on("dealer:update", data => {
      if (isDealer) renderDealer(data);
    });

    socket.on("topup:request", data => {
      topupPlayerId = data.id;
      showTopupPopup(data.name);
    });

    socket.on("room:closed", () => {
      toast("Room telah ditutup.");
      setTimeout(() => location.reload(), 1000);
    });
  }

  function updateDealerUI() {
    const hasControl = isDealer || isAI;

    visible("dealerPanel", hasControl);
    visible("startControls", hasControl);
    visible("startRound", hasControl);
    visible("nextRound", false);

    const heading = $("dealerPanel")?.querySelector("h2");
    const description = $("dealerPanel")?.querySelector("p");

    if (isAI) {
      if (heading) heading.textContent = "AI DEALER";
      if (description) {
        description.textContent =
          "Dealer otomatis mengelola pembagian kartu dan jalannya ronde.";
      }

      if ($("startRound")) {
        $("startRound").textContent = "MULAI RONDE";
      }

      if ($("nextRound")) {
        $("nextRound").textContent = "RONDE BERIKUTNYA";
      }
    }

    if ($("dealerIndicator")) {
      $("dealerIndicator").style.display = "flex";

      if (isAI) {
        $("dealerIndicator").innerHTML = `
          <div class="dealer-chip">D</div>
          <span>AI DEALER</span>
        `;
      }
    }
  }

  function createRoom() {
    if (!socket?.connected) {
      toast("Koneksi belum siap.");
      return;
    }

    socket.emit("room:create");
  }

  function createAIRoom() {
    if (!socket?.connected) {
      toast("Koneksi belum siap.");
      return;
    }

    const button = $("createAI");

    if (button) {
      button.disabled = true;
      button.textContent = "MEMBUAT ROOM AI...";
    }

    socket.emit("room:create-ai", {
      name: $("name")?.value.trim() || "Player",
      difficulty: "normal",
      aiCount: 4
    });

    setTimeout(() => {
      if (button) {
        button.disabled = false;
        button.textContent = "VS AI — 4 BOT";
      }
    }, 2500);
  }

  function joinRoom() {
    if (!socket?.connected) {
      toast("Koneksi belum siap.");
      return;
    }

    const code = $("code")?.value.trim().toUpperCase();

    if (!code) {
      toast("Masukkan kode room.");
      return;
    }

    socket.emit("room:join", {
      code,
      name: $("name")?.value.trim() || "Player"
    });
  }

  // Kartu utama mengikuti class asli dari style.css: .card
  function cardHTML(card, hidden = false) {
    if (hidden || !card) {
      return `
        <div class="card card-empty" aria-label="Kartu tertutup">
          <span>?</span>
        </div>
      `;
    }

    const red = card.suit === "♥" || card.suit === "♦";
    const colorClass = red ? "red" : "";

    return `
      <div class="card ${colorClass}">
        <span>${escapeHTML(card.rank)}</span>
        <span>${escapeHTML(card.suit)}</span>
      </div>
    `;
  }

  function miniCardHTML(card) {
    if (!card) return "";

    const red = card.suit === "♥" || card.suit === "♦";

    return `
      <div class="mini-card ${red ? "red" : ""}">
        <span>${escapeHTML(card.rank)}</span>
        <span>${escapeHTML(card.suit)}</span>
      </div>
    `;
  }

  function cardBacksHTML() {
    return `
      <div class="card-backs">
        <div class="card-back"></div>
        <div class="card-back"></div>
      </div>
    `;
  }

  function renderPlayers(room) {
    const container = $("players");
    if (!container) return;

    container.innerHTML = "";

    room.players.forEach((player, index) => {
      const isMe = player.id === myId;
      const isTurn = player.id === room.turnId;

      const avatar = player.avatar
        ? `<img src="${player.avatar}" alt="Foto profil">`
        : escapeHTML((player.name || "?")[0].toUpperCase());

      const showCards =
        isMe ||
        (room.phase === "showdown" && !player.folded);

      const cardsHTML = showCards
        ? `<div class="mini-cards">
            ${(player.hand || []).map(miniCardHTML).join("")}
           </div>`
        : room.phase !== "waiting"
          ? cardBacksHTML()
          : "";

      const seat = document.createElement("div");

      seat.className = [
        "player",
        `seat-${index}`,
        isMe ? "my-seat" : "",
        isTurn ? "active-turn" : "",
        player.folded ? "folded-player" : "",
        player.allIn ? "all-in-player" : "",
        player.isAI ? "ai-player" : ""
      ].filter(Boolean).join(" ");

      seat.innerHTML = `
        <div class="player-top">
          <div class="player-avatar">${avatar}</div>

          <div style="min-width:0">
            <div class="player-name">
              ${escapeHTML(player.name)}
            </div>

            ${player.isAI
              ? '<div class="role">AI PLAYER</div>'
              : isMe
                ? '<div class="role">YOU · PLAYER</div>'
                : '<div class="role">PLAYER</div>'
            }

            ${player.folded
              ? '<div class="role">FOLD</div>'
              : ""
            }

            ${player.allIn
              ? '<div class="role">ALL IN</div>'
              : ""
            }
          </div>
        </div>

        <div class="player-chips">
          ${player.chips} chip
        </div>

        ${player.bet > 0
          ? `<div class="player-bet">Bet: ${player.bet}</div>`
          : ""
        }

        ${cardsHTML}
      `;

      container.appendChild(seat);
    });

    const felt = $("feltLayout");

    if (felt) {
      felt.dataset.count = String(room.players.length);
    }
  }

  function renderCommunity(room) {
    const target = $("communityCards");
    if (!target) return;

    target.innerHTML = "";

    if (room.phase === "waiting") {
      target.innerHTML =
        '<span class="placeholder">Menunggu kartu meja</span>';
      return;
    }

    (room.community || []).forEach((card, index) => {
      const html = cardHTML(card);

      target.insertAdjacentHTML("beforeend", html);

      const lastCard = target.lastElementChild;

      if (lastCard) {
        lastCard.classList.add("community-deal");
        lastCard.style.setProperty(
          "--deal-delay",
          `${index * 130}ms`
        );
      }
    });

    for (let i = room.community.length; i < 5; i++) {
      target.insertAdjacentHTML(
        "beforeend",
        '<div class="card card-empty"></div>'
      );
    }
  }

  function renderMyHand(room) {
    const target = $("myHand");
    if (!target) return;

    const me = room.players.find(player => player.id === myId);

    if (!me || !me.hand?.length) {
      target.innerHTML =
        '<span class="placeholder">Menunggu pembagian kartu</span>';
      return;
    }

    target.innerHTML = me.hand
      .map((card, index) => {
        return cardHTML(card).replace(
          'class="card ',
          `class="card private-deal `
        ).replace(
          'class="card private-deal ',
          `style="--deal-delay:${index * 160}ms" class="card private-deal `
        );
      })
      .join("");
  }

  function renderPot(room) {
    if ($("pot")) {
      $("pot").textContent = room.pot ?? 0;
    }

    if ($("potDisplay")) {
      $("potDisplay").dataset.total = room.pot ?? 0;
    }

    if ($("currentBet")) {
      $("currentBet").textContent = room.currentBet ?? 0;
    }

    if ($("round")) {
      $("round").textContent = room.round || 0;
    }

    if ($("status")) {
      const labels = {
        waiting: "Menunggu permainan",
        preflop: "Pre-Flop",
        flop: "Flop",
        turn: "Turn",
        river: "River",
        showdown: "Showdown"
      };

      $("status").textContent =
        labels[room.phase] || room.phase;
    }

    if ($("turnInfo")) {
      const current = room.players.find(
        player => player.id === room.turnId
      );

      $("turnInfo").textContent = current
        ? `Giliran: ${current.name}`
        : room.phase === "showdown"
          ? "Ronde selesai"
          : "Menunggu ronde dimulai.";
    }
  }

  function renderActions(room) {
    const me = room.players.find(player => player.id === myId);

    const myTurn = !!(
      me &&
      room.turnId === myId &&
      !me.folded &&
      !me.allIn &&
      room.phase !== "waiting" &&
      room.phase !== "showdown"
    );

    visible("actionControls", myTurn);

    if (!myTurn) return;

    const toCall = Math.max(0, room.currentBet - me.bet);

    visible("check", toCall === 0);
    visible("call", toCall > 0);

    if ($("call")) {
      $("call").textContent =
        `CALL ${Math.min(toCall, me.chips)}`;
    }

    if ($("raiseTo")) {
      $("raiseTo").min = String(room.currentBet + 1);
      $("raiseTo").max = String(me.bet + me.chips);
    }

    if ($("raise")) {
      $("raise").disabled = me.chips <= toCall;
    }

    if ($("allin")) {
      $("allin").disabled = me.chips <= 0;
    }
  }

  function renderDealer(data) {
    const target = $("dealerPlayers");
    if (!target) return;

    target.innerHTML = "";

    data.players.forEach(player => {
      const row = document.createElement("div");
      row.className = "dealer-player-row";

      row.textContent =
        `${player.name}${player.isAI ? " (AI)" : ""} — ${player.chips} chip`;

      target.appendChild(row);
    });
  }

  function renderResults(room) {
    if (room.phase !== "showdown" || !room.results?.length) {
      visible("results", false);
      return;
    }

    const winnerNames = room.results
      .flatMap(result => result.winners || []);

    const winnerText = [...new Set(winnerNames)].join(", ");

    if ($("winnerText")) {
      $("winnerText").textContent = `Pemenang: ${winnerText}`;
    }

    if ($("popupWinner")) {
      $("popupWinner").textContent = winnerText;
    }

    if ($("popupHand")) {
      $("popupHand").textContent = room.results
        .map(result =>
          `${result.hand} — ${result.amount} chip`
        )
        .join(" | ");
    }

    const ranking = $("rankingList");

    if (ranking) {
      ranking.innerHTML = "";

      [...room.players]
        .sort((a, b) => b.chips - a.chips)
        .forEach((player, index) => {
          const item = document.createElement("div");

          item.textContent =
            `${index + 1}. ${player.name} — ${player.chips} chip`;

          ranking.appendChild(item);
        });
    }

    visible("results", true);

    const key = `${room.round}-${winnerText}`;

    if (key !== lastWinnerKey) {
      lastWinnerKey = key;
      visible("winnerPopup", true);
    }
  }

  function renderRoom(room) {
    lastRoom = room;

    renderPlayers(room);
    renderCommunity(room);
    renderMyHand(room);
    renderPot(room);
    renderActions(room);
    renderResults(room);

    const me = room.players.find(player => player.id === myId);

    visible(
      "topupControls",
      !!me &&
      me.chips <= 0 &&
      room.phase === "waiting"
    );

    const canStart =
      (isDealer || isAI) &&
      (room.phase === "waiting" || room.phase === "showdown");

    visible("startRound", canStart);
    visible("nextRound", (isDealer || isAI) && room.phase === "showdown");
    visible("dealerPanel", isDealer || isAI);

    if (isAI && $("startRound")) {
      $("startRound").textContent =
        room.phase === "showdown"
          ? "MULAI RONDE"
          : "MULAI RONDE";
    }
  }

  function sendAction(action, amount = 0) {
    if (!socket?.connected) return;

    socket.emit("player:action", {
      action,
      amount: Number(amount || 0)
    });
  }

  function showTopupPopup(name) {
    if ($("topupText")) {
      $("topupText").textContent =
        `${name} meminta tambahan 10 chip virtual.`;
    }

    visible("topupPopup", true);
  }

  function closeTopupPopup() {
    visible("topupPopup", false);
    topupPlayerId = null;
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
            preview.innerHTML = "";

            const img = document.createElement("img");
            img.src = avatar;
            img.alt = "Foto profil";

            preview.appendChild(img);
          }

          socket?.emit("player:profile", { avatar });
        };

        image.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  }

  function bind(id, event, callback) {
    const element = $(id);

    if (element) {
      element.addEventListener(event, callback);
    }
  }

  function bindButtons() {
    bind("create", "click", createRoom);
    bind("createAI", "click", createAIRoom);
    bind("join", "click", joinRoom);

    bind("startRound", "click", () => {
      socket?.emit("dealer:start");
    });

    bind("nextRound", "click", () => {
      socket?.emit("dealer:next");
      visible("winnerPopup", false);
      lastWinnerKey = "";
    });

    bind("fold", "click", () => sendAction("fold"));
    bind("check", "click", () => sendAction("check"));
    bind("call", "click", () => sendAction("call"));
    bind("allin", "click", () => sendAction("allin"));

    bind("raise", "click", () => {
      const amount = Number($("raiseTo")?.value || 0);
      sendAction("raise", amount);
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
      visible("winnerPopup", false);
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

      if (!name) {
        toast("Nama tidak boleh kosong.");
        return;
      }

      socket?.emit("player:profile", { name });
      toast("Profil diperbarui.");
    });
  }

  function init() {
    bindButtons();

    setupAvatar("avatarInput", "lobbyAvatarPreview");
    setupAvatar("roomAvatarInput", "roomAvatarPreview");

    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
