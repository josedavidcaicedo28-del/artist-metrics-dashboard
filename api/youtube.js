const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getArtist, saveArtist } = require('../lib/storage');

const YT_API = 'https://www.googleapis.com/youtube/v3';

// POST /api/youtube/config/:artistId — save API key + channel ID
router.post('/config/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const { apiKey, channelId } = req.body;
  if (!apiKey?.trim() || !channelId?.trim()) {
    return res.status(400).json({ error: 'apiKey y channelId son requeridos' });
  }

  artist.credentials.youtube = {
    apiKey: apiKey.trim(),
    channelId: channelId.trim(),
    connected: true
  };

  saveArtist(artist);
  res.json({ ok: true });
});

// GET /api/youtube/metrics/:artistId — fetch channel metrics
router.get('/metrics/:artistId', async (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  const c = artist.credentials.youtube;
  if (!c?.connected) return res.status(400).json({ error: 'YouTube no configurado' });

  const key = c.apiKey || process.env.YOUTUBE_API_KEY;
  const channelId = c.channelId;

  try {
    // Channel statistics
    const channelRes = await axios.get(`${YT_API}/channels`, {
      params: { part: 'statistics,snippet', id: channelId, key }
    });

    const ch = channelRes.data.items?.[0];
    if (!ch) return res.status(404).json({ error: 'Canal de YouTube no encontrado' });

    // Latest videos
    const searchRes = await axios.get(`${YT_API}/search`, {
      params: {
        part: 'snippet',
        channelId,
        order: 'date',
        maxResults: 10,
        type: 'video',
        key
      }
    });

    const videoIds = (searchRes.data.items || [])
      .map(v => v.id.videoId)
      .filter(Boolean)
      .join(',');

    let latestVideo = null;
    let latestVideoWeekViews = 0;

    if (videoIds) {
      const statsRes = await axios.get(`${YT_API}/videos`, {
        params: { part: 'statistics,snippet', id: videoIds, key }
      });

      const videos = statsRes.data.items || [];

      // Latest video
      const lv = videos[0];
      if (lv) {
        const totalViews = parseInt(lv.statistics.viewCount) || 0;
        const publishedAt = new Date(lv.snippet.publishedAt);
        const ageMs = Date.now() - publishedAt.getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const avgDailyViews = ageDays > 0 ? Math.round(totalViews / ageDays) : totalViews;

        latestVideo = {
          id: lv.id,
          title: lv.snippet.title,
          thumbnail: lv.snippet.thumbnails?.medium?.url,
          publishedAt: lv.snippet.publishedAt,
          totalViews,
          likes: parseInt(lv.statistics.likeCount) || 0,
          comments: parseInt(lv.statistics.commentCount) || 0,
          avgDailyViews,
          estimatedWeekViews: avgDailyViews * 7
        };
        latestVideoWeekViews = latestVideo.estimatedWeekViews;
      }
    }

    const metrics = {
      channelName: ch.snippet.title,
      channelImage: ch.snippet.thumbnails?.high?.url,
      totalSubscribers: parseInt(ch.statistics.subscriberCount) || 0,
      totalViews: parseInt(ch.statistics.viewCount) || 0,
      videoCount: parseInt(ch.statistics.videoCount) || 0,
      latestVideo,
      latestVideoWeekViews,
      fetchedAt: new Date().toISOString()
    };

    res.json(metrics);
  } catch (err) {
    console.error('YouTube metrics error:', err.response?.data || err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/youtube/disconnect/:artistId
router.delete('/disconnect/:artistId', (req, res) => {
  const artist = getArtist(req.params.artistId);
  if (!artist) return res.status(404).json({ error: 'Artista no encontrado' });

  artist.credentials.youtube = { connected: false };
  saveArtist(artist);
  res.json({ ok: true });
});

module.exports = router;
