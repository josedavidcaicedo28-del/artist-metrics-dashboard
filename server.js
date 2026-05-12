require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In Vercel use /tmp (ephemeral), locally use ./data
const DATA_DIR = process.env.VERCEL
  ? '/tmp/artist-metrics'
  : path.join(__dirname, 'data');

try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.warn('Could not create data dir:', e.message);
}

global.DATA_DIR = DATA_DIR;

app.use('/api/artists', require('./api/artists'));
app.use('/api/spotify', require('./api/spotify'));
app.use('/api/youtube', require('./api/youtube'));
app.use('/api/instagram', require('./api/instagram'));

// Temporary diagnostic endpoint — shows what's stored without exposing tokens
app.get('/api/debug/artist/:id', async (req, res) => {
  const { getArtist, USE_REDIS } = require('./lib/storage');
  try {
    const artist = await getArtist(req.params.id);
    if (!artist) return res.json({ found: false, storage: USE_REDIS ? 'redis' : 'files' });

    const sp = artist.credentials?.spotify || {};
    res.json({
      found:          true,
      storage:        USE_REDIS ? 'redis' : 'files',
      artistName:     artist.name,
      spotify: {
        connected:       sp.connected,
        spotifyArtistId: sp.spotifyArtistId || null,
        hasAccessToken:  !!sp.accessToken,
        hasRefreshToken: !!sp.refreshToken,
        hasClientId:     !!sp.clientId,
        spotifyUserId:   sp.spotifyUserId || null
      },
      envVars: {
        SPOTIFY_CLIENT_ID:     !!process.env.SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET: !!process.env.SPOTIFY_CLIENT_SECRET,
        UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🎵  Artist Metrics Dashboard`);
    console.log(`    http://localhost:${PORT}\n`);
  });
}

module.exports = app;
