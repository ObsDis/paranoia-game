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
app.set('trust proxy', true); // for getting real IP behind Render's proxy
const server = http.createServer(app);
const io = new Server(server);

// ===== GEO TRACKING =====
const activeUsers = new Map(); // socketId -> { lat, lng, city, country, connectedAt }
const geoCache = new Map(); // ip -> { lat, lng, city, country, ts }

async function lookupGeo(ip) {
  // Skip local/private IPs
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null;
  }
  // Check cache (1 hour TTL)
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.ts < 3600000) return cached;

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,lat,lon,city,country`);
    const data = await res.json();
    if (data.status === 'success') {
      const geo = { lat: data.lat, lng: data.lon, city: data.city || '', country: data.country || '', ts: Date.now() };
      geoCache.set(ip, geo);
      return geo;
    }
  } catch (e) { /* ignore geo failures */ }
  return null;
}

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

// Track page visit
app.post('/api/track-visit', async (req, res) => {
  const { page, referrer, visitor_id } = req.body;
  if (supabaseReady) {
    try {
      await supabase.from('site_visits').insert({
        visitor_id: visitor_id || null,
        page: page || '/',
        referrer: referrer || null,
        user_agent: req.headers['user-agent'] || null,
        ip_hash: crypto.createHash('sha256').update(req.ip || '').digest('hex').substring(0, 16),
      });
    } catch (e) { /* ignore */ }
  }
  res.json({ ok: true });
});

// ===== ACTIVITY LOGGING =====
function logActivity(eventType, data = {}) {
  if (!supabaseReady) return;
  supabase.from('activity_events').insert({
    event_type: eventType,
    player_name: data.playerName || null,
    room_code: data.roomCode || null,
    ip_hash: data.ipHash || null,
    metadata: data.metadata || {},
  }).then(() => {});
}

// ===== ADMIN DASHBOARD =====
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'paranoia-admin';

function requireAdmin(req, res, next) {
  const pw = req.query.pw || req.headers['x-admin-password'];
  if (pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  const metrics = {
    // Real-time from memory
    onlineUsers: io.engine.clientsCount || 0,
    activeRooms: rooms.size,
    activeGames: [...rooms.values()].filter(r => r.state === 'playing').length,
    playersInGames: [...rooms.values()].filter(r => r.state === 'playing').reduce((sum, r) => sum + r.players.length, 0),
    playersInLobbies: [...rooms.values()].filter(r => r.state === 'lobby').reduce((sum, r) => sum + r.players.length, 0),
    totalRoundsActive: [...rooms.values()].reduce((sum, r) => sum + r.roundNumber, 0),

    // Supabase metrics (defaults if not available)
    totalAccounts: 0,
    totalCustomQuestions: 0,
    liveQuestions: 0,
    totalGamesPlayed: 0,
    totalRoundsPlayed: 0,
    visitsToday: 0,
    visitsThisWeek: 0,
    visitsAllTime: 0,
    uniqueVisitorsToday: 0,
    recentQuestions: [],
    users: [],
    visitsByDay: [],
    activeLocations: [...activeUsers.values()],
    roomsCreated: 0,
    gamesStarted: 0,
    uniquePlayersPlayed: 0,
    bounceRate: 0,
  };

  if (!supabaseReady) return res.json(metrics);

  // Each query wrapped individually so one failure doesn't kill the rest
  try {
    const { count: accountCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    metrics.totalAccounts = accountCount || 0;
  } catch (e) { console.error('Admin: profiles query failed:', e.message); }

  try {
    const { count: qCount } = await supabase.from('custom_questions').select('*', { count: 'exact', head: true });
    metrics.totalCustomQuestions = qCount || 0;
  } catch (e) { console.error('Admin: questions count failed:', e.message); }

  try {
    const { count: liveQCount } = await supabase.from('custom_questions').select('*', { count: 'exact', head: true }).eq('category', 'live');
    metrics.liveQuestions = liveQCount || 0;
  } catch (e) {}

  try {
    const { data: gameStats } = await supabase.from('game_history').select('player_count, rounds_played');
    if (gameStats) {
      metrics.totalGamesPlayed = gameStats.length;
      metrics.totalRoundsPlayed = gameStats.reduce((sum, g) => sum + (g.rounds_played || 0), 0);
    }
  } catch (e) {}

  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { count: todayCount } = await supabase.from('site_visits').select('*', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString());
    metrics.visitsToday = todayCount || 0;
    const { data: uniqueToday } = await supabase.from('site_visits').select('ip_hash').gte('created_at', todayStart.toISOString());
    metrics.uniqueVisitorsToday = uniqueToday ? new Set(uniqueToday.map(v => v.ip_hash)).size : 0;
  } catch (e) {}

  try {
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0, 0, 0, 0);
    const { count: weekCount } = await supabase.from('site_visits').select('*', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString());
    metrics.visitsThisWeek = weekCount || 0;
  } catch (e) {}

  try {
    const { count: allCount } = await supabase.from('site_visits').select('*', { count: 'exact', head: true });
    metrics.visitsAllTime = allCount || 0;
  } catch (e) {}

  try {
    const { data: allQ, error: qErr } = await supabase.from('custom_questions').select('id, text, author_name, category, is_public, upvotes, created_at').order('created_at', { ascending: false });
    if (qErr) console.error('Admin: questions fetch error:', qErr.message);
    metrics.recentQuestions = allQ || [];
  } catch (e) { console.error('Admin: questions query failed:', e.message); }

  try {
    const { data: users, error: uErr } = await supabase.rpc('admin_get_users');
    if (uErr) console.error('Admin: users RPC error:', uErr.message);
    metrics.users = users || [];
  } catch (e) { console.error('Admin: users query failed:', e.message); }

  try {
    const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const { data: visitData } = await supabase.from('site_visits').select('created_at').gte('created_at', twoWeeksAgo.toISOString());
    if (visitData) {
      const byDay = {};
      visitData.forEach(v => {
        const day = v.created_at.substring(0, 10);
        byDay[day] = (byDay[day] || 0) + 1;
      });
      metrics.visitsByDay = Object.entries(byDay).sort().map(([date, count]) => ({ date, count }));
    }
  } catch (e) {}

  // Activity metrics
  try {
    const { count: roomCount } = await supabase.from('activity_events').select('*', { count: 'exact', head: true }).eq('event_type', 'room_created');
    metrics.roomsCreated = roomCount || 0;
  } catch (e) {}

  try {
    const { count: gameCount } = await supabase.from('activity_events').select('*', { count: 'exact', head: true }).eq('event_type', 'game_started');
    metrics.gamesStarted = gameCount || 0;
  } catch (e) {}

  try {
    const { data: playerEvents } = await supabase.from('activity_events').select('player_name').eq('event_type', 'player_played');
    metrics.uniquePlayersPlayed = playerEvents ? new Set(playerEvents.map(e => e.player_name)).size : 0;
  } catch (e) {}

  // Bounce rate: visits that never created/joined a room
  try {
    const { count: totalVisitors } = await supabase.from('site_visits').select('*', { count: 'exact', head: true });
    const { count: engagedVisitors } = await supabase.from('activity_events').select('*', { count: 'exact', head: true }).eq('event_type', 'room_created');
    if (totalVisitors && totalVisitors > 0) {
      metrics.bounceRate = Math.round(((totalVisitors - (engagedVisitors || 0)) / totalVisitors) * 100);
    }
  } catch (e) {}

  res.json(metrics);
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

  // Geo-track this connection
  const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
  lookupGeo(clientIp).then(geo => {
    if (geo) {
      activeUsers.set(socket.id, { lat: geo.lat, lng: geo.lng, city: geo.city, country: geo.country, connectedAt: Date.now() });
    }
  });

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
      questionSources: questionSources || ['preset'],
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
    logActivity('room_created', { playerName: name, roomCode: code, ipHash: crypto.createHash('sha256').update(clientIp || '').digest('hex').substring(0, 16) });
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
    if (questionSources) room.questionSources = questionSources;

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
    logActivity('game_started', { roomCode: currentRoom, metadata: { playerCount: room.players.length, mode: room.mode } });
    // Log each player who played
    room.players.forEach(p => {
      logActivity('player_played', { playerName: p.name, roomCode: currentRoom });
    });
  });

  function startTurn(room) {
    room.roundNumber++;
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

    // Check if custom-only mode (whisperer types the question)
    const isCustomOnly = room.questionSources &&
      room.questionSources.includes('custom') &&
      !room.questionSources.includes('preset') &&
      !room.questionSources.includes('community');

    if (isCustomOnly) {
      // Custom mode: whisperer types their own question
      room.currentQuestion = null; // will be set when whisperer submits

      // Tell whisperer to type a question
      io.to(whisperer.id).emit('type-your-question', {
        askerName: currentPlayer.name,
        mode: room.mode,
        roundNumber: room.roundNumber,
        bonusChallenge,
      });

      // Tell asker to wait for the whisperer's question
      io.to(currentPlayer.id).emit('waiting-for-whisper', {
        whispererName: whisperer.name,
        players: room.players,
        you: currentPlayer.id,
        mode: room.mode,
        roundNumber: room.roundNumber,
        bonusChallenge,
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
    } else {
      // Normal mode: pick a random question from the pool
      const question = getRandomQuestion(room.usedQuestions, room.questionPool);
      room.currentQuestion = question;

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
  }

  // ---- WHISPERER SUBMITS CUSTOM QUESTION ----
  socket.on('submit-whisper-question', ({ text }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (!text || text.trim().length < 5) {
      socket.emit('error-msg', 'Question is too short');
      return;
    }

    const whispererIndex = (room.currentTurnIndex - 1 + room.players.length) % room.players.length;
    const whisperer = room.players[whispererIndex];
    if (whisperer.id !== socket.id) return; // only the whisperer can submit

    const question = text.trim();
    room.currentQuestion = question;

    // Save whisper question to Supabase
    if (supabaseReady) {
      supabase.from('custom_questions').insert({
        text: question,
        author_name: whisperer.name,
        is_public: true,
        category: 'live',
      }).then(() => {});
    }

    const currentPlayer = room.players[room.currentTurnIndex];

    // Now send the question to the asker so they can pick
    io.to(currentPlayer.id).emit('your-turn', {
      question,
      players: room.players,
      you: currentPlayer.id,
      mode: room.mode,
      roundNumber: room.roundNumber,
    });

    // Confirm to whisperer that question was sent
    io.to(whisperer.id).emit('you-are-whisperer', {
      question,
      askerName: currentPlayer.name,
      mode: room.mode,
      roundNumber: room.roundNumber,
    });
  });

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
    activeUsers.delete(socket.id);
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
