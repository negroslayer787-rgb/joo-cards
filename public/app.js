
const socket = io({
  reconnection: true,
  timeout: 10000
});

const $ = id => document.getElementById(id);

let isDealer = false;
let currentCode = "";

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

function name() {
  return $("name").value.trim() || "Pemain";
}

// DIAGNOSTIK KONEKSI
socket.on("connect", () => {
  toast("TERHUBUNG KE SERVER");
  console.log("Socket connected:", socket.id);
});

socket.on("disconnect", () => {
  toast("KONEKSI TERPUTUS");
});

socket.on("connect_error", error => {
  toast("ERROR KONEKSI: " + error.message);
});

// BUAT ROOM
$("create").onclick = () => {
  toast("TOMBOL DIKLIK");

  if (!socket.connected) {
    toast("SERVER BELUM TERHUBUNG");
    return;
  }

  socket.emit("room:create", { name: name() });
};

// GABUNG ROOM
$("join").onclick = () => {
  if (!socket.connected) {
    toast("SERVER BELUM TERHUBUNG");
    return;
  }

  socket.emit("room:join", {
    name: name(),
    code: $("code").value
  });
};

// FITUR DEALER
$("deal").onclick = () => socket.emit("dealer:deal");
$("reveal").onclick = () => socket.emit("dealer:reveal");
$("next").onclick = () => socket.emit("dealer:next");

// SALIN KODE
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(currentCode);
    toast("Kode room disalin.");
  } catch {
    toast("Kode room: " + currentCode);
  }
};

// ROOM BERHASIL DIBUAT
socket.on("room:joined", data => {
  currentCode = data.code;
  isDealer = data.isDealer;

  toast("ROOM BERHASIL DIBUAT");

  $("lobby").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("roomCode").textContent = currentCode;
});

// PESAN ERROR SERVER
socket.on("error:notice", msg => toast("SERVER: " + msg));

// UPDATE PERMAINAN
socket.on("room:update", room => {
  $("round").textContent = room.round;
  $("status").textContent = room.message;
  $("players").innerHTML = "";

  room.players.forEach(p => {
    const el = document.createElement("div");
    el.className = "player";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = p.name.slice(0, 1).toUpperCase();

    const nm = document.createElement("div");
    nm.className = "pname";
    nm.textContent = p.name;

    const role = document.createElement("div");
    role.className = "role";
    role.textContent = p.isDealer ? "DEALER" : "PEMAIN";

    el.append(avatar, nm, role);

    if (p.card) {
      const c = document.createElement("div");
      c.className = "card " +
        (["♥", "♦"].includes(p.card.suit) ? "red" : "");
      c.textContent = p.card.rank + p.card.suit;
      el.append(c);
    } else if (p.hasCard) {
      const c = document.createElement("div");
      c.className = "card back";
      c.textContent = "J";
      el.append(c);
    }

    $("players").append(el);
  });

  $("deal").classList.toggle("hidden", !isDealer);
  $("reveal").classList.toggle(
    "hidden",
    !isDealer || room.revealed ||
    !room.players.some(p => p.hasCard)
  );
  $("next").classList.toggle(
    "hidden",
    !isDealer || !room.revealed
  );
});

