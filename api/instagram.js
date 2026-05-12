const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getArtist, saveArtist } = require('../lib/storage');

const IG_AUTH       = 'https://api.instagram.com/oauth/authorize';
const IG_TOKEN      = 'https://api.instagram.com/oauth/access_token';
const IG_LONG_TOKEN = 'https://graph.instagram.com/access_token';
const IG_GRAPH      = 'https://graph.instagram.com';
const PROD_URL      = 'https://artist-metrics-dashboard-p55ut4vex.vercel.app';

function getRedirectUri() {
  return process.env.INSTAGRAM_REDIRECT_URI ||
         `${process.env.BASE_URL || PROD_URL}/api/instagram/callback`;
}

function appCreds(artist) {
  const c = artist.credentials.instagram || {};
  return {
    appId:     c.appId     || process.env.INSTAGRAM_APP_ID,
    appSecret: c.appSecret || process.env.INSTAGRAM_APP_SECRET
  };
}

// GET /api/instagram/auth/:artistId
router.get('/auth/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const { appId } = appCreds(artist);
    if (!appId) return res.status(400).json({ error: 'INSTAGRAM_APP_ID no configurado' });

    const statePayload = Buffer.from(
      JSON.stringify({ id: artist.id, name: artist.name })
    ).toString('base64url');

    const params = new URLSearchParams({
      client_id:     appId,
      redirect_uri:  getRedirectUri(),
      scope:         'user_profile,user_media',
      response_type: 'code',
      state:         statePayload
    });

    res.json({ url: `${IG_AUTH}?${params}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/instagram/callback
router.get('/callback', async (req, res) => {
  const { code, state: stateParam, error } = req.query;

  let artistId, artistName;
  try {
    const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
    artistId   = decoded.id;
    artistName = decoded.name;
  } catch {
    artistId = stateParam;
  }

  if (error) return res.redirect(`/?error=instagram_denied&artistId=${artistId}`);

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

  const { appId, appSecret } = appCreds(artist);

  try {
    const shortRes = await axios.post(IG_TOKEN,
      new URLSearchParams({ client_id: appId, client_secret: appSecret,
        grant_type: 'authorization_code', redirect_uri: getRedirectUri(), code }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const longRes = await axios.get(IG_LONG_TOKEN, {
      params: { grant_type: 'ig_exchange_token', client_secret: appSecret,
                access_token: shortRes.data.access_token }
    });

    artist.credentials.instagram = {
      ...artist.credentials.instagram,
      accessToken: longRes.data.access_token,
      userId:      String(shortRes.data.user_id),
      expiresAt:   Date.now() + longRes.data.expires_in * 1000,
      connected:   true
    };

    await saveArtist(artist);
    res.redirect(`/?success=instagram_connected&artistId=${artistId}`);
  } catch (err) {
    console.error('Instagram callback error:', err.response?.data || err.message);
    res.redirect(`/?error=instagram_auth_failed&artistId=${artistId}`);
  }
});

// POST /api/instagram/config/:artistId
router.post('/config/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const { accessToken, userId, appId, appSecret } = req.body;
    const c = artist.credentials.instagram || {};

    artist.credentials.instagram = {
      ...c,
      appId:       appId       || c.appId,
      appSecret:   appSecret   || c.appSecret,
      accessToken: accessToken || c.accessToken,
      userId:      userId      || c.userId,
      connected:   !!(accessToken || c.accessToken)
    };

    await saveArtist(artist);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/instagram/metrics/:artistId
router.get('/metrics/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const c = artist.credentials.instagram;
    if (!c?.connected || !c.accessToken)
      return res.status(400).json({ error: 'Instagram no conectado' });

    const profileRes = await axios.get(`${IG_GRAPH}/me`, {
      params: {
        fields: 'id,username,account_type,media_count,followers_count,profile_picture_url',
        access_token: c.accessToken
      }
    });

    const mediaRes = await axios.get(`${IG_GRAPH}/me/media`, {
      params: { fields: 'id,media_type,timestamp', limit: 100, access_token: c.accessToken }
    }).catch(() => ({ data: { data: [] } }));

    const media       = mediaRes.data.data || [];
    const now         = new Date();
    const oneWeekAgo  = new Date(now - 7  * 86_400_000);
    const twoWeeksAgo = new Date(now - 14 * 86_400_000);

    const countType = (items, type) => items.filter(m => m.media_type === type).length;
    const currMedia = media.filter(m => new Date(m.timestamp) >= oneWeekAgo);
    const prevMedia = media.filter(m => {
      const d = new Date(m.timestamp);
      return d >= twoWeeksAgo && d < oneWeekAgo;
    });

    res.json({
      username:       profileRes.data.username,
      totalFollowers: profileRes.data.followers_count || 0,
      totalMedia:     profileRes.data.media_count || 0,
      profilePicture: profileRes.data.profile_picture_url || null,
      currWeek: {
        reels:     countType(currMedia, 'VIDEO'),
        carousels: countType(currMedia, 'CAROUSEL_ALBUM'),
        images:    countType(currMedia, 'IMAGE'),
        total:     currMedia.length
      },
      prevWeek: {
        reels:     countType(prevMedia, 'VIDEO'),
        carousels: countType(prevMedia, 'CAROUSEL_ALBUM'),
        images:    countType(prevMedia, 'IMAGE'),
        total:     prevMedia.length
      },
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// DELETE /api/instagram/disconnect/:artistId
router.delete('/disconnect/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    artist.credentials.instagram = {
      appId:     artist.credentials.instagram?.appId,
      appSecret: artist.credentials.instagram?.appSecret,
      connected: false
    };

    await saveArtist(artist);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
