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
