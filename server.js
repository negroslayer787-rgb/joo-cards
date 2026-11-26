

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
    "2", "3", "4", "5", "6", "7",
    "8", "9", "10", "J", "Q", "K", "A"
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

function sendUpdate(room) {
  io.to(room.code).emit("room:update", {
    round: room.round,
    message: room.message,
    dealt: room.dealt,
    players: room.players.map(player => ({
      name: player.name,
      isDealer: player.id === room.dealerId,
      hasHand: player.hand.length === 2
    }))
  });

  room.players.forEach(player => {
    io.to(player.id).emit("hand:update", player.hand);
  });

  io.to(room.code).emit("community:update", room.community);
}

function removePlayer(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  socket.data.roomCode = null;
  socket.leave(code);

  const room = rooms.get(code);
  if (!room) return;

  room.players = room.players.filter(
    player => player.id !== socket.id
  );

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

  sendUpdate(room);
}

io.on("connection", socket => {
  console.log("Terhubung:", socket.id);

  socket.on("room:create", (data = {}, callback) => {
    removePlayer(socket);

    const code = makeCode();

    const room = {
      code,
      dealerId: socket.id,
      players: [{
        id: socket.id,
        name: String(data.name || "Pemain").trim().slice(0, 18) || "Pemain",
        hand: []
      }],
      round: 1,
      dealt: false,
      deck: [],
      community: [],
      message: "Room dibuat. Menunggu pemain."
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

    sendUpdate(room);
  });

  socket.on("room:join", (data = {}, callback) => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit("error:notice", "Room tidak ditemukan.");
      if (typeof callback === "function") callback({ ok: false });
      return;
    }

    if (room.players.length >= 6) {
      socket.emit("error:notice", "Room sudah penuh (maksimal 6 pemain).");
      if (typeof callback === "function") callback({ ok: false });
      return;
    }

    removePlayer(socket);

    const player = {
      id: socket.id,
      name: String(data.name || "Pemain").trim().slice(0, 18) || "Pemain",
      hand: []
    };

    room.players.push(player);
    room.message = player.name + " bergabung ke room.";

    socket.join(code);
    socket.data.roomCode = code;

    socket.emit("room:joined", {
      code,
      isDealer: false
    });

    if (typeof callback === "function") {
      callback({ ok: true, code });
    }

    sendUpdate(room);
  });

  socket.on("dealer:deal", () => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.dealerId !== socket.id) {
      socket.emit("error:notice", "Hanya dealer yang dapat membagikan kartu.");
      return;
    }

    if (room.players.length < 2) {
      socket.emit("error:notice", "Minimal 2 pemain diperlukan.");
      return;
    }

    room.deck = makeDeck();
    room.community = [];

    room.players.forEach(player => {
      player.hand = [
        room.deck.pop(),
        room.deck.pop()
      ];
    });

    room.dealt = true;
    room.message = "Dua kartu pribadi telah dibagikan.";

    sendUpdate(room);
  });

  socket.on("dealer:next", () => {
    const room = rooms.get(socket.data.roomCode);

    if (!room || room.dealerId !== socket.id) {
      socket.emit("error:notice", "Hanya dealer yang dapat memulai ronde baru.");
      return;
    }

    room.round++;
    room.dealt = false;
    room.deck = [];
    room.community = [];

    room.players.forEach(player => {
      player.hand = [];
    });

    room.message = "Ronde baru dimulai. Menunggu pembagian kartu.";

    sendUpdate(room);
  });

  socket.on("disconnect", () => {
    console.log("Terputus:", socket.id);
    removePlayer(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Joo Cards berjalan pada port " + PORT);
});

