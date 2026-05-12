const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getArtist, saveArtist } = require('../lib/storage');

const AUTH_URL  = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL   = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-follow-read',
  'user-top-read',
  'user-read-recently-played'
].join(' ');

// Production URL used as fallback so Vercel doesn't fall back to localhost
const PROD_URL = 'https://artist-metrics-dashboard.vercel.app';

function getRedirectUri() {
  return (
    process.env.SPOTIFY_REDIRECT_URI ||
    `${process.env.BASE_URL || PROD_URL}/api/spotify/callback`
  );
}

function getAppCreds(artist) {
  const c = artist?.credentials?.spotify || {};
  return {
    clientId:     c.clientId     || process.env.SPOTIFY_CLIENT_ID,
    clientSecret: c.clientSecret || process.env.SPOTIFY_CLIENT_SECRET
  };
}

// ─── Client Credentials (no user auth needed, for public artist data) ──────
async function getClientCredentialsToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET son requeridos');
  }
  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return data.access_token;
}

// ─── OAuth token refresh ─────────────────────────────────────────────────────
async function getRefreshedToken(artist) {
  const c = artist.credentials.spotify;
  if (!c?.accessToken) throw new Error('Spotify OAuth no conectado');

  if (Date.now() < c.expiresAt - 60_000) return c.accessToken;

  const { clientId, clientSecret } = getAppCreds(artist);
  const { data } = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken }),
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  c.accessToken = data.access_token;
  c.expiresAt   = Date.now() + data.expires_in * 1000;
  if (data.refresh_token) c.refreshToken = data.refresh_token;
  saveArtist(artist);
  return c.accessToken;
}

// ─── GET /api/spotify/auth/:artistId — generate OAuth URL ───────────────────
router.get('/auth/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { clientId } = getAppCreds(artist);
  if (!clientId) return res.status(400).json({ error: 'SPOTIFY_CLIENT_ID no configurado' });

  // Encode artistId + artist name in state so the callback can recover
  // even if /tmp is empty in the Vercel invocation that receives the redirect
  const statePayload = Buffer.from(
    JSON.stringify({ id: artist.id, name: artist.name })
  ).toString('base64url');

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  getRedirectUri(),
    scope:         SCOPES,
    state:         statePayload,
    show_dialog:   'true'
  });

  res.json({ url: `${AUTH_URL}?${params}` });
});

// ─── GET /api/spotify/callback — OAuth callback ──────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state: stateParam, error } = req.query;

  // Decode state (may be plain artistId for backwards compat, or base64url JSON)
  let artistId, artistName;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
    artistId   = decoded.id;
    artistName = decoded.name;
  } catch {
    // Fallback: state is the raw artistId (old format)
    artistId = stateParam;
  }

  if (error) return res.redirect(`/?error=spotify_denied&artistId=${artistId}`);

  // Try to load from storage; if /tmp is empty (Vercel cold start), reconstruct minimal artist
  let artist = getArtist(artistId);
  if (!artist) {
    if (!artistId) return res.redirect('/?error=artist_not_found');
    // Reconstruct a minimal shell so the token can be stored
    artist = {
      id: artistId,
      name: artistName || 'Artista',
      image: null,
      createdAt: new Date().toISOString(),
      credentials: {
        spotify:   { connected: false },
        youtube:   { connected: false },
        instagram: { connected: false },
        tiktok:    { connected: false }
      },
      weeklyData: { prevWeek: {}, currWeek: {} }
    };
  }

  const { clientId, clientSecret } = getAppCreds(artist);

  try {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: getRedirectUri()
      }),
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
      accessToken:    data.access_token,
      refreshToken:   data.refresh_token,
      expiresAt:      Date.now() + data.expires_in * 1000,
      spotifyUserId:  profileRes.data.id,
      displayName:    profileRes.data.display_name,
      connected:      true
    };

    saveArtist(artist);
    res.redirect(`/?success=spotify_connected&artistId=${artistId}`);
  } catch (err) {
    console.error('Spotify callback error:', err.response?.data || err.message);
    res.redirect(`/?error=spotify_auth_failed&artistId=${artistId}`);
  }
});

// ─── GET /api/spotify/metrics/:artistId — fetch artist metrics ───────────────
// Uses Client Credentials when spotifyArtistId is configured (no OAuth needed).
// Falls back to the user OAuth token for user-specific data if available.
router.get('/metrics/:artistId', async (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { clientId, clientSecret } = getAppCreds(artist);
  const spotifyArtistId = artist.credentials.spotify?.spotifyArtistId;
  const hasOAuth        = !!artist.credentials.spotify?.accessToken;

  if (!clientId) return res.status(400).json({ error: 'SPOTIFY_CLIENT_ID no configurado' });
  if (!spotifyArtistId && !hasOAuth) {
    return res.status(400).json({
      error: 'Configura el Spotify Artist ID o conecta con OAuth primero'
    });
  }

  try {
    let artistData = null;
    let topTracks  = [];
    let recentPlayCount = 0;

    // ── Path A: Client Credentials — public artist data (preferred, no OAuth needed) ──
    if (spotifyArtistId) {
      const ccToken = await getClientCredentialsToken(clientId, clientSecret);
      const headers = { Authorization: `Bearer ${ccToken}` };

      const [artistRes, topTracksRes] = await Promise.allSettled([
        axios.get(`${API_URL}/artists/${spotifyArtistId}`, { headers }),
        axios.get(`${API_URL}/artists/${spotifyArtistId}/top-tracks?market=ES`, { headers })
      ]);

      if (artistRes.status === 'fulfilled') artistData = artistRes.value.data;
      if (topTracksRes.status === 'fulfilled') topTracks = topTracksRes.value.data.tracks || [];
    }

    // ── Path B: OAuth user token — adds recently-played count ──────────────────
    if (hasOAuth) {
      try {
        const oauthToken = await getRefreshedToken(artist);
        const recentRes  = await axios.get(
          `${API_URL}/me/player/recently-played?limit=50`,
          { headers: { Authorization: `Bearer ${oauthToken}` } }
        );
        recentPlayCount = recentRes.data.items?.length || 0;

        // If no spotifyArtistId, fall back to user profile for follower count
        if (!artistData) {
          const profileRes = await axios.get(`${API_URL}/me`, {
            headers: { Authorization: `Bearer ${oauthToken}` }
          });
          artistData = {
            name: profileRes.data.display_name,
            followers: { total: profileRes.data.followers?.total || 0 },
            images: profileRes.data.images || []
          };
        }
      } catch (oauthErr) {
        // OAuth failed (expired + refresh failed) — not fatal if we have CC data
        console.warn('OAuth refresh failed, using Client Credentials only:', oauthErr.message);
      }
    }

    const metrics = {
      totalFollowers:  artistData?.followers?.total ?? 0,
      displayName:     artistData?.name ?? '',
      image:           artistData?.images?.[0]?.url ?? null,
      popularity:      artistData?.popularity ?? 0,
      topTracks: topTracks.slice(0, 5).map(t => ({
        name:       t.name,
        id:         t.id,
        popularity: t.popularity,
        previewUrl: t.preview_url || null
      })),
      recentPlayCount,
      fetchedAt: new Date().toISOString(),
      authMethod: spotifyArtistId ? 'client_credentials' : 'oauth',
      note: 'Oyentes semanales y streams exactos solo están disponibles en Spotify for Artists. Usa ✏️ Editar para ingresar esas métricas manualmente.'
    };

    res.json(metrics);
  } catch (err) {
    console.error('Spotify metrics error:', err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ─── GET /api/spotify/artist-public/:spotifyArtistId — lookup by Spotify ID ──
// No stored artist needed — uses Client Credentials directly.
// Useful to verify an Artist ID before saving it.
router.get('/artist-public/:spotifyArtistId', async (req, res) => {
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  try {
    const token = await getClientCredentialsToken(clientId, clientSecret);
    const { data } = await axios.get(
      `${API_URL}/artists/${req.params.spotifyArtistId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({
      id:        data.id,
      name:      data.name,
      followers: data.followers?.total,
      popularity: data.popularity,
      image:     data.images?.[0]?.url || null,
      genres:    data.genres || []
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    const status = err.response?.status || 500;
    res.status(status).json({ error: msg });
  }
});

// ─── POST /api/spotify/config/:artistId — save Artist ID & optional app creds ─
router.post('/config/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { spotifyArtistId, clientId, clientSecret } = req.body;
  const c = artist.credentials.spotify;

  if (spotifyArtistId !== undefined) c.spotifyArtistId = spotifyArtistId.trim();
  if (clientId)     c.clientId     = clientId.trim();
  if (clientSecret) c.clientSecret = clientSecret.trim();

  // Mark as connected if we have an artistId (Client Credentials path)
  if (spotifyArtistId || c.spotifyArtistId) {
    c.connected = true;
  }

  saveArtist(artist);
  res.json({ ok: true, connected: c.connected });
});

// ─── DELETE /api/spotify/disconnect/:artistId ────────────────────────────────
router.delete('/disconnect/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  artist.credentials.spotify = {
    clientId:         artist.credentials.spotify?.clientId,
    clientSecret:     artist.credentials.spotify?.clientSecret,
    spotifyArtistId:  artist.credentials.spotify?.spotifyArtistId,
    connected:        false
  };

  saveArtist(artist);
  res.json({ ok: true });
});

module.exports = router;
