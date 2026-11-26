
(() => {
  const $ = id => document.getElementById(id);

  let currentCode = "";
  let isDealer = false;
  let mySocketId = null;

  function connection(message) {
    $("connection").textContent = message;
  }

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
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

    if (player.isTurn) el.classList.add("active-turn");
    if (player.folded) el.classList.add("folded-player");

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
      state.textContent = "GILIRANMU";
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
    connection("SOCKET.IO TIDAK TERMUAT");
    toast("Socket.IO tidak berhasil dimuat.");
    return;
  }

  const socket = window.io({
    transports: ["polling"],
    reconnection: true,
    timeout: 10000
  });

  connection("MENGHUBUNGKAN...");

  socket.on("connect", () => {
    mySocketId = socket.id;
    connection("TERHUBUNG");
  });

  socket.on("disconnect", () => {
    connection("TERPUTUS");
  });

  socket.on("connect_error", error => {
    connection("KONEKSI GAGAL");
    toast(error.message);
  });

  $("create").onclick = () => {
    if (!socket.connected) {
      toast("Server belum terhubung.");
      return;
    }

    socket.emit("room:create", {
      name: $("name").value.trim() || "Pemain"
    });
  };

  $("join").onclick = () => {
    if (!socket.connected) {
      toast("Server belum terhubung.");
      return;
    }

    const code = $("code").value.trim().toUpperCase();

    if (!code) {
      toast("Masukkan kode room.");
      return;
    }

    socket.emit("room:join", {
      name: $("name").value.trim() || "Pemain",
      code
    });
  };

  $("deal").onclick = () => socket.emit("dealer:deal");
  $("check").onclick = () => socket.emit("player:check");
  $("fold").onclick = () => socket.emit("player:fold");
  $("next").onclick = () => socket.emit("dealer:next");

  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      toast("Kode room disalin.");
    } catch {
      toast("Kode room: " + currentCode);
    }
  };

  socket.on("room:joined", data => {
    currentCode = data.code;
    isDealer = data.isDealer;

    $("lobby").classList.add("hidden");
    $("game").classList.remove("hidden");
    $("roomCode").textContent = currentCode;

    toast("Berhasil masuk room.");
  });

  socket.on("error:notice", message => toast(message));

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
    const active = room.stage !== "waiting" &&
      room.stage !== "showdown";

    $("turnInfo").textContent = active
      ? (myTurn
          ? "Giliranmu! Pilih CHECK atau FOLD."
          : "Menunggu giliran pemain berikutnya.")
      : room.stage === "showdown"
        ? "Ronde selesai."
        : "Menunggu dealer memulai ronde.";

    $("actionControls").classList.toggle(
      "hidden",
      !(myTurn && active)
    );

    $("deal").classList.toggle(
      "hidden",
      !(isDealer && room.stage === "waiting" &&
        room.players.length >= 2)
    );

    $("next").classList.toggle(
      "hidden",
      !(isDealer && room.stage === "showdown")
    );
  });
})();


