
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

  let selectedAvatar = null;
  let currentAvatar = null;
  let toastTimer = null;
  let lastCommunitySignature = "";

  /* =========================
     BASIC HELPERS
  ========================= */

  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      $("toast").classList.remove("show");
    }, 3000);
  }

  function emitAction(action, extra = {}) {
    socket.emit("player:action", {
      action,
      ...extra
    });
  }

  function setAvatarPreview(element, avatar, name) {
    element.innerHTML = "";

    if (avatar) {
      const img = document.createElement("img");
      img.src = avatar;
      img.alt = "Foto profil";
      element.appendChild(img);
    } else {
      const initial = document.createElement("span");
      initial.textContent =
        (name || "?").trim().charAt(0).toUpperCase() || "?";
      element.appendChild(initial);
    }
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("File harus berupa gambar."));
        return;
      }

      if (file.size > 8 * 1024 * 1024) {
        reject(new Error("Ukuran foto maksimal 8 MB."));
        return;
      }

      const reader = new FileReader();

      reader.onerror = () => {
        reject(new Error("Gagal membaca foto."));
      };

      reader.onload = () => {
        const image = new Image();

        image.onerror = () => {
          reject(new Error("Foto tidak dapat dibuka."));
        };

        image.onload = () => {
          const maxSize = 180;
          const scale = Math.min(
            maxSize / image.width,
            maxSize / image.height,
            1
          );

          const canvas = document.createElement("canvas");

          canvas.width = Math.max(
            1,
            Math.round(image.width * scale)
          );

          canvas.height = Math.max(
            1,
            Math.round(image.height * scale)
          );

          const context = canvas.getContext("2d");

          context.drawImage(
            image,
            0,
            0,
            canvas.width,
            canvas.height
          );

          resolve(
            canvas.toDataURL("image/jpeg", 0.72)
          );
        };

        image.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  }

  function getDisplayName(player) {
    return player.name || "Pemain";
  }

  /* =========================
     PROFILE
  ========================= */

  $("avatarInput").addEventListener("change", async event => {
    const file = event.target.files[0];

    if (!file) return;

    try {
      selectedAvatar = await compressImage(file);

      setAvatarPreview(
        $("lobbyAvatarPreview"),
        selectedAvatar,
        $("name").value
      );

      toast("Foto profil berhasil dipilih.");
    } catch (error) {
      toast(error.message);
    }

    event.target.value = "";
  });

  $("roomAvatarInput").addEventListener("change", async event => {
    const file = event.target.files[0];

    if (!file) return;

    try {
      selectedAvatar = await compressImage(file);

      setAvatarPreview(
        $("roomAvatarPreview"),
        selectedAvatar,
        $("editName").value
      );

      toast("Foto baru siap disimpan.");
    } catch (error) {
      toast(error.message);
    }

    event.target.value = "";
  });

  $("name").addEventListener("input", () => {
    setAvatarPreview(
      $("lobbyAvatarPreview"),
      selectedAvatar,
      $("name").value
    );
  });

  $("editName").addEventListener("input", () => {
    setAvatarPreview(
      $("roomAvatarPreview"),
      currentAvatar,
      $("editName").value
    );
  });

  function saveProfile() {
    if (!socket || !socket.connected) {
      toast("Koneksi server belum tersedia.");
      return;
    }

    if (isDealer || !roomCode) {
      toast("Profil pemain hanya tersedia untuk pemain.");
      return;
    }

    const name = $("editName").value.trim();

    if (!name) {
      toast("Nama pemain tidak boleh kosong.");
      return;
    }

    const avatar = selectedAvatar !== null
      ? selectedAvatar
      : currentAvatar;

    socket.emit("player:profile", {
      name,
      avatar
    });

    currentAvatar = avatar;
    selectedAvatar = null;

    $("editName").value = name;

    toast("Profil berhasil diperbarui.");
  }

  $("saveProfile").addEventListener(
    "click",
    saveProfile
  );

  function updateOwnProfileFromRoom(room) {
    const me = room.players.find(
      player => player.id === myId
    );

    if (!me) return;

    currentAvatar = me.avatar || null;

    if (
      document.activeElement !== $("editName")
    ) {
      $("editName").value = me.name || "";
    }

    if (selectedAvatar === null) {
      setAvatarPreview(
        $("roomAvatarPreview"),
        currentAvatar,
        me.name
      );
    }
  }

  /* =========================
     CARD ANIMATIONS
  ========================= */

  function renderCards(container, cards, isCommunity = false) {
    if (!cards || !cards.length) {
      container.innerHTML =
        '<span class="placeholder">Menunggu kartu</span>';

      if (isCommunity) {
        lastCommunitySignature = "";
      }

      return;
    }

    const signature = JSON.stringify(cards);

    if (
      isCommunity &&
      signature === lastCommunitySignature
    ) {
      return;
    }

    if (isCommunity) {
      const previousCards = Array.from(
        container.querySelectorAll(".card")
      );

      const previousCount = previousCards.length;

      if (cards.length < previousCount) {
        container.innerHTML = "";
      }

      if (cards.length > previousCount) {
        cards.slice(previousCount).forEach((card, index) => {
          const el = createCard(card);

          el.style.animationDelay =
            (index * 550) + "ms";

          container.appendChild(el);
        });

        lastCommunitySignature = signature;
        return;
      }

      if (cards.length === previousCount) {
        lastCommunitySignature = signature;
        return;
      }
    }

    container.innerHTML = "";

    cards.forEach((card, index) => {
      const el = createCard(card);

      if (isCommunity) {
        el.style.animationDelay =
          (index * 550) + "ms";
      }

      container.appendChild(el);
    });

    if (isCommunity) {
      lastCommunitySignature = signature;
    }
  }

  function createCard(card) {
    const el = document.createElement("div");

    el.className =
      "card " +
      (["♥", "♦"].includes(card.suit) ? "red" : "");

    el.textContent = card.rank + card.suit;

    return el;
  }

  function renderCardsInto(parent, cards) {
    const wrap = document.createElement("div");
    wrap.className = "mini-cards";

    cards.forEach(card => {
      const el = document.createElement("span");

      el.className =
        "mini-card " +
        (["♥", "♦"].includes(card.suit) ? "red" : "");

      el.textContent = card.rank + card.suit;

      wrap.appendChild(el);
    });

    parent.appendChild(wrap);
  }

  /* =========================
     PLAYER DISPLAY
  ========================= */

  function renderPlayers(players) {
    $("players").innerHTML = "";

    players.forEach(player => {
      const el = document.createElement("div");

      el.className = "player";
      el.dataset.playerId = player.id;

      if (player.isTurn) {
        el.classList.add("active-turn");
      }

      if (player.folded) {
        el.classList.add("folded-player");
      }

      if (player.allIn) {
        el.classList.add("all-in-player");
      }

      const top = document.createElement("div");
      top.className = "player-top";

      const avatar = document.createElement("div");
      avatar.className = "player-avatar";

      if (player.avatar) {
        const img = document.createElement("img");

        img.src = player.avatar;
        img.alt = "Foto " + getDisplayName(player);

        avatar.appendChild(img);
      } else {
        avatar.textContent =
          getDisplayName(player).charAt(0).toUpperCase();
      }

      const name = document.createElement("strong");
      name.className = "player-name";
      name.textContent = getDisplayName(player);

      top.append(avatar, name);

      const chips = document.createElement("div");
      chips.className = "player-chips";
      chips.textContent = "🪙 " + player.chips + " chip";

      const role = document.createElement("div");
      role.className = "role";

      const roles = [];

      if (player.isSmallBlind) {
        roles.push("SMALL BLIND");
      }

      if (player.isBigBlind) {
        roles.push("BIG BLIND");
      }

      if (player.isTurn) {
        roles.push("GILIRAN");
      }

      if (player.folded) {
        roles.push("FOLD");
      }

      if (player.allIn) {
        roles.push("ALL-IN");
      }

      role.textContent = roles.join(" • ");

      const bet = document.createElement("div");
      bet.className = "player-bet";
      bet.textContent =
        "Taruhan ronde: " + player.streetBet;

      el.append(top, chips, role, bet);

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

  /* =========================
     RESULTS
  ========================= */

  function renderResults(results) {
    if (!results) {
      $("results").classList.add("hidden");
      return;
    }

    $("results").classList.remove("hidden");

    $("winnerText").textContent =
      "Pemenang: " +
      results.winnerNames.join(", ");

    $("rankingList").innerHTML = "";

    results.players.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = "result-row";

      const name = document.createElement("strong");

      name.textContent =
        (index + 1) + ". " + player.name;

      const hand = document.createElement("span");
      hand.textContent = player.handName;

      row.append(name, hand);

      if (player.winner) {
        const badge = document.createElement("b");
        badge.textContent = "PEMENANG";

        row.appendChild(badge);
      }

      $("rankingList").appendChild(row);
    });

    const key =
      roomCode + "-" +
      results.winnerNames.join(",");

    if (key !== lastWinnerKey) {
      lastWinnerKey = key;

      const winner = results.players.find(
        p => p.winner
      );

      $("popupWinner").textContent =
        results.winnerNames.join(" & ");

      $("popupHand").textContent =
        winner
          ? winner.handName
          : "Pemenang ronde";

      $("winnerPopup").classList.remove("hidden");
    }
  }

  /* =========================
     DEALER DISPLAY
  ========================= */

  function renderDealerPlayers(players) {
    $("dealerPlayers").innerHTML = "";

    players.forEach(player => {
      const row = document.createElement("div");

      row.className = "dealer-player-row";

      const label = document.createElement("span");

      label.textContent =
        player.name + " — " +
        player.chips + " chip";

      row.appendChild(label);

      if (player.topupRequested) {
        const button = document.createElement("button");

        button.className = "secondary small";
        button.textContent = "SETUJUI ISI ULANG";

        button.addEventListener("click", () => {
          socket.emit(
            "dealer:topup-approve",
            player.id
          );
        });

        row.appendChild(button);
      }

      $("dealerPlayers").appendChild(row);
    });
  }

  /* =========================
     ACTION CONTROLS
  ========================= */

  function updateActionControls(room) {
    const me = room.players.find(
      p => p.id === myId
    );

    const myTurn =
      room.currentPlayerId === myId;

    const active =
      room.stage !== "waiting" &&
      room.stage !== "showdown";

    $("actionControls").classList.toggle(
      "hidden",
      !(myTurn && active)
    );

    if (me) {
      const due =
        room.currentBet - me.streetBet;

      $("check").classList.toggle(
        "hidden",
        due > 0
      );

      $("call").classList.toggle(
        "hidden",
        due <= 0
      );

      $("call").textContent =
        "CALL " + Math.max(0, due);

      $("raiseTo").max =
        me.streetBet + me.chips;

      $("raiseTo").placeholder =
        "Raise min. " +
        (room.currentBet + 1);

      $("allin").disabled =
        me.chips <= 0;

      $("topupControls").classList.toggle(
        "hidden",
        !(me.chips <= 0 && room.stage === "waiting")
      );
    } else {
      $("topupControls").classList.add("hidden");
    }
  }

  /* =========================
     CHIP ANIMATION
  ========================= */

  function animateChip(fromElement, toElement, count = 3) {
    if (!fromElement || !toElement) return;

    const from = fromElement.getBoundingClientRect();
    const to = toElement.getBoundingClientRect();

    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;

    const endX = to.left + to.width / 2;
    const endY = to.top + to.height / 2;

    for (let i = 0; i < count; i++) {
      const chip = document.createElement("div");

      chip.className = "flying-chip";

      chip.style.setProperty(
        "--chip-start-x",
        startX + "px"
      );

      chip.style.setProperty(
        "--chip-start-y",
        startY + "px"
      );

      chip.style.setProperty(
        "--chip-x",
        (endX - startX) + "px"
      );

      chip.style.setProperty(
        "--chip-y",
        (endY - startY) + "px"
      );

      chip.style.animationDelay =
        (i * 100) + "ms";

      document.body.appendChild(chip);

      setTimeout(() => chip.remove(), 1500);
    }
  }

  function animatePot() {
    const pot = $("potDisplay");

    pot.classList.remove("pot-pulse");

    void pot.offsetWidth;

    pot.classList.add("pot-pulse");
  }

  function animateBetChanges(room, previousRoom) {
    if (!previousRoom) return;

    if (room.pot > previousRoom.pot) {
      animatePot();

      previousRoom.players.forEach(oldPlayer => {
        const newPlayer = room.players.find(
          p => p.id === oldPlayer.id
        );

        if (
          newPlayer &&
          newPlayer.streetBet > oldPlayer.streetBet
        ) {
          const playerElement = document.querySelector(
            '.player[data-player-id="' +
            oldPlayer.id +
            '"]'
          );

          animateChip(
            playerElement,
            $("potDisplay"),
            2
          );
        }
      });
    }

    if (
      room.stage === "showdown" &&
      previousRoom.stage !== "showdown" &&
      room.pot > 0
    ) {
      $("potDisplay").classList.add("pot-win");
    }
  }

  /* =========================
     ROOM RENDER
  ========================= */

  function renderRoom(room) {
    const previousRoom = lastRoom;

    $("round").textContent = room.round;
    $("status").textContent = room.message;
    $("pot").textContent = room.pot;
    $("currentBet").textContent = room.currentBet;

    renderPlayers(room.players);

    renderCards(
      $("communityCards"),
      room.community,
      true
    );

    renderResults(room.results);
    updateActionControls(room);
    updateOwnProfileFromRoom(room);

    if (room.currentPlayerId === myId) {
      $("turnInfo").textContent =
        "Giliranmu. Tentukan tindakan.";
    } else if (room.stage === "showdown") {
      $("turnInfo").textContent =
        "Ronde selesai.";
    } else if (room.stage === "waiting") {
      $("turnInfo").textContent =
        "Menunggu dealer memulai ronde.";
    } else {
      const current = room.players.find(
        p => p.id === room.currentPlayerId
      );

      $("turnInfo").textContent = current
        ? "Menunggu giliran " + current.name + "."
        : "Menunggu giliran pemain lain.";
    }

    if (previousRoom) {
      animateBetChanges(room, previousRoom);
    }

    if (
      room.stage === "waiting" &&
      room.community.length === 0
    ) {
      renderCards(
        $("communityCards"),
        [],
        true
      );
    }

    lastRoom = room;
  }

  /* =========================
     SOCKET CONNECTION
  ========================= */

  socket = io({
    transports: ["polling"],
    reconnection: true,
    timeout: 15000
  });

  $("connection").textContent =
    "MENGHUBUNGKAN...";

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

  socket.on("connect_error", error => {
    $("connection").textContent =
      "KONEKSI GAGAL";

    toast("Koneksi gagal: " + error.message);
  });

  /* =========================
     JOIN ROOM
  ========================= */

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
    const name =
      $("name").value.trim() || "Dealer";

    joinRoom("room:create", { name });
  });

  $("join").addEventListener("click", () => {
    const code = $("code").value
      .trim()
      .toUpperCase();

    if (!code) {
      toast("Masukkan kode room.");
      return;
    }

    joinRoom("room:join", {
      name: $("name").value,
      code
    });
  });

  socket.on("room:joined", data => {
    roomCode = data.code;
    isDealer = data.isDealer;

    $("roomCode").textContent = roomCode;

    $("lobby").classList.add("hidden");
    $("game").classList.remove("hidden");

    $("dealerPanel").classList.toggle(
      "hidden",
      !isDealer
    );

    $("profile-editor-placeholder");

    if (isDealer) {
      $("profile-editor-placeholder");
      $("saveProfile").disabled = true;
      $("editName").disabled = true;
    } else {
      $("saveProfile").disabled = false;
      $("editName").disabled = false;

      $("editName").value =
        $("name").value.trim() || "Pemain";

      if (selectedAvatar) {
        currentAvatar = selectedAvatar;
      }

      socket.emit("player:profile", {
        name: $("editName").value,
        avatar: currentAvatar
      });
    }

    toast(
      isDealer
        ? "Room dealer berhasil dibuat."
        : "Berhasil bergabung."
    );
  });

  socket.on("room:update", renderRoom);

  socket.on("hand:update", cards => {
    renderCards(
      $("myHand"),
      cards,
      false
    );
  });

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

  /* =========================
     DEALER BUTTONS
  ========================= */

  $("startRound").addEventListener("click", () => {
    const amount = Number($("bbAmount").value);

    if (
      !Number.isInteger(amount) ||
      amount < 1
    ) {
      toast(
        "Masukkan taruhan Big Blind minimal 1 chip."
      );

      return;
    }

    socket.emit("dealer:start", amount);
  });

  $("nextRound").addEventListener("click", () => {
    socket.emit("dealer:next");

    lastWinnerKey = "";
    lastCommunitySignature = "";
  });

  /* =========================
     PLAYER ACTION BUTTONS
  ========================= */

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
    const raiseTo = Number(
      $("raiseTo").value
    );

    if (
      !Number.isInteger(raiseTo) ||
      raiseTo < 1
    ) {
      toast("Masukkan nominal Raise.");
      return;
    }

    emitAction("raise", { raiseTo });
  });

  /* =========================
     VIRTUAL CHIP RESET
  ========================= */

  $("topupRequest").addEventListener("click", () => {
    socket.emit("player:topup-request");
  });

  socket.on("topup:waiting", () => {
    toast(
      "Permintaan isi ulang dikirim ke dealer."
    );

    $("topupRequest").disabled = true;
  });

  socket.on("topup:approved", amount => {
    $("topupRequest").disabled = false;

    toast(
      amount + " chip virtual gratis berhasil ditambahkan."
    );
  });

  socket.on("topup:request", data => {
    pendingTopupId = data.playerId;

    $("topupText").textContent =
      data.name +
      " meminta isi ulang 10 chip virtual gratis.";

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

  /* =========================
     POPUPS & ROOM CODE
  ========================= */

  $("closePopup").addEventListener("click", () => {
    $("winnerPopup").classList.add("hidden");
  });

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(roomCode);

      toast("Kode room disalin.");
    } catch {
      toast("Kode room: " + roomCode);
    }
  });

})();

