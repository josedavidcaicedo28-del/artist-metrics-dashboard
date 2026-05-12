/**
 * Storage abstraction:
 *   - Local dev  → JSON files in ./data/
 *   - Vercel     → Upstash Redis when UPSTASH_REDIS_REST_URL is set
 */

const fs   = require('fs');
const path = require('path');

const USE_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

// Lazy singleton — only instantiated when env vars are present
let _redis = null;
function getRedis() {
  if (!_redis) {
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
  }
  return _redis;
}

// ── File-system helpers (local dev) ─────────────────────────────────────────
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

// ── Public API (always async) ────────────────────────────────────────────────

async function getArtistsIndex() {
  if (USE_REDIS) {
    const val = await getRedis().get('artists:index');
    return val ? (typeof val === 'string' ? JSON.parse(val) : val) : [];
  }
  return fsRead('index.json', []);
}

async function getArtist(id) {
  if (USE_REDIS) {
    const val = await getRedis().get(`artist:${id}`);
    return val ? (typeof val === 'string' ? JSON.parse(val) : val) : null;
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

  if (USE_REDIS) {
    const r = getRedis();
    await r.set(`artist:${artist.id}`, JSON.stringify(artist));
    const raw   = await r.get('artists:index');
    const index = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    const idx   = index.findIndex(a => a.id === artist.id);
    if (idx >= 0) index[idx] = summary; else index.push(summary);
    await r.set('artists:index', JSON.stringify(index));
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
  if (USE_REDIS) {
    const r = getRedis();
    await r.del(`artist:${id}`);
    const raw   = await r.get('artists:index');
    const index = (raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [])
                    .filter(a => a.id !== id);
    await r.set('artists:index', JSON.stringify(index));
  } else {
    const fp = path.join(ensureDir(), `artist_${id}.json`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    fsWrite('index.json', fsRead('index.json', []).filter(a => a.id !== id));
  }
}

module.exports = { getArtistsIndex, getArtist, saveArtist, deleteArtist, USE_REDIS };
