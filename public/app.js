
    
(() => {
  const $ = id => document.getElementById(id);

  let currentCode = "";
  let isDealer = false;

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

  socket.on("room:update", room => {
    $("round").textContent = room.round;
    $("status").textContent = room.message;

    $("players").innerHTML = "";

    room.players.forEach(player => {
      const el = document.createElement("div");
      el.className = "player";

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

      if (player.hasHand) {
        const card = document.createElement("div");
        card.className = "card back";
        card.textContent = "J";
        el.appendChild(card);
      }

      $("players").appendChild(el);
    });

    $("deal").classList.toggle(
      "hidden",
      !isDealer || room.dealt || room.players.length < 2
    );

    $("next").classList.toggle(
      "hidden",
      !isDealer || !room.dealt
    );
  });

  socket.on("hand:update", cards => {
    renderCards($("myHand"), cards);
  });

  socket.on("community:update", cards => {
    renderCards($("communityCards"), cards);
  });
})();
