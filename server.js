
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
const RANKS = [
  "2", "3", "4", "5", "6", "7",
  "8", "9", "10", "J", "Q", "K", "A"
];

const RANK_VALUE = Object.fromEntries(
  RANKS.map((rank, index) => [rank, index + 2])
);

const HAND_NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
  "Royal Flush"
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
  const output = [];

  function build(start, chosen) {
    if (chosen.length === size) {
      output.push(chosen);
      return;
    }

    for (let i = start; i < cards.length; i++) {
      build(i + 1, [...chosen, cards[i]]);
    }
  }

  build(0, []);
  return output;
}

function evaluateFive(cards) {
  const values = cards
    .map(card => RANK_VALUE[card.rank])
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
    .sort((a, b) =>
      b.count - a.count || b.value - a.value
    );

  const flush = cards.every(card => card.suit === cards[0].suit);

  const unique = [...new Set(values)];
  let straightHigh = 0;

  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      straightHigh = unique[0];
    } else if (
      unique.join(",") === "14,5,4,3,2"
    ) {
      straightHigh = 5;
    }
  }

  if (flush && straightHigh === 14) {
    return { score: [9, 14], name: "Royal Flush" };
  }

  if (flush && straightHigh) {
    return { score: [8, straightHigh], name: HAND_NAMES[8] };
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

  if (straightHigh) {
    return { score: [4, straightHigh], name: HAND_NAMES[4] };
  }

  if (groups[0].count === 3) {
    const kickers = groups
      .slice(1)
      .map(group => group.value)
      .sort((a, b) => b - a);

    return {
      score: [3, groups[0].value, ...kickers],
      name: HAND_NAMES[3]
    };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups
      .filter(group => group.count === 2)
      .map(group => group.value)
      .sort((a, b) => b - a);

    const kicker = groups.find(group => group.count === 1).value;

    return {
      score: [2, ...pairs, kicker],
      name: HAND_NAMES[2]
    };
  }

  if (groups[0].count === 2) {
    const kickers = groups
      .filter(group => group.count === 1)
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
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i++) {
    const first = a[i] || 0;
    const second = b[i] || 0;

    if (first > second) return 1;
    if (first < second) return -1;
  }

  return 0;
}

function evaluateSeven(cards) {
  const allHands = combinations(cards, 5);
  let best = null;

  for (const hand of allHands) {
    const result = evaluateFive(hand);

    if (!best || compareScores(result.score, best.score) > 0) {
      best = result;
    }
  }

  return best;
}

function calculateResults(room) {
  const evaluated = room.players.map(player => {
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

  evaluated.sort((a, b) =>
    compareScores(b.score, a.score)
  );

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

function sendUpdate(room) {
  io.to(room.code).emit("room:update", {
    round: room.round,
    stage: room.stage,
    message: room.message,
    community: room.community,
    results: room.results,
    players: room.players.map(player => {
      const result = room.results?.players.find(
        item => item.id === player.id
      );

      return {
        name: player.name,
        isDealer: player.id === room.dealerId,
        hasHand: player.hand.length === 2,
        publicHand: room.stage === "showdown" ? player.hand : null,
        handName: result?.handName || null
      };
    })
  });

  // Kartu pribadi hanya dikirim kepada pemiliknya,
  // kecuali saat Showdown.
  room.players.forEach(player => {
    io.to(player.id).emit(
      "hand:update",
      room.stage === "showdown" ? player.hand : player.hand
    );
  });
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

  // Jika pemain keluar saat ronde berjalan,
  // ronde harus dimulai ulang agar hasil tidak keliru.
  if (room.stage !== "waiting") {
    room.stage = "waiting";
    room.deck = [];
    room.community = [];
    room.results = null;
    room.players.forEach(player => {
      player.hand = [];
    });
    room.message = "Pemain keluar. Ronde diatur ulang.";
  }

  sendUpdate(room);
}

function dealerRoom(socket) {
  const room = rooms.get(socket.data.roomCode);

  if (!room || room.dealerId !== socket.id) {
    socket.emit(
      "error:notice",
      "Hanya dealer yang dapat melakukan tindakan ini."
    );
    return null;
  }

  return room;
}

io.on("connection", socket => {
  console.log("Pemain terhubung:", socket.id);

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
      stage: "waiting",
      deck: [],
      community: [],
      results: null,
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

    if (room.stage !== "waiting") {
      socket.emit("error:notice", "Ronde sedang berlangsung. Tunggu ronde berikutnya.");
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
    const room = dealerRoom(socket);
    if (!room || room.stage !== "waiting") return;

    if (room.players.length < 2) {
      socket.emit("error:notice", "Minimal 2 pemain diperlukan.");
      return;
    }

    room.deck = makeDeck();
    room.community = [];
    room.results = null;

    room.players.forEach(player => {
      player.hand = [
        room.deck.pop(),
        room.deck.pop()
      ];
    });

    room.stage = "preflop";
    room.message = "Pre-Flop: dua kartu pribadi dibagikan.";

    sendUpdate(room);
  });

  socket.on("dealer:flop", () => {
    const room = dealerRoom(socket);
    if (!room || room.stage !== "preflop") return;

    room.deck.pop();
    room.community.push(
      room.deck.pop(),
      room.deck.pop(),
      room.deck.pop()
    );

    room.stage = "flop";
    room.message = "Flop: tiga kartu community dibuka.";

    sendUpdate(room);
  });

  socket.on("dealer:turn", () => {
    const room = dealerRoom(socket);
    if (!room || room.stage !== "flop") return;

    room.deck.pop();
    room.community.push(room.deck.pop());

    room.stage = "turn";
    room.message = "Turn: kartu community keempat dibuka.";

    sendUpdate(room);
  });

  socket.on("dealer:river", () => {
    const room = dealerRoom(socket);
    if (!room || room.stage !== "turn") return;

    room.deck.pop();
    room.community.push(room.deck.pop());

    room.stage = "river";
    room.message = "River: kartu community kelima dibuka.";

    sendUpdate(room);
  });

  socket.on("dealer:showdown", () => {
    const room = dealerRoom(socket);
    if (!room || room.stage !== "river") return;

    room.results = calculateResults(room);
    room.stage = "showdown";

    room.message = room.results.winnerNames.length > 1
      ? "Showdown selesai. Hasil seri!"
      : "Showdown selesai. Pemenang telah ditentukan!";

    sendUpdate(room);
  });

  socket.on("dealer:next", () => {
    const room = dealerRoom(socket);
    if (!room || room.stage !== "showdown") return;

    room.round++;
    room.stage = "waiting";
    room.deck = [];
    room.community = [];
    room.results = null;

    room.players.forEach(player => {
      player.hand = [];
    });

    room.message = "Ronde baru dimulai. Menunggu pembagian kartu.";

    sendUpdate(room);
  });

  socket.on("disconnect", () => {
    console.log("Pemain terputus:", socket.id);
    removePlayer(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Joo Cards berjalan pada port " + PORT);
});

