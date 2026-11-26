 

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.json({ limit: "250kb" }));
app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "Joo Cards" });
});

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const VALUES = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

const HAND_NAMES = [
  "High Card", "One Pair", "Two Pair", "Three of a Kind",
  "Straight", "Flush", "Full House", "Four of a Kind",
  "Straight Flush", "Royal Flush"
];

function cleanName(name) {
  return String(name || "Pemain").trim().slice(0, 18) || "Pemain";
}

function cleanAvatar(avatar) {
  if (!avatar) return null;
  const value = String(avatar);
  if (value.length > 180000) return null;

  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
    ? value
    : null;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function makeDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

/* =========================
   HAND EVALUATION
========================= */

function combinations(cards, size) {
  const out = [];

  function walk(start, picked) {
    if (picked.length === size) {
      out.push(picked);
      return;
    }

    for (let i = start; i < cards.length; i++) {
      walk(i + 1, [...picked, cards[i]]);
    }
  }

  walk(0, []);
  return out;
}

function evaluateFive(cards) {
  const values = cards
    .map(c => VALUES[c.rank])
    .sort((a, b) => b - a);

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
      .map(g => g.value)
      .sort((a, b) => b - a);

    return {
      score: [3, groups[0].value, ...kickers],
      name: HAND_NAMES[3]
    };
  }

  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairs = groups
      .filter(g => g.count === 2)
      .map(g => g.value)
      .sort((a, b) => b - a);

    const kicker = groups.find(g => g.count === 1).value;

    return {
      score: [2, ...pairs, kicker],
      name: HAND_NAMES[2]
    };
  }

  if (groups[0].count === 2) {
    const kickers = groups
      .filter(g => g.count === 1)
      .map(g => g.value)
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
    const x = a[i] || 0;
    const y = b[i] || 0;

    if (x !== y) return x > y ? 1 : -1;
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

/* =========================
   PLAYER HELPERS
========================= */

function findPlayer(room, id) {
  return room.players.find(p => p.id === id);
}

function activePlayers(room) {
  return room.players.filter(p => !p.folded && p.hand.length === 2);
}

function actionablePlayers(room) {
  return activePlayers(room).filter(p => p.chips > 0);
}

function pay(player, amount) {
  const paid = Math.min(player.chips, Math.max(0, amount));

  player.chips -= paid;
  player.streetBet += paid;
  player.totalBet += paid;

  return paid;
}

function nextPlayer(room, fromIndex, allowedIds) {
  if (!allowedIds.size) return null;

  for (let step = 1; step <= room.players.length; step++) {
    const index = (fromIndex + step) % room.players.length;
    const player = room.players[index];

    if (player && allowedIds.has(player.id)) {
      return player;
    }
  }

  return null;
}

function firstActor(room, allowedIds) {
  const bbIndex = room.players.findIndex(
    p => p.id === room.bigBlindId
  );

  if (bbIndex < 0) {
    return nextPlayer(room, -1, allowedIds);
  }

  const bb = room.players[bbIndex];

  if (bb && allowedIds.has(bb.id)) return bb;

  return nextPlayer(room, bbIndex, allowedIds);
}

function setPending(room, exceptId = null) {
  room.pending = new Set(
    actionablePlayers(room)
      .filter(p => p.id !== exceptId)
      .map(p => p.id)
  );
}

function advanceTurn(room, fromId) {
  const fromIndex = room.players.findIndex(p => p.id === fromId);
  const next = nextPlayer(room, fromIndex, room.pending);

  room.currentPlayerId = next ? next.id : null;
}

function potTotal(room) {
  return room.players.reduce((sum, p) => sum + p.totalBet, 0);
}

/* =========================
   SIDE POT SYSTEM
========================= */

function buildSidePots(room) {
  const levels = [
    ...new Set(
      room.players
        .map(p => p.totalBet)
        .filter(amount => amount > 0)
    )
  ].sort((a, b) => a - b);

  const pots = [];
  let previousLevel = 0;

  for (const level of levels) {
    const contributors = room.players.filter(
      p => p.totalBet >= level
    );

    const amount =
      (level - previousLevel) * contributors.length;

    previousLevel = level;

    if (amount <= 0) continue;

    const eligible = contributors.filter(
      p => !p.folded && p.hand.length === 2
    );

    pots.push({
      type: pots.length === 0 ? "MAIN POT" : "SIDE POT " + pots.length,
      amount,
      cap: level,
      eligibleIds: eligible.map(p => p.id),
      winners: [],
      winnerNames: []
    });
  }

  return pots;
}

function awardSidePots(room) {
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

  const pots = buildSidePots(room);
  const payouts = [];

  for (const pot of pots) {
    const contenders = evaluated.filter(
      player => pot.eligibleIds.includes(player.id)
    );

    if (!contenders.length) continue;

    contenders.sort((a, b) =>
      compareScores(b.score, a.score)
    );

    const bestScore = contenders[0].score;

    const winners = contenders.filter(player =>
      compareScores(player.score, bestScore) === 0
    );

    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount % winners.length;

    winners.forEach(winner => {
      const amount = share + (remainder > 0 ? 1 : 0);

      if (remainder > 0) remainder--;

      const player = findPlayer(room, winner.id);

      if (player) player.chips += amount;

      const existing = payouts.find(item => item.id === winner.id);

      if (existing) {
        existing.amount += amount;
      } else {
        payouts.push({
          id: winner.id,
          name: winner.name,
          amount
        });
      }

      pot.winners.push({
        id: winner.id,
        name: winner.name,
        amount
      });
    });

    pot.winnerNames = winners.map(w => w.name);
  }

  const bestOverall = [...evaluated].sort(
    (a, b) => compareScores(b.score, a.score)
  )[0];

  const overallWinners = bestOverall
    ? evaluated.filter(player =>
        compareScores(player.score, bestOverall.score) === 0
      )
    : [];

  return {
    winnerNames: [...new Set(pots.flatMap(p => p.winnerNames))],

    players: evaluated.map(player => ({
      id: player.id,
      name: player.name,
      handName: player.handName,
      winner: overallWinners.some(w => w.id === player.id)
    })),

    payouts,

    pots: pots.map(pot => ({
      type: pot.type,
      amount: pot.amount,
      cap: pot.cap,
      winnerNames: pot.winnerNames,
      winners: pot.winners
    }))
  };
}

/* =========================
   ROUND FINISH
========================= */

function finishByFold(room) {
  const remaining = activePlayers(room);

  if (remaining.length !== 1) return false;

  const winner = remaining[0];
  const amount = potTotal(room);

  winner.chips += amount;

  room.results = {
    winnerNames: [winner.name],

    players: [{
      id: winner.id,
      name: winner.name,
      handName: "Menang karena pemain lain Fold",
      winner: true
    }],

    payouts: [{
      id: winner.id,
      name: winner.name,
      amount
    }],

    pots: [{
      type: "MAIN POT",
      amount,
      cap: null,
      winnerNames: [winner.name],
      winners: [{
        id: winner.id,
        name: winner.name,
        amount
      }]
    }]
  };

  room.stage = "showdown";
  room.currentPlayerId = null;
  room.pending.clear();
  room.message = winner.name + " memenangkan pot!";

  return true;
}

function finishShowdown(room) {
  room.results = awardSidePots(room);
  room.stage = "showdown";
  room.currentPlayerId = null;
  room.pending.clear();
  room.message = "Showdown selesai!";
}

function dealRemainingBoard(room) {
  while (room.community.length < 5) {
    room.deck.pop();
    room.community.push(room.deck.pop());
  }
}

/* =========================
   STREET MANAGEMENT
========================= */

function beginStreet(room, stage) {
  room.stage = stage;
  room.currentBet = 0;

  room.players.forEach(p => {
    p.streetBet = 0;
  });

  const canAct = actionablePlayers(room);

  setPending(room);

  if (canAct.length <= 1) {
    dealRemainingBoard(room);
    finishShowdown(room);
    return;
  }

  const first = firstActor(room, room.pending);

  room.currentPlayerId = first ? first.id : null;
  room.message = stage.toUpperCase() + " dimulai.";
}

function advanceStreet(room) {
  if (finishByFold(room)) return;

  const nextStage = {
    preflop: "flop",
    flop: "turn",
    turn: "river",
    river: "showdown"
  }[room.stage];

  if (nextStage === "showdown") {
    dealRemainingBoard(room);
    finishShowdown(room);
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

/* =========================
   BIG BLIND OPENING
========================= */

function applyBigBlindOpening(room, player, action) {
  if (!room.openingPending || player.id !== room.bigBlindId) {
    return;
  }

  room.openingPending = false;

  if (action !== "raise" && action !== "allin") {
    return;
  }

  const smallBlind = findPlayer(room, room.smallBlindId);

  if (!smallBlind || smallBlind.folded || smallBlind.chips <= 0) {
    return;
  }

  const due = Math.max(
    0,
    room.currentBet - smallBlind.streetBet
  );

  if (due > 0) {
    const paid = pay(smallBlind, due);

    room.pending.delete(smallBlind.id);

    room.message +=
      " Small Blind otomatis Call " + paid + " chip.";
  }
}

/* =========================
   PLAYER ACTIONS
========================= */

function completeAction(room, player, action, raiseTo) {
  if (room.stage === "waiting" || room.stage === "showdown") {
    return "Ronde tidak sedang berlangsung.";
  }

  if (room.currentPlayerId !== player.id) {
    return "Belum giliranmu.";
  }

  if (player.folded || player.chips <= 0) {
    return "Aksi tidak tersedia.";
  }

  if (!room.pending.has(player.id)) {
    return "Kamu tidak memiliki aksi tersisa.";
  }

  if (action === "fold") {
    player.folded = true;
    room.pending.delete(player.id);
    room.message = player.name + " Fold.";
  }

  else if (action === "check") {
    if (player.streetBet < room.currentBet) {
      return "Belum bisa Check. Kamu harus Call atau Fold.";
    }

    room.pending.delete(player.id);
    room.message = player.name + " Check.";
  }

  else if (action === "call") {
    const due = room.currentBet - player.streetBet;

    if (due <= 0) {
      return "Tidak ada taruhan yang perlu di-Call.";
    }

    const paid = pay(player, due);

    room.pending.delete(player.id);
    room.message = player.name + " Call " + paid + " chip.";
  }

  else if (action === "raise") {
    const target = Math.floor(Number(raiseTo));

    if (!Number.isFinite(target) || target <= room.currentBet) {
      return "Nominal Raise harus lebih besar dari taruhan saat ini.";
    }

    const maximum = player.streetBet + player.chips;

    if (target > maximum) {
      return "Chip tidak mencukupi.";
    }

    const paid = target - player.streetBet;

    pay(player, paid);

    room.currentBet = target;

    // Semua pemain aktif selain raiser harus mendapat giliran lagi.
    setPending(room, player.id);

    room.message =
      player.name + " Raise menjadi " + target + " chip.";
  }

  else if (action === "allin") {
    const target = player.streetBet + player.chips;

    if (player.chips <= 0) {
      return "Chip kamu sudah habis.";
    }

    pay(player, player.chips);

    if (target > room.currentBet) {
      room.currentBet = target;

      // Semua pemain aktif lain harus merespons All-in.
      setPending(room, player.id);
    } else {
      room.pending.delete(player.id);
    }

    room.message = player.name + " All-in!";
  }

  else {
    return "Aksi tidak dikenal.";
  }

  // Big Blind membuka taruhan terlebih dahulu.
  // Jika BB Raise atau All-in, Small Blind otomatis Call.
  applyBigBlindOpening(room, player, action);

  if (finishByFold(room)) return null;

  // Pemain yang All-in tidak perlu bertindak.
  // Jika hanya satu pemain yang masih bisa bertindak,
  // seluruh kartu meja dibuka otomatis.
  if (actionablePlayers(room).length <= 1) {
    dealRemainingBoard(room);
    finishShowdown(room);
    return null;
  }

  if (room.pending.size === 0) {
    advanceStreet(room);
  } else {
    advanceTurn(room, player.id);
  }

  return null;
}

/* =========================
   RESET ROUND
========================= */

function resetRound(room) {
  room.stage = "waiting";
  room.deck = [];
  room.community = [];
  room.results = null;
  room.currentPlayerId = null;
  room.currentBet = 0;
  room.pending = new Set();
  room.openingPending = false;

  room.smallBlindId = null;
  room.bigBlindId = null;

  room.players.forEach(p => {
    p.hand = [];
    p.folded = false;
    p.streetBet = 0;
    p.totalBet = 0;
    p.allIn = false;
  });
}

/* =========================
   ROOM UPDATE
========================= */

function sendUpdate(room) {
  const pot = potTotal(room);

  io.to(room.code).emit("room:update", {
    round: room.round,
    stage: room.stage,
    message: room.message,
    community: room.community,
    results: room.results,
    currentPlayerId: room.currentPlayerId,
    currentBet: room.currentBet,
    pot,
    smallBlindId: room.smallBlindId,
    bigBlindId: room.bigBlindId,
    openingPending: room.openingPending,

    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || null,
      chips: p.chips,
      streetBet: p.streetBet,
      totalBet: p.totalBet,
      folded: p.folded,
      allIn: p.chips === 0 && p.hand.length === 2 && !p.folded,
      isTurn: p.id === room.currentPlayerId,
      isSmallBlind: p.id === room.smallBlindId,
      isBigBlind: p.id === room.bigBlindId,
      hasHand: p.hand.length === 2,
      publicHand: room.stage === "showdown" ? p.hand : null
    }))
  });

  room.players.forEach(p => {
    io.to(p.id).emit("hand:update", p.hand);
  });

  io.to(room.dealerId).emit("dealer:update", {
    code: room.code,
    round: room.round,
    stage: room.stage,

    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || null,
      chips: p.chips,
      topupRequested: p.topupRequested
    }))
  });
}

/* =========================
   PLAYER REMOVAL
========================= */

function removePlayer(socket) {
  const code = socket.data.roomCode;

  if (!code) return;

  socket.data.roomCode = null;
  socket.leave(code);

  const room = rooms.get(code);

  if (!room) return;

  room.players = room.players.filter(p => p.id !== socket.id);

  if (!room.players.length) {
    rooms.delete(code);
    return;
  }

  if (room.stage !== "waiting") {
    resetRound(room);
    room.message = "Pemain keluar. Ronde diatur ulang.";
  }

  sendUpdate(room);
}

function getDealerRoom(socket) {
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

/* =========================
   SOCKET EVENTS
========================= */

io.on("connection", socket => {

  socket.on("room:create", (data = {}, callback) => {
    removePlayer(socket);

    const code = makeCode();

    const room = {
      code,
      dealerId: socket.id,
      players: [],
      round: 1,
      stage: "waiting",
      deck: [],
      community: [],
      results: null,
      currentPlayerId: null,
      currentBet: 0,
      pending: new Set(),
      openingPending: false,
      smallBlindId: null,
      bigBlindId: null,
      blindCursor: 0,
      message: "Dealer telah membuat room. Menunggu pemain."
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

    const fail = message => {
      socket.emit("error:notice", message);

      if (typeof callback === "function") {
        callback({ ok: false });
      }
    };

    if (!room) return fail("Room tidak ditemukan.");
    if (room.players.length >= 6) return fail("Room sudah penuh.");
    if (room.stage !== "waiting") return fail("Ronde sedang berlangsung.");

    removePlayer(socket);

    const player = {
      id: socket.id,
      name: cleanName(data.name),
      avatar: null,
      chips: 10,
      hand: [],
      folded: false,
      streetBet: 0,
      totalBet: 0,
      topupRequested: false
    };

    room.players.push(player);

    socket.join(code);
    socket.data.roomCode = code;

    room.message = player.name + " bergabung.";

    socket.emit("room:joined", {
      code,
      isDealer: false
    });

    if (typeof callback === "function") {
      callback({ ok: true });
    }

    sendUpdate(room);
  });

  socket.on("player:profile", data => {
    const room = rooms.get(socket.data.roomCode);
    const player = room && findPlayer(room, socket.id);

    if (!room || !player) return;

    if (data && typeof data === "object") {
      if (typeof data.name === "string") {
        player.name = cleanName(data.name);
      }

      if (Object.prototype.hasOwnProperty.call(data, "avatar")) {
        player.avatar = cleanAvatar(data.avatar);
      }
    }

    room.message = player.name + " memperbarui profil.";
    sendUpdate(room);
  });

  socket.on("player:rename", name => {
    const room = rooms.get(socket.data.roomCode);
    const player = room && findPlayer(room, socket.id);

    if (!player) return;

    player.name = cleanName(name);
    room.message = player.name + " memperbarui nama.";

    sendUpdate(room);
  });

  socket.on("dealer:start", () => {
    const room = getDealerRoom(socket);

    if (!room || room.stage !== "waiting") return;

    if (room.players.length < 2) {
      socket.emit("error:notice", "Minimal 2 pemain diperlukan.");
      return;
    }

    room.players = room.players.filter(p => p.chips > 0);

    if (room.players.length < 2) {
      socket.emit(
        "error:notice",
        "Minimal 2 pemain dengan chip diperlukan."
      );
      return;
    }

    room.deck = makeDeck();
    room.community = [];
    room.results = null;
    room.currentBet = 0;
    room.pending.clear();

    room.players.forEach(p => {
      p.hand = [room.deck.pop(), room.deck.pop()];
      p.folded = false;
      p.streetBet = 0;
      p.totalBet = 0;
      p.topupRequested = false;
    });

    const count = room.players.length;
    const sbIndex = room.blindCursor % count;
    const bbIndex = (sbIndex + 1) % count;

    const sb = room.players[sbIndex];
    const bb = room.players[bbIndex];

    room.smallBlindId = sb.id;
    room.bigBlindId = bb.id;

    // Tidak ada taruhan wajib dari dealer.
    // Big Blind menentukan taruhan pembuka sendiri.
    room.openingPending = true;

    room.blindCursor = (sbIndex + 1) % count;

    setPending(room);

    room.currentPlayerId = bb.id;
    room.message =
      "Giliran Big Blind " + bb.name +
      " untuk menentukan taruhan pembuka.";

    sendUpdate(room);
  });

  socket.on("player:action", data => {
    const room = rooms.get(socket.data.roomCode);
    const player = room && findPlayer(room, socket.id);

    if (!room || !player) return;

    const error = completeAction(
      room,
      player,
      data?.action,
      data?.raiseTo
    );

    if (error) {
      socket.emit("error:notice", error);
      return;
    }

    sendUpdate(room);
  });

  socket.on("dealer:next", () => {
    const room = getDealerRoom(socket);

    if (!room || room.stage !== "showdown") return;

    room.round++;
    resetRound(room);

    room.message =
      "Ronde " + room.round + ". Menunggu dealer.";

    sendUpdate(room);
  });

  socket.on("player:topup-request", () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room && findPlayer(room, socket.id);

    if (!room || !player) return;

    if (player.chips > 0) {
      socket.emit("error:notice", "Chip kamu belum habis.");
      return;
    }

    player.topupRequested = true;

    io.to(room.dealerId).emit("topup:request", {
      playerId: player.id,
      name: player.name
    });

    socket.emit("topup:waiting");
    sendUpdate(room);
  });

  socket.on("dealer:topup-approve", playerId => {
    const room = getDealerRoom(socket);

    if (!room) return;

    const player = findPlayer(room, playerId);

    if (!player || !player.topupRequested || player.chips > 0) {
      return;
    }

    player.chips = 10;
    player.topupRequested = false;

    io.to(player.id).emit("topup:approved", 10);

    room.message =
      player.name + " menerima 10 chip virtual gratis.";

    sendUpdate(room);
  });

  socket.on("disconnect", () => {
    removePlayer(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Joo Cards berjalan di port " + PORT);
});
