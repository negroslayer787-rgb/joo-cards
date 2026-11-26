
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  let currentCode = "";
  let isDealer = false;
  let mySocketId = null;
  let joining = false;

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");

    setTimeout(() => {
      el.classList.remove("show");
    }, 3000);
  }

  function connection(message) {
    $("connection").textContent = message;
  }

  function setLobbyButtons(disabled) {
    $("create").disabled = disabled;
    $("join").disabled = disabled;
  }

  function renderCards(container, cards) {
    container.innerHTML = "";

    if (!cards || cards.length === 0) {
      container.innerHTML =
        '<span class="placeholder">Belum ada kartu</span>';
      return;
    }

    cards.forEach(card => {
      const el = document.createElement("div");

      el.className = "card " +
        (["♥", "♦"].includes(card.suit) ? "red" : "");

      el.textContent = card.rank + card.suit;
      container.appendChild(el);
    });
  }

  function renderPlayer(player) {
    const el = document.createElement("div");
    el.className = "player";

    if (player.isTurn) {
      el.classList.add("active-turn");
    }

    if (player.folded) {
      el.classList.add("folded-player");
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = player.name.slice(0, 1).toUpperCase();

    const name = document.createElement("div");
    name.className = "pname";
    name.textContent = player.name;

    const role = document.createElement("div");
    role.className = "role";
    role.textContent = player.isDealer ? "DEALER" : "PEMAIN";

    el.append(avatar, name, role);

    if (player.publicHand && player.publicHand.length) {
      player.publicHand.forEach(card => {
        const cardEl = document.createElement("div");

        cardEl.className = "card " +
          (["♥", "♦"].includes(card.suit) ? "red" : "");

        cardEl.textContent = card.rank + card.suit;
        el.appendChild(cardEl);
      });
    } else if (player.hasHand && !player.folded) {
      for (let i = 0; i < 2; i++) {
        const cardEl = document.createElement("div");
        cardEl.className = "card back";
        cardEl.textContent = "J";
        el.appendChild(cardEl);
      }
    }

    const state = document.createElement("div");
    state.className = "role";

    if (player.folded) {
      state.textContent = "FOLD";
    } else if (player.isTurn) {
      state.textContent = "GILIRAN";
    } else if (player.acted) {
      state.textContent = "SELESAI";
    } else if (player.hasHand) {
      state.textContent = "AKTIF";
    }

    el.appendChild(state);

    if (player.handName) {
      const handName = document.createElement("div");
      handName.className = "role";
      handName.textContent = player.handName;
      el.appendChild(handName);
    }

    return el;
  }

  function renderResults(results) {
    const section = $("results");

    if (!results) {
      section.classList.add("hidden");
      $("winnerText").textContent = "";
      $("rankingList").innerHTML = "";
      return;
    }

    section.classList.remove("hidden");

    $("winnerText").textContent =
      results.winnerNames.length > 1
        ? "Hasil seri: " + results.winnerNames.join(", ")
        : "Pemenang: " + results.winnerNames[0];

    $("rankingList").innerHTML = "";

    results.players.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "result-row";

      const name = document.createElement("strong");
      name.textContent = (index + 1) + ". " + player.name;

      const hand = document.createElement("span");
      hand.textContent = player.handName;

      row.append(name, hand);

      if (player.winner) {
        row.classList.add("result-winner");

        const badge = document.createElement("b");
        badge.textContent = "PEMENANG";

        row.appendChild(badge);
      }

      $("rankingList").appendChild(row);
    });
  }

  if (typeof window.io !== "function") {
    connection("SOCKET.IO GAGAL");
    toast("Socket.IO tidak berhasil dimuat.");
    setLobbyButtons(true);
    return;
  }

  const socket = window.io({
    transports: ["polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    timeout: 15000
  });

  connection("MENGHUBUNGKAN...");
  setLobbyButtons(true);

  socket.on("connect", () => {
    mySocketId = socket.id;
    joining = false;

    connection("TERHUBUNG");
    setLobbyButtons(false);
  });

  socket.on("disconnect", () => {
    mySocketId = null;
    joining = false;

    connection("TERPUTUS");
    setLobbyButtons(true);
  });

  socket.on("connect_error", error => {
    connection("KONEKSI GAGAL");
    joining = false;
    setLobbyButtons(true);

    toast("Koneksi gagal: " + error.message);
  });

  function enterRoom(eventName, data) {
    if (!socket.connected) {
      toast("Server belum terhubung. Tunggu sebentar.");
      return;
    }

    if (joining) return;

    joining = true;
    setLobbyButtons(true);

    socket.emit(eventName, data, response => {
      if (response && response.ok === false) {
        joining = false;
        setLobbyButtons(false);
      }
    });

    setTimeout(() => {
      if (joining) {
        joining = false;
        setLobbyButtons(socket.connected ? false : true);
      }
    }, 8000);
  }

  $("create").addEventListener("click", () => {
    const name = $("name").value.trim() || "Pemain";

    enterRoom("room:create", { name });
  });

  $("join").addEventListener("click", () => {
    const name = $("name").value.trim() || "Pemain";
    const code = $("code").value.trim().toUpperCase();

    if (!code) {
      toast("Masukkan kode room terlebih dahulu.");
      return;
    }

    enterRoom("room:join", { name, code });
  });

  $("deal").addEventListener("click", () => {
    socket.emit("dealer:deal");
  });

  $("check").addEventListener("click", () => {
    socket.emit("player:check");
  });

  $("fold").addEventListener("click", () => {
    socket.emit("player:fold");
  });

  $("next").addEventListener("click", () => {
    socket.emit("dealer:next");
  });

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      toast("Kode room berhasil disalin.");
    } catch {
      toast("Kode room: " + currentCode);
    }
  });

  socket.on("room:joined", data => {
    joining = false;
    currentCode = data.code;
    isDealer = data.isDealer;

    $("lobby").classList.add("hidden");
    $("game").classList.remove("hidden");

    $("roomCode").textContent = currentCode;

    toast("Berhasil masuk room.");
  });

  socket.on("error:notice", message => {
    joining = false;
    setLobbyButtons(socket.connected ? false : true);
    toast(message);
  });

  socket.on("hand:update", cards => {
    renderCards($("myHand"), cards);
  });

  socket.on("room:update", room => {
    $("round").textContent = room.round;
    $("status").textContent = room.message;

    $("players").innerHTML = "";

    room.players.forEach(player => {
      $("players").appendChild(renderPlayer(player));
    });

    renderCards($("communityCards"), room.community);
    renderResults(room.results);

    const myTurn = room.currentPlayerId === mySocketId;

    const active =
      room.stage !== "waiting" &&
      room.stage !== "showdown";

    if (active && myTurn) {
      $("turnInfo").textContent =
        "Giliranmu! Pilih CHECK atau FOLD.";
    } else if (active) {
      $("turnInfo").textContent =
        "Menunggu giliran pemain berikutnya.";
    } else if (room.stage === "showdown") {
      $("turnInfo").textContent = "Ronde selesai.";
    } else {
      $("turnInfo").textContent =
        "Menunggu dealer memulai ronde.";
    }

    $("actionControls").classList.toggle(
      "hidden",
      !(myTurn && active)
    );

    $("deal").classList.toggle(
      "hidden",
      !(isDealer &&
        room.stage === "waiting" &&
        room.players.length >= 2)
    );

    $("next").classList.toggle(
      "hidden",
      !(isDealer && room.stage === "showdown")
    );
  });
})();



