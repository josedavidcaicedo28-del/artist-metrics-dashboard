const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getArtist, saveArtist } = require('../lib/storage');

const AUTH_URL  = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL   = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-private', 'user-read-email',
  'user-follow-read',  'user-top-read',
  'user-read-recently-played'
].join(' ');

const PROD_URL = 'https://artist-metrics-dashboard.vercel.app';

function getRedirectUri() {
  return process.env.SPOTIFY_REDIRECT_URI ||
         `${process.env.BASE_URL || PROD_URL}/api/spotify/callback`;
}

function getAppCreds(artist) {
  const c = artist?.credentials?.spotify || {};
  return {
    clientId:     c.clientId     || process.env.SPOTIFY_CLIENT_ID,
    clientSecret: c.clientSecret || process.env.SPOTIFY_CLIENT_SECRET
  };
}

// ── Client Credentials (no user auth — for public artist data) ───────────────
async function getClientCredentialsToken(clientId, clientSecret) {
  if (!clientId || !clientSecret)
    throw new Error('SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET son requeridos');

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

// ── OAuth token refresh ───────────────────────────────────────────────────────
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
  await saveArtist(artist);
  return c.accessToken;
}

// ── GET /api/spotify/auth/:artistId ──────────────────────────────────────────
router.get('/auth/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const { clientId } = getAppCreds(artist);
    if (!clientId) return res.status(400).json({ error: 'SPOTIFY_CLIENT_ID no configurado' });

    // Encode id + name in state so callback can recover even on cold Vercel instance
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/spotify/callback ─────────────────────────────────────────────────
router.get('/callback', async (req, res) => {
  const { code, state: stateParam, error } = req.query;

  let artistId, artistName;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
    artistId   = decoded.id;
    artistName = decoded.name;
  } catch {
    artistId = stateParam; // legacy plain-id fallback
  }

  if (error) return res.redirect(`/?error=spotify_denied&artistId=${artistId}`);

  // Try storage; if empty (Vercel cold start) reconstruct minimal shell
  let artist = await getArtist(artistId);
  if (!artist) {
    if (!artistId) return res.redirect('/?error=artist_not_found');
    artist = {
      id: artistId, name: artistName || 'Artista', image: null,
      createdAt: new Date().toISOString(),
      credentials: {
        spotify: { connected: false }, youtube: { connected: false },
        instagram: { connected: false }, tiktok: { connected: false }
      },
      weeklyData: { prevWeek: {}, currWeek: {} }
    };
  }

  const { clientId, clientSecret } = getAppCreds(artist);

  try {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: getRedirectUri() }),
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
      accessToken:   data.access_token,
      refreshToken:  data.refresh_token,
      expiresAt:     Date.now() + data.expires_in * 1000,
      spotifyUserId: profileRes.data.id,
      displayName:   profileRes.data.display_name,
      connected:     true
    };

    await saveArtist(artist);
    res.redirect(`/?success=spotify_connected&artistId=${artistId}`);
  } catch (err) {
    console.error('Spotify callback error:', err.response?.data || err.message);
    res.redirect(`/?error=spotify_auth_failed&artistId=${artistId}`);
  }
});

// ── GET /api/spotify/metrics/:artistId ───────────────────────────────────────
router.get('/metrics/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const { clientId, clientSecret } = getAppCreds(artist);
    const spotifyArtistId = artist.credentials.spotify?.spotifyArtistId;
    const hasOAuth        = !!artist.credentials.spotify?.accessToken;

    if (!clientId) return res.status(400).json({ error: 'SPOTIFY_CLIENT_ID no configurado' });
    if (!spotifyArtistId && !hasOAuth)
      return res.status(400).json({ error: 'Configura el Spotify Artist ID o conecta OAuth primero' });

    let artistData = null, topTracks = [], recentPlayCount = 0;

    // Path A: Client Credentials — public artist data (preferred, no user auth needed)
    if (spotifyArtistId) {
      const ccToken = await getClientCredentialsToken(clientId, clientSecret);
      const headers = { Authorization: `Bearer ${ccToken}` };

      const [artistRes, topRes] = await Promise.allSettled([
        axios.get(`${API_URL}/artists/${spotifyArtistId}`, { headers }),
        axios.get(`${API_URL}/artists/${spotifyArtistId}/top-tracks?market=ES`, { headers })
      ]);

      // Surface the real Spotify error instead of silently returning 0
      if (artistRes.status === 'rejected') {
        const spotifyErr = artistRes.reason?.response?.data?.error?.message
                        || artistRes.reason?.message
                        || 'Error consultando Spotify';
        const statusCode = artistRes.reason?.response?.status || 500;
        return res.status(statusCode).json({
          error: `Spotify: ${spotifyErr}`,
          spotifyArtistId,
          hint: 'Verifica que el Spotify Artist ID sea correcto (ej: 36pU0SBDFZq23Ca4qq40jg)'
        });
      }

      artistData = artistRes.value.data;
      if (topRes.status === 'fulfilled') topTracks = topRes.value.data.tracks || [];
    }

    // Path B: OAuth user token — adds recently-played count
    if (hasOAuth) {
      try {
        const oauthToken = await getRefreshedToken(artist);
        const recentRes  = await axios.get(
          `${API_URL}/me/player/recently-played?limit=50`,
          { headers: { Authorization: `Bearer ${oauthToken}` } }
        );
        recentPlayCount = recentRes.data.items?.length || 0;

        // If no Artist ID was configured, fall back to user profile for basic data
        if (!artistData) {
          const profileRes = await axios.get(`${API_URL}/me`,
            { headers: { Authorization: `Bearer ${oauthToken}` } });
          artistData = {
            name:      profileRes.data.display_name,
            followers: { total: profileRes.data.followers?.total || 0 },
            images:    profileRes.data.images || []
          };
        }
      } catch (oauthErr) {
        console.warn('OAuth refresh failed, CC data will be used:', oauthErr.message);
      }
    }

    const totalFollowers = artistData?.followers?.total ?? 0;

    // Calculate new followers vs what's stored in prevWeek
    const prevFollowers  = artist.weeklyData?.prevWeek?.spotify?.totalFollowers ?? 0;
    const currFollowers  = artist.weeklyData?.currWeek?.spotify?.totalFollowers ?? 0;
    // newFollowers = difference since we first started tracking this week
    const newFollowers   = currFollowers > 0
      ? totalFollowers - currFollowers   // incremental since last sync
      : totalFollowers - prevFollowers;  // full week diff on first sync

    res.json({
      // What we got from the API (always accurate)
      totalFollowers,
      newFollowers:      Math.max(0, newFollowers),  // can go negative → user sees it via edit
      displayName:       artistData?.name ?? '',
      image:             artistData?.images?.[0]?.url ?? null,
      popularity:        artistData?.popularity ?? 0,
      genres:            artistData?.genres ?? [],
      topTracks: topTracks.slice(0, 5).map(t => ({
        name: t.name, id: t.id, popularity: t.popularity, previewUrl: t.preview_url || null
      })),
      recentPlayCount,
      fetchedAt:         new Date().toISOString(),
      // What requires manual entry (not available in public API)
      manualRequired:    ['listeners', 'streams'],
      manualNote:        'Oyentes semanales y streams no están en la API pública de Spotify. Se obtienen solo desde Spotify for Artists.'
    });
  } catch (err) {
    console.error('Spotify metrics error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// ── GET /api/spotify/artist-public/:spotifyArtistId — no stored artist needed ─
router.get('/artist-public/:spotifyArtistId', async (req, res) => {
  try {
    const token = await getClientCredentialsToken(
      process.env.SPOTIFY_CLIENT_ID,
      process.env.SPOTIFY_CLIENT_SECRET
    );
    const { data } = await axios.get(
      `${API_URL}/artists/${req.params.spotifyArtistId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({
      id:         data.id,
      name:       data.name,
      followers:  data.followers?.total,
      popularity: data.popularity,
      image:      data.images?.[0]?.url || null,
      genres:     data.genres || []
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: err.response?.data?.error?.message || err.message
    });
  }
});

// ── POST /api/spotify/config/:artistId ───────────────────────────────────────
router.post('/config/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const { spotifyArtistId, clientId, clientSecret } = req.body;
    const c = artist.credentials.spotify;

    if (spotifyArtistId !== undefined) c.spotifyArtistId = spotifyArtistId.trim();
    if (clientId)     c.clientId     = clientId.trim();
    if (clientSecret) c.clientSecret = clientSecret.trim();
    if (spotifyArtistId || c.spotifyArtistId) c.connected = true;

    await saveArtist(artist);
    res.json({ ok: true, connected: c.connected });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/spotify/disconnect/:artistId ──────────────────────────────────
router.delete('/disconnect/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    artist.credentials.spotify = {
      clientId:        artist.credentials.spotify?.clientId,
      clientSecret:    artist.credentials.spotify?.clientSecret,
      spotifyArtistId: artist.credentials.spotify?.spotifyArtistId,
      connected:       false
    };

    await saveArtist(artist);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
