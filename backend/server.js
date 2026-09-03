/**
 * SCHOOL APP — BACKEND
 * -----------------------------------------------------------------------
 * Single-file Express server. Everything shared/persistent lives in a
 * JSON file on disk (data/db.json), NOT in the browser. That file is the
 * single source of truth for every authenticated user: if Teacher A
 * edits something, it's written here, and Teacher B/students read the
 * same file on their next request.
 *
 * No native/compiled dependencies (no better-sqlite3 etc.) so this
 * installs cleanly on a phone (Termux) or any minimal host.
 *
 * Run:
 *   cd backend && npm install --prefix ../config  (or copy package.json here)
 *   node server.js
 * -----------------------------------------------------------------------
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// -------------------------------------------------------------------------
// CONFIG
// -------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const DB_PATH = path.join(__dirname, 'data', 'db.json');

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET not set in .env — using a random one that will change on restart (all logins will be invalidated). Set JWT_SECRET in your .env for production.');
}
if (!GEMINI_API_KEY) {
  console.warn('[warn] GEMINI_API_KEY not set — /api/ai/chat will return a clear config error until you set it in .env');
}

// -------------------------------------------------------------------------
// TINY JSON "DATABASE" — central, file-backed, shared by all users.
// Writes are queued so concurrent requests don't corrupt the file.
// -------------------------------------------------------------------------
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: [],
      announcements: [],
      schoolInfo: {
        schoolName: 'Our School',
        welcomeMessage: 'Welcome to the school portal.',
        contactEmail: '',
        editableByTeachers: ['welcomeMessage'] // which schoolInfo keys teachers (not just admin) may edit
      },
      aiConfigs: {},   // { [teacherId]: { aiName, subject, teachingStyle } }
      aiHistory: {}    // { [teacherId]: [ { role, content, ts } ] }
    };
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

let db = loadDB();
let writeQueue = Promise.resolve();
function saveDB() {
  // Serialize writes so two near-simultaneous edits can't clobber each other.
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), (err) => {
      if (err) return reject(err);
      resolve();
    });
  }));
  return writeQueue;
}

// Seed an initial admin account on first run, from .env, so there's a way in.
function seedAdmin() {
  if (db.users.length > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'changeme123';
  const admin = {
    id: crypto.randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'admin',
    name: 'Administrator',
    createdAt: new Date().toISOString()
  };
  db.users.push(admin);
  saveDB();
  console.log(`[seed] Created initial admin account -> username: "${username}"`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`[seed] No ADMIN_PASSWORD set in .env — using default "changeme123". Change this immediately.`);
  }
}
seedAdmin();

// -------------------------------------------------------------------------
// AUTH HELPERS
// -------------------------------------------------------------------------
function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, username: user.username, name: user.name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// Verifies the JWT and attaches req.user. The frontend's claimed role is
// never trusted on its own — this decoded, signed token is the only
// source of truth the backend uses for permission checks below.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authentication token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { sub, role, username, name }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

function publicUser(u) {
  const { passwordHash, ...safe } = u;
  return safe;
}

// -------------------------------------------------------------------------
// AUTH ROUTES
// -------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const user = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

// -------------------------------------------------------------------------
// USER MANAGEMENT (admin only)
// -------------------------------------------------------------------------
app.get('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ users: db.users.map(publicUser) });
});

app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name || !['student', 'teacher', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'username, password, name, and a valid role are required' });
  }
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const newUser = {
    id: crypto.randomUUID(),
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    name,
    createdAt: new Date().toISOString()
  };
  db.users.push(newUser);
  saveDB();
  res.status(201).json({ user: publicUser(newUser) });
});

app.put('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, role, password } = req.body || {};
  if (name) user.name = name;
  if (role && ['student', 'teacher', 'admin'].includes(role)) user.role = role;
  if (password) user.passwordHash = bcrypt.hashSync(password, 10);
  saveDB();
  res.json({ user: publicUser(user) });
});

app.delete('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
  if (req.params.id === req.user.sub) {
    return res.status(400).json({ error: "You can't delete your own account while logged in as it." });
  }
  const before = db.users.length;
  db.users = db.users.filter(u => u.id !== req.params.id);
  if (db.users.length === before) return res.status(404).json({ error: 'User not found' });
  delete db.aiConfigs[req.params.id];
  delete db.aiHistory[req.params.id];
  saveDB();
  res.json({ ok: true });
});

// -------------------------------------------------------------------------
// ANNOUNCEMENTS (school-wide, shared, central)
// -------------------------------------------------------------------------
app.get('/api/announcements', requireAuth, (req, res) => {
  const sorted = [...db.announcements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ announcements: sorted });
});

app.post('/api/announcements', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: 'title and content required' });
  const announcement = {
    id: crypto.randomUUID(),
    title,
    content,
    authorId: req.user.sub,
    authorName: req.user.name,
    createdAt: new Date().toISOString(),
    updatedAt: null
  };
  db.announcements.push(announcement);
  saveDB();
  res.status(201).json({ announcement });
});

app.put('/api/announcements/:id', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const a = db.announcements.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  if (req.user.role !== 'admin' && a.authorId !== req.user.sub) {
    return res.status(403).json({ error: 'You can only edit your own announcements' });
  }
  const { title, content } = req.body || {};
  if (title) a.title = title;
  if (content) a.content = content;
  a.updatedAt = new Date().toISOString();
  saveDB();
  res.json({ announcement: a });
});

app.delete('/api/announcements/:id', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const a = db.announcements.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Announcement not found' });
  if (req.user.role !== 'admin' && a.authorId !== req.user.sub) {
    return res.status(403).json({ error: 'You can only delete your own announcements' });
  }
  db.announcements = db.announcements.filter(x => x.id !== req.params.id);
  saveDB();
  res.json({ ok: true });
});

// -------------------------------------------------------------------------
// SCHOOL INFO (shared, central; admin can edit everything, teachers can
// edit only the fields listed in schoolInfo.editableByTeachers)
// -------------------------------------------------------------------------
app.get('/api/school-info', requireAuth, (req, res) => {
  res.json({ schoolInfo: db.schoolInfo });
});

app.put('/api/school-info', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const updates = req.body || {};
  const editableByTeachers = new Set(db.schoolInfo.editableByTeachers || []);

  for (const key of Object.keys(updates)) {
    if (key === 'editableByTeachers') continue; // only admin can change permissions, handled below
    if (req.user.role !== 'admin' && !editableByTeachers.has(key)) {
      return res.status(403).json({ error: `You are not permitted to edit "${key}"` });
    }
  }
  Object.assign(db.schoolInfo, updates);
  if (req.user.role === 'admin' && Array.isArray(updates.editableByTeachers)) {
    db.schoolInfo.editableByTeachers = updates.editableByTeachers;
  }
  saveDB();
  res.json({ schoolInfo: db.schoolInfo });
});

// -------------------------------------------------------------------------
// TEACHER AI — per-teacher config + history, strictly scoped to req.user.sub
// -------------------------------------------------------------------------
app.get('/api/ai/config', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const config = db.aiConfigs[req.user.sub] || {
    aiName: `${req.user.name}'s Teaching Assistant`,
    subject: '',
    teachingStyle: 'Clear and practical'
  };
  res.json({ config });
});

app.put('/api/ai/config', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  const { aiName, subject, teachingStyle } = req.body || {};
  const existing = db.aiConfigs[req.user.sub] || {};
  db.aiConfigs[req.user.sub] = {
    aiName: aiName ?? existing.aiName ?? `${req.user.name}'s Teaching Assistant`,
    subject: subject ?? existing.subject ?? '',
    teachingStyle: teachingStyle ?? existing.teachingStyle ?? 'Clear and practical'
  };
  saveDB();
  res.json({ config: db.aiConfigs[req.user.sub] });
});

app.get('/api/ai/history', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  res.json({ history: db.aiHistory[req.user.sub] || [] });
});

app.delete('/api/ai/history', requireAuth, requireRole('teacher', 'admin'), (req, res) => {
  db.aiHistory[req.user.sub] = [];
  saveDB();
  res.json({ ok: true });
});

app.post('/api/ai/chat', requireAuth, requireRole('teacher', 'admin'), async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });

  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not configured on the server. Add it to backend/.env (see .env.example) and restart the server.'
    });
  }

  const config = db.aiConfigs[req.user.sub] || {
    aiName: `${req.user.name}'s Teaching Assistant`,
    subject: '',
    teachingStyle: 'Clear and practical'
  };

  const history = db.aiHistory[req.user.sub] || [];
  history.push({ role: 'user', content: message, ts: new Date().toISOString() });

  const systemPreamble =
    `You are "${config.aiName}", an AI teaching assistant for a teacher named ${req.user.name}` +
    (config.subject ? ` who teaches ${config.subject}` : '') +
    `. Teaching style to follow: ${config.teachingStyle}. ` +
    `You help with lesson planning, explaining topics, creating questions/worksheets, ` +
    `summarizing material, and generating classroom activity ideas. ` +
    `You are an educational assistant, not a human, and should never claim to be one.`;

  // Build a short rolling context from recent history (kept small for a mobile-scale app).
  const recent = history.slice(-10);
  const contents = [
    { role: 'user', parts: [{ text: systemPreamble }] },
    { role: 'model', parts: [{ text: 'Understood. I will follow that role for this conversation.' }] },
    ...recent.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }))
  ];

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[gemini error]', geminiRes.status, errText);
      return res.status(502).json({ error: 'The AI service returned an error. Check server logs / your Gemini API key.' });
    }

    const data = await geminiRes.json();
    const replyText =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ||
      "I couldn't generate a response for that — could you rephrase?";

    history.push({ role: 'assistant', content: replyText, ts: new Date().toISOString() });
    db.aiHistory[req.user.sub] = history;
    saveDB();

    res.json({ reply: replyText });
  } catch (err) {
    console.error('[gemini fetch failed]', err);
    res.status(502).json({ error: 'Could not reach the AI service. Check server network access and API key.' });
  }
});

// -------------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`School app backend listening on http://localhost:${PORT}`);
});
