const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getArtistsIndex, getArtist, saveArtist, deleteArtist } = require('../lib/storage');

// GET /api/artists — list all
router.get('/', (req, res) => {
  res.json(getArtistsIndex());
});

// GET /api/artists/:id — single artist (redacts tokens)
router.get('/:id', (req, res) => {
  const artist = getArtist(req.params.id);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });
  res.json(redact(artist));
});

// POST /api/artists — create
router.post('/', (req, res) => {
  const { name, image } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const artist = {
    id: uuidv4(),
    name: name.trim(),
    image: image || null,
    createdAt: new Date().toISOString(),
    credentials: {
      spotify: { connected: false },
      youtube: { connected: false },
      instagram: { connected: false },
      tiktok: { connected: false }
    },
    weeklyData: emptyWeeklyData()
  };

  saveArtist(artist);
  res.status(201).json(redact(artist));
});

// PUT /api/artists/:id — update name/image/weeklyData
router.put('/:id', (req, res) => {
  const artist = getArtist(req.params.id);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  if (req.body.name) artist.name = req.body.name.trim();
  if (req.body.image !== undefined) artist.image = req.body.image;
  if (req.body.weeklyData) {
    artist.weeklyData = deepMerge(artist.weeklyData, req.body.weeklyData);
  }

  saveArtist(artist);
  res.json(redact(artist));
});

// DELETE /api/artists/:id
router.delete('/:id', (req, res) => {
  deleteArtist(req.params.id);
  res.json({ ok: true });
});

// POST /api/artists/:id/credentials — save platform credentials
router.post('/:id/credentials', (req, res) => {
  const artist = getArtist(req.params.id);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { platform, credentials } = req.body;
  const valid = ['spotify', 'youtube', 'instagram', 'tiktok'];
  if (!valid.includes(platform)) return res.status(400).json({ error: 'Plataforma inválida' });

  artist.credentials[platform] = {
    ...artist.credentials[platform],
    ...credentials,
    connected: true
  };

  saveArtist(artist);
  res.json({ ok: true, connected: true });
});

// POST /api/artists/:id/advance-week — move curr → prev, clear curr
router.post('/:id/advance-week', (req, res) => {
  const artist = getArtist(req.params.id);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  artist.weeklyData.prevWeek = JSON.parse(JSON.stringify(artist.weeklyData.currWeek));
  artist.weeklyData.currWeek = emptyWeeklyData().currWeek;

  saveArtist(artist);
  res.json({ ok: true });
});

// POST /api/artists/:id/copy-to-prev — copy curr → prev without clearing curr
router.post('/:id/copy-to-prev', (req, res) => {
  const artist = getArtist(req.params.id);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  artist.weeklyData.prevWeek = JSON.parse(JSON.stringify(artist.weeklyData.currWeek));

  saveArtist(artist);
  res.json({ ok: true });
});

// ==================== helpers ====================

function redact(artist) {
  const clone = JSON.parse(JSON.stringify(artist));
  for (const platform of Object.keys(clone.credentials || {})) {
    const c = clone.credentials[platform];
    if (c.accessToken) c.accessToken = '[stored]';
    if (c.refreshToken) c.refreshToken = '[stored]';
    if (c.clientSecret) c.clientSecret = '[stored]';
    if (c.appSecret) c.appSecret = '[stored]';
    if (c.apiKey) c.apiKey = '[stored]';
  }
  return clone;
}

function emptyWeeklyData() {
  const week = () => ({
    weekLabel: '',
    spotify: {
      listeners: 0,
      streams: 0,
      avgDailyStreams: 0,
      newFollowers: 0,
      totalFollowers: 0,
      latestReleaseName: ''
    },
    youtube: {
      newSubscribers: 0,
      totalSubscribers: 0,
      latestVideoViews: 0,
      latestVideoTitle: '',
      avgViews: 0
    },
    instagram: {
      newFollowers: 0,
      totalFollowers: 0,
      reach: 0,
      reels: 0,
      carousels: 0,
      stories: 0
    },
    tiktok: {
      newFollowers: 0,
      totalFollowers: 0
    }
  });
  return { prevWeek: week(), currWeek: week() };
}

function deepMerge(target, source) {
  if (!target || typeof target !== 'object') return source;
  const out = { ...target };
  for (const k of Object.keys(source)) {
    if (source[k] !== null && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      out[k] = deepMerge(target[k] || {}, source[k]);
    } else {
      out[k] = source[k];
    }
  }
  return out;
}

module.exports = router;
