const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getArtist, saveArtist } = require('../lib/storage');

const IG_AUTH = 'https://api.instagram.com/oauth/authorize';
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token';
const IG_LONG_TOKEN = 'https://graph.instagram.com/access_token';
const IG_GRAPH = 'https://graph.instagram.com';

function appCreds(artist) {
  const c = artist.credentials.instagram;
  return {
    appId: c.appId || process.env.INSTAGRAM_APP_ID,
    appSecret: c.appSecret || process.env.INSTAGRAM_APP_SECRET,
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI ||
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/instagram/callback`
  };
}

// GET /api/instagram/auth/:artistId — generate OAuth URL
router.get('/auth/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { appId, redirectUri } = appCreds(artist);
  if (!appId) return res.status(400).json({ error: 'INSTAGRAM_APP_ID no configurado' });

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: 'user_profile,user_media',
    response_type: 'code',
    state: req.params.artistId
  });

  res.json({ url: `${IG_AUTH}?${params}` });
});

// GET /api/instagram/callback — OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state: artistId, error } = req.query;
  if (error) return res.redirect(`/?error=instagram_denied&artistId=${artistId}`);

  const artist = getArtist(artistId);
  if (!artist) return res.redirect('/?error=artist_not_found');

  const { appId, appSecret, redirectUri } = appCreds(artist);

  try {
    // Short-lived token
    const shortRes = await axios.post(IG_TOKEN,
      new URLSearchParams({ client_id: appId, client_secret: appSecret,
        grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token: shortToken, user_id } = shortRes.data;

    // Long-lived token (~60 days)
    const longRes = await axios.get(IG_LONG_TOKEN, {
      params: { grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken }
    });

    artist.credentials.instagram = {
      ...artist.credentials.instagram,
      accessToken: longRes.data.access_token,
      userId: String(user_id),
      expiresAt: Date.now() + longRes.data.expires_in * 1000,
      connected: true
    };

    saveArtist(artist);
    res.redirect(`/?success=instagram_connected&artistId=${artistId}`);
  } catch (err) {
    console.error('Instagram callback error:', err.response?.data || err.message);
    res.redirect(`/?error=instagram_auth_failed&artistId=${artistId}`);
  }
});

// POST /api/instagram/config/:artistId — save manual access token
router.post('/config/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { accessToken, userId, appId, appSecret } = req.body;
  const c = artist.credentials.instagram || {};

  artist.credentials.instagram = {
    ...c,
    appId: appId || c.appId,
    appSecret: appSecret || c.appSecret,
    accessToken: accessToken || c.accessToken,
    userId: userId || c.userId,
    connected: !!(accessToken || c.accessToken)
  };

  saveArtist(artist);
  res.json({ ok: true });
});

// GET /api/instagram/metrics/:artistId — fetch metrics
router.get('/metrics/:artistId', async (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const c = artist.credentials.instagram;
  if (!c?.connected || !c.accessToken) {
    return res.status(400).json({ error: 'Instagram no conectado' });
  }

  try {
    // Profile fields
    const profileRes = await axios.get(`${IG_GRAPH}/me`, {
      params: {
        fields: 'id,username,account_type,media_count,followers_count,profile_picture_url',
        access_token: c.accessToken
      }
    });

    const profile = profileRes.data;

    // Recent media (last 100 posts)
    const mediaRes = await axios.get(`${IG_GRAPH}/me/media`, {
      params: {
        fields: 'id,media_type,timestamp,like_count,comments_count,insights.metric(reach,impressions)',
        limit: 100,
        access_token: c.accessToken
      }
    }).catch(() => ({ data: { data: [] } }));

    const media = mediaRes.data.data || [];
    const now = new Date();
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

    function countType(items, type) {
      return items.filter(m => m.media_type === type).length;
    }

    const currMedia = media.filter(m => new Date(m.timestamp) >= oneWeekAgo);
    const prevMedia = media.filter(m => {
      const d = new Date(m.timestamp);
      return d >= twoWeeksAgo && d < oneWeekAgo;
    });

    const metrics = {
      username: profile.username,
      totalFollowers: profile.followers_count || 0,
      totalMedia: profile.media_count || 0,
      profilePicture: profile.profile_picture_url || null,
      currWeek: {
        reels: countType(currMedia, 'VIDEO'),
        carousels: countType(currMedia, 'CAROUSEL_ALBUM'),
        images: countType(currMedia, 'IMAGE'),
        total: currMedia.length
      },
      prevWeek: {
        reels: countType(prevMedia, 'VIDEO'),
        carousels: countType(prevMedia, 'CAROUSEL_ALBUM'),
        images: countType(prevMedia, 'IMAGE'),
        total: prevMedia.length
      },
      fetchedAt: new Date().toISOString()
    };

    res.json(metrics);
  } catch (err) {
    console.error('Instagram metrics error:', err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/instagram/disconnect/:artistId
router.delete('/disconnect/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  artist.credentials.instagram = {
    appId: artist.credentials.instagram?.appId,
    appSecret: artist.credentials.instagram?.appSecret,
    connected: false
  };

  saveArtist(artist);
  res.json({ ok: true });
});

module.exports = router;
