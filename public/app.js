
"use strict";

const $ = id => document.getElementById(id);

const socket = io({
  reconnection: true,
  timeout: 10000
});

let isDealer = false;
let currentCode = "";

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");

  setTimeout(() => {
    el.classList.remove("show");
  }, 3000);
}

function setConnection(message) {
  $("connection").textContent = message;
}

function playerName() {
  return $("name").value.trim() || "Pemain";
}

socket.on("connect", () => {
  setConnection("TERHUBUNG");
  toast("Koneksi server berhasil.");
});

socket.on("disconnect", () => {
  setConnection("TERPUTUS");
  toast("Koneksi server terputus.");
});

socket.on("connect_error", error => {
  setConnection("GAGAL TERHUBUNG");
  toast("Koneksi gagal: " + error.message);
  console.error(error);
});

$("create").addEventListener("click", () => {
  toast("Mengirim permintaan room...");

  if (!socket.connected) {
    toast("Server belum terhubung.");
    return;
  }

  socket.emit("room:create", {
    name: playerName()
  });
});

$("join").addEventListener("click", () => {
  if (!socket.connected) {
    toast("Server belum terhubung.");
    return;
  }

  socket.emit("room:join", {
    name: playerName(),
    code: $("code").value
  });
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
  try {
    await navigator.clipboard.writeText(currentCode);
    toast("Kode room disalin.");
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

  toast("Room berhasil dibuat.");
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
    avatar.textContent = player.name.charAt(0).toUpperCase();

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
    !isDealer || room.revealed ||
    !room.players.some(player => player.hasCard)
  );

  $("next").classList.toggle(
    "hidden",
    !isDealer || !room.revealed
  );
});

window.addEventListener("error", event => {
  toast("JavaScript error: " + event.message);
  console.error(event.error);
});


