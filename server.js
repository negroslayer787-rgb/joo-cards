
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "Joo Cards" });
});

const rooms = new Map();
const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function cleanName(value) {
  return String(value || "Pemain")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 18) || "Pemain";
}

function createDeck() {
  const cards = [];

  for (const suit of suits) {
    for (let i = 0; i < ranks.length; i++) {
      cards.push({
        suit,
        rank: ranks[i],
        value: i + 1
      });
    }
  }

  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

function getRoom(socket) {
  return rooms.get(socket.data.room);
}

function safeRoom(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(player => ({
      id: player.id,
      name: player.name,
      isDealer: player.id === room.dealer,
      card: room.revealed ? player.card : null,
      hasCard: Boolean(player.card)
    })),
    revealed: room.revealed,
    round: room.round,
    message: room.message
  };
}

function broadcast(room) {
  io.to(room.code).emit("room:update", safeRoom(room));
}

io.on("connection", socket => {
  console.log("Player connected:", socket.id);

  socket.on("room:create", data => {
    try {
      const code = crypto.randomBytes(3)
        .toString("hex")
        .toUpperCase();

      const room = {
        code,
        dealer: socket.id,
        players: new Map(),
        revealed: false,
        round: 1,
        deck: [],
        message: "Room berhasil dibuat."
      };

      room.players.set(socket.id, {
        id: socket.id,
        name: cleanName(data?.name),
        card: null
      });

      rooms.set(code, room);

      socket.join(code);
      socket.data.room = code;

      socket.emit("room:joined", {
        code,
        isDealer: true
      });

      broadcast(room);
      console.log("Room created:", code);
    } catch (error) {
      console.error(error);
      socket.emit("error:notice", "Gagal membuat room.");
    }
  });

  socket.on("room:join", data => {
    const code = String(data?.code || "")
      .trim()
      .toUpperCase();

    const room = rooms.get(code);

    if (!room) {
      return socket.emit("error:notice", "Room tidak ditemukan.");
    }

    if (room.players.size >= 8) {
      return socket.emit("error:notice", "Room penuh.");
    }

    const playerName = cleanName(data?.name);

    if ([...room.players.values()].some(
      p => p.name.toLowerCase() === playerName.toLowerCase()
    )) {
      return socket.emit("error:notice", "Nama sudah digunakan.");
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      card: null
    });

    socket.join(code);
    socket.data.room = code;

    socket.emit("room:joined", {
      code,
      isDealer: false
    });

    room.message = playerName + " bergabung.";
    broadcast(room);
  });

  socket.on("dealer:deal", () => {
    const room = getRoom(socket);

    if (!room || room.dealer !== socket.id) {
      return socket.emit("error:notice", "Akses dealer diperlukan.");
    }

    room.deck = createDeck();

    for (const player of room.players.values()) {
      player.card = room.deck.pop();
    }

    room.revealed = false;
    room.message = "Kartu telah dibagikan.";
    broadcast(room);
  });

  socket.on("dealer:reveal", () => {
    const room = getRoom(socket);

    if (!room || room.dealer !== socket.id) return;

    if (![...room.players.values()].some(p => p.card)) {
      return socket.emit("error:notice", "Bagikan kartu dahulu.");
    }

    room.revealed = true;

    const best = [...room.players.values()]
      .filter(p => p.card)
      .sort((a, b) => b.card.value - a.card.value)[0];

    room.message = "Kartu tertinggi: " + best.name + ".";
    broadcast(room);
  });

  socket.on("dealer:next", () => {
    const room = getRoom(socket);

    if (!room || room.dealer !== socket.id) return;

    room.round++;
    room.revealed = false;
    room.deck = [];

    for (const player of room.players.values()) {
      player.card = null;
    }

    room.message = "Ronde " + room.round + ".";
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket);
    if (!room) return;

    room.players.delete(socket.id);

    if (room.dealer === socket.id) {
      const next = room.players.keys().next().value;
      room.dealer = next || null;
      room.message = next
        ? "Dealer dialihkan."
        : "Room ditutup.";
    }

    if (room.players.size === 0) {
      rooms.delete(room.code);
    } else {
      broadcast(room);
    }

    console.log("Player disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("Joo Cards running on port " + PORT);
});

