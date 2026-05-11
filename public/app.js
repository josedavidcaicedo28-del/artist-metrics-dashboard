/* =====================================================
   Artist Metrics Dashboard — Frontend SPA
   ===================================================== */

// ==================== STATE ====================
const state = {
  artists: [],
  artist: null,   // currently viewed artist (full data)
  loading: false
};

// ==================== UTILS ====================
function fmt(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (isNaN(num)) return '—';
  return num.toLocaleString('es-ES');
}

function pct(curr, prev) {
  if (!prev || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function fmtPct(p) {
  if (p === null || p === undefined) return null;
  const sign = p > 0 ? '+' : '';
  return `${sign}${p.toFixed(1)}%`;
}

function changeBadge(curr, prev) {
  const p = pct(curr, prev);
  if (p === null) return '<span class="change-badge zero">—</span>';
  const cls = p > 0 ? 'pos' : p < 0 ? 'neg' : 'zero';
  const arrow = p > 0 ? '↑' : p < 0 ? '↓' : '→';
  return `<span class="change-badge ${cls}">${arrow} ${fmtPct(p)}</span>`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function avgDaily(total, days = 7) {
  return total > 0 ? Math.round(total / days) : 0;
}

// ==================== TOAST ====================
function toast(msg, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// ==================== API ====================
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const GET  = (p)    => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT  = (p, b) => api('PUT', p, b);
const DEL  = (p)    => api('DELETE', p);

// ==================== ROUTING ====================
function navigate(hash) { window.location.hash = hash; }

async function handleRoute() {
  const hash = window.location.hash || '#/';
  const match = hash.match(/#\/([^/]*)(?:\/(.*))?/);
  const [, route, id] = match || [];

  if (!route) {
    await loadArtists();
    renderDashboard();
  } else if (route === 'artist' && id) {
    state.loading = true;
    document.getElementById('app').innerHTML = loadingHTML();
    const artist = await loadArtist(id);
    if (artist) renderDetail(artist);
    else { toast('Artista no encontrado', 'error'); navigate('#/'); }
  }
}

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', async () => {
  // Handle OAuth return
  const params = new URLSearchParams(window.location.search);
  const success = params.get('success');
  const error = params.get('error');
  const artistId = params.get('artistId');

  if (success) {
    const platform = success.replace('_connected', '');
    toast(`${capitalize(platform)} conectado correctamente`, 'success');
  }
  if (error) {
    toast(`Error: ${error.replace(/_/g, ' ')}`, 'error');
  }

  if (success || error) {
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  await loadArtists();
  handleRoute();
});

// ==================== DATA ====================
async function loadArtists() {
  try {
    state.artists = await GET('/artists');
  } catch (e) {
    toast('Error cargando artistas: ' + e.message, 'error');
    state.artists = [];
  }
}

async function loadArtist(id) {
  try {
    const artist = await GET(`/artists/${id}`);
    state.artist = artist;
    const idx = state.artists.findIndex(a => a.id === id);
    if (idx >= 0) state.artists[idx] = artist;
    else state.artists.push(artist);
    return artist;
  } catch (e) {
    toast('Error: ' + e.message, 'error');
    return null;
  }
}

function loadingHTML() {
  return `<div class="loading-overlay"><div class="spinner"></div><span>Cargando...</span></div>`;
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  updateNavbar(false, null);
  const app = document.getElementById('app');
  const connected = p => state.artists.filter(a => a.connected?.[p]).length;

  app.innerHTML = `
    <div class="dashboard">
      <div class="dashboard-header">
        <div>
          <h1 class="dashboard-title">🎵 Artist Metrics</h1>
          <p class="dashboard-subtitle">${state.artists.length} artista${state.artists.length !== 1 ? 's' : ''} registrado${state.artists.length !== 1 ? 's' : ''}</p>
        </div>
        <button class="btn btn-primary" onclick="showCreateArtistModal()">+ Nuevo Artista</button>
      </div>

      ${state.artists.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">🎵</div>
          <h2>No hay artistas aún</h2>
          <p>Agrega tu primer artista para comenzar a rastrear métricas semanales</p>
          <button class="btn btn-primary" onclick="showCreateArtistModal()">+ Agregar Artista</button>
        </div>
      ` : `
        <div class="artist-grid">
          ${state.artists.map(a => artistCardHTML(a)).join('')}
        </div>
      `}
    </div>
  `;
}

function artistCardHTML(a) {
  const conns = [];
  if (a.connected?.spotify) conns.push({ name: 'Spotify', cls: 'spotify' });
  if (a.connected?.youtube) conns.push({ name: 'YouTube', cls: 'youtube' });
  if (a.connected?.instagram) conns.push({ name: 'Instagram', cls: 'instagram' });
  if (a.connected?.tiktok) conns.push({ name: 'TikTok', cls: 'tiktok' });

  const avatarContent = a.image
    ? `<img src="${a.image}" alt="${a.name}" onerror="this.parentNode.innerHTML='${a.name[0].toUpperCase()}'">`
    : a.name[0].toUpperCase();

  return `
    <div class="artist-card" onclick="navigate('#/artist/${a.id}')">
      <div class="artist-card-header">
        <div class="artist-avatar">${avatarContent}</div>
        <div>
          <div class="artist-card-name">${a.name}</div>
          <div class="artist-card-meta">${conns.length > 0 ? conns.map(c => c.name).join(' · ') : 'Sin plataformas configuradas'}</div>
        </div>
      </div>
      <div class="card-platforms">
        ${['spotify', 'youtube', 'instagram', 'tiktok'].map(p => `
          <span class="platform-dot ${a.connected?.[p] ? 'active' : ''}">
            ${platformIcon(p)} ${capitalize(p)}
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

function platformIcon(p) {
  return { spotify: '🎵', youtube: '▶️', instagram: '📷', tiktok: '🎵' }[p] || '●';
}

// ==================== DETAIL VIEW ====================
function renderDetail(artist) {
  updateNavbar(true, artist);
  const app = document.getElementById('app');
  const w = artist.weeklyData || {};
  const curr = w.currWeek || {};
  const prev = w.prevWeek || {};

  const avatarContent = artist.image
    ? `<img src="${artist.image}" alt="${artist.name}" onerror="this.style.display='none'">`
    : artist.name[0].toUpperCase();

  app.innerHTML = `
    <div class="detail-header">
      <div class="detail-avatar">${avatarContent}</div>
      <div>
        <h1 class="detail-title">${artist.name}</h1>
        <p class="detail-subtitle">Métricas semanales comparativas</p>
      </div>
      <div class="detail-actions">
        <button class="btn btn-secondary btn-sm" onclick="showEditArtistModal('${artist.id}')">✏️ Editar</button>
        <button class="btn btn-secondary btn-sm" onclick="generatePDF('${artist.id}')">📄 PDF</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDelete('${artist.id}')">🗑️ Eliminar</button>
      </div>
    </div>

    <!-- Week Navigator -->
    <div class="week-nav">
      <span class="week-nav-label">Semana Anterior</span>
      <span class="week-nav-value">${prev.weekLabel || 'Sin datos'}</span>
      <span class="week-nav-arrow">→</span>
      <span class="week-nav-label">Semana Actual</span>
      <span class="week-nav-value">${curr.weekLabel || 'Sin datos'}</span>
      <span class="week-nav-spacer"></span>
      <button class="btn btn-secondary btn-sm" onclick="showAdvanceWeekModal('${artist.id}')" title="Avanzar semana">⏭️ Avanzar Semana</button>
    </div>

    <!-- Platforms -->
    ${spotifySection(artist, curr.spotify, prev.spotify)}
    ${youtubeSection(artist, curr.youtube, prev.youtube)}
    ${instagramSection(artist, curr.instagram, prev.instagram)}
    ${tiktokSection(artist, curr.tiktok, prev.tiktok)}
  `;
}

// ==================== PLATFORM SECTIONS ====================
function spotifySection(artist, curr = {}, prev = {}) {
  const connected = artist.credentials?.spotify?.connected;
  return `
    <div class="platform-section spotify">
      <div class="platform-header">
        <div class="platform-icon">🎵</div>
        <span class="platform-name">Spotify</span>
        <span class="platform-status ${connected ? 'connected' : 'disconnected'}">
          ${connected ? '● Conectado' : '○ No conectado'}
        </span>
        <div class="platform-actions">
          ${connected
            ? `<button class="btn btn-ghost btn-xs" onclick="syncSpotify('${artist.id}')">🔄 Sync</button>`
            : `<button class="btn btn-secondary btn-xs" onclick="connectSpotify('${artist.id}')">Conectar</button>`
          }
          <button class="btn btn-ghost btn-xs" onclick="showSpotifyConfigModal('${artist.id}')">⚙️</button>
          <button class="btn btn-ghost btn-xs" onclick="showEditMetricsModal('${artist.id}', 'spotify')">✏️ Editar</button>
        </div>
      </div>
      <table class="metrics-table">
        <thead>
          <tr>
            <th>Métrica</th>
            <th>Sem. Anterior</th>
            <th>Sem. Actual</th>
            <th>Cambio</th>
          </tr>
        </thead>
        <tbody>
          ${metricRow('Oyentes semanales', prev.listeners, curr.listeners)}
          ${metricRow('Streams último lanzamiento', prev.streams, curr.streams)}
          ${metricRow('Prom. diario de streams', prev.avgDailyStreams, curr.avgDailyStreams)}
          ${metricRow('Seguidores totales', prev.totalFollowers, curr.totalFollowers)}
          ${metricRow('Nuevos seguidores', prev.newFollowers, curr.newFollowers)}
        </tbody>
      </table>
      ${curr.latestReleaseName ? `<div style="padding:10px 20px; font-size:0.8rem; color:var(--text3)">Último lanzamiento: ${curr.latestReleaseName}</div>` : ''}
    </div>
  `;
}

function youtubeSection(artist, curr = {}, prev = {}) {
  const connected = artist.credentials?.youtube?.connected;
  return `
    <div class="platform-section youtube">
      <div class="platform-header">
        <div class="platform-icon">▶️</div>
        <span class="platform-name">YouTube</span>
        <span class="platform-status ${connected ? 'connected' : 'disconnected'}">
          ${connected ? '● Conectado' : '○ No configurado'}
        </span>
        <div class="platform-actions">
          ${connected
            ? `<button class="btn btn-ghost btn-xs" onclick="syncYouTube('${artist.id}')">🔄 Sync</button>`
            : `<button class="btn btn-secondary btn-xs" onclick="showYouTubeConfigModal('${artist.id}')">Configurar</button>`
          }
          ${connected ? `<button class="btn btn-ghost btn-xs" onclick="showYouTubeConfigModal('${artist.id}')">⚙️</button>` : ''}
          <button class="btn btn-ghost btn-xs" onclick="showEditMetricsModal('${artist.id}', 'youtube')">✏️ Editar</button>
        </div>
      </div>
      <table class="metrics-table">
        <thead>
          <tr><th>Métrica</th><th>Sem. Anterior</th><th>Sem. Actual</th><th>Cambio</th></tr>
        </thead>
        <tbody>
          ${metricRow('Suscriptores totales', prev.totalSubscribers, curr.totalSubscribers)}
          ${metricRow('Nuevos suscriptores', prev.newSubscribers, curr.newSubscribers)}
          ${metricRow('Views último video', prev.latestVideoViews, curr.latestVideoViews)}
          ${metricRow('Prom. de views', prev.avgViews, curr.avgViews)}
        </tbody>
      </table>
      ${curr.latestVideoTitle ? `<div style="padding:10px 20px; font-size:0.8rem; color:var(--text3)">Último video: ${curr.latestVideoTitle}</div>` : ''}
    </div>
  `;
}

function instagramSection(artist, curr = {}, prev = {}) {
  const connected = artist.credentials?.instagram?.connected;
  return `
    <div class="platform-section instagram">
      <div class="platform-header">
        <div class="platform-icon">📷</div>
        <span class="platform-name">Instagram</span>
        <span class="platform-status ${connected ? 'connected' : 'disconnected'}">
          ${connected ? '● Conectado' : '○ No conectado'}
        </span>
        <div class="platform-actions">
          ${connected
            ? `<button class="btn btn-ghost btn-xs" onclick="syncInstagram('${artist.id}')">🔄 Sync</button>`
            : `<button class="btn btn-secondary btn-xs" onclick="connectInstagram('${artist.id}')">Conectar</button>`
          }
          <button class="btn btn-ghost btn-xs" onclick="showInstagramConfigModal('${artist.id}')">⚙️</button>
          <button class="btn btn-ghost btn-xs" onclick="showEditMetricsModal('${artist.id}', 'instagram')">✏️ Editar</button>
        </div>
      </div>
      <table class="metrics-table">
        <thead>
          <tr><th>Métrica</th><th>Sem. Anterior</th><th>Sem. Actual</th><th>Cambio</th></tr>
        </thead>
        <tbody>
          ${metricRow('Seguidores totales', prev.totalFollowers, curr.totalFollowers)}
          ${metricRow('Nuevos seguidores', prev.newFollowers, curr.newFollowers, true)}
          ${metricRow('Alcance semanal', prev.reach, curr.reach)}
          ${metricRow('Reels publicados', prev.reels, curr.reels)}
          ${metricRow('Carruseles publicados', prev.carousels, curr.carousels)}
          ${metricRow('Historias publicadas', prev.stories, curr.stories)}
        </tbody>
      </table>
    </div>
  `;
}

function tiktokSection(artist, curr = {}, prev = {}) {
  const connected = artist.credentials?.tiktok?.connected;
  return `
    <div class="platform-section tiktok">
      <div class="platform-header">
        <div class="platform-icon">🎵</div>
        <span class="platform-name">TikTok</span>
        <span class="platform-status connected">● Manual</span>
        <div class="platform-actions">
          <button class="btn btn-ghost btn-xs" onclick="showEditMetricsModal('${artist.id}', 'tiktok')">✏️ Editar</button>
        </div>
      </div>
      <table class="metrics-table">
        <thead>
          <tr><th>Métrica</th><th>Sem. Anterior</th><th>Sem. Actual</th><th>Cambio</th></tr>
        </thead>
        <tbody>
          ${metricRow('Seguidores totales', prev.totalFollowers, curr.totalFollowers)}
          ${metricRow('Nuevos seguidores', prev.newFollowers, curr.newFollowers, true)}
        </tbody>
      </table>
    </div>
  `;
}

function metricRow(label, prevVal, currVal, allowNeg = false) {
  const pv = prevVal ?? 0;
  const cv = currVal ?? 0;
  const badge = changeBadge(cv, pv);
  const fmtVal = (v) => {
    if (v === 0 || v === null || v === undefined) return '—';
    if (allowNeg && v > 0) return `+${fmt(v)}`;
    if (allowNeg && v < 0) return fmt(v);
    return fmt(v);
  };
  return `
    <tr>
      <td>${label}</td>
      <td class="metric-prev">${fmtVal(pv)}</td>
      <td class="metric-curr">${fmtVal(cv)}</td>
      <td>${badge}</td>
    </tr>
  `;
}

// ==================== NAVBAR ====================
function updateNavbar(detail, artist) {
  const actions = document.getElementById('navbar-actions');
  if (detail && artist) {
    actions.innerHTML = `
      <button class="navbar-back" onclick="navigate('#/')">← Volver al Dashboard</button>
    `;
  } else {
    actions.innerHTML = '';
  }
}

// ==================== MODALS ====================
let modalEl = null;

function openModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  modalEl = overlay;
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeModal() {
  if (!modalEl) return;
  modalEl.classList.remove('visible');
  setTimeout(() => { modalEl?.remove(); modalEl = null; }, 220);
}

// ===== Create Artist Modal =====
function showCreateArtistModal() {
  openModal(`
    <div class="modal-header">
      <span class="modal-title">➕ Nuevo Artista</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Nombre del artista *</label>
        <input type="text" id="modal-artist-name" placeholder="Ej: Bad Bunny" autofocus />
      </div>
      <div class="form-group">
        <label>URL de imagen (opcional)</label>
        <input type="url" id="modal-artist-image" placeholder="https://..." />
        <span class="form-hint">Puedes agregar una imagen de perfil o dejar en blanco</span>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="createArtist()">Crear Artista</button>
    </div>
  `);
  document.getElementById('modal-artist-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') createArtist();
  });
}

async function createArtist() {
  const name = document.getElementById('modal-artist-name').value.trim();
  const image = document.getElementById('modal-artist-image').value.trim();
  if (!name) { toast('El nombre es requerido', 'error'); return; }

  try {
    const artist = await POST('/artists', { name, image: image || null });
    state.artists.push(artist);
    closeModal();
    toast(`Artista "${artist.name}" creado`, 'success');
    renderDashboard();
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ===== Edit Artist Modal =====
async function showEditArtistModal(id) {
  const artist = await loadArtist(id);
  if (!artist) return;

  openModal(`
    <div class="modal-header">
      <span class="modal-title">✏️ Editar Artista</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Nombre</label>
        <input type="text" id="edit-name" value="${artist.name}" />
      </div>
      <div class="form-group">
        <label>URL de imagen</label>
        <input type="url" id="edit-image" value="${artist.image || ''}" placeholder="https://..." />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="updateArtistInfo('${id}')">Guardar</button>
    </div>
  `);
}

async function updateArtistInfo(id) {
  const name = document.getElementById('edit-name').value.trim();
  const image = document.getElementById('edit-image').value.trim();
  if (!name) { toast('El nombre es requerido', 'error'); return; }

  try {
    const updated = await PUT(`/artists/${id}`, { name, image: image || null });
    state.artist = updated;
    closeModal();
    toast('Artista actualizado', 'success');
    renderDetail(updated);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ===== Delete Confirm =====
function confirmDelete(id) {
  const artist = state.artist || state.artists.find(a => a.id === id);
  openModal(`
    <div class="modal-header">
      <span class="modal-title">🗑️ Eliminar Artista</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-danger">
        ¿Estás seguro de eliminar a <strong>${artist?.name || 'este artista'}</strong>?
        Esta acción no se puede deshacer y se perderán todos sus datos.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="deleteArtist('${id}')">Eliminar definitivamente</button>
    </div>
  `);
}

async function deleteArtist(id) {
  try {
    await DEL(`/artists/${id}`);
    state.artists = state.artists.filter(a => a.id !== id);
    closeModal();
    toast('Artista eliminado', 'info');
    navigate('#/');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ===== Advance Week Modal =====
function showAdvanceWeekModal(id) {
  openModal(`
    <div class="modal-header">
      <span class="modal-title">⏭️ Avanzar Semana</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-info">
        Esta acción mueve los datos de <strong>Semana Actual → Semana Anterior</strong>
        y limpia los datos de la semana actual para ingresar datos nuevos.
      </div>
      <p style="color:var(--text2); font-size:0.9rem; margin-top:12px;">
        Usa esto al inicio de cada semana para registrar el nuevo período.
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="advanceWeek('${id}')">⏭️ Avanzar Semana</button>
    </div>
  `);
}

async function advanceWeek(id) {
  try {
    await POST(`/artists/${id}/advance-week`);
    const artist = await loadArtist(id);
    closeModal();
    toast('¡Semana avanzada correctamente!', 'success');
    renderDetail(artist);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ==================== EDIT METRICS MODAL ====================
async function showEditMetricsModal(id, platform) {
  const artist = state.artist;
  if (!artist) return;

  const curr = artist.weeklyData?.currWeek?.[platform] || {};
  const prev = artist.weeklyData?.prevWeek?.[platform] || {};

  const fields = getMetricFields(platform);

  const rows = fields.map(f => `
    <tr>
      <td style="color:var(--text2); font-size:0.85rem; vertical-align:middle; padding:8px 0">${f.label}</td>
      <td style="padding:4px 8px">
        <input type="number" id="prev-${f.key}" value="${prev[f.key] ?? ''}" placeholder="0"
          style="width:100%; padding:8px 10px; background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:6px; font-size:0.85rem;" />
      </td>
      <td style="padding:4px 8px">
        <input type="number" id="curr-${f.key}" value="${curr[f.key] ?? ''}" placeholder="0"
          style="width:100%; padding:8px 10px; background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:6px; font-size:0.85rem;" />
      </td>
    </tr>
  `).join('');

  const extraFields = getExtraTextFields(platform, curr, prev);

  openModal(`
    <div class="modal-header">
      <span class="modal-title">${platformIcon(platform)} Editar métricas — ${capitalize(platform)}</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      ${extraFields}
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left; font-size:0.72rem; color:var(--text3); text-transform:uppercase; padding:8px 0; letter-spacing:0.06em;">Métrica</th>
            <th style="text-align:center; font-size:0.72rem; color:var(--text3); text-transform:uppercase; padding:8px 8px; letter-spacing:0.06em; width:130px">Sem. Anterior</th>
            <th style="text-align:center; font-size:0.72rem; color:var(--text3); text-transform:uppercase; padding:8px 8px; letter-spacing:0.06em; width:130px">Sem. Actual</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:16px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div>
          <label style="font-size:0.72rem; color:var(--text3); text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:6px;">Etiqueta sem. anterior</label>
          <input type="text" id="prev-weekLabel" value="${prev.weekLabel || artist.weeklyData?.prevWeek?.weekLabel || ''}"
            placeholder="Ej: 14-20 Abr"
            style="width:100%; padding:8px 10px; background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:6px; font-size:0.85rem;" />
        </div>
        <div>
          <label style="font-size:0.72rem; color:var(--text3); text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:6px;">Etiqueta sem. actual</label>
          <input type="text" id="curr-weekLabel" value="${curr.weekLabel || artist.weeklyData?.currWeek?.weekLabel || ''}"
            placeholder="Ej: 21-27 Abr"
            style="width:100%; padding:8px 10px; background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:6px; font-size:0.85rem;" />
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveMetrics('${id}', '${platform}')">💾 Guardar</button>
    </div>
  `);
}

function getMetricFields(platform) {
  const map = {
    spotify: [
      { key: 'listeners', label: 'Oyentes semanales' },
      { key: 'streams', label: 'Streams último lanzamiento' },
      { key: 'avgDailyStreams', label: 'Prom. diario de streams' },
      { key: 'totalFollowers', label: 'Seguidores totales' },
      { key: 'newFollowers', label: 'Nuevos seguidores' }
    ],
    youtube: [
      { key: 'totalSubscribers', label: 'Suscriptores totales' },
      { key: 'newSubscribers', label: 'Nuevos suscriptores' },
      { key: 'latestVideoViews', label: 'Views último video' },
      { key: 'avgViews', label: 'Prom. de views' }
    ],
    instagram: [
      { key: 'totalFollowers', label: 'Seguidores totales' },
      { key: 'newFollowers', label: 'Nuevos seguidores (neg. si se perdieron)' },
      { key: 'reach', label: 'Alcance semanal' },
      { key: 'reels', label: 'Reels publicados' },
      { key: 'carousels', label: 'Carruseles publicados' },
      { key: 'stories', label: 'Historias publicadas' }
    ],
    tiktok: [
      { key: 'totalFollowers', label: 'Seguidores totales' },
      { key: 'newFollowers', label: 'Nuevos seguidores (neg. si se perdieron)' }
    ]
  };
  return map[platform] || [];
}

function getExtraTextFields(platform, curr, prev) {
  if (platform === 'spotify') {
    return `
      <div class="form-group">
        <label>Nombre último lanzamiento (opcional)</label>
        <input type="text" id="curr-latestReleaseName" value="${curr.latestReleaseName || ''}" placeholder="Ej: Nombre del sencillo"
          style="width:100%; padding:10px 14px; background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:6px; font-size:0.9rem;" />
      </div>
    `;
  }
  if (platform === 'youtube') {
    return `
      <div class="form-group">
        <label>Título último video (opcional)</label>
        <input type="text" id="curr-latestVideoTitle" value="${curr.latestVideoTitle || ''}" placeholder="Ej: Título del video"
          style="width:100%; padding:10px 14px; background:var(--bg2); border:1px solid var(--border); color:var(--text); border-radius:6px; font-size:0.9rem;" />
      </div>
    `;
  }
  return '';
}

async function saveMetrics(id, platform) {
  const artist = state.artist;
  const fields = getMetricFields(platform);

  const prevData = {};
  const currData = {};

  for (const f of fields) {
    const pv = document.getElementById(`prev-${f.key}`);
    const cv = document.getElementById(`curr-${f.key}`);
    if (pv) prevData[f.key] = pv.value !== '' ? Number(pv.value) : 0;
    if (cv) currData[f.key] = cv.value !== '' ? Number(cv.value) : 0;
  }

  // Extra text fields
  const extras = ['latestReleaseName', 'latestVideoTitle'];
  for (const e of extras) {
    const el = document.getElementById(`curr-${e}`);
    if (el) currData[e] = el.value;
  }

  // Week labels
  const prevLabel = document.getElementById('prev-weekLabel')?.value;
  const currLabel = document.getElementById('curr-weekLabel')?.value;

  const weeklyData = {
    prevWeek: { ...artist.weeklyData?.prevWeek, [platform]: prevData, weekLabel: prevLabel || artist.weeklyData?.prevWeek?.weekLabel || '' },
    currWeek: { ...artist.weeklyData?.currWeek, [platform]: currData, weekLabel: currLabel || artist.weeklyData?.currWeek?.weekLabel || '' }
  };

  try {
    const updated = await PUT(`/artists/${id}`, { weeklyData });
    state.artist = updated;
    closeModal();
    toast(`Métricas de ${capitalize(platform)} guardadas`, 'success');
    renderDetail(updated);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ==================== API CONFIGS ====================
function showSpotifyConfigModal(id) {
  const artist = state.artist;
  const c = artist?.credentials?.spotify || {};

  openModal(`
    <div class="modal-header">
      <span class="modal-title">🎵 Configurar Spotify</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-info">
        Conecta la cuenta de Spotify del artista mediante OAuth para obtener datos automáticamente.
        También puedes ingresar el Spotify Artist ID para obtener datos del perfil público del artista.
      </div>

      <div class="form-section-title">App Personalizada (opcional)</div>
      <p style="font-size:0.82rem; color:var(--text2); margin-bottom:14px;">
        Si tienes un cliente_id/secret propio en Spotify Developer, ingrésalos aquí.
        De lo contrario se usarán las credenciales globales.
      </p>
      <div class="form-row">
        <div class="form-group">
          <label>Client ID</label>
          <input type="text" id="sp-client-id" value="${c.clientId || ''}" placeholder="De Spotify Developer" />
        </div>
        <div class="form-group">
          <label>Client Secret</label>
          <input type="password" id="sp-client-secret" placeholder="Dejar en blanco para mantener" />
        </div>
      </div>

      <div class="form-section-title">Spotify Artist ID</div>
      <div class="form-group">
        <label>ID del artista en Spotify</label>
        <input type="text" id="sp-artist-id" value="${c.spotifyArtistId || ''}"
          placeholder="Ej: 3TVXtAsR1Inumwj472S9r4" />
        <span class="form-hint">Encuéntralo en la URL del perfil del artista en Spotify</span>
      </div>

      ${c.connected
        ? `<div class="alert alert-success" style="margin-top:12px;">✓ Cuenta conectada como: ${c.displayName || c.spotifyUserId || 'Usuario'}</div>`
        : ''}
    </div>
    <div class="modal-footer">
      ${c.connected
        ? `<button class="btn btn-danger btn-sm" onclick="disconnectPlatform('${id}', 'spotify')">Desconectar</button>`
        : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-secondary" onclick="saveSpotifyConfig('${id}')">Guardar config</button>
      <button class="btn btn-primary" onclick="connectSpotify('${id}')">🔗 Conectar con OAuth</button>
    </div>
  `);
}

async function saveSpotifyConfig(id) {
  const clientId = document.getElementById('sp-client-id')?.value.trim();
  const clientSecret = document.getElementById('sp-client-secret')?.value.trim();
  const spotifyArtistId = document.getElementById('sp-artist-id')?.value.trim();

  try {
    await POST(`/spotify/config/${id}`, {
      ...(clientId && { clientId }),
      ...(clientSecret && { clientSecret }),
      ...(spotifyArtistId !== undefined && { spotifyArtistId })
    });
    toast('Configuración de Spotify guardada', 'success');
    closeModal();
    await loadArtist(id);
    renderDetail(state.artist);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function connectSpotify(id) {
  try {
    const { url } = await GET(`/spotify/auth/${id}`);
    window.location.href = url;
  } catch (e) {
    toast('Error al iniciar OAuth: ' + e.message, 'error');
  }
}

async function syncSpotify(id) {
  toast('Sincronizando Spotify...', 'info', 2000);
  try {
    const metrics = await GET(`/spotify/metrics/${id}`);
    toast(`Spotify sincronizado. Seguidores: ${fmt(metrics.totalFollowers)}`, 'success');
    // Pre-fill current week
    const artist = await loadArtist(id);
    const weeklyData = {
      currWeek: {
        ...artist.weeklyData?.currWeek,
        spotify: {
          ...artist.weeklyData?.currWeek?.spotify,
          totalFollowers: metrics.totalFollowers || 0
        }
      }
    };
    await PUT(`/artists/${id}`, { weeklyData });
    const updated = await loadArtist(id);
    renderDetail(updated);
    if (metrics.note) toast(metrics.note, 'info', 6000);
  } catch (e) {
    toast('Error sincronizando Spotify: ' + e.message, 'error');
  }
}

function showYouTubeConfigModal(id) {
  const artist = state.artist;
  const c = artist?.credentials?.youtube || {};

  openModal(`
    <div class="modal-header">
      <span class="modal-title">▶️ Configurar YouTube</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-info">
        Necesitas una API Key de Google Cloud Console con YouTube Data API v3 habilitada.
      </div>
      <div class="form-group">
        <label>YouTube API Key</label>
        <input type="password" id="yt-api-key" placeholder="${c.apiKey ? '••••• (guardado)' : 'AIza...'}" />
        <span class="form-hint">Google Cloud Console → APIs → YouTube Data API v3 → Credenciales</span>
      </div>
      <div class="form-group">
        <label>Channel ID</label>
        <input type="text" id="yt-channel-id" value="${c.channelId || ''}" placeholder="UCxxxxxxxxxxxxxx" />
        <span class="form-hint">Encuéntralo en YouTube Studio → Configuración → Info del canal</span>
      </div>
    </div>
    <div class="modal-footer">
      ${c.connected
        ? `<button class="btn btn-danger btn-sm" onclick="disconnectPlatform('${id}', 'youtube')">Desconectar</button>`
        : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="saveYouTubeConfig('${id}')">Guardar</button>
    </div>
  `);
}

async function saveYouTubeConfig(id) {
  const apiKey = document.getElementById('yt-api-key')?.value.trim();
  const channelId = document.getElementById('yt-channel-id')?.value.trim();
  if (!channelId) { toast('Channel ID es requerido', 'error'); return; }

  try {
    await POST(`/youtube/config/${id}`, { apiKey: apiKey || undefined, channelId });
    toast('YouTube configurado correctamente', 'success');
    closeModal();
    const updated = await loadArtist(id);
    renderDetail(updated);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function syncYouTube(id) {
  toast('Sincronizando YouTube...', 'info', 2000);
  try {
    const metrics = await GET(`/youtube/metrics/${id}`);
    toast(`YouTube sincronizado. Suscriptores: ${fmt(metrics.totalSubscribers)}`, 'success');

    const artist = await loadArtist(id);
    const weeklyData = {
      currWeek: {
        ...artist.weeklyData?.currWeek,
        youtube: {
          ...artist.weeklyData?.currWeek?.youtube,
          totalSubscribers: metrics.totalSubscribers || 0,
          latestVideoViews: metrics.latestVideo?.totalViews || 0,
          avgViews: metrics.latestVideo?.avgDailyViews ? metrics.latestVideo.avgDailyViews * 7 : 0,
          latestVideoTitle: metrics.latestVideo?.title || ''
        }
      }
    };
    await PUT(`/artists/${id}`, { weeklyData });
    const updated = await loadArtist(id);
    renderDetail(updated);
  } catch (e) {
    toast('Error sincronizando YouTube: ' + e.message, 'error');
  }
}

function showInstagramConfigModal(id) {
  const artist = state.artist;
  const c = artist?.credentials?.instagram || {};

  openModal(`
    <div class="modal-header">
      <span class="modal-title">📷 Configurar Instagram</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <div class="alert alert-info">
        Instagram requiere una cuenta Business/Creator y una app de Meta Developers.
        Puedes ingresar el token de acceso directamente si ya lo tienes.
      </div>

      <div class="form-section-title">Credenciales de la App</div>
      <div class="form-row">
        <div class="form-group">
          <label>App ID</label>
          <input type="text" id="ig-app-id" value="${c.appId || ''}" placeholder="De Meta for Developers" />
        </div>
        <div class="form-group">
          <label>App Secret</label>
          <input type="password" id="ig-app-secret" placeholder="${c.appSecret ? '(guardado)' : 'App Secret'}" />
        </div>
      </div>

      <div class="form-section-title">O Token Manual</div>
      <div class="form-group">
        <label>Access Token (larga duración)</label>
        <input type="password" id="ig-access-token" placeholder="${c.accessToken ? '(guardado)' : 'EAAxxxxxxxx...'}" />
        <span class="form-hint">Token de larga duración de Instagram Graph API</span>
      </div>

      ${c.connected
        ? `<div class="alert alert-success">✓ Cuenta conectada</div>`
        : ''}
    </div>
    <div class="modal-footer">
      ${c.connected
        ? `<button class="btn btn-danger btn-sm" onclick="disconnectPlatform('${id}', 'instagram')">Desconectar</button>`
        : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-secondary" onclick="saveInstagramConfig('${id}')">Guardar config</button>
      <button class="btn btn-primary" onclick="connectInstagram('${id}')">🔗 Conectar con OAuth</button>
    </div>
  `);
}

async function saveInstagramConfig(id) {
  const appId = document.getElementById('ig-app-id')?.value.trim();
  const appSecret = document.getElementById('ig-app-secret')?.value.trim();
  const accessToken = document.getElementById('ig-access-token')?.value.trim();

  try {
    await POST(`/instagram/config/${id}`, {
      ...(appId && { appId }),
      ...(appSecret && { appSecret }),
      ...(accessToken && { accessToken })
    });
    toast('Instagram configurado', 'success');
    closeModal();
    const updated = await loadArtist(id);
    renderDetail(updated);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function connectInstagram(id) {
  try {
    const { url } = await GET(`/instagram/auth/${id}`);
    window.location.href = url;
  } catch (e) {
    toast('Error al iniciar OAuth: ' + e.message, 'error');
  }
}

async function syncInstagram(id) {
  toast('Sincronizando Instagram...', 'info', 2000);
  try {
    const metrics = await GET(`/instagram/metrics/${id}`);
    toast(`Instagram sincronizado. Seguidores: ${fmt(metrics.totalFollowers)}`, 'success');

    const artist = await loadArtist(id);
    const weeklyData = {
      currWeek: {
        ...artist.weeklyData?.currWeek,
        instagram: {
          ...artist.weeklyData?.currWeek?.instagram,
          totalFollowers: metrics.totalFollowers || 0,
          reels: metrics.currWeek?.reels || 0,
          carousels: metrics.currWeek?.carousels || 0
        }
      }
    };
    await PUT(`/artists/${id}`, { weeklyData });
    const updated = await loadArtist(id);
    renderDetail(updated);
  } catch (e) {
    toast('Error sincronizando Instagram: ' + e.message, 'error');
  }
}

async function disconnectPlatform(id, platform) {
  const endpoints = {
    spotify: `/spotify/disconnect/${id}`,
    youtube: `/youtube/disconnect/${id}`,
    instagram: `/instagram/disconnect/${id}`
  };

  try {
    await DEL(endpoints[platform]);
    toast(`${capitalize(platform)} desconectado`, 'info');
    closeModal();
    const updated = await loadArtist(id);
    renderDetail(updated);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ==================== PDF GENERATION ====================
async function generatePDF(artistId) {
  const artist = state.artist;
  if (!artist) return;

  toast('Generando PDF...', 'info', 3000);

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [297, 167] });

    const platforms = [
      { key: 'spotify', name: 'SPOTIFY', icon: '♪', color: '#1db954' },
      { key: 'youtube', name: 'YOUTUBE', icon: '▶', color: '#ff0000' },
      { key: 'instagram', name: 'INSTAGRAM', icon: '◈', color: '#e1306c' },
      { key: 'tiktok', name: 'TIKTOK', icon: '♬', color: '#ee1d52' }
    ];

    for (let i = 0; i < platforms.length; i++) {
      if (i > 0) doc.addPage();
      await drawPlatformSlide(doc, artist, platforms[i]);
    }

    // Summary slide
    doc.addPage();
    await drawSummarySlide(doc, artist);

    doc.save(`${artist.name.replace(/[^a-z0-9]/gi, '_')}_metrics.pdf`);
    toast('PDF generado correctamente', 'success');
  } catch (e) {
    console.error('PDF error:', e);
    toast('Error generando PDF: ' + e.message, 'error');
  }
}

async function drawPlatformSlide(doc, artist, platform) {
  const canvas = document.getElementById('pdf-canvas');
  const W = 1920, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const curr = artist.weeklyData?.currWeek?.[platform.key] || {};
  const prev = artist.weeklyData?.prevWeek?.[platform.key] || {};
  const prevLabel = artist.weeklyData?.prevWeek?.weekLabel || 'Sem. Anterior';
  const currLabel = artist.weeklyData?.currWeek?.weekLabel || 'Sem. Actual';

  // Background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Top gradient bar
  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0, '#7c3aed');
  barGrad.addColorStop(1, '#e040fb');
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, 0, W, 8);

  // Glow behind title
  const glow = ctx.createRadialGradient(960, 200, 50, 960, 200, 400);
  glow.addColorStop(0, 'rgba(224,64,251,0.12)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Artist name (top-left)
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 36px Inter, Arial, sans-serif';
  ctx.fillText(artist.name, 80, 80);

  // Platform name (centered, large)
  const titleGrad = ctx.createLinearGradient(0, 100, W, 260);
  titleGrad.addColorStop(0, '#e040fb');
  titleGrad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = titleGrad;
  ctx.font = 'bold 140px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(platform.name, W / 2, 220);

  // Gradient divider
  const div = ctx.createLinearGradient(160, 0, W - 160, 0);
  div.addColorStop(0, 'transparent');
  div.addColorStop(0.1, '#7c3aed');
  div.addColorStop(0.9, '#e040fb');
  div.addColorStop(1, 'transparent');
  ctx.fillStyle = div;
  ctx.fillRect(160, 250, W - 320, 2);

  // Column headers
  ctx.textAlign = 'center';
  ctx.font = 'bold 32px Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('MÉTRICA', 420, 320);
  ctx.fillText(prevLabel.toUpperCase(), 960, 320);
  ctx.fillText(currLabel.toUpperCase(), 1380, 320);
  ctx.fillText('CAMBIO', 1750, 320);

  // Horizontal line under headers
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(160, 335, W - 320, 1);

  // Metrics rows
  const fields = getMetricFields(platform.key);
  const rowH = 96;
  const startY = 380;

  fields.forEach((f, i) => {
    const y = startY + i * rowH;
    const pv = prev[f.key] ?? 0;
    const cv = curr[f.key] ?? 0;
    const change = pv > 0 ? ((cv - pv) / Math.abs(pv)) * 100 : null;

    // Row bg (alternating)
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      ctx.fillRect(160, y - 34, W - 320, rowH - 6);
    }

    // Label
    ctx.textAlign = 'left';
    ctx.font = '500 34px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(f.label, 200, y);

    // Prev value
    ctx.textAlign = 'center';
    ctx.font = 'bold 38px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(pv > 0 ? pv.toLocaleString('es-ES') : '—', 960, y);

    // Curr value
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cv > 0 ? cv.toLocaleString('es-ES') : '—', 1380, y);

    // Change badge
    if (change !== null) {
      const sign = change > 0 ? '+' : '';
      const color = change > 0 ? '#4ade80' : change < 0 ? '#f87171' : '#6b7280';
      const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
      ctx.fillStyle = color;
      ctx.font = 'bold 38px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${arrow} ${sign}${change.toFixed(1)}%`, 1750, y);
    }
  });

  // Bottom divider
  ctx.fillStyle = div;
  ctx.fillRect(160, H - 80, W - 320, 2);

  // Date
  ctx.textAlign = 'left';
  ctx.font = '400 28px Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText(`Generado: ${new Date().toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })}`, 80, H - 36);

  // Artist metrics logo
  ctx.textAlign = 'right';
  const logoGrad = ctx.createLinearGradient(W - 400, 0, W - 80, 0);
  logoGrad.addColorStop(0, '#7c3aed');
  logoGrad.addColorStop(1, '#e040fb');
  ctx.fillStyle = logoGrad;
  ctx.font = 'bold 28px Inter, Arial, sans-serif';
  ctx.fillText('Artist Metrics Dashboard', W - 80, H - 36);

  // Add to PDF
  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  doc.addImage(imgData, 'JPEG', 0, 0, 297, 167);
}

async function drawSummarySlide(doc, artist) {
  const canvas = document.getElementById('pdf-canvas');
  const W = 1920, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const curr = artist.weeklyData?.currWeek || {};
  const prev = artist.weeklyData?.prevWeek || {};
  const currLabel = curr.weekLabel || 'Semana Actual';
  const prevLabel = prev.weekLabel || 'Semana Anterior';

  // Background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, W, H);

  // Top bar
  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0, '#7c3aed');
  barGrad.addColorStop(1, '#e040fb');
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, 0, W, 8);

  // Central glow
  const glow = ctx.createRadialGradient(960, 540, 100, 960, 540, 600);
  glow.addColorStop(0, 'rgba(124,58,237,0.08)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Artist name
  ctx.font = 'bold 80px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  const nameGrad = ctx.createLinearGradient(0, 0, W, 0);
  nameGrad.addColorStop(0, '#e040fb');
  nameGrad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = nameGrad;
  ctx.fillText(artist.name.toUpperCase(), W / 2, 130);

  ctx.font = '400 36px Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(`${prevLabel}  →  ${currLabel}`, W / 2, 190);

  // Divider
  const div = ctx.createLinearGradient(200, 0, W - 200, 0);
  div.addColorStop(0, 'transparent');
  div.addColorStop(0.1, '#7c3aed');
  div.addColorStop(0.9, '#e040fb');
  div.addColorStop(1, 'transparent');
  ctx.fillStyle = div;
  ctx.fillRect(200, 220, W - 400, 2);

  // Platform summary cards
  const platforms = [
    {
      name: 'SPOTIFY', color: '#1db954',
      lines: [
        ['Oyentes', curr.spotify?.listeners, prev.spotify?.listeners],
        ['Seguidores', curr.spotify?.totalFollowers, prev.spotify?.totalFollowers]
      ]
    },
    {
      name: 'YOUTUBE', color: '#ff0000',
      lines: [
        ['Suscriptores', curr.youtube?.totalSubscribers, prev.youtube?.totalSubscribers],
        ['Views último video', curr.youtube?.latestVideoViews, prev.youtube?.latestVideoViews]
      ]
    },
    {
      name: 'INSTAGRAM', color: '#e1306c',
      lines: [
        ['Seguidores', curr.instagram?.totalFollowers, prev.instagram?.totalFollowers],
        ['Alcance semanal', curr.instagram?.reach, prev.instagram?.reach]
      ]
    },
    {
      name: 'TIKTOK', color: '#ee1d52',
      lines: [
        ['Seguidores', curr.tiktok?.totalFollowers, prev.tiktok?.totalFollowers],
        ['Nuevos seguidores', curr.tiktok?.newFollowers, prev.tiktok?.newFollowers]
      ]
    }
  ];

  const cardW = 380, cardH = 260, gap = 40;
  const totalW = platforms.length * cardW + (platforms.length - 1) * gap;
  let startX = (W - totalW) / 2;
  const startY = 300;

  platforms.forEach((p, i) => {
    const cx = startX + i * (cardW + gap);

    // Card bg
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.roundRect(cx, startY, cardW, cardH, 16);
    ctx.fill();

    // Left color accent
    ctx.fillStyle = p.color;
    ctx.fillRect(cx, startY, 4, cardH);

    // Platform name
    ctx.font = 'bold 32px Inter, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = p.color;
    ctx.fillText(p.name, cx + 24, startY + 52);

    // Metrics
    p.lines.forEach(([label, cv, pv], j) => {
      const ly = startY + 110 + j * 80;
      ctx.font = '400 26px Inter, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(label, cx + 24, ly);

      ctx.font = 'bold 32px Inter, Arial, sans-serif';
      ctx.fillStyle = '#ffffff';
      const val = (cv ?? 0) > 0 ? (cv ?? 0).toLocaleString('es-ES') : '—';
      ctx.fillText(val, cx + 24, ly + 38);

      if (pv && cv !== undefined) {
        const ch = pv > 0 ? ((cv - pv) / Math.abs(pv) * 100) : null;
        if (ch !== null) {
          const sign = ch > 0 ? '+' : '';
          const arrow = ch > 0 ? '↑' : ch < 0 ? '↓' : '→';
          ctx.font = 'bold 26px Inter, Arial, sans-serif';
          ctx.fillStyle = ch > 0 ? '#4ade80' : ch < 0 ? '#f87171' : '#6b7280';
          ctx.fillText(`${arrow} ${sign}${ch.toFixed(1)}%`, cx + cardW - 140, ly + 38);
        }
      }
    });
  });

  // Bottom
  ctx.fillStyle = div;
  ctx.fillRect(200, H - 80, W - 400, 2);
  ctx.textAlign = 'left';
  ctx.font = '400 26px Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillText(`Generado: ${new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}`, 80, H - 36);

  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  doc.addImage(imgData, 'JPEG', 0, 0, 297, 167);
}
