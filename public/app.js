
const socket = io({
  reconnection: true,
  timeout: 10000
});

const $ = id => document.getElementById(id);

let isDealer = false;
let currentCode = "";

function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2400);
}

function name() {
  return $("name").value.trim() || "Pemain";
}

socket.on("connect", () => {
  console.log("Socket terhubung:", socket.id);
});

socket.on("connect_error", error => {
  toast("Koneksi gagal: " + error.message);
  console.error("Socket error:", error);
});

$("create").onclick = () => {
  if (!socket.connected) {
    toast("Server belum terhubung. Coba lagi.");
    return;
  }
  socket.emit("room:create", { name: name() });
};

$("join").onclick = () => {
  if (!socket.connected) {
    toast("Server belum terhubung. Coba lagi.");
    return;
  }
  socket.emit("room:join", {
    name: name(),
    code: $("code").value
  });
};

$("deal").onclick = () => socket.emit("dealer:deal");
$("reveal").onclick = () => socket.emit("dealer:reveal");
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
});

socket.on("error:notice", toast);

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
    !isDealer || room.revealed || !room.players.some(p => p.hasCard)
  );
  $("next").classList.toggle("hidden", !isDealer || !room.revealed);
});
