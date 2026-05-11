const fs = require('fs');
const path = require('path');

function getDir() {
  return global.DATA_DIR || path.join(process.cwd(), 'data');
}

function ensureDir() {
  const dir = getDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getIndexPath() {
  return path.join(ensureDir(), 'index.json');
}

function getArtistPath(id) {
  return path.join(ensureDir(), `artist_${id}.json`);
}

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getArtistsIndex() {
  return readJSON(getIndexPath(), []);
}

function getArtist(id) {
  return readJSON(getArtistPath(id), null);
}

function saveArtist(artist) {
  writeJSON(getArtistPath(artist.id), artist);

  const index = getArtistsIndex();
  const idx = index.findIndex(a => a.id === artist.id);
  const summary = {
    id: artist.id,
    name: artist.name,
    image: artist.image || null,
    createdAt: artist.createdAt,
    connected: {
      spotify: !!artist.credentials?.spotify?.connected,
      youtube: !!artist.credentials?.youtube?.connected,
      instagram: !!artist.credentials?.instagram?.connected,
      tiktok: !!artist.credentials?.tiktok?.connected
    }
  };

  if (idx >= 0) index[idx] = summary;
  else index.push(summary);

  writeJSON(getIndexPath(), index);
  return artist;
}

function deleteArtist(id) {
  const fp = getArtistPath(id);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  const index = getArtistsIndex().filter(a => a.id !== id);
  writeJSON(getIndexPath(), index);
}

module.exports = { getArtistsIndex, getArtist, saveArtist, deleteArtist };
