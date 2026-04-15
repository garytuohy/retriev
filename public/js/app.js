// Retriev — Shared App JS

// ── Auth ──
const Auth = {
  getToken: () => localStorage.getItem('retriev_token'),
  getUser: () => { try { return JSON.parse(localStorage.getItem('retriev_user') || 'null'); } catch { return null; } },
  setAuth: (token, user) => { localStorage.setItem('retriev_token', token); localStorage.setItem('retriev_user', JSON.stringify(user)); },
  clear: () => { localStorage.removeItem('retriev_token'); localStorage.removeItem('retriev_user'); localStorage.removeItem('retriev_plan'); },
  requireAuth: () => {
    if (!Auth.getToken()) { window.location.href = '/login.html'; return false; }
    return true;
  },
  logout: () => { Auth.clear(); window.location.href = '/login.html'; }
};

// ── API ──
const API = {
  base: '/api',
  async req(path, opts = {}) {
    const token = Auth.getToken();
    const res = await fetch(API.base + path, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {})
      },
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get: (path) => API.req(path),
  post: (path, body) => API.req(path, { method: 'POST', body: JSON.stringify(body) }),
};

// ── Toast ──
function showToast(msg, type = 'info') {
  let container = document.getElementById('toast');
  if (!container) { container = document.createElement('div'); container.id = 'toast'; document.body.appendChild(container); }
  const icons = { success: '✅', error: '❌', info: '💡', warning: '⚠️' };
  const item = document.createElement('div');
  item.className = 'toast-item';
  item.innerHTML = `<span>${icons[type] || '💡'}</span> ${msg}`;
  container.appendChild(item);
  setTimeout(() => item.remove(), 4000);
}

// ── Copy to clipboard ──
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = orig; }, 2000); }
    showToast('Copied to clipboard', 'success');
  });
}

// ── Sidebar user hydration ──
function hydrateSidebar() {
  const user = Auth.getUser();
  if (!user) return;
  const nameEl = document.getElementById('sidebar-name');
  const planEl = document.getElementById('sidebar-plan');
  const avatarEl = document.getElementById('sidebar-avatar');
  if (nameEl) nameEl.textContent = user.name || user.email;
  if (planEl) planEl.textContent = (user.plan || 'starter').charAt(0).toUpperCase() + (user.plan || 'starter').slice(1) + ' Plan';
  if (avatarEl) avatarEl.textContent = (user.name || user.email || 'U')[0].toUpperCase();
}

// ── Nav scroll effect ──
function initNavScroll() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ── Hamburger menu ──
function initHamburger() {
  const btn = document.querySelector('.nav-hamburger');
  const links = document.querySelector('.nav-links');
  const ctas = document.querySelector('.nav-ctas');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', !open);
    // Simple mobile: toggle visibility
    if (links) links.style.display = open ? '' : 'flex';
    if (ctas) ctas.style.display = open ? '' : 'flex';
  });
}

// ── Active sidebar link ──
function setActiveSidebarLink() {
  const path = window.location.pathname;
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === path || path.endsWith(a.getAttribute('href')));
  });
}

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  initNavScroll();
  initHamburger();
  hydrateSidebar();
  setActiveSidebarLink();

  // Logout buttons
  document.querySelectorAll('[data-logout]').forEach(el => {
    el.addEventListener('click', () => Auth.logout());
  });
});

// ── Number formatter ──
const fmt = {
  money: (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  pct: (n) => Number(n).toFixed(1) + '%',
  num: (n) => Number(n).toLocaleString(),
};
