
(() => {
  const $ = id => document.getElementById(id);

  let currentCode = "";
  let isDealer = false;

  function connection(message) {
    const el = $("connection");
    if (el) el.textContent = message;
  }

  function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    setTimeout(() => el.classList.remove("show"), 3000);
  }

  function playerName() {
    return $("name").value.trim().slice(0, 18) || "Pemain";
  }

  connection("APP.JS AKTIF; MEMERIKSA SOCKET.IO...");

  if (typeof window.io !== "function") {
    connection("SOCKET.IO TIDAK TERMUAT");
    toast("File Socket.IO tidak berhasil dimuat.");
    return;
  }

  const socket = window.io({
    transports: ["polling"],
    reconnection: true,
    timeout: 10000
  });

  socket.on("connect", () => {
    connection("TERHUBUNG");
    console.log("Joo Cards connected:", socket.id);
  });

  socket.on("disconnect", () => {
    connection("TERPUTUS");
  });

  socket.on("connect_error", error => {
    connection("KONEKSI GAGAL");
    toast("Koneksi gagal: " + error.message);
  });

  $("create").addEventListener("click", () => {
    if (!socket.connected) {
      toast("Server belum terhubung. Tunggu sebentar.");
      return;
    }

    socket.timeout(7000).emit(
      "room:create",
      { name: playerName() },
      (error, response) => {
        if (error) toast("Server tidak merespons.");
        else if (!response || !response.ok) {
          toast("Room gagal dibuat.");
        }
      }
    );
  });

  $("join").addEventListener("click", () => {
    if (!socket.connected) {
      toast("Server belum terhubung.");
      return;
    }

    const code = $("code").value.trim().toUpperCase();

    if (!code) {
      toast("Masukkan kode room.");
      return;
    }

    socket.timeout(7000).emit(
      "room:join",
      { name: playerName(), code },
      (error, response) => {
        if (error) toast("Server tidak merespons.");
        else if (!response || !response.ok) {
          toast("Gagal bergabung ke room.");
        }
      }
    );
  });

  $("deal").addEventListener("click", () => {
    socket.emit("dealer:deal");
  });

  $("reveal").addEventListener("click", () => {
    socket.emit("dealer:reveal");
  });

  $("next").addEventListener("click", () => {
    socket.emit("dealer:next");
  });

  $("copy").addEventListener("click", async () => {
    if (!currentCode) return;

    try {
      await navigator.clipboard.writeText(currentCode);
      toast("Kode room berhasil disalin.");
    } catch {
      toast("Kode room: " + currentCode);
    }
  });

  socket.on("room:joined", data => {
    currentCode = data.code;
    isDealer = data.isDealer;

    $("lobby").classList.add("hidden");
    $("game").classList.remove("hidden");
    $("roomCode").textContent = currentCode;

    toast("Berhasil masuk ke room!");
  });

  socket.on("error:notice", message => {
    toast(message);
  });

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

      if (player.card) {
        const card = document.createElement("div");
        card.className = "card " +
          (["♥", "♦"].includes(player.card.suit) ? "red" : "");

        card.textContent = player.card.rank + player.card.suit;
        el.append(card);
      } else if (player.hasCard) {
        const card = document.createElement("div");
        card.className = "card back";
        card.textContent = "J";
        el.append(card);
      }

      $("players").append(el);
    });

    $("deal").classList.toggle("hidden", !isDealer);

    $("reveal").classList.toggle(
      "hidden",
      !isDealer ||
      room.revealed ||
      !room.players.some(player => player.hasCard)
    );

    $("next").classList.toggle(
      "hidden",
      !isDealer || !room.revealed
    );
  });
})();
