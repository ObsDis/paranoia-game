const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const questions = require('./questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory room storage
const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getRandomQuestion(usedQuestions) {
  const available = questions.filter((_, i) => !usedQuestions.has(i));
  if (available.length === 0) {
    usedQuestions.clear();
    return questions[Math.floor(Math.random() * questions.length)];
  }
  const idx = Math.floor(Math.random() * available.length);
  const originalIdx = questions.indexOf(available[idx]);
  usedQuestions.add(originalIdx);
  return available[idx];
}

function flipCoin() {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentName = null;

  socket.on('create-room', ({ name, avatar }) => {
    const code = generateRoomCode();
    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name, avatar, score: 0 }],
      state: 'lobby', // lobby, playing
      currentTurnIndex: 0,
      currentQuestion: null,
      currentAnswer: null,
      usedQuestions: new Set(),
      history: [],
    };
    rooms.set(code, room);
    socket.join(code);
    currentRoom = code;
    currentName = name;
    socket.emit('room-created', { code, players: room.players, you: socket.id });
  });

  socket.on('join-room', ({ code, name, avatar }) => {
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      socket.emit('error-msg', 'Room not found. Check the code and try again.');
      return;
    }
    if (room.players.find(p => p.name.toLowerCase() === name.toLowerCase())) {
      socket.emit('error-msg', 'That name is already taken in this room.');
      return;
    }
    if (room.players.length >= 20) {
      socket.emit('error-msg', 'Room is full (max 20 players).');
      return;
    }
    room.players.push({ id: socket.id, name, avatar, score: 0 });
    socket.join(code.toUpperCase());
    currentRoom = code.toUpperCase();
    currentName = name;
    socket.emit('room-joined', { code: room.code, players: room.players, you: socket.id, state: room.state });
    socket.to(room.code).emit('player-joined', { players: room.players });

    // If game is already in progress, sync the new player
    if (room.state === 'playing') {
      const currentPlayer = room.players[room.currentTurnIndex];
      socket.emit('game-state-sync', {
        players: room.players,
        currentTurnIndex: room.currentTurnIndex,
        currentPlayerName: currentPlayer ? currentPlayer.name : null,
        phase: room.currentQuestion ? 'waiting-for-pick' : 'turn-start',
      });
    }
  });

  socket.on('start-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 3) {
      socket.emit('error-msg', 'Need at least 3 players to start.');
      return;
    }
    room.state = 'playing';
    room.currentTurnIndex = 0;
    startTurn(room);
  });

  function startTurn(room) {
    const question = getRandomQuestion(room.usedQuestions);
    room.currentQuestion = question;
    room.currentAnswer = null;
    const currentPlayer = room.players[room.currentTurnIndex];
    // Determine the "whisperer" - the person before the current player in the circle
    const whispererIndex = (room.currentTurnIndex - 1 + room.players.length) % room.players.length;
    const whisperer = room.players[whispererIndex];

    // Send question only to the current player (the one who answers)
    io.to(currentPlayer.id).emit('your-turn', { question, players: room.players, you: currentPlayer.id });

    // Tell whisperer they're the one asking
    io.to(whisperer.id).emit('you-are-whisperer', { question, askerName: currentPlayer.name });

    // Tell everyone else to wait
    room.players.forEach(p => {
      if (p.id !== currentPlayer.id && p.id !== whisperer.id) {
        io.to(p.id).emit('waiting-for-pick', {
          currentPlayerName: currentPlayer.name,
          whispererName: whisperer.name,
          players: room.players,
        });
      }
    });
  }

  socket.on('pick-player', ({ pickedId }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.id !== socket.id) return;

    const pickedPlayer = room.players.find(p => p.id === pickedId);
    if (!pickedPlayer) return;

    room.currentAnswer = pickedId;
    const coinResult = flipCoin();
    const whispererIndex = (room.currentTurnIndex - 1 + room.players.length) % room.players.length;
    const whisperer = room.players[whispererIndex];

    const historyEntry = {
      whisperer: whisperer.name,
      answerer: currentPlayer.name,
      picked: pickedPlayer.name,
      question: room.currentQuestion,
      revealed: coinResult === 'heads',
      coin: coinResult,
    };
    room.history.push(historyEntry);

    // Update score for picked player
    pickedPlayer.score = (pickedPlayer.score || 0) + 1;

    io.to(room.code).emit('coin-flip', {
      answererName: currentPlayer.name,
      whispererName: whisperer.name,
      pickedName: pickedPlayer.name,
      pickedId: pickedId,
      coinResult,
      question: coinResult === 'heads' ? room.currentQuestion : null,
      players: room.players,
      history: room.history,
    });
  });

  socket.on('next-turn', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    startTurn(room);
  });

  socket.on('skip-question', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.id !== socket.id) return;
    // Give a new question
    const question = getRandomQuestion(room.usedQuestions);
    room.currentQuestion = question;
    const whispererIndex = (room.currentTurnIndex - 1 + room.players.length) % room.players.length;
    const whisperer = room.players[whispererIndex];
    io.to(currentPlayer.id).emit('your-turn', { question, players: room.players, you: currentPlayer.id });
    io.to(whisperer.id).emit('you-are-whisperer', { question, askerName: currentPlayer.name });
  });

  socket.on('kick-player', ({ playerId }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx === -1 || playerId === socket.id) return;
    room.players.splice(idx, 1);
    io.to(playerId).emit('kicked');
    io.to(room.code).emit('player-joined', { players: room.players });
    if (room.currentTurnIndex >= room.players.length) {
      room.currentTurnIndex = 0;
    }
  });

  socket.on('end-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    room.state = 'lobby';
    room.currentTurnIndex = 0;
    room.currentQuestion = null;
    room.currentAnswer = null;
    room.players.forEach(p => p.score = 0);
    room.history = [];
    io.to(room.code).emit('game-ended', { players: room.players });
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx === -1) return;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      rooms.delete(currentRoom);
      return;
    }

    // Transfer host if host left
    if (room.host === socket.id) {
      room.host = room.players[0].id;
      io.to(room.players[0].id).emit('you-are-host');
    }

    if (room.currentTurnIndex >= room.players.length) {
      room.currentTurnIndex = 0;
    }

    io.to(room.code).emit('player-left', { players: room.players, leftName: currentName });

    // If game was in progress and it's the disconnected player's turn, advance
    if (room.state === 'playing' && room.players.length >= 3) {
      startTurn(room);
    } else if (room.state === 'playing' && room.players.length < 3) {
      room.state = 'lobby';
      io.to(room.code).emit('game-ended', { players: room.players, reason: 'Not enough players' });
    }
  });
});

const PORT = 4001;
server.listen(PORT, () => {
  console.log(`\n  🎲 PARANOIA is live at http://localhost:${PORT}\n`);
});
