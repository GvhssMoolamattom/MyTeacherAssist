/**
 * COMPONENTS — pure render functions.
 * Each function returns an HTML string for a screen. app.js calls these,
 * injects the result into #app, then calls the matching bind* function to
 * wire up event listeners (kept separate from markup on purpose).
 */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const Views = {};

// ---------------------------------------------------------------- LOGIN
Views.login = (state) => `
  <div class="login-wrap">
    <h1>🏫 School Portal</h1>
    <div class="sub">Sign in with your school account</div>
    ${state.status ? `<div class="status ${state.status.type}">${escapeHtml(state.status.text)}</div>` : ''}
    <div class="field">
      <label>Username</label>
      <input id="login-username" autocomplete="username" placeholder="e.g. jsmith" />
    </div>
    <div class="field">
      <label>Password</label>
      <input id="login-password" type="password" autocomplete="current-password" placeholder="••••••••" />
    </div>
    <button class="btn" id="login-submit">Sign in</button>
  </div>
`;

// ---------------------------------------------------------------- SHELL (topbar + bottom nav wrapper)
Views.shell = (state, innerHtml) => {
  const role = state.user.role;
  const navItems = {
    student: [
      { id: 'home', icon: '🏠', label: 'Home' },
      { id: 'announcements', icon: '📣', label: 'News' },
      { id: 'school-info', icon: 'ℹ️', label: 'School' },
      { id: 'profile', icon: '👤', label: 'Profile' }
    ],
    teacher: [
      { id: 'home', icon: '🏠', label: 'Home' },
      { id: 'teachers-corner', icon: '🍎', label: "Teacher's Corner" },
      { id: 'ai-chat', icon: '🤖', label: 'AI Assistant' },
      { id: 'announcements', icon: '📣', label: 'News' },
      { id: 'profile', icon: '👤', label: 'Profile' }
    ],
    admin: [
      { id: 'home', icon: '🏠', label: 'Home' },
      { id: 'admin', icon: '🛠️', label: 'Admin' },
      { id: 'announcements', icon: '📣', label: 'News' },
      { id: 'school-info', icon: 'ℹ️', label: 'School' },
      { id: 'profile', icon: '👤', label: 'Profile' }
    ]
  }[role] || [];

  return `
    <div class="topbar">
      <div>
        <h1>${escapeHtml(state.schoolInfo?.schoolName || 'School Portal')}</h1>
        <div class="sub">${escapeHtml(state.user.name)} · <span class="role-badge">${role}</span></div>
      </div>
      <button class="icon-btn" id="theme-toggle" title="Toggle theme">${state.theme === 'dark' ? '☀️' : '🌙'}</button>
    </div>
    <main id="main-content">${innerHtml}</main>
    <nav class="bottom-nav">
      ${navItems.map(item => `
        <button class="nav-btn ${state.view === item.id ? 'active' : ''}" data-nav="${item.id}">
          <span class="nav-icon">${item.icon}</span>
          <span>${item.label}</span>
        </button>
      `).join('')}
    </nav>
  `;
};

// ---------------------------------------------------------------- HOME
Views.home = (state) => `
  <div class="card">
    <h3>Welcome, ${escapeHtml(state.user.name.split(' ')[0])} 👋</h3>
    <p>${escapeHtml(state.schoolInfo?.welcomeMessage || '')}</p>
  </div>
  <div class="card">
    <h3>Latest announcements</h3>
    ${state.announcements.slice(0, 3).map(a => `
      <div style="margin-bottom:10px;">
        <strong style="font-size:14px;">${escapeHtml(a.title)}</strong>
        <div class="meta">${escapeHtml(a.authorName)} · ${timeAgo(a.createdAt)}</div>
      </div>
    `).join('') || `<div class="empty-state">No announcements yet.</div>`}
  </div>
`;

// ---------------------------------------------------------------- ANNOUNCEMENTS
Views.announcements = (state) => {
  const canPost = state.user.role === 'teacher' || state.user.role === 'admin';
  return `
    ${canPost ? `
      <div class="card">
        <h3>New announcement</h3>
        ${state.status ? `<div class="status ${state.status.type}">${escapeHtml(state.status.text)}</div>` : ''}
        <div class="field"><input id="ann-title" placeholder="Title" /></div>
        <div class="field"><textarea id="ann-content" placeholder="What's the announcement?"></textarea></div>
        <button class="btn" id="ann-submit">Post to whole school</button>
      </div>
    ` : (state.status ? `<div class="status ${state.status.type}">${escapeHtml(state.status.text)}</div>` : '')}
    ${state.announcements.map(a => `
      <div class="card" data-ann-id="${a.id}">
        <h3>${escapeHtml(a.title)}</h3>
        <div class="meta">${escapeHtml(a.authorName)} · ${timeAgo(a.createdAt)}${a.updatedAt ? ' · edited' : ''}</div>
        <p>${escapeHtml(a.content)}</p>
        ${(state.user.role === 'admin' || a.authorId === state.user.id) ? `
          <div class="row" style="margin-top:10px;">
            <button class="btn secondary small" data-edit-ann="${a.id}">Edit</button>
            <button class="btn danger small" data-delete-ann="${a.id}">Delete</button>
          </div>
        ` : ''}
      </div>
    `).join('') || `<div class="empty-state">No announcements yet.</div>`}
  `;
};

// ---------------------------------------------------------------- SCHOOL INFO
Views.schoolInfo = (state) => {
  const info = state.schoolInfo || {};
  const isAdmin = state.user.role === 'admin';
  const editableKeys = new Set(info.editableByTeachers || []);
  const canEdit = (key) => isAdmin || editableKeys.has(key);
  const fields = [
    { key: 'schoolName', label: 'School name' },
    { key: 'welcomeMessage', label: 'Welcome message' },
    { key: 'contactEmail', label: 'Contact email' }
  ];
  return `
    <div class="card">
      <h3>Shared school information</h3>
      <div class="meta">Edits here save to the school's central record — every teacher and student sees the same version.</div>
      ${state.status ? `<div class="status ${state.status.type}">${escapeHtml(state.status.text)}</div>` : ''}
      ${fields.map(f => `
        <div class="field">
          <label>${f.label}${!canEdit(f.key) ? ' (view only)' : ''}</label>
          <input data-info-key="${f.key}" value="${escapeHtml(info[f.key] || '')}" ${canEdit(f.key) ? '' : 'disabled'} />
        </div>
      `).join('')}
      ${(isAdmin || editableKeys.size > 0) ? `<button class="btn" id="info-save">Save changes</button>` : ''}
    </div>
  `;
};

// ---------------------------------------------------------------- PROFILE
Views.profile = (state) => `
  <div class="card">
    <h3>${escapeHtml(state.user.name)}</h3>
    <div class="meta">@${escapeHtml(state.user.username)} · <span class="role-badge">${state.user.role}</span></div>
  </div>
  <div class="card">
    <button class="btn danger" id="logout-btn">Log out</button>
  </div>
`;

// ---------------------------------------------------------------- TEACHER'S CORNER
Views.teachersCorner = (state) => `
  <div class="card">
    <h3>🍎 Teacher's Corner</h3>
    <div class="meta">Your dashboard, resources, and AI assistant configuration.</div>
  </div>
  <div class="card">
    <h3>Your AI Assistant</h3>
    ${state.status ? `<div class="status ${state.status.type}">${escapeHtml(state.status.text)}</div>` : ''}
    <div class="field">
      <label>Assistant name</label>
      <input id="ai-config-name" value="${escapeHtml(state.aiConfig?.aiName || '')}" />
    </div>
    <div class="field">
      <label>Subject</label>
      <input id="ai-config-subject" value="${escapeHtml(state.aiConfig?.subject || '')}" placeholder="e.g. Mathematics" />
    </div>
    <div class="field">
      <label>Teaching style</label>
      <input id="ai-config-style" value="${escapeHtml(state.aiConfig?.teachingStyle || '')}" placeholder="e.g. Simple and practical" />
    </div>
    <button class="btn" id="ai-config-save">Save AI settings</button>
  </div>
  <div class="card">
    <button class="btn secondary" data-nav="ai-chat">Open AI Assistant chat →</button>
  </div>
`;

// ---------------------------------------------------------------- AI CHAT
Views.aiChat = (state) => `
  <div class="card" style="margin-bottom:8px;">
    <h3>🤖 ${escapeHtml(state.aiConfig?.aiName || 'AI Teaching Assistant')}</h3>
    <div class="meta">${escapeHtml(state.aiConfig?.subject || 'General')} · ${escapeHtml(state.aiConfig?.teachingStyle || '')}</div>
  </div>
  ${state.status ? `<div class="status ${state.status.type}">${escapeHtml(state.status.text)}</div>` : ''}
  <div class="chat-log" id="chat-log">
    ${state.aiHistory.length ? state.aiHistory.map(m => `
      <div class="msg ${m.role === 'assistant' ? 'assistant' : 'user'}">${escapeHtml(m.content)}</div>
    `).join('') : `<div class="empty-state">Ask your AI assistant for lesson plans, worksheets, explanations, or activity ideas.</div>`}
    ${state.aiThinking ? `<div class="msg assistant">Thinking…</div>` : ''}
  </div>
  <div class="chat-input-row">
    <button class="mic-btn ${state.recording ? 'recording' : ''}" id="mic-btn" title="Voice input">🎙️</button>
    <textarea id="chat-input" placeholder="Ask your assistant…"></textarea>
    <button class="btn small" id="chat-send" style="flex:0 0 70px;">Send</button>
  </div>
`;

// ---------------------------------------------------------------- ADMIN
Views.admin = (state) => `
  <div class="card">
    <h3>🛠️ Admin panel</h3>
    <div class="meta">Manage every account in the school.</div>
  </div>
  <div class="card">
    <h3>Add a user</h3>
    ${state.status ? `<div class="status ${state.status.type}">${escapeHtml(state.status.text)}</div>` : ''}
    <div class="field"><label>Full name</label><input id="new-user-name" /></div>
    <div class="field"><label>Username</label><input id="new-user-username" /></div>
    <div class="field"><label>Temporary password</label><input id="new-user-password" type="text" /></div>
    <div class="field">
      <label>Role</label>
      <select id="new-user-role">
        <option value="student">Student</option>
        <option value="teacher">Teacher</option>
        <option value="admin">Admin</option>
      </select>
    </div>
    <button class="btn" id="new-user-submit">Create account</button>
  </div>
  <div class="card">
    <h3>All users (${state.users.length})</h3>
    ${state.users.map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:14px;font-weight:600;">${escapeHtml(u.name)}</div>
          <div class="meta">@${escapeHtml(u.username)} · <span class="role-badge">${u.role}</span></div>
        </div>
        <div class="row" style="flex:0 0 auto;gap:6px;">
          <select data-role-select="${u.id}" style="width:auto;margin:0;padding:6px 8px;font-size:12px;">
            <option value="student" ${u.role === 'student' ? 'selected' : ''}>student</option>
            <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>teacher</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
          </select>
          <button class="btn danger small" data-delete-user="${u.id}">✕</button>
        </div>
      </div>
    `).join('') || `<div class="empty-state">No users yet.</div>`}
  </div>
`;

Views.loading = () => `<div class="empty-state">Loading…</div>`;
