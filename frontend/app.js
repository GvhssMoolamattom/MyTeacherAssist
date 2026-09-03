/**
 * APP — state, routing, API calls, event wiring.
 *
 * IMPORTANT ARCHITECTURE NOTE:
 * localStorage is used ONLY for: the login session token, and the
 * device's dark/light theme preference. Every piece of shared school
 * data (announcements, school info, user accounts, AI configs, AI
 * conversation history) is fetched from and saved to the backend API —
 * never read from or written to localStorage. That's what makes edits
 * visible across devices/users.
 */

const state = {
  view: 'login',
  token: localStorage.getItem('sa_token') || null,
  user: null,
  theme: localStorage.getItem('sa_theme') || 'light',
  schoolInfo: null,
  announcements: [],
  aiConfig: null,
  aiHistory: [],
  aiThinking: false,
  users: [],
  status: null,
  recording: false
};

const appEl = document.getElementById('app');

// ------------------------------------------------------------------ API
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${window.API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) {
    if (res.status === 401) doLogout(false);
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ------------------------------------------------------------------ RENDER
function render() {
  document.body.setAttribute('data-theme', state.theme);

  if (!state.token || !state.user) {
    appEl.innerHTML = Views.login(state);
    return;
  }

  let inner = Views.loading();
  switch (state.view) {
    case 'home': inner = Views.home(state); break;
    case 'announcements': inner = Views.announcements(state); break;
    case 'school-info': inner = Views.schoolInfo(state); break;
    case 'profile': inner = Views.profile(state); break;
    case 'teachers-corner': inner = Views.teachersCorner(state); break;
    case 'ai-chat': inner = Views.aiChat(state); break;
    case 'admin': inner = Views.admin(state); break;
    default: inner = Views.home(state);
  }
  appEl.innerHTML = Views.shell(state, inner);

  // Auto-scroll chat to bottom
  const log = document.getElementById('chat-log');
  if (log) log.scrollTop = log.scrollHeight;
}

function setStatus(text, type = 'info') {
  state.status = text ? { text, type } : null;
}

async function navigate(view) {
  state.status = null;
  state.view = view;
  render();
  try {
    if (view === 'announcements' && state.token) {
      const d = await api('/api/announcements');
      state.announcements = d.announcements;
    } else if (view === 'school-info' || view === 'home') {
      const [info, ann] = await Promise.all([api('/api/school-info'), api('/api/announcements')]);
      state.schoolInfo = info.schoolInfo;
      state.announcements = ann.announcements;
    } else if (view === 'teachers-corner' || view === 'ai-chat') {
      const [cfg, hist] = await Promise.all([api('/api/ai/config'), api('/api/ai/history')]);
      state.aiConfig = cfg.config;
      state.aiHistory = hist.history;
    } else if (view === 'admin') {
      const d = await api('/api/users');
      state.users = d.users;
    }
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

// ------------------------------------------------------------------ AUTH
async function doLogin(username, password) {
  try {
    setStatus(null);
    const d = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    state.token = d.token;
    state.user = d.user;
    localStorage.setItem('sa_token', d.token);
    await navigate('home');
  } catch (e) {
    setStatus(e.message, 'error');
    render();
  }
}

function doLogout(rerender = true) {
  state.token = null;
  state.user = null;
  state.view = 'login';
  localStorage.removeItem('sa_token');
  if (rerender) render();
}

async function tryRestoreSession() {
  if (!state.token) return render();
  try {
    const d = await api('/api/me');
    state.user = d.user;
    await navigate('home');
  } catch (e) {
    doLogout();
  }
}

// ------------------------------------------------------------------ VOICE INPUT (graceful fallback)
let recognizer = null;
function toggleVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus('Voice input is not supported on this browser — please type instead.', 'info');
    render();
    return;
  }
  if (state.recording) {
    recognizer?.stop();
    return;
  }
  recognizer = new SpeechRecognition();
  recognizer.lang = 'en-US';
  recognizer.interimResults = false;
  recognizer.onstart = () => { state.recording = true; render(); };
  recognizer.onend = () => { state.recording = false; render(); };
  recognizer.onerror = () => { state.recording = false; setStatus('Voice input failed — please type instead.', 'info'); render(); };
  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const input = document.getElementById('chat-input');
    if (input) input.value = (input.value ? input.value + ' ' : '') + transcript;
  };
  recognizer.start();
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utter);
  } catch (_) { /* graceful no-op */ }
}

// ------------------------------------------------------------------ ACTIONS
async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const message = input?.value?.trim();
  if (!message) return;
  state.aiHistory.push({ role: 'user', content: message, ts: new Date().toISOString() });
  state.aiThinking = true;
  setStatus(null);
  render();
  try {
    const d = await api('/api/ai/chat', { method: 'POST', body: { message } });
    state.aiHistory.push({ role: 'assistant', content: d.reply, ts: new Date().toISOString() });
    speak(d.reply);
  } catch (e) {
    setStatus(e.message, 'error');
  }
  state.aiThinking = false;
  render();
}

async function saveAiConfig() {
  const aiName = document.getElementById('ai-config-name').value.trim();
  const subject = document.getElementById('ai-config-subject').value.trim();
  const teachingStyle = document.getElementById('ai-config-style').value.trim();
  try {
    const d = await api('/api/ai/config', { method: 'PUT', body: { aiName, subject, teachingStyle } });
    state.aiConfig = d.config;
    setStatus('AI settings saved.', 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

async function postAnnouncement() {
  const title = document.getElementById('ann-title').value.trim();
  const content = document.getElementById('ann-content').value.trim();
  if (!title || !content) { setStatus('Title and content are required.', 'error'); render(); return; }
  try {
    await api('/api/announcements', { method: 'POST', body: { title, content } });
    setStatus('Announcement posted school-wide.', 'success');
    const d = await api('/api/announcements');
    state.announcements = d.announcements;
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

async function deleteAnnouncement(id) {
  if (!confirm('Delete this announcement for everyone?')) return;
  try {
    await api(`/api/announcements/${id}`, { method: 'DELETE' });
    state.announcements = state.announcements.filter(a => a.id !== id);
    setStatus('Announcement deleted.', 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

async function editAnnouncementPrompt(id) {
  const a = state.announcements.find(x => x.id === id);
  if (!a) return;
  const newTitle = prompt('Edit title:', a.title);
  if (newTitle === null) return;
  const newContent = prompt('Edit content:', a.content);
  if (newContent === null) return;
  try {
    await api(`/api/announcements/${id}`, { method: 'PUT', body: { title: newTitle, content: newContent } });
    const d = await api('/api/announcements');
    state.announcements = d.announcements;
    setStatus('Announcement updated for everyone.', 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

async function saveSchoolInfo() {
  const inputs = document.querySelectorAll('[data-info-key]');
  const updates = {};
  inputs.forEach(el => { if (!el.disabled) updates[el.getAttribute('data-info-key')] = el.value; });
  try {
    const d = await api('/api/school-info', { method: 'PUT', body: updates });
    state.schoolInfo = d.schoolInfo;
    setStatus('School information updated for everyone.', 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

async function createUser() {
  const name = document.getElementById('new-user-name').value.trim();
  const username = document.getElementById('new-user-username').value.trim();
  const password = document.getElementById('new-user-password').value.trim();
  const role = document.getElementById('new-user-role').value;
  if (!name || !username || !password) { setStatus('All fields are required.', 'error'); render(); return; }
  try {
    await api('/api/users', { method: 'POST', body: { name, username, password, role } });
    const d = await api('/api/users');
    state.users = d.users;
    setStatus(`Account created for ${name}.`, 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

async function changeUserRole(id, role) {
  try {
    await api(`/api/users/${id}`, { method: 'PUT', body: { role } });
    setStatus('Role updated.', 'success');
  } catch (e) {
    setStatus(e.message, 'error');
    const d = await api('/api/users');
    state.users = d.users;
  }
  render();
}

async function deleteUser(id) {
  if (!confirm('Remove this user? This cannot be undone.')) return;
  try {
    await api(`/api/users/${id}`, { method: 'DELETE' });
    state.users = state.users.filter(u => u.id !== id);
    setStatus('User removed.', 'success');
  } catch (e) {
    setStatus(e.message, 'error');
  }
  render();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('sa_theme', state.theme);
  render();
}

// ------------------------------------------------------------------ EVENT DELEGATION
appEl.addEventListener('click', (e) => {
  const t = e.target;

  if (t.id === 'login-submit') {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    doLogin(username, password);
  }
  if (t.id === 'theme-toggle') toggleTheme();
  if (t.id === 'logout-btn') doLogout();
  if (t.dataset.nav) navigate(t.dataset.nav);

  if (t.id === 'ann-submit') postAnnouncement();
  if (t.dataset.deleteAnn) deleteAnnouncement(t.dataset.deleteAnn);
  if (t.dataset.editAnn) editAnnouncementPrompt(t.dataset.editAnn);

  if (t.id === 'info-save') saveSchoolInfo();

  if (t.id === 'ai-config-save') saveAiConfig();
  if (t.id === 'chat-send') sendChatMessage();
  if (t.id === 'mic-btn') toggleVoiceInput();

  if (t.id === 'new-user-submit') createUser();
  if (t.dataset.deleteUser) deleteUser(t.dataset.deleteUser);
});

appEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.roleSelect) changeUserRole(t.dataset.roleSelect, t.value);
});

appEl.addEventListener('keydown', (e) => {
  if (e.target.id === 'login-password' && e.key === 'Enter') {
    document.getElementById('login-submit').click();
  }
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('chat-send').click();
  }
});

// ------------------------------------------------------------------ INIT
tryRestoreSession();
