
"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["polling", "websocket"]
});

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [
  "2", "3", "4", "5", "6", "7", "8",
  "9", "10", "J", "Q", "K", "A"
];

function makeDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (let i = 0; i < RANKS.length; i++) {
      deck.push({ rank: RANKS[i], value: i + 2, suit });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function makeCode() {
  let code;

  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));

  return code;
}

function cleanName(value) {
  return String(value || "Player").trim().slice(0, 18) || "Player";
}

function cleanAvatar(value) {
  if (typeof value !== "string") return "";
  if (value.length > 500000) return "";
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(value)) return "";
  return value;
}

function getPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

function alive(room) {
  return room.players.filter(p => !p.folded);
}

function canAct(room) {
  return room.players.filter(p => !p.folded && !p.allIn && p.chips > 0);
}

function potTotal(room) {
  return room.players.reduce((sum, p) => sum + p.totalBet, 0);
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    chips: p.chips,
    bet: p.bet,
    folded: p.folded,
    allIn: p.allIn,
    isAI: !!p.isAI,
    isDealer: false,
    isTurn: false
  };
}

function roomSnapshot(room, viewerId) {
  const viewer = getPlayer(room, viewerId);

  return {
    code: room.code,
    aiMode: room.aiMode,
    difficulty: room.difficulty,
    dealerName: room.aiMode ? "AI DEALER" : "Dealer",
    players: room.players.map(p => ({
      ...publicPlayer(p),
      hand: p.id === viewerId
        ? p.hand
        : (
          room.phase === "showdown" && !p.folded
            ? p.hand
            : []
        )
    })),
    community: room.community,
    pot: potTotal(room),
    currentBet: room.currentBet,
    phase: room.phase,
    round: room.round,
    turnId: room.turnId,
    dealerId: room.dealerId,
    isStarted: room.started,
    viewer: viewer ? {
      id: viewer.id,
      chips: viewer.chips,
      hand: viewer.hand,
      bet: viewer.bet,
      folded: viewer.folded,
      allIn: viewer.allIn
    } : null,
    results: room.results || []
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (!p.isAI) {
      io.to(p.id).emit("room:update", roomSnapshot(room, p.id));
    }
  }

  // Hanya dealer manusia pada room multiplayer yang menerima panel dealer.
  if (!room.aiMode && room.dealerId) {
    io.to(room.dealerId).emit("dealer:update", {
      code: room.code,
      players: room.players.map(publicPlayer),
      phase: room.phase,
      started: room.started,
      aiMode: false
    });
  }
}

function pay(player, amount) {
  amount = Math.max(0, Math.min(player.chips, Math.floor(amount)));

  player.chips -= amount;
  player.bet += amount;
  player.totalBet += amount;

  if (player.chips === 0) player.allIn = true;

  return amount;
}

function nextIndex(room, fromIndex, predicate) {
  const count = room.players.length;

  for (let step = 1; step <= count; step++) {
    const index = (fromIndex + step) % count;

    if (predicate(room.players[index])) return index;
  }

  return -1;
}

function setNextTurn(room, fromIndex) {
  const index = nextIndex(
    room,
    fromIndex,
    p => !p.folded && !p.allIn && p.chips > 0
  );

  room.turnId = index < 0 ? null : room.players[index].id;
}

function resetBets(room) {
  room.currentBet = 0;

  room.players.forEach(p => {
    p.bet = 0;
    p.acted = false;
  });
}

function createPlayer(id, name, isAI = false) {
  return {
    id,
    name,
    avatar: "",
    chips: 10,
    hand: [],
    bet: 0,
    totalBet: 0,
    folded: false,
    allIn: false,
    acted: false,
    isAI
  };
}

function startRound(room) {
  const eligible = room.players.filter(p => p.chips > 0);

  if (eligible.length < 2) {
    const target = room.aiMode ? room.hostId : room.dealerId;
    if (target) io.to(target).emit("toast", "Minimal perlu 2 pemain dengan chip.");
    return;
  }

  room.round++;
  room.started = true;
  room.phase = "preflop";
  room.deck = makeDeck();
  room.community = [];
  room.currentBet = 0;
  room.results = [];

  room.players.forEach(p => {
    p.hand = [];
    p.bet = 0;
    p.totalBet = 0;
    p.folded = p.chips <= 0;
    p.allIn = false;
    p.acted = false;
  });

  const active = room.players.filter(p => !p.folded);

  active.forEach(p => {
    p.hand = [room.deck.pop(), room.deck.pop()];
  });

  // Dealer button berputar di antara pemain yang masih memiliki chip.
  room.dealerIndex = room.dealerIndex % active.length;

  const sbIndex = room.dealerIndex % active.length;
  const bbIndex = (sbIndex + 1) % active.length;

  const sb = active[sbIndex];
  const bb = active[bbIndex];

  pay(sb, 1);
  pay(bb, 2);

  room.currentBet = Math.max(sb.bet, bb.bet);
  room.turnId = bb.id;

  room.dealerIndex = (room.dealerIndex + 1) % active.length;

  broadcast(room);

  if (room.aiMode) scheduleAI(room, 900);
}

function combinations(items, size) {
  const output = [];

  function walk(start, chosen) {
    if (chosen.length === size) {
      output.push(chosen);
      return;
    }

    for (let i = start; i <= items.length - (size - chosen.length); i++) {
      walk(i + 1, [...chosen, items[i]]);
    }
  }

  walk(0, []);
  return output;
}

function scoreFive(cards) {
  const values = cards.map(c => c.value).sort((a, b) => b - a);
  const counts = {};

  values.forEach(v => {
    counts[v] = (counts[v] || 0) + 1;
  });

  const groups = Object.entries(counts)
    .map(([value, count]) => ({
      value: Number(value),
      count
    }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const flush = cards.every(c => c.suit === cards[0].suit);
  const unique = [...new Set(values)].sort((a, b) => b - a);

  let straightHigh = 0;

  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      straightHigh = unique[0];
    } else if (unique.join(",") === "14,5,4,3,2") {
      straightHigh = 5;
    }
  }

  if (flush && straightHigh) return [8, straightHigh];

  if (groups[0].count === 4) {
    return [7, groups[0].value, groups[1].value];
  }

  if (groups[0].count === 3 && groups[1].count === 2) {
    return [6, groups[0].value, groups[1].value];
  }

  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];

  if (groups[0].count === 3) {
    return [3, groups[0].value, ...groups.slice(1).map(g => g.value)];
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    return [
      2,
      Math.max(groups[0].value, groups[1].value),
      Math.min(groups[0].value, groups[1].value),
      groups[2].value
    ];
  }

  if (groups[0].count === 2) {
    return [1, groups[0].value, ...groups.slice(1).map(g => g.value)];
  }

  return [0, ...values];
}

function evaluateHand(cards) {
  const fiveCardSets = combinations(cards, 5);
  let best = null;

  for (const set of fiveCardSets) {
    const score = scoreFive(set);

    if (!best || compareScore(score, best) > 0) {
      best = score;
    }
  }

  return best || [0];
}

function compareScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;

    if (av !== bv) return av > bv ? 1 : -1;
  }

  return 0;
}

function handName(score) {
  return [
    "High Card",
    "One Pair",
    "Two Pair",
    "Three of a Kind",
    "Straight",
    "Flush",
    "Full House",
    "Four of a Kind",
    "Straight Flush"
  ][score[0]] || "Poker";
}

function buildSidePots(room) {
  const levels = [...new Set(
    room.players.map(p => p.totalBet).filter(v => v > 0)
  )].sort((a, b) => a - b);

  let previous = 0;
  const pots = [];

  for (const level of levels) {
    const contributors = room.players.filter(p => p.totalBet >= level);
    const amount = (level - previous) * contributors.length;
    const eligible = contributors.filter(p => !p.folded);

    if (amount > 0 && eligible.length) {
      pots.push({ amount, eligible });
    }

    previous = level;
  }

  return pots;
}

function awardPots(room) {
  const pots = buildSidePots(room);
  const results = [];

  for (const pot of pots) {
    let bestScore = null;
    let winners = [];

    for (const p of pot.eligible) {
      const score = evaluateHand([...p.hand, ...room.community]);

      if (!bestScore || compareScore(score, bestScore) > 0) {
        bestScore = score;
        winners = [p];
      } else if (compareScore(score, bestScore) === 0) {
        winners.push(p);
      }
    }

    if (!winners.length) continue;

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;

    winners.forEach(p => {
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      p.chips += share + extra;
    });

    results.push({
      amount: pot.amount,
      winners: winners.map(p => p.name),
      hand: handName(bestScore)
    });
  }

  room.results = results;
}

function finishRound(room) {
  while (room.community.length < 5) {
    room.community.push(room.deck.pop());
  }

  room.phase = "showdown";
  room.turnId = null;

  awardPots(room);
  broadcast(room);
}

function finishByFold(room) {
  const winner = alive(room)[0];

  if (winner) {
    const amount = potTotal(room);
    winner.chips += amount;

    room.results = [{
      amount,
      winners: [winner.name],
      hand: "Last player standing"
    }];
  }

  room.phase = "showdown";
  room.turnId = null;
  broadcast(room);
}

function advanceStreet(room) {
  const active = alive(room);

  if (active.length <= 1) {
    finishByFold(room);
    return;
  }

  if (room.community.length === 0) {
    room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.phase = "flop";
  } else if (room.community.length === 3) {
    room.community.push(room.deck.pop());
    room.phase = "turn";
  } else if (room.community.length === 4) {
    room.community.push(room.deck.pop());
    room.phase = "river";
  } else {
    finishRound(room);
    return;
  }

  resetBets(room);

  const first = room.players.findIndex(
    p => !p.folded && !p.allIn && p.chips > 0
  );

  room.turnId = first < 0 ? null : room.players[first].id;

  if (!room.turnId) {
    finishRound(room);
    return;
  }

  broadcast(room);

  if (room.aiMode) scheduleAI(room, 850);
}

function bettingComplete(room) {
  const able = canAct(room);

  if (able.length === 0) return true;

  if (able.length === 1) {
    const only = able[0];
    return only.acted || only.bet === room.currentBet;
  }

  return able.every(p => p.acted && p.bet === room.currentBet);
}

function applyAction(room, player, action, amount = 0) {
  if (!player || room.phase === "showdown") return;
  if (room.turnId !== player.id) return;
  if (player.folded || player.allIn) return;

  const index = room.players.indexOf(player);
  const toCall = Math.max(0, room.currentBet - player.bet);

  if (action === "fold") {
    player.folded = true;
    player.acted = true;
  } else if (action === "check") {
    if (toCall > 0) return;
    player.acted = true;
  } else if (action === "call") {
    pay(player, toCall);
    player.acted = true;
  } else if (action === "raise") {
    const target = Math.max(
      room.currentBet + 1,
      Math.floor(Number(amount) || 0)
    );

    const needed = target - player.bet;

    if (needed <= 0 || player.chips <= 0) return;

    const paid = pay(player, needed);

    if (player.bet > room.currentBet) {
      room.currentBet = player.bet;

      room.players.forEach(p => {
        if (p.id !== player.id && !p.folded && !p.allIn) {
          p.acted = false;
        }
      });
    }

    player.acted = true;

    if (paid === 0) return;
  } else if (action === "allin") {
    const oldBet = room.currentBet;

    pay(player, player.chips);

    if (player.bet > oldBet) {
      room.currentBet = player.bet;

      room.players.forEach(p => {
        if (p.id !== player.id && !p.folded && !p.allIn) {
          p.acted = false;
        }
      });
    }

    player.acted = true;
  } else {
    return;
  }

  if (alive(room).length <= 1) {
    finishByFold(room);
    return;
  }

  if (bettingComplete(room)) {
    advanceStreet(room);
    return;
  }

  setNextTurn(room, index);
  broadcast(room);

  if (room.aiMode) scheduleAI(room, 850);
}

function aiDecision(room, bot) {
  const toCall = Math.max(0, room.currentBet - bot.bet);
  const highCard = Math.max(bot.hand[0].value, bot.hand[1].value);
  const pair = bot.hand[0].value === bot.hand[1].value;
  const suited = bot.hand[0].suit === bot.hand[1].suit;
  const difficulty = room.difficulty || "normal";

  const strength =
    (pair ? 4 : 0) +
    (highCard >= 12 ? 2 : 0) +
    (highCard >= 10 ? 1 : 0) +
    (suited ? 1 : 0) +
    (room.community.length >= 3 ? 1 : 0);

  if (toCall === 0) {
    if (strength >= 6 && bot.chips > 2 && Math.random() < 0.2) {
      return {
        action: "raise",
        amount: room.currentBet + 2
      };
    }

    return { action: "check" };
  }

  if (toCall >= bot.chips) {
    return strength >= 5
      ? { action: "allin" }
      : { action: "fold" };
  }

  const callChance = difficulty === "normal"
    ? Math.min(0.9, 0.35 + strength * 0.08)
    : 0.5;

  if (Math.random() > callChance) {
    return { action: "fold" };
  }

  if (strength >= 7 && bot.chips > toCall + 2 && Math.random() < 0.15) {
    return {
      action: "raise",
      amount: room.currentBet + 2
    };
  }

  return { action: "call" };
}

function scheduleAI(room, delay = 900) {
  if (!room.aiMode || room.phase === "showdown" || !room.turnId) return;

  const bot = getPlayer(room, room.turnId);
  if (!bot || !bot.isAI) return;

  const code = room.code;
  const botId = bot.id;

  setTimeout(() => {
    const currentRoom = rooms.get(code);
    if (!currentRoom || currentRoom.turnId !== botId) return;

    const currentBot = getPlayer(currentRoom, botId);
    if (!currentBot || !currentBot.isAI) return;

    const decision = aiDecision(currentRoom, currentBot);

    applyAction(
      currentRoom,
      currentBot,
      decision.action,
      decision.amount
    );
  }, delay);
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (
      room.dealerId === socketId ||
      room.hostId === socketId ||
      room.players.some(p => p.id === socketId)
    ) {
      return room;
    }
  }

  return null;
}

function createRoom(socket, aiMode = false, data = {}) {
  const code = makeCode();

  const room = {
    code,
    // Pada VS AI, dealer adalah sistem AI, bukan socket pemain.
    dealerId: aiMode ? null : socket.id,
    hostId: aiMode ? socket.id : null,
    players: [],
    aiMode,
    difficulty: data?.difficulty || "normal",
    started: false,
    round: 0,
    phase: "waiting",
    deck: [],
    community: [],
    currentBet: 0,
    turnId: null,
    dealerIndex: 0,
    results: []
  };

  if (aiMode) {
    const human = createPlayer(
      socket.id,
      cleanName(data?.name || "Player")
    );

    human.avatar = cleanAvatar(data?.avatar);
    human.isDealer = false;
    room.players.push(human);

    // Empat AI ini adalah pemain, bukan dealer.
    ["Astra", "Bima", "Nara", "Raka"].forEach((name, i) => {
      const bot = createPlayer(`AI_${code}_${i}`, name, true);
      room.players.push(bot);
    });
  }

  rooms.set(code, room);
  socket.join(code);

  socket.emit("room:joined", {
    code,
    isDealer: !aiMode,
    aiMode,
    dealerName: aiMode ? "AI DEALER" : "Dealer"
  });

  broadcast(room);
}

function canManageRound(room, socketId) {
  if (room.aiMode) return room.hostId === socketId;
  return room.dealerId === socketId;
}

io.on("connection", socket => {
  socket.emit("connected", { id: socket.id });

  socket.on("room:create", () => {
    createRoom(socket, false);
  });

  socket.on("room:create-ai", data => {
    createRoom(socket, true, data || {});
  });

  socket.on("room:join", data => {
    const code = String(data?.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit("toast", "Room tidak ditemukan.");
      return;
    }

    if (room.aiMode) {
      socket.emit("toast", "Room VS AI tidak menerima pemain lain.");
      return;
    }

    if (room.started) {
      socket.emit("toast", "Ronde sedang berlangsung.");
      return;
    }

    if (room.players.length >= 8) {
      socket.emit("toast", "Room sudah penuh.");
      return;
    }

    const player = createPlayer(
      socket.id,
      cleanName(data?.name)
    );

    player.avatar = cleanAvatar(data?.avatar);
    room.players.push(player);
    socket.join(code);

    socket.emit("room:joined", {
      code,
      isDealer: false,
      aiMode: false
    });

    broadcast(room);
  });

  socket.on("player:profile", data => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    if (!player) return;

    if (data?.name) player.name = cleanName(data.name);
    if (data?.avatar) player.avatar = cleanAvatar(data.avatar);

    broadcast(room);
  });

  socket.on("player:rename", data => {
    const room = getRoomBySocket(socket.id);
    const player = room && getPlayer(room, socket.id);

    if (!player) return;

    player.name = cleanName(data?.name);
    broadcast(room);
  });

  socket.on("dealer:start", () => {
    const room = getRoomBySocket(socket.id);

    if (!room || !canManageRound(room, socket.id)) return;
    if (room.phase !== "waiting" && room.phase !== "showdown") return;

    startRound(room);
  });

  socket.on("player:action", data => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    if (!player || player.isAI) return;

    applyAction(
      room,
      player,
      String(data?.action || ""),
      Number(data?.amount || 0)
    );
  });

  socket.on("dealer:next", () => {
    const room = getRoomBySocket(socket.id);

    if (!room || !canManageRound(room, socket.id)) return;
    if (room.phase !== "showdown") return;

    room.phase = "waiting";
    room.started = false;
    room.turnId = null;

    room.players.forEach(p => {
      p.hand = [];
      p.bet = 0;
      p.totalBet = 0;
      p.folded = false;
      p.allIn = false;
      p.acted = false;
    });

    room.community = [];
    room.currentBet = 0;
    room.results = [];

    broadcast(room);
  });

  socket.on("player:topup-request", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    const player = getPlayer(room, socket.id);
    if (!player || player.chips > 0) return;

    // Di VS AI, dealer AI menyetujui tambahan chip virtual.
    if (room.aiMode && room.hostId === socket.id) {
      if (room.phase !== "waiting" && room.phase !== "showdown") {
        socket.emit("toast", "Tunggu ronde selesai untuk meminta chip.");
        return;
      }

      player.chips += 10;
      socket.emit("toast", "AI Dealer menyetujui 10 chip virtual.");
      broadcast(room);
      return;
    }

    if (room.dealerId) {
      io.to(room.dealerId).emit("topup:request", {
        id: player.id,
        name: player.name
      });
    }
  });

  socket.on("dealer:topup-approve", data => {
    const room = getRoomBySocket(socket.id);

    if (!room || room.aiMode || room.dealerId !== socket.id) return;

    const player = getPlayer(room, String(data?.id || ""));
    if (!player || player.chips > 0) return;

    player.chips += 10;

    io.to(player.id).emit(
      "toast",
      "10 chip virtual berhasil ditambahkan."
    );

    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    // Dealer manusia keluar dari room multiplayer.
    if (!room.aiMode && room.dealerId === socket.id) {
      rooms.delete(room.code);
      io.to(room.code).emit("room:closed");
      return;
    }

    // Host VS AI keluar, room AI ditutup.
    if (room.aiMode && room.hostId === socket.id) {
      rooms.delete(room.code);
      io.to(room.code).emit("room:closed");
      return;
    }

    const index = room.players.findIndex(p => p.id === socket.id);

    if (index >= 0) {
      room.players.splice(index, 1);

      if (room.started && room.phase !== "showdown") {
        room.players.forEach(p => {
          p.folded = true;
        });

        room.phase = "showdown";
        room.turnId = null;
      }

      if (!room.players.length) {
        rooms.delete(room.code);
      } else {
        broadcast(room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Joo Cards berjalan di port ${PORT}`);
});

