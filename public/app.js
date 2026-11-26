 
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  let socket;
  let roomCode = "";
  let isDealer = false;
  let myId = "";
  let lastWinnerKey = "";
  let pendingTopupId = null;
  let lastRoom = null;

  // Menyimpan kartu yang sudah ditampilkan
  const renderedCards = new WeakMap();

  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");

    setTimeout(() => {
      $("toast").classList.remove("show");
    }, 3000);
  }

  function emitAction(action, extra = {}) {
    socket.emit("player:action", { action, ...extra });
  }

  // Membuat elemen kartu dengan animasi
  function createCardElement(card, index = 0) {
    const el = document.createElement("div");

    el.className =
      "card " +
      (["♥", "♦"].includes(card.suit) ? "red" : "black");

    el.textContent = card.rank + card.suit;

    el.style.animation = "cardIn .35s ease both";
    el.style.animationDelay = (index * 120) + "ms";

    return el;
  }

  // Render kartu tanpa mengulang animasi kartu lama
  function renderCards(container, cards) {
    const previous = renderedCards.get(container) || [];
    const current = cards || [];

    const signature = current.map(
      card => card.rank + card.suit
    );

    if (
      previous.length === signature.length &&
      previous.every((card, i) => card === signature[i])
    ) {
      return;
    }

    const isSameSequence =
      previous.length <= signature.length &&
      previous.every((card, i) => card === signature[i]);

    if (!isSameSequence) {
      container.innerHTML = "";
    }

    if (!current.length) {
      container.innerHTML =
        '<span class="placeholder">Belum ada kartu</span>';

      renderedCards.set(container, []);
      return;
    }

    if (!isSameSequence) {
      container.innerHTML = "";
    }

    const startIndex = isSameSequence ? previous.length : 0;

    for (let i = startIndex; i < current.length; i++) {
      container.appendChild(
        createCardElement(current[i], i - startIndex)
      );
    }

    renderedCards.set(container, signature);
  }

  // Render pemain
  function renderPlayers(players) {
    $("players").innerHTML = "";

    players.forEach((player, index) => {
      const el = document.createElement("div");
      el.className = "player";

      if (player.isTurn) {
        el.classList.add("active-turn");
      }

      if (player.folded) {
        el.classList.add("folded-player");
      }

      // Nomor kursi
      const seat = document.createElement("div");
      seat.className = "seat-number";
      seat.textContent = "SEAT " + (index + 1);

      const name = document.createElement("strong");
      name.textContent = player.name;

      const chips = document.createElement("div");
      chips.textContent = "🪙 " + player.chips + " chip";

      const role = document.createElement("div");
      role.className = "role";

      const roles = [];

      if (player.isSmallBlind) roles.push("SMALL BLIND");
      if (player.isBigBlind) roles.push("BIG BLIND");
      if (player.isTurn) roles.push("GILIRAN");
      if (player.folded) roles.push("FOLD");
      if (player.allIn) roles.push("ALL-IN");

      role.textContent = roles.join(" • ");

      const bet = document.createElement("div");
      bet.textContent = "Taruhan ronde: " + player.streetBet;

      el.append(seat, name, chips, role, bet);

      if (player.publicHand) {
        renderCardsInto(el, player.publicHand);
      } else if (player.hasHand && !player.folded) {
        const backs = document.createElement("div");
        backs.className = "card-backs";
        backs.textContent = "🂠 🂠";
        el.appendChild(backs);
      }

      $("players").appendChild(el);
    });
  }

  function renderCardsInto(parent, cards) {
    cards.forEach((card, index) => {
      const el = document.createElement("span");

      el.className =
        "mini-card " +
        (["♥", "♦"].includes(card.suit) ? "red" : "");

      el.textContent = card.rank + card.suit;
      el.style.animation = "cardIn .3s ease both";
      el.style.animationDelay = (index * 100) + "ms";

      parent.appendChild(el);
    });
  }

  // Hasil showdown
  function renderResults(results) {
    if (!results) {
      $("results").classList.add("hidden");
      return;
    }

    $("results").classList.remove("hidden");

    $("winnerText").textContent =
      "Pemenang: " + results.winnerNames.join(", ");

    $("rankingList").innerHTML = "";

    results.players.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "result-row";

      const name = document.createElement("strong");
      name.textContent = (i + 1) + ". " + p.name;

      const hand = document.createElement("span");
      hand.textContent = p.handName;

      row.append(name, hand);

      if (p.winner) {
        const badge = document.createElement("b");
        badge.textContent = "PEMENANG";
        row.appendChild(badge);
      }

      $("rankingList").appendChild(row);
    });

    const key =
      roomCode + "-" + results.winnerNames.join(",");

    if (key !== lastWinnerKey) {
      lastWinnerKey = key;

      const winner = results.players.find(p => p.winner);

      $("popupWinner").textContent =
        results.winnerNames.join(" & ");

      $("popupHand").textContent =
        winner ? winner.handName : "Pemenang ronde";

      $("winnerPopup").classList.remove("hidden");
    }
  }

  // Panel dealer
  function renderDealerPlayers(players) {
    $("dealerPlayers").innerHTML = "";

    players.forEach(player => {
      const row = document.createElement("div");
      row.className = "dealer-player-row";

      const label = document.createElement("span");

      label.textContent =
        player.name + " — " + player.chips + " chip";

      row.appendChild(label);

      if (player.topupRequested) {
        const button = document.createElement("button");

        button.className = "secondary small";
        button.textContent = "SETUJUI ISI ULANG";

        button.addEventListener("click", () => {
          socket.emit("dealer:topup-approve", player.id);
        });

        row.appendChild(button);
      }

      $("dealerPlayers").appendChild(row);
    });
  }

  // Kontrol aksi pemain
  function updateActionControls(room) {
    const me = room.players.find(p => p.id === myId);
    const myTurn = room.currentPlayerId === myId;

    const active =
      room.stage !== "waiting" &&
      room.stage !== "showdown";

    $("actionControls").classList.toggle(
      "hidden",
      !(myTurn && active)
    );

    if (me) {
      const due = room.currentBet - me.streetBet;

      $("check").classList.toggle("hidden", due > 0);
      $("call").classList.toggle("hidden", due <= 0);

      $("call").textContent =
        "CALL " + Math.max(0, due);

      $("raiseTo").max =
        me.streetBet + me.chips;

      $("raiseTo").placeholder =
        "Raise min. " + (room.currentBet + 1);

      $("allin").disabled = me.chips <= 0;

      $("topupControls").classList.toggle(
        "hidden",
        !(me.chips <= 0 && room.stage === "waiting")
      );
    } else {
      $("topupControls").classList.add("hidden");
    }
  }

  // Render room
  function renderRoom(room) {
    lastRoom = room;

    $("round").textContent = room.round;
    $("status").textContent = room.message;
    $("pot").textContent = room.pot;
    $("currentBet").textContent = room.currentBet;

    renderPlayers(room.players);

    // Community cards: animasi hanya untuk kartu baru
    renderCards($("communityCards"), room.community);

    renderResults(room.results);
    updateActionControls(room);

    const me = room.players.find(p => p.id === myId);

    if (room.currentPlayerId === myId) {
      $("turnInfo").textContent =
        "Giliranmu. Tentukan tindakan.";
    } else if (room.stage === "showdown") {
      $("turnInfo").textContent = "Ronde selesai.";
    } else if (room.stage === "waiting") {
      $("turnInfo").textContent =
        "Menunggu dealer memulai ronde.";
    } else {
      $("turnInfo").textContent =
        "Menunggu giliran pemain lain.";
    }

    if (me && me.chips === 0 && room.stage === "waiting") {
      $("topupControls").classList.remove("hidden");
    }
  }

  // Koneksi server
  socket = io({
    transports: ["polling"],
    reconnection: true,
    timeout: 15000
  });

  $("connection").textContent = "MENGHUBUNGKAN...";

  socket.on("connect", () => {
    myId = socket.id;

    $("connection").textContent = "TERHUBUNG";

    $("create").disabled = false;
    $("join").disabled = false;
  });

  socket.on("disconnect", () => {
    $("connection").textContent = "TERPUTUS";

    $("create").disabled = true;
    $("join").disabled = true;
  });

  socket.on("connect_error", err => {
    $("connection").textContent = "KONEKSI GAGAL";
    toast("Koneksi gagal: " + err.message);
  });

  // Masuk room
  function joinRoom(event, data) {
    if (!socket.connected) {
      toast("Server belum terhubung.");
      return;
    }

    $("create").disabled = true;
    $("join").disabled = true;

    socket.emit(event, data, response => {
      if (response && response.ok === false) {
        $("create").disabled = false;
        $("join").disabled = false;
      }
    });
  }

  $("create").addEventListener("click", () => {
    joinRoom("room:create", {
      name: $("name").value
    });
  });

  $("join").addEventListener("click", () => {
    const code = $("code").value.trim().toUpperCase();

    if (!code) {
      return toast("Masukkan kode room.");
    }

    joinRoom("room:join", {
      name: $("name").value,
      code
    });
  });

  // Room berhasil dimasuki
  socket.on("room:joined", data => {
    roomCode = data.code;
    isDealer = data.isDealer;

    $("roomCode").textContent = roomCode;

    $("lobby").classList.add("hidden");
    $("game").classList.remove("hidden");

    $("dealerPanel").classList.toggle("hidden", !isDealer);

    toast(
      isDealer
        ? "Room dealer berhasil dibuat."
        : "Berhasil bergabung."
    );
  });

  socket.on("room:update", renderRoom);

  // Kartu pribadi
  socket.on("hand:update", cards => {
    renderCards($("myHand"), cards);
  });

  // Update dealer
  socket.on("dealer:update", data => {
    if (!isDealer) return;

    renderDealerPlayers(data.players);

    $("startControls").classList.toggle(
      "hidden",
      data.stage !== "waiting"
    );

    $("nextRound").classList.toggle(
      "hidden",
      data.stage !== "showdown"
    );
  });

  socket.on("error:notice", message => {
    toast(message);
  });

  // Mulai ronde
  $("startRound").addEventListener("click", () => {
    const amount = Number($("bbAmount").value);

    if (!Number.isInteger(amount) || amount < 1) {
      return toast(
        "Masukkan taruhan Big Blind minimal 1 chip."
      );
    }

    socket.emit("dealer:start", amount);
  });

  $("nextRound").addEventListener("click", () => {
    socket.emit("dealer:next");
    lastWinnerKey = "";
  });

  // Aksi poker
  $("check").addEventListener("click", () => {
    emitAction("check");
  });

  $("call").addEventListener("click", () => {
    emitAction("call");
  });

  $("fold").addEventListener("click", () => {
    emitAction("fold");
  });

  $("allin").addEventListener("click", () => {
    emitAction("allin");
  });

  $("raise").addEventListener("click", () => {
    const raiseTo = Number($("raiseTo").value);

    if (!Number.isInteger(raiseTo) || raiseTo < 1) {
      return toast("Masukkan nominal Raise.");
    }

    emitAction("raise", { raiseTo });
  });

  // Permintaan chip virtual gratis
  $("topupRequest").addEventListener("click", () => {
    socket.emit("player:topup-request");
  });

  socket.on("topup:waiting", () => {
    toast("Permintaan isi ulang dikirim ke dealer.");
    $("topupRequest").disabled = true;
  });

  socket.on("topup:approved", amount => {
    $("topupRequest").disabled = false;

    toast(
      amount + " chip virtual berhasil ditambahkan."
    );
  });

  socket.on("topup:request", data => {
    pendingTopupId = data.playerId;

    $("topupText").textContent =
      data.name + " meminta isi ulang 10 chip virtual.";

    $("topupPopup").classList.remove("hidden");
  });

  $("approveTopup").addEventListener("click", () => {
    if (!pendingTopupId) return;

    socket.emit(
      "dealer:topup-approve",
      pendingTopupId
    );

    pendingTopupId = null;

    $("topupPopup").classList.add("hidden");
  });

  $("closeTopup").addEventListener("click", () => {
    $("topupPopup").classList.add("hidden");
  });

  $("closePopup").addEventListener("click", () => {
    $("winnerPopup").classList.add("hidden");
  });

  // Salin kode room
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      toast("Kode room disalin.");
    } catch {
      toast("Kode room: " + roomCode);
    }
  });

  // Ganti nama pemain
  $("name").addEventListener("change", () => {
    if (!isDealer && roomCode) {
      socket.emit(
        "player:rename",
        $("name").value
      );
    }
  });

})();


