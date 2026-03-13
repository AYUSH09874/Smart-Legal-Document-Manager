/**
 * LexVault — Frontend Logic
 * Plain ES6+ JavaScript (no frameworks) for learning clarity.
 */

// ── State ─────────────────────────────────────────────────
const state = {
  documents:       [],    // list from API
  currentDoc:      null,  // selected document object
  currentVersions: [],    // versions of current doc
};

// ── Utility: get current author name ──────────────────────
function getAuthor() {
  return document.getElementById('global-author').value.trim() || 'Anonymous';
}

// ── Utility: show a toast notification ────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ── Utility: basic fetch wrapper ──────────────────────────
async function api(path, options = {}) {
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
  };
  const res = await fetch(path, { ...defaults, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── View Switch (Documents / Notifications) ───────────────
function switchView(view) {
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  const docPanel   = document.querySelector('.doc-panel');
  const sidebar    = document.getElementById('sidebar');
  const notifPanel = document.getElementById('notifications-panel');

  if (view === 'documents') {
    docPanel.classList.remove('hidden');
    sidebar.classList.remove('hidden');
    notifPanel.classList.add('hidden');
  } else {
    docPanel.classList.add('hidden');
    sidebar.classList.add('hidden');
    notifPanel.classList.remove('hidden');
    loadNotifications();
  }
}

// ── Load & Render Document List ───────────────────────────
async function loadDocuments() {
  try {
    const docs = await api('/api/documents');
    state.documents = docs;
    renderDocList(docs);
  } catch (e) {
    document.getElementById('doc-list').innerHTML =
      `<div class="loading-pulse" style="color:#f87171">Failed to load: ${e.message}</div>`;
  }
}

function renderDocList(docs) {
  const el = document.getElementById('doc-list');
  if (docs.length === 0) {
    el.innerHTML = '<div class="loading-pulse">No documents yet. Create one!</div>';
    return;
  }
  el.innerHTML = docs.map((d, i) => `
    <div class="doc-card ${state.currentDoc?.id === d.id ? 'active' : ''}"
         style="animation-delay:${i * 40}ms"
         onclick="selectDocument(${d.id})">
      <div class="doc-card-title">${escHtml(d.title)}</div>
      <div class="doc-card-meta">
        <span class="doc-card-ver">v${d.latest_version ?? 1}</span>
        <span class="doc-card-date">${fmtDate(d.updated_at)}</span>
      </div>
    </div>
  `).join('');
}

// Filter sidebar docs by search input
function filterDocs() {
  const q = document.getElementById('doc-search').value.toLowerCase();
  const filtered = state.documents.filter(d => d.title.toLowerCase().includes(q));
  renderDocList(filtered);
}

// ── Select & Show a Document ──────────────────────────────
async function selectDocument(id) {
  try {
    const data = await api(`/api/documents/${id}`);
    state.currentDoc      = data.document;
    state.currentVersions = data.versions;   // newest-first from API

    renderDocList(state.documents);          // re-render to update active state
    showDocDetail();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function showDocDetail() {
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('doc-detail').classList.remove('hidden');

  const doc      = state.currentDoc;
  const versions = state.currentVersions;
  const latest   = versions[0];   // newest first

  document.getElementById('doc-title-display').textContent = doc.title;
  document.getElementById('doc-version-badge').textContent =
    `${versions.length} version${versions.length !== 1 ? 's' : ''}`;
  document.getElementById('doc-date').textContent = `Updated ${fmtDate(doc.updated_at)}`;

  // View tab: show latest content
  document.getElementById('doc-content-display').textContent =
    latest ? latest.content : '— no content —';

  // Edit tab: pre-fill with latest content
  document.getElementById('edit-content').value = latest ? latest.content : '';
  document.getElementById('edit-summary').value = '';

  renderVersionHistory();
  populateDiffSelects();
  switchTab('view');
}

// ── Tab Switcher ──────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.remove('active');
    c.classList.add('hidden');
  });
  const active = document.getElementById(`tab-${tab}`);
  active.classList.remove('hidden');
  active.classList.add('active');

  if (tab === 'history') renderVersionHistory();
  if (tab === 'diff')    populateDiffSelects();
}

// ── Create New Document ───────────────────────────────────
function openNewDocModal() {
  document.getElementById('new-title').value   = '';
  document.getElementById('new-content').value = '';
  document.getElementById('new-summary').value = '';
  openModal('modal-new');
}

async function createDocument() {
  const title   = document.getElementById('new-title').value.trim();
  const content = document.getElementById('new-content').value.trim();
  const summary = document.getElementById('new-summary').value.trim() || 'Initial version';

  if (!title || !content) {
    showToast('Title and content are required.', 'error');
    return;
  }

  try {
    const data = await api('/api/documents', {
      method: 'POST',
      body:   JSON.stringify({ title, content, author: getAuthor(), change_summary: summary }),
    });
    closeModal('modal-new');
    showToast(`"${data.document.title}" created!`);
    await loadDocuments();
    selectDocument(data.document.id);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── Save New Version ──────────────────────────────────────
async function saveNewVersion() {
  if (!state.currentDoc) return;
  const content = document.getElementById('edit-content').value.trim();
  const summary = document.getElementById('edit-summary').value.trim();

  if (!content) {
    showToast('Content cannot be empty.', 'error');
    return;
  }

  try {
    await api(`/api/documents/${state.currentDoc.id}/versions`, {
      method: 'POST',
      body:   JSON.stringify({ content, author: getAuthor(), change_summary: summary }),
    });
    showToast('New version saved!');
    await loadDocuments();
    selectDocument(state.currentDoc.id);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── Update Title ──────────────────────────────────────────
function openEditTitleModal() {
  document.getElementById('new-title-input').value = state.currentDoc?.title || '';
  openModal('modal-edit-title');
}

async function saveTitle() {
  const title = document.getElementById('new-title-input').value.trim();
  if (!title) { showToast('Title cannot be empty.', 'error'); return; }

  try {
    await api(`/api/documents/${state.currentDoc.id}/title`, {
      method: 'PATCH',
      body:   JSON.stringify({ title }),
    });
    closeModal('modal-edit-title');
    showToast('Title updated!');
    await loadDocuments();
    selectDocument(state.currentDoc.id);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── Delete Document ───────────────────────────────────────
function confirmDeleteDoc() {
  if (!state.currentDoc) return;
  if (!confirm(`Delete "${state.currentDoc.title}" and ALL its versions?\nThis cannot be undone.`)) return;
  deleteDocument();
}

async function deleteDocument() {
  try {
    await api(`/api/documents/${state.currentDoc.id}`, { method: 'DELETE' });
    showToast('Document deleted.');
    state.currentDoc = null;
    document.getElementById('doc-detail').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
    await loadDocuments();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── Version History ───────────────────────────────────────
function renderVersionHistory() {
  const el = document.getElementById('version-list');
  const versions = state.currentVersions;   // newest-first
  if (!versions.length) {
    el.innerHTML = '<div class="loading-pulse">No versions found.</div>';
    return;
  }

  el.innerHTML = versions.map((v, i) => `
    <div class="version-item" style="animation-delay:${i * 50}ms">
      <div class="version-num">v${v.version_number}</div>
      <div class="version-info">
        <div class="version-summary">${escHtml(v.change_summary || '—')}</div>
        <div class="version-detail">
          <span>👤 ${escHtml(v.author)}</span>
          <span>🕒 ${fmtDateLong(v.created_at)}</span>
        </div>
      </div>
      <div class="version-actions">
        <button class="btn-sm gold" onclick="viewVersion(${v.version_number})">View</button>
        <button class="btn-sm" onclick="deleteVersionPrompt(${v.version_number})" title="Delete version">✕</button>
      </div>
    </div>
  `).join('');
}

// ── View a specific version in modal ─────────────────────
function viewVersion(vNum) {
  const v = state.currentVersions.find(x => x.version_number === vNum);
  if (!v) return;
  document.getElementById('modal-version-title').textContent =
    `Version ${v.version_number} — ${escHtml(v.author)} — ${fmtDateLong(v.created_at)}`;
  document.getElementById('modal-version-body').textContent = v.content;

  // Hook delete button
  const delBtn = document.getElementById('modal-version-delete-btn');
  delBtn.onclick = () => deleteVersionPrompt(vNum);

  openModal('modal-version');
}

// ── Delete a single version ───────────────────────────────
async function deleteVersionPrompt(vNum) {
  if (!confirm(`Delete version ${vNum} of this document?\nThe document and other versions remain.`)) return;
  try {
    await api(`/api/documents/${state.currentDoc.id}/versions/${vNum}`, { method: 'DELETE' });
    closeModal('modal-version');
    showToast(`Version ${vNum} deleted.`);
    selectDocument(state.currentDoc.id);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ── Diff: populate dropdowns ──────────────────────────────
function populateDiffSelects() {
  const v1El = document.getElementById('diff-v1');
  const v2El = document.getElementById('diff-v2');
  const versions = [...state.currentVersions].reverse();   // oldest first for select

  const options = versions.map(v =>
    `<option value="${v.version_number}">v${v.version_number} — ${escHtml(v.change_summary || v.author)}</option>`
  ).join('');

  v1El.innerHTML = options;
  v2El.innerHTML = options;

  // Default: compare v1 → latest
  if (versions.length >= 2) {
    v1El.value = versions[0].version_number;
    v2El.value = versions[versions.length - 1].version_number;
  }

  document.getElementById('diff-result').innerHTML = '';
}

// ── Run Diff ──────────────────────────────────────────────
async function runDiff() {
  const v1 = document.getElementById('diff-v1').value;
  const v2 = document.getElementById('diff-v2').value;

  if (v1 === v2) {
    showToast('Select two different versions to compare.', 'error');
    return;
  }

  try {
    const data = await api(
      `/api/documents/${state.currentDoc.id}/diff?v1=${v1}&v2=${v2}`
    );
    renderDiff(data);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderDiff(data) {
  const el = document.getElementById('diff-result');

  if (data.is_identical) {
    el.innerHTML = '<div class="diff-identical">✓ These two versions are identical.</div>';
    return;
  }

  const { stats, hunks, version_from, version_to } = data;

  // Stats bar
  let html = `
    <div class="diff-stats">
      <span class="diff-stat">
        <span class="stat-dot add"></span>
        <strong>+${stats.added}</strong> added line${stats.added !== 1 ? 's' : ''}
      </span>
      <span class="diff-stat">
        <span class="stat-dot del"></span>
        <strong>−${stats.removed}</strong> removed line${stats.removed !== 1 ? 's' : ''}
      </span>
      <span class="diff-stat">
        <span class="stat-dot rep"></span>
        <strong>~${stats.changed}</strong> changed line${stats.changed !== 1 ? 's' : ''}
      </span>
    </div>
  `;

  // Render each hunk
  hunks.forEach(hunk => {
    if (hunk.type === 'equal') {
      // Show max 2 context lines for equal sections
      const lines = hunk.old_lines.slice(0, 2);
      if (!lines.length) return;
      html += `<div class="diff-hunk">`;
      html += `<div class="diff-hunk-header">@@ context @@</div>`;
      lines.forEach((line, i) => {
        html += `<div class="diff-line diff-eq">
          <span class="diff-line-num">${hunk.old_start + i}</span>
          <span class="diff-line-sign"> </span>
          <span class="diff-line-text">${escHtml(line)}</span>
        </div>`;
      });
      if (hunk.old_lines.length > 2) {
        html += `<div class="diff-line diff-eq"><span class="diff-line-num">…</span><span class="diff-line-sign"></span><span class="diff-line-text" style="color:var(--text-dim)">  ${hunk.old_lines.length - 2} unchanged line(s)</span></div>`;
      }
      html += '</div>';

    } else if (hunk.type === 'insert') {
      html += `<div class="diff-hunk">`;
      html += `<div class="diff-hunk-header">@@ +${hunk.new_start} Added @@</div>`;
      hunk.new_lines.forEach((line, i) => {
        html += `<div class="diff-line diff-add">
          <span class="diff-line-num">${hunk.new_start + i}</span>
          <span class="diff-line-sign">+</span>
          <span class="diff-line-text">${escHtml(line)}</span>
        </div>`;
      });
      html += '</div>';

    } else if (hunk.type === 'delete') {
      html += `<div class="diff-hunk">`;
      html += `<div class="diff-hunk-header">@@ −${hunk.old_start} Removed @@</div>`;
      hunk.old_lines.forEach((line, i) => {
        html += `<div class="diff-line diff-del">
          <span class="diff-line-num">${hunk.old_start + i}</span>
          <span class="diff-line-sign">−</span>
          <span class="diff-line-text">${escHtml(line)}</span>
        </div>`;
      });
      html += '</div>';

    } else if (hunk.type === 'replace') {
      html += `<div class="diff-hunk">`;
      html += `<div class="diff-hunk-header">@@ −${hunk.old_start} → +${hunk.new_start} Changed @@</div>`;
      // Show removed lines
      hunk.old_lines.forEach((line, i) => {
        html += `<div class="diff-line diff-del">
          <span class="diff-line-num">${hunk.old_start + i}</span>
          <span class="diff-line-sign">−</span>
          <span class="diff-line-text">${escHtml(line)}</span>
        </div>`;
      });
      // Show added lines
      hunk.new_lines.forEach((line, i) => {
        html += `<div class="diff-line diff-add">
          <span class="diff-line-num">${hunk.new_start + i}</span>
          <span class="diff-line-sign">+</span>
          <span class="diff-line-text">${escHtml(line)}</span>
        </div>`;
      });
      html += '</div>';
    }
  });

  el.innerHTML = html;
}

// ── Notifications ──────────────────────────────────────────
async function loadNotifications() {
  const el = document.getElementById('notif-list');
  el.innerHTML = '<div class="loading-pulse">Loading…</div>';
  try {
    const data = await api('/api/notifications');
    if (!data.notifications.length) {
      el.innerHTML = '<div class="notif-empty">No significant-change notifications yet.</div>';
      return;
    }
    el.innerHTML = data.notifications.map((n, i) =>
      `<div class="notif-item" style="animation-delay:${i * 30}ms">${escHtml(n)}</div>`
    ).join('');
  } catch (e) {
    el.innerHTML = `<div class="notif-empty" style="color:#f87171">${e.message}</div>`;
  }
}

// ── Modal helpers ─────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
// Close on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.classList.add('hidden');
  });
});
// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  }
});

// ── Formatting utilities ──────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtDateLong(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return d.toLocaleString('en-IN', {
    day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}

// ── Init ─────────────────────────────────────────────────
loadDocuments();
