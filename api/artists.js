const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getArtistsIndex, getArtist, saveArtist, deleteArtist } = require('../lib/storage');

// GET /api/artists
router.get('/', async (req, res) => {
  try {
    res.json(await getArtistsIndex());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/artists/:id
router.get('/:id', async (req, res) => {
  try {
    const artist = await getArtist(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });
    res.json(redact(artist));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/artists — create
router.post('/', async (req, res) => {
  try {
    const { name, image } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const artist = {
      id:        uuidv4(),
      name:      name.trim(),
      image:     image || null,
      createdAt: new Date().toISOString(),
      credentials: {
        spotify:   { connected: false },
        youtube:   { connected: false },
        instagram: { connected: false },
        tiktok:    { connected: false }
      },
      weeklyData: emptyWeeklyData()
    };

    await saveArtist(artist);
    res.status(201).json(redact(artist));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/artists/:id
router.put('/:id', async (req, res) => {
  try {
    const artist = await getArtist(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    if (req.body.name)             artist.name  = req.body.name.trim();
    if (req.body.image !== undefined) artist.image = req.body.image;
    if (req.body.weeklyData)       artist.weeklyData = deepMerge(artist.weeklyData, req.body.weeklyData);

    await saveArtist(artist);
    res.json(redact(artist));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/artists/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteArtist(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/artists/:id/credentials
router.post('/:id/credentials', async (req, res) => {
  try {
    const artist = await getArtist(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const { platform, credentials } = req.body;
    const valid = ['spotify', 'youtube', 'instagram', 'tiktok'];
    if (!valid.includes(platform)) return res.status(400).json({ error: 'Plataforma inválida' });

    artist.credentials[platform] = { ...artist.credentials[platform], ...credentials, connected: true };
    await saveArtist(artist);
    res.json({ ok: true, connected: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/artists/:id/advance-week
router.post('/:id/advance-week', async (req, res) => {
  try {
    const artist = await getArtist(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    artist.weeklyData.prevWeek = JSON.parse(JSON.stringify(artist.weeklyData.currWeek));
    artist.weeklyData.currWeek = emptyWeeklyData().currWeek;

    await saveArtist(artist);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/artists/:id/copy-to-prev
router.post('/:id/copy-to-prev', async (req, res) => {
  try {
    const artist = await getArtist(req.params.id);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    artist.weeklyData.prevWeek = JSON.parse(JSON.stringify(artist.weeklyData.currWeek));
    await saveArtist(artist);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

function redact(artist) {
  const clone = JSON.parse(JSON.stringify(artist));
  for (const p of Object.keys(clone.credentials || {})) {
    const c = clone.credentials[p];
    if (c.accessToken)  c.accessToken  = '[stored]';
    if (c.refreshToken) c.refreshToken = '[stored]';
    if (c.clientSecret) c.clientSecret = '[stored]';
    if (c.appSecret)    c.appSecret    = '[stored]';
    if (c.apiKey)       c.apiKey       = '[stored]';
  }
  return clone;
}

function emptyWeeklyData() {
  const week = () => ({
    weekLabel: '',
    spotify:   { listeners: 0, streams: 0, avgDailyStreams: 0, newFollowers: 0, totalFollowers: 0, latestReleaseName: '' },
    youtube:   { newSubscribers: 0, totalSubscribers: 0, latestVideoViews: 0, latestVideoTitle: '', avgViews: 0 },
    instagram: { newFollowers: 0, totalFollowers: 0, reach: 0, reels: 0, carousels: 0, stories: 0 },
    tiktok:    { newFollowers: 0, totalFollowers: 0 }
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
