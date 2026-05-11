const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getArtist, saveArtist } = require('../lib/storage');

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-follow-read',
  'user-top-read',
  'user-read-recently-played'
].join(' ');

function creds(artist) {
  const c = artist.credentials.spotify;
  return {
    clientId: c.clientId || process.env.SPOTIFY_CLIENT_ID,
    clientSecret: c.clientSecret || process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || `${process.env.BASE_URL || 'http://localhost:3000'}/api/spotify/callback`
  };
}

// GET /api/spotify/auth/:artistId — generate OAuth URL
router.get('/auth/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { clientId, redirectUri } = creds(artist);
  if (!clientId) return res.status(400).json({ error: 'SPOTIFY_CLIENT_ID no configurado' });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    state: req.params.artistId,
    show_dialog: 'true'
  });

  res.json({ url: `${AUTH_URL}?${params}` });
});

// GET /api/spotify/callback — OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state: artistId, error } = req.query;
  if (error) return res.redirect(`/?error=spotify_denied&artistId=${artistId}`);

  const artist = getArtist(artistId);
  if (!artist) return res.redirect('/?error=artist_not_found');

  const { clientId, clientSecret, redirectUri } = creds(artist);

  try {
    const { data } = await axios.post(TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const profileRes = await axios.get(`${API_URL}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });

    artist.credentials.spotify = {
      ...artist.credentials.spotify,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      spotifyUserId: profileRes.data.id,
      displayName: profileRes.data.display_name,
      connected: true
    };

    saveArtist(artist);
    res.redirect(`/?success=spotify_connected&artistId=${artistId}`);
  } catch (err) {
    console.error('Spotify callback error:', err.response?.data || err.message);
    res.redirect(`/?error=spotify_auth_failed&artistId=${artistId}`);
  }
});

// Helper: get valid (possibly refreshed) token
async function getToken(artist) {
  const c = artist.credentials.spotify;
  if (!c.accessToken) throw new Error('Spotify no conectado');

  if (Date.now() > c.expiresAt - 60_000) {
    const { clientId, clientSecret } = creds(artist);
    const { data } = await axios.post(TOKEN_URL,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken }),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    c.accessToken = data.access_token;
    c.expiresAt = Date.now() + data.expires_in * 1000;
    if (data.refresh_token) c.refreshToken = data.refresh_token;
    saveArtist(artist);
  }

  return c.accessToken;
}

// GET /api/spotify/metrics/:artistId — fetch metrics
router.get('/metrics/:artistId', async (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });
  if (!artist.credentials.spotify?.connected) {
    return res.status(400).json({ error: 'Spotify no conectado' });
  }

  try {
    const token = await getToken(artist);
    const headers = { Authorization: `Bearer ${token}` };

    const [profileRes, topTracksRes, recentRes] = await Promise.allSettled([
      axios.get(`${API_URL}/me`, { headers }),
      axios.get(`${API_URL}/me/top/tracks?limit=5&time_range=short_term`, { headers }),
      axios.get(`${API_URL}/me/player/recently-played?limit=50`, { headers })
    ]);

    const profile = profileRes.status === 'fulfilled' ? profileRes.value.data : {};
    const topTracks = topTracksRes.status === 'fulfilled' ? topTracksRes.value.data.items : [];
    const recent = recentRes.status === 'fulfilled' ? recentRes.value.data.items : [];

    // If spotifyArtistId is configured, fetch artist data too
    let artistData = null;
    if (artist.credentials.spotify.spotifyArtistId) {
      try {
        const aRes = await axios.get(
          `${API_URL}/artists/${artist.credentials.spotify.spotifyArtistId}`,
          { headers }
        );
        artistData = aRes.data;
      } catch {}
    }

    const metrics = {
      totalFollowers: artistData?.followers?.total ?? profile.followers?.total ?? 0,
      displayName: artistData?.name ?? profile.display_name ?? '',
      image: artistData?.images?.[0]?.url ?? profile.images?.[0]?.url ?? null,
      popularity: artistData?.popularity ?? 0,
      topTracks: topTracks.slice(0, 5).map(t => ({
        name: t.name,
        id: t.id,
        popularity: t.popularity,
        streams: null // not available via public API
      })),
      recentPlayCount: recent.length,
      fetchedAt: new Date().toISOString(),
      note: 'Oyentes semanales y streams exactos solo están disponibles en Spotify for Artists. Usa entrada manual para esas métricas.'
    };

    res.json(metrics);
  } catch (err) {
    console.error('Spotify metrics error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// POST /api/spotify/config/:artistId — save Spotify Artist ID & optional custom app creds
router.post('/config/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { spotifyArtistId, clientId, clientSecret } = req.body;
  const c = artist.credentials.spotify;

  if (spotifyArtistId !== undefined) c.spotifyArtistId = spotifyArtistId;
  if (clientId) c.clientId = clientId;
  if (clientSecret) c.clientSecret = clientSecret;

  saveArtist(artist);
  res.json({ ok: true });
});

// DELETE /api/spotify/disconnect/:artistId
router.delete('/disconnect/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  artist.credentials.spotify = {
    clientId: artist.credentials.spotify.clientId,
    clientSecret: artist.credentials.spotify.clientSecret,
    spotifyArtistId: artist.credentials.spotify.spotifyArtistId,
    connected: false
  };

  saveArtist(artist);
  res.json({ ok: true });
});

module.exports = router;
