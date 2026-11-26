const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();
const suits = ["♠", "♥", "♦", "♣"];
const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function deck() {
  const cards = [];
  for (const suit of suits) for (let i = 0; i < ranks.length; i++)
    cards.push({ suit, rank: ranks[i], value: i + 1 });
  return cards.sort(() => Math.random() - 0.5);
}
function safeRoom(room) {
  return {
    code: room.code,
    dealer: room.dealer,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, isDealer: p.id === room.dealer,
      card: room.revealed ? p.card : null,
      hasCard: !!p.card
    })),
    revealed: room.revealed,
    round: room.round,
    message: room.message
  };
}
function broadcast(room) {
  io.to(room.code).emit("room:update", safeRoom(room));
}
function getRoom(socket) {
  const code = socket.data.room;
  return code && rooms.get(code);
}

io.on("connection", socket => {
  socket.on("room:create", ({name}) => {
    const code = crypto.randomBytes(3).toString("hex").toUpperCase();
    const room = {code, dealer: socket.id, players: new Map(), revealed: false, round: 1, deck: [], message: "Room dibuat. Dealer dapat membagikan kartu."};
    room.players.set(socket.id, {id: socket.id, name: cleanName(name), card: null});
    rooms.set(code, room);
    socket.join(code); socket.data.room = code;
    socket.emit("room:joined", {code, isDealer: true});
    broadcast(room);
  });

  socket.on("room:join", ({code, name}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("error:notice", "Room tidak ditemukan.");
    if (room.players.size >= 8) return socket.emit("error:notice", "Room sudah penuh (maksimal 8 pemain).");
    if ([...room.players.values()].some(p => p.name.toLowerCase() === cleanName(name).toLowerCase()))
      return socket.emit("error:notice", "Nama tersebut sudah digunakan di room ini.");
    room.players.set(socket.id, {id: socket.id, name: cleanName(name), card: null});
    socket.join(code); socket.data.room = code;
    socket.emit("room:joined", {code, isDealer: false});
    room.message = `${cleanName(name)} bergabung.`;
    broadcast(room);
  });

  socket.on("dealer:deal", () => {
    const room = getRoom(socket);
    if (!room || room.dealer !== socket.id) return socket.emit("error:notice", "Hanya dealer yang dapat membagikan kartu.");
    room.deck = deck();
    for (const player of room.players.values()) player.card = room.deck.pop();
    room.revealed = false;
    room.message = "Kartu telah dibagikan. Dealer dapat membuka semua kartu.";
    broadcast(room);
  });

  socket.on("dealer:reveal", () => {
    const room = getRoom(socket);
    if (!room || room.dealer !== socket.id) return socket.emit("error:notice", "Hanya dealer yang dapat membuka kartu.");
    if (![...room.players.values()].some(p => p.card)) return socket.emit("error:notice", "Bagikan kartu terlebih dahulu.");
    room.revealed = true;
    const best = [...room.players.values()].filter(p => p.card).sort((a,b) => b.card.value-a.card.value)[0];
    room.message = `Semua kartu dibuka. Kartu tertinggi: ${best.name}.`;
    broadcast(room);
  });

  socket.on("dealer:next", () => {
    const room = getRoom(socket);
    if (!room || room.dealer !== socket.id) return socket.emit("error:notice", "Hanya dealer yang dapat memulai ronde baru.");
    room.round++;
    room.revealed = false;
    room.deck = [];
    for (const player of room.players.values()) player.card = null;
    room.message = `Ronde ${room.round}. Dealer dapat membagikan kartu baru.`;
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.dealer === socket.id) {
      const next = room.players.keys().next().value;
      room.dealer = next || null;
      room.message = next ? "Dealer keluar. Peran dealer dialihkan ke pemain berikutnya." : "Room ditutup.";
    }
    if (!room.players.size) rooms.delete(room.code);
    else broadcast(room);
  });
});
function cleanName(value) {
  return String(value || "Pemain").trim().replace(/[<>]/g, "").slice(0, 18) || "Pemain";
}
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Joo Cards running on port ${port}`));
