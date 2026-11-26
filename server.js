
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

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const VALUES = Object.fromEntries(
  RANKS.map((rank, index) => [rank, index + 2])
);

const HAND_NAMES = [
  "High Card", "One Pair", "Two Pair",
  "Three of a Kind", "Straight", "Flush",
  "Full House", "Four of a Kind",
  "Straight Flush", "Royal Flush"
];

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
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function combinations(cards, size) {
  const result = [];

  function build(start, selected) {
    if (selected.length === size) {
      result.push(selected);
      return;
    }

    for (let i = start; i < cards.length; i++) {
      build(i + 1, [...selected, cards[i]]);
    }
  }

  build(0, []);
  return result;
}

function evaluateFive(cards) {
  const values = cards.map(card => VALUES[card.rank])
    .sort((a, b) => b - a);

  const counts = {};

  values.forEach(value => {
    counts[value] = (counts[value] || 0) + 1;
  });

  const groups = Object.entries(counts)
    .map(([value, count]) => ({
      value: Number(value),
      count
    }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const flush = cards.every(
    card => card.suit === cards[0].suit
  );

  const unique = [...new Set(values)];
  let straight = 0;

  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      straight = unique[0];
    } else if (unique.join(",") === "14,5,4,3,2") {
      straight = 5;
    }
  }

  if (flush && straight === 14) {
    return { score: [9, 14], name: HAND_NAMES[9] };
  }

  if (flush && straight) {
    return { score: [8, straight], name: HAND_NAMES[8] };
  }

  if (groups[0].count === 4) {
    return {
      score: [7, groups[0].value, groups[1].value],
      name: HAND_NAMES[7]
    };
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return {
      score: [6, groups[0].value, groups[1].value],
      name: HAND_NAMES[6]
    };
  }

  if (flush) {
    return { score: [5, ...values], name: HAND_NAMES[5] };
  }

  if (straight) {
    return { score: [4, straight], name: HAND_NAMES[4] };
  }

  if (groups[0].count === 3) {
    const kickers = groups.slice(1)
      .map(group => group.value)
      .sort((a, b) => b - a);

    return {
      score: [3, groups[0].value, ...kickers],
      name: HAND_NAMES[3]
    };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups.filter(group => group.count === 2)
      .map(group => group.value)
      .sort((a, b) => b - a);

    const kicker = groups.find(group => group.count === 1).value;

    return {
      score: [2, ...pairs, kicker],
      name: HAND_NAMES[2]
    };
  }

  if (groups[0].count === 2) {
    const kickers = groups.filter(group => group.count === 1)
      .map(group => group.value)
      .sort((a, b) => b - a);

    return {
      score: [1, groups[0].value, ...kickers],
      name: HAND_NAMES[1]
    };
  }

  return { score: [0, ...values], name: HAND_NAMES[0] };
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const first = a[i] || 0;
    const second = b[i] || 0;

    if (first > second) return 1;
    if (first < second) return -1;
  }

  return 0;
}

function evaluateSeven(cards) {
  let best = null;

  for (const hand of combinations(cards, 5)) {
    const result = evaluateFive(hand);

    if (!best || compareScores(result.score, best.score) > 0) {
      best = result;
    }
  }

  return best;
}

function activePlayers(room) {
  return room.players.filter(
    player => !player.folded && player.hand.length === 2
  );
}

function nextActiveIndex(room, fromIndex) {
  for (let step = 1; step <= room.players.length; step++) {
    const index = (fromIndex + step) % room.players.length;
    const player = room.players[index];

    if (player && !player.folded && player.hand.length === 2) {
      return index;
    }
  }

  return -1;
}

function calculateResults(room) {
  const evaluated = activePlayers(room).map(player => {
    const result = evaluateSeven([
      ...player.hand,
      ...room.community
    ]);

    return {
      id: player.id,
      name: player.name,
      handName: result.name,
      score: result.score
    };
  });

  evaluated.sort((a, b) => compareScores(b.score, a.score));

  const bestScore = evaluated[0].score;

  const winners = evaluated.filter(player =>
    compareScores(player.score, bestScore) === 0
  );

  const winnerIds = new Set(winners.map(player => player.id));

  return {
    winnerNames: winners.map(player => player.name),
    players: evaluated.map(player => ({
      id: player.id,
      name: player.name,
      handName: player.handName,
      winner: winnerIds.has(player.id)
    }))
  };
}

function finishWithOnePlayer(room) {
  const remaining = activePlayers(room);

  if (remaining.length !== 1) return false;

  const winner = remaining[0];

  room.results = {
    winnerNames: [winner.name],
    players: [{
      id: winner.id,
      name: winner.name,
      handName: "Menang karena pemain lain fold",
      winner: true
    }]
  };

  room.stage = "showdown";
  room.currentPlayerId = null;
  room.message = winner.name + " menjadi pemenang!";

  return true;
}

function beginStreet(room, stage) {
  room.stage = stage;
  room.acted = [];

  const dealerIndex = room.players.findIndex(
    player => player.id === room.dealerId
  );

  const firstIndex = nextActiveIndex(room, dealerIndex);

  room.currentPlayerId = firstIndex >= 0
    ? room.players[firstIndex].id
    : null;

  room.message = stage.toUpperCase() + ": giliran pemain dimulai.";
}

function advanceStreet(room) {
  if (finishWithOnePlayer(room)) return;

  const stages = {
    preflop: "flop",
    flop: "turn",
    turn: "river",
    river: "showdown"
  };

  const nextStage = stages[room.stage];

  if (nextStage === "showdown") {
    room.results = calculateResults(room);
    room.stage = "showdown";
    room.currentPlayerId = null;
    room.message = "Showdown selesai. Pemenang ditentukan!";
    return;
  }

  room.deck.pop();

  if (nextStage === "flop") {
    room.community.push(
      room.deck.pop(),
      room.deck.pop(),
      room.deck.pop()
    );
  } else {
    room.community.push(room.deck.pop());
  }

  beginStreet(room, nextStage);
}

function processAction(room, player, action) {
  if (room.stage === "waiting" || room.stage === "showdown") {
    return "Ronde tidak sedang berlangsung.";
  }

  if (room.currentPlayerId !== player.id) {
    return "Belum giliranmu.";
  }

  if (player.folded) {
    return "Kamu sudah fold.";
  }

  if (action === "fold") {
    player.folded = true;
    room.message = player.name + " memilih FOLD.";
  } else {
    room.message = player.name + " memilih CHECK.";
  }

  room.acted.push(player.id);

  if (finishWithOnePlayer(room)) return null;

  const active = activePlayers(room);
  const allActed = active.every(
    item => room.acted.includes(item.id)
  );

  if (allActed) {
    advanceStreet(room);
    return null;
  }

  const currentIndex = room.players.findIndex(
    item => item.id === player.id
  );

  const nextIndex = nextActiveIndex(room, currentIndex);

  room.currentPlayerId = nextIndex >= 0
    ? room.players[nextIndex].id
    : null;

  return null;
}

function sendUpdate(room) {
  io.to(room.code).emit("room:update", {
    round: room.round,
    stage: room.stage,
    message: room.message,
    community: room.community,
    results: room.results,
    currentPlayerId: room.currentPlayerId,

    players: room.players.map(player => {
      const result = room.results?.players.find(
        item => item.id === player.id
      );

      return {
        id: player.id,
        name: player.name,
        isDealer: player.id === room.dealerId,
        hasHand: player.hand.length === 2,
        folded: !!player.folded,
        acted: room.acted.includes(player.id),
        isTurn: player.id === room.currentPlayerId,
        publicHand: room.stage === "showdown"
          ? player.hand
          : null,
        handName: result?.handName || null
      };
    })
  });

  room.players.forEach(player => {
    io.to(player.id).emit("hand:update", player.hand);
  });
}

function resetRound(room) {
  room.stage = "waiting";
  room.deck = [];
  room.community = [];
  room.results = null;
  room.currentPlayerId = null;
  room.acted = [];

  room.players.forEach(player => {
    player.hand = [];
    player.folded = false;
  });
}

function removePlayer(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  socket.data.roomCode = null;
  socket.leave(code);

  const room = rooms.get(code);
  if (!room) return;

  const wasDealer = room.dealerId === socket.id;

  room.players = room.players.filter(
    player => player.id !== socket.id
  );

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (wasDealer) {
    room.dealerId = room.players[0].id;
  }

  if (room.stage !== "waiting") {
    resetRound(room);
    room.message = "Pemain keluar. Ronde diatur ulang.";
  } else {
    room.message = "Pemain meninggalkan room.";
  }

  sendUpdate(room);
}

function dealerRoom(socket) {
  const room = rooms.get(socket.data.roomCode);

  if (!room || room.dealerId !== socket.id) {
    socket.emit("error:notice", "Hanya dealer yang dapat melakukan ini.");
    return null;
  }

  return room;
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
        hand: [],
        folded: false
      }],
      round: 1,
      stage: "waiting",
      deck: [],
      community: [],
      results: null,
      currentPlayerId: null,
      acted: [],
      message: "Room dibuat. Menunggu pemain lain."
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit("room:joined", {
      code,
      isDealer: true
    });

    if (typeof callback === "function") {
      callback({ ok: true });
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
      socket.emit("error:notice", "Room sudah penuh.");
      if (typeof callback === "function") callback({ ok: false });
      return;
    }

    if (room.stage !== "waiting") {
      socket.emit("error:notice", "Ronde sedang berlangsung.");
      if (typeof callback === "function") callback({ ok: false });
      return;
    }

    removePlayer(socket);

    const player = {
      id: socket.id,
      name: String(data.name || "Pemain").trim().slice(0, 18) || "Pemain",
      hand: [],
      folded: false
    };

    room.players.push(player);

    socket.join(code);
    socket.data.roomCode = code;

    room.message = player.name + " bergabung ke room.";

    socket.emit("room:joined", {
      code,
      isDealer: false
    });

    if (typeof callback === "function") {
      callback({ ok: true });
    }

    sendUpdate(room);
  });

  socket.on("dealer:deal", () => {
    const room = dealerRoom(socket);
    if (!room || room.stage !== "waiting") return;

    if (room.players.length < 2) {
      socket.emit("error:notice", "Minimal 2 pemain diperlukan.");
      return;
    }

    room.deck = makeDeck();
    room.community = [];
    room.results = null;
    room.acted = [];

    room.players.forEach(player => {
      player.folded = false;
      player.hand = [
        room.deck.pop(),
        room.deck.pop()
      ];
    });

    beginStreet(room, "preflop");
    sendUpdate(room);
  });

  socket.on("player:check", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;

    const player = room.players.find(
      item => item.id === socket.id
    );

    if (!player) return;

    const error = processAction(room, player, "check");

    if (error) {
      socket.emit("error:notice", error);
      return;
    }

    sendUpdate(room);
  });

  socket.on("player:fold", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;

    const player = room.players.find(
      item => item.id === socket.id
    );

    if (!player) return;

    const error = processAction(room, player, "fold");

    if (error) {
      socket.emit("error:notice", error);
      return;
    }

    sendUpdate(room);
  });

  socket.on("dealer:next", () => {
    const room = dealerRoom(socket);
    if (!room || room.stage !== "showdown") return;

    room.round++;
    resetRound(room);
    room.message = "Ronde baru dimulai.";

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

