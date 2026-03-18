require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const presetQuestions = require('./questions');
const drinkingRules = require('./drinking-rules');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);
let supabaseReady = false;

// Check if Supabase tables exist
async function checkSupabase() {
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);
    if (!error) {
      supabaseReady = true;
      console.log('  ✅ Supabase connected');
    } else {
      console.log('  ⚠️  Supabase tables not found - running in local mode');
      console.log('     Run supabase-schema.sql in your Supabase SQL Editor to enable cloud features');
    }
  } catch (e) {
    console.log('  ⚠️  Supabase not configured - running in local mode');
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ===== REST API ENDPOINTS =====

// Pass supabase config to frontend
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseReady,
  });
});

// Get preset questions
app.get('/api/questions/preset', (req, res) => {
  res.json(presetQuestions);
});

// Get community questions from Supabase
app.get('/api/questions/community', async (req, res) => {
  if (!supabaseReady) return res.json([]);
  try {
    const { data, error } = await supabase
      .from('custom_questions')
      .select('*')
      .eq('is_public', true)
      .order('upvotes', { ascending: false })
      .limit(500);
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.json([]);
  }
});

// Submit a question (no auth required - for live gameplay)
app.post('/api/questions/submit', async (req, res) => {
  const { text, author_name, room_code } = req.body;
  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: 'Question must be at least 10 characters' });
  }

  // Save to Supabase if available
  let saved = false;
  if (supabaseReady) {
    try {
      const { error } = await supabase.from('custom_questions').insert({
        text: text.trim(),
        author_name: author_name || 'Anonymous',
        is_public: true,
        category: 'live',
      });
      if (!error) saved = true;
    } catch (e) {
      // Continue even if Supabase save fails
    }
  }

  // If we have a room code, add to that room's live pool
  if (room_code) {
    const room = rooms.get(room_code);
    if (room) {
      room.questionPool.push(text.trim());
    }
  }

  res.json({ success: true, saved });
});

// Get drinking rules
app.get('/api/drinking-rules', (req, res) => {
  res.json(drinkingRules);
});

// ===== IN-MEMORY ROOM STORAGE =====
const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getRandomQuestion(usedQuestions, questionPool) {
  const available = questionPool.filter((_, i) => !usedQuestions.has(i));
  if (available.length === 0) {
    usedQuestions.clear();
    return questionPool[Math.floor(Math.random() * questionPool.length)];
  }
  const idx = Math.floor(Math.random() * available.length);
  const originalIdx = questionPool.indexOf(available[idx]);
  usedQuestions.add(originalIdx);
  return available[idx];
}

function flipCoin() {
  return Math.random() < 0.5 ? 'heads' : 'tails';
}

function getRandomPunishment(type) {
  const pool = drinkingRules[type];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentName = null;

  // ---- CREATE ROOM ----
  socket.on('create-room', ({ name, avatar, mode, intensity, questionSources, customQuestions }) => {
    const code = generateRoomCode();

    // Build question pool based on selected sources
    let questionPool = [];
    if (!questionSources || questionSources.includes('preset')) {
      questionPool = [...presetQuestions];
    }
    if (customQuestions && customQuestions.length > 0) {
      questionPool = questionPool.concat(customQuestions);
    }
    if (questionPool.length === 0) {
      questionPool = [...presetQuestions];
    }

    const room = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name, avatar, score: 0 }],
      state: 'lobby',
      mode: mode || 'classic', // classic or drinking
      intensity: intensity || 'medium',
      questionPool,
      currentTurnIndex: 0,
      roundNumber: 0,
      currentQuestion: null,
      currentAnswer: null,
      usedQuestions: new Set(),
      history: [],
    };
    rooms.set(code, room);
    socket.join(code);
    currentRoom = code;
    currentName = name;
    socket.emit('room-created', { code, players: room.players, you: socket.id, mode: room.mode, intensity: room.intensity });
  });

  // ---- JOIN ROOM ----
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
    socket.emit('room-joined', {
      code: room.code, players: room.players, you: socket.id,
      state: room.state, mode: room.mode, intensity: room.intensity
    });
    socket.to(room.code).emit('player-joined', { players: room.players });

    if (room.state === 'playing') {
      const currentPlayer = room.players[room.currentTurnIndex];
      socket.emit('game-state-sync', {
        players: room.players,
        currentTurnIndex: room.currentTurnIndex,
        currentPlayerName: currentPlayer ? currentPlayer.name : null,
        mode: room.mode,
      });
    }
  });

  // ---- UPDATE ROOM SETTINGS ----
  socket.on('update-settings', ({ mode, intensity, questionSources, customQuestions }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    if (mode) room.mode = mode;
    if (intensity) room.intensity = intensity;

    // Rebuild question pool
    let questionPool = [];
    if (!questionSources || questionSources.includes('preset')) {
      questionPool = [...presetQuestions];
    }
    if (customQuestions && customQuestions.length > 0) {
      questionPool = questionPool.concat(customQuestions);
    }
    if (questionPool.length === 0) {
      questionPool = [...presetQuestions];
    }
    room.questionPool = questionPool;

    io.to(room.code).emit('settings-updated', { mode: room.mode, intensity: room.intensity, questionCount: questionPool.length });
  });

  // ---- ADD COMMUNITY QUESTIONS TO POOL ----
  socket.on('add-community-questions', ({ questions }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    if (questions && questions.length > 0) {
      room.questionPool = room.questionPool.concat(questions);
      io.to(room.code).emit('settings-updated', { mode: room.mode, intensity: room.intensity, questionCount: room.questionPool.length });
    }
  });

  // ---- SUBMIT LIVE QUESTION (any player, during gameplay) ----
  socket.on('submit-live-question', async ({ text }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (!text || text.trim().length < 10) {
      socket.emit('error-msg', 'Question must be at least 10 characters');
      return;
    }

    const cleanText = text.trim();
    const player = room.players.find(p => p.id === socket.id);
    const authorName = player ? player.name : 'Anonymous';

    // Add to room's question pool immediately
    room.questionPool.push(cleanText);

    // Save to Supabase in background
    if (supabaseReady) {
      supabase.from('custom_questions').insert({
        text: cleanText,
        author_name: authorName,
        is_public: true,
        category: 'live',
      }).then(() => {});
    }

    // Notify all players in the room
    io.to(room.code).emit('live-question-added', {
      text: cleanText,
      authorName,
      questionCount: room.questionPool.length,
    });
  });

  // ---- START GAME ----
  socket.on('start-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 3) {
      socket.emit('error-msg', 'Need at least 3 players to start.');
      return;
    }
    room.state = 'playing';
    room.currentTurnIndex = 0;
    room.roundNumber = 0;
    startTurn(room);
  });

  function startTurn(room) {
    room.roundNumber++;
    const question = getRandomQuestion(room.usedQuestions, room.questionPool);
    room.currentQuestion = question;
    room.currentAnswer = null;
    const currentPlayer = room.players[room.currentTurnIndex];
    const whispererIndex = (room.currentTurnIndex - 1 + room.players.length) % room.players.length;
    const whisperer = room.players[whispererIndex];

    // Check for bonus drinking challenges
    let bonusChallenge = null;
    if (room.mode === 'drinking') {
      if (room.roundNumber % 10 === 0) {
        bonusChallenge = drinkingRules.challenges.find(c => c.trigger === 'every10rounds');
      } else if (room.roundNumber % 5 === 0) {
        bonusChallenge = drinkingRules.challenges.find(c => c.trigger === 'every5rounds');
      } else if (Math.random() < 0.1) {
        const randoms = drinkingRules.challenges.filter(c => c.trigger === 'random');
        bonusChallenge = randoms[Math.floor(Math.random() * randoms.length)];
      }
    }

    // Send question to current player
    io.to(currentPlayer.id).emit('your-turn', {
      question, players: room.players, you: currentPlayer.id,
      mode: room.mode, roundNumber: room.roundNumber, bonusChallenge
    });

    // Send question to whisperer
    io.to(whisperer.id).emit('you-are-whisperer', {
      question, askerName: currentPlayer.name,
      mode: room.mode, roundNumber: room.roundNumber, bonusChallenge
    });

    // Tell others to wait
    room.players.forEach(p => {
      if (p.id !== currentPlayer.id && p.id !== whisperer.id) {
        io.to(p.id).emit('waiting-for-pick', {
          currentPlayerName: currentPlayer.name,
          whispererName: whisperer.name,
          players: room.players,
          mode: room.mode,
          roundNumber: room.roundNumber,
          bonusChallenge,
        });
      }
    });
  }

  // ---- PICK PLAYER ----
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

    // Get drinking punishment
    let punishment = null;
    if (room.mode === 'drinking') {
      if (coinResult === 'heads') {
        punishment = getRandomPunishment('revealed');
      } else {
        punishment = getRandomPunishment('secret');
      }
    }

    const historyEntry = {
      whisperer: whisperer.name,
      answerer: currentPlayer.name,
      picked: pickedPlayer.name,
      question: room.currentQuestion,
      revealed: coinResult === 'heads',
      coin: coinResult,
      punishment,
      round: room.roundNumber,
    };
    room.history.push(historyEntry);

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
      mode: room.mode,
      punishment,
      roundNumber: room.roundNumber,
    });
  });

  // ---- NEXT TURN ----
  socket.on('next-turn', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    startTurn(room);
  });

  // ---- SKIP QUESTION ----
  socket.on('skip-question', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const currentPlayer = room.players[room.currentTurnIndex];
    if (currentPlayer.id !== socket.id) return;
    const question = getRandomQuestion(room.usedQuestions, room.questionPool);
    room.currentQuestion = question;
    const whispererIndex = (room.currentTurnIndex - 1 + room.players.length) % room.players.length;
    const whisperer = room.players[whispererIndex];
    io.to(currentPlayer.id).emit('your-turn', { question, players: room.players, you: currentPlayer.id, mode: room.mode, roundNumber: room.roundNumber });
    io.to(whisperer.id).emit('you-are-whisperer', { question, askerName: currentPlayer.name, mode: room.mode, roundNumber: room.roundNumber });
  });

  // ---- KICK PLAYER ----
  socket.on('kick-player', ({ playerId }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx === -1 || playerId === socket.id) return;
    room.players.splice(idx, 1);
    io.to(playerId).emit('kicked');
    io.to(room.code).emit('player-joined', { players: room.players });
    if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;
  });

  // ---- END GAME ----
  socket.on('end-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    // Log to Supabase if available
    if (supabaseReady) {
      supabase.from('game_history').insert({
        room_code: room.code,
        player_count: room.players.length,
        rounds_played: room.roundNumber,
        mode: room.mode,
      }).then(() => {});
    }

    room.state = 'lobby';
    room.currentTurnIndex = 0;
    room.currentQuestion = null;
    room.currentAnswer = null;
    room.roundNumber = 0;
    room.players.forEach(p => p.score = 0);
    room.history = [];
    io.to(room.code).emit('game-ended', { players: room.players });
  });

  // ---- DISCONNECT ----
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

    if (room.host === socket.id) {
      room.host = room.players[0].id;
      io.to(room.players[0].id).emit('you-are-host');
    }

    if (room.currentTurnIndex >= room.players.length) room.currentTurnIndex = 0;
    io.to(room.code).emit('player-left', { players: room.players, leftName: currentName });

    if (room.state === 'playing' && room.players.length >= 3) {
      startTurn(room);
    } else if (room.state === 'playing' && room.players.length < 3) {
      room.state = 'lobby';
      io.to(room.code).emit('game-ended', { players: room.players, reason: 'Not enough players' });
    }
  });
});

const PORT = 4001;
checkSupabase().then(() => {
  server.listen(PORT, () => {
    console.log(`\n  🎲 PARANOIA is live at http://localhost:${PORT}\n`);
  });
});
