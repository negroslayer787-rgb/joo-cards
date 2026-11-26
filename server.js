

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "Joo Cards" });
});

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));

  return code;
}

function makeDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    "A", "2", "3", "4", "5", "6", "7",
    "8", "9", "10", "J", "Q", "K"
  ];

  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function notifyError(socket, message) {
  socket.emit("error:notice", message);
}

function sendUpdate(code) {
  const room = rooms.get(code);
  if (!room) return;

  const players = room.players.map(player => ({
    name: player.name,
    isDealer: player.id === room.dealerId,
    hasCard: Boolean(player.card),
    card: room.revealed ? player.card : null
  }));

  io.to(code).emit("room:update", {
    round: room.round,
    message: room.message,
    revealed: room.revealed,
    players
  });
}

function removePlayer(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  socket.data.roomCode = null;

  if (!room) return;

  room.players = room.players.filter(player => player.id !== socket.id);

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (room.dealerId === socket.id) {
    room.dealerId = room.players[0].id;
    room.message = "Dealer baru telah dipilih.";
  } else {
    room.message = "Seorang pemain meninggalkan room.";
  }

  sendUpdate(code);
}

io.on("connection", socket => {
  console.log("Pemain terhubung:", socket.id);

  socket.on("room:create", (data = {}, callback) => {
    removePlayer(socket);

    const code = makeCode();
    const player = {
      id: socket.id,
      name: String(data.name || "Pemain").trim().slice(0, 18) || "Pemain",
      card: null
    };

    const room = {
      code,
      dealerId: socket.id,
      players: [player],
      round: 1,
      revealed: false,
      message: "Room berhasil dibuat. Menunggu pemain lain."
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit("room:joined", {
      code,
      isDealer: true
    });

    if (typeof callback === "function") {
      callback({ ok: true, code });
    }

    sendUpdate(code);
  });

  socket.on("room:join", (data = {}, callback) => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      notifyError(socket, "Room tidak ditemukan.");
      if (typeof callback === "function") callback({ ok: false });
      return;
    }

    if (room.players.length >= 8) {
      notifyError(socket, "Room sudah penuh.");
      if (typeof callback === "function") callback({ ok: false });
      return;
    }

    removePlayer(socket);

    const player = {
      id: socket.id,
      name: String(data.name || "Pemain").trim().slice(0, 18) || "Pemain",
      card: null
    };

    room.players.push(player);
    room.message = `${player.name} bergabung ke room.`;

    socket.join(code);
    socket.data.roomCode = code;

    socket.emit("room:joined", {
      code,
      isDealer: false
    });

    if (typeof callback === "function") {
      callback({ ok: true, code });
    }

    sendUpdate(code);
  });

  socket.on("dealer:deal", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);

    if (!room || room.dealerId !== socket.id) {
      notifyError(socket, "Hanya dealer yang dapat membagikan kartu.");
      return;
    }

    if (room.players.length < 2) {
      notifyError(socket, "Minimal harus ada 2 pemain.");
      return;
    }

    const deck = makeDeck();

    room.players.forEach((player, index) => {
      player.card = deck[index];
    });

    room.revealed = false;
    room.message = "Kartu telah dibagikan.";
    sendUpdate(code);
  });

  socket.on("dealer:reveal", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);

    if (!room || room.dealerId !== socket.id) {
      notifyError(socket, "Hanya dealer yang dapat membuka kartu.");
      return;
    }

    if (!room.players.some(player => player.card)) {
      notifyError(socket, "Bagikan kartu terlebih dahulu.");
      return;
    }

    room.revealed = true;
    room.message = "Semua kartu telah dibuka.";
    sendUpdate(code);
  });

  socket.on("dealer:next", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);

    if (!room || room.dealerId !== socket.id) {
      notifyError(socket, "Hanya dealer yang dapat memulai ronde berikutnya.");
      return;
    }

    room.round += 1;
    room.revealed = false;
    room.players.forEach(player => {
      player.card = null;
    });

    room.message = "Ronde baru dimulai.";
    sendUpdate(code);
  });

  socket.on("disconnect", () => {
    console.log("Pemain terputus:", socket.id);
    removePlayer(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Joo Cards berjalan pada port ${PORT}`);
});

