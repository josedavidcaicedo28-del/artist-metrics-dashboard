/**
 * Storage abstraction:
 *   - Local dev  → JSON files in ./data/
 *   - Vercel     → Vercel KV (Redis) when KV_REST_API_URL is set
 *
 * All exports are async so callers use `await` uniformly.
 */

const fs   = require('fs');
const path = require('path');

// Vercel KV is available when these env vars exist (auto-added when you link a KV store)
const USE_KV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// ── KV helpers (lazy-require so local dev without the package still works) ──
function kv() {
  return require('@vercel/kv').kv;
}

async function kvGet(key)        { return (await kv().get(key)) ?? null; }
async function kvSet(key, value) { await kv().set(key, JSON.stringify(value)); }
async function kvDel(key)        { await kv().del(key); }

// ── File-system helpers (local only) ────────────────────────────────────────
function getDir() {
  return global.DATA_DIR || path.join(process.cwd(), 'data');
}
function ensureDir() {
  const dir = getDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function fsRead(file, fallback) {
  try {
    const p = path.join(ensureDir(), file);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return fallback; }
}
function fsWrite(file, data) {
  fs.writeFileSync(path.join(ensureDir(), file), JSON.stringify(data, null, 2), 'utf8');
}

// ── Public API ───────────────────────────────────────────────────────────────

async function getArtistsIndex() {
  if (USE_KV) {
    const raw = await kv().get('artists:index');
    if (!raw) return [];
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return fsRead('index.json', []);
}

async function getArtist(id) {
  if (USE_KV) {
    const raw = await kv().get(`artist:${id}`);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  return fsRead(`artist_${id}.json`, null);
}

async function saveArtist(artist) {
  const summary = {
    id:        artist.id,
    name:      artist.name,
    image:     artist.image || null,
    createdAt: artist.createdAt,
    connected: {
      spotify:   !!artist.credentials?.spotify?.connected,
      youtube:   !!artist.credentials?.youtube?.connected,
      instagram: !!artist.credentials?.instagram?.connected,
      tiktok:    !!artist.credentials?.tiktok?.connected
    }
  };

  if (USE_KV) {
    await kv().set(`artist:${artist.id}`, JSON.stringify(artist));
    const raw   = await kv().get('artists:index');
    const index = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    const idx   = index.findIndex(a => a.id === artist.id);
    if (idx >= 0) index[idx] = summary; else index.push(summary);
    await kv().set('artists:index', JSON.stringify(index));
  } else {
    fsWrite(`artist_${artist.id}.json`, artist);
    const index = fsRead('index.json', []);
    const idx   = index.findIndex(a => a.id === artist.id);
    if (idx >= 0) index[idx] = summary; else index.push(summary);
    fsWrite('index.json', index);
  }

  return artist;
}

async function deleteArtist(id) {
  if (USE_KV) {
    await kv().del(`artist:${id}`);
    const raw   = await kv().get('artists:index');
    const index = (raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [])
                    .filter(a => a.id !== id);
    await kv().set('artists:index', JSON.stringify(index));
  } else {
    const fp = path.join(ensureDir(), `artist_${id}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    fsWrite('index.json', fsRead('index.json', []).filter(a => a.id !== id));
  }
}

module.exports = { getArtistsIndex, getArtist, saveArtist, deleteArtist, USE_KV };
