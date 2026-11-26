
(() => {
  const $ = id => document.getElementById(id);

  let currentCode = "";
  let isDealer = false;

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2500);
  }

  function connection(message) {
    const el = $("connection");
    if (el) el.textContent = message;
  }

  function name() {
    return $("name").value.trim() || "Pemain";
  }

  if (typeof window.io !== "function") {
    connection("SOCKET.IO TIDAK TERMUAT");
    toast("Periksa koneksi Socket.IO.");
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
    toast("Koneksi gagal: " + error.message);
  });

  $("create").onclick = () => {
    socket.emit("room:create", { name: name() });
  };

  $("join").onclick = () => {
    const code = $("code").value.trim().toUpperCase();

    if (!code) {
      toast("Masukkan kode room.");
      return;
    }

    socket.emit("room:join", {
      name: name(),
      code
    });
  };

  $("deal").onclick = () => socket.emit("dealer:deal");
  $("reveal").onclick = () => socket.emit("dealer:reveal");
  $("next").onclick = () => socket.emit("dealer:next");

  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      toast("Kode room berhasil disalin.");
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

    toast("Berhasil masuk ke room.");
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

      const nm = document.createElement("div");
      nm.className = "pname";
      nm.textContent = player.name;

      const role = document.createElement("div");
      role.className = "role";
      role.textContent = player.isDealer ? "DEALER" : "PEMAIN";

      el.append(avatar, nm, role);

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
      !isDealer || room.revealed ||
      !room.players.some(player => player.hasCard)
    );

    $("next").classList.toggle(
      "hidden",
      !isDealer || !room.revealed
    );
  });
})();

