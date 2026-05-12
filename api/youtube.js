const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getArtist, saveArtist } = require('../lib/storage');

const YT_API = 'https://www.googleapis.com/youtube/v3';

// POST /api/youtube/config/:artistId
router.post('/config/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const { apiKey, channelId } = req.body;
    if (!channelId?.trim()) return res.status(400).json({ error: 'channelId es requerido' });

    artist.credentials.youtube = {
      apiKey:    apiKey?.trim() || artist.credentials.youtube?.apiKey,
      channelId: channelId.trim(),
      connected: true
    };

    await saveArtist(artist);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/youtube/metrics/:artistId
router.get('/metrics/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

    const c = artist.credentials.youtube;
    if (!c?.connected) return res.status(400).json({ error: 'YouTube no configurado' });

    const key       = c.apiKey || process.env.YOUTUBE_API_KEY;
    const channelId = c.channelId;

    const channelRes = await axios.get(`${YT_API}/channels`, {
      params: { part: 'statistics,snippet', id: channelId, key }
    });

    const ch = channelRes.data.items?.[0];
    if (!ch) return res.status(404).json({ error: 'Canal de YouTube no encontrado' });

    const searchRes = await axios.get(`${YT_API}/search`, {
      params: { part: 'snippet', channelId, order: 'date', maxResults: 10, type: 'video', key }
    });

    const videoIds = (searchRes.data.items || []).map(v => v.id.videoId).filter(Boolean).join(',');
    let latestVideo = null;

    if (videoIds) {
      const statsRes = await axios.get(`${YT_API}/videos`, {
        params: { part: 'statistics,snippet', id: videoIds, key }
      });
      const lv = statsRes.data.items?.[0];
      if (lv) {
        const totalViews = parseInt(lv.statistics.viewCount) || 0;
        const ageDays    = (Date.now() - new Date(lv.snippet.publishedAt).getTime()) / 86_400_000;
        const avgDaily   = ageDays > 0 ? Math.round(totalViews / ageDays) : totalViews;
        latestVideo = {
          id:                  lv.id,
          title:               lv.snippet.title,
          thumbnail:           lv.snippet.thumbnails?.medium?.url,
          publishedAt:         lv.snippet.publishedAt,
          totalViews,
          likes:               parseInt(lv.statistics.likeCount) || 0,
          comments:            parseInt(lv.statistics.commentCount) || 0,
          avgDailyViews:       avgDaily,
          estimatedWeekViews:  avgDaily * 7
        };
      }
    }

    res.json({
      channelName:       ch.snippet.title,
      channelImage:      ch.snippet.thumbnails?.high?.url,
      totalSubscribers:  parseInt(ch.statistics.subscriberCount) || 0,
      totalViews:        parseInt(ch.statistics.viewCount) || 0,
      videoCount:        parseInt(ch.statistics.videoCount) || 0,
      latestVideo,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/youtube/disconnect/:artistId
router.delete('/disconnect/:artistId', async (req, res) => {
  try {
    const artist = await getArtist(req.params.artistId);
    if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });
    artist.credentials.youtube = { connected: false };
    await saveArtist(artist);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
