// netlify/functions/youtube.js
// Trae el RSS público de la playlist de YouTube (sin API key) y devuelve
// los últimos 7 videos con metadata + ID para embebido.
// Protegido con Netlify Identity: requiere JWT válido para responder.

const { XMLParser } = require('fast-xml-parser');
const { requireAuth } = require('./_auth');

const PLAYLIST_ID = 'PLpUj470-ctJMGIcMRUu-PrBwQOmN5uyiD';
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true
});

function getText(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'number') return String(field);
  if (field['#text']) return field['#text'];
  return '';
}

function normalizeEntry(entry) {
  const mediaGroup = entry['media:group'] || {};
  const thumb = mediaGroup['media:thumbnail'];
  const thumbUrl = Array.isArray(thumb)
    ? thumb[0]?.['@_url']
    : thumb?.['@_url'];

  const stats = mediaGroup['media:community']?.['media:statistics'];
  const views = stats?.['@_views'];

  return {
    videoId: getText(entry['yt:videoId']),
    title: getText(entry.title),
    published: getText(entry.published),
    updated: getText(entry.updated),
    author: getText(entry.author?.name),
    thumbnail: thumbUrl || `https://i.ytimg.com/vi/${getText(entry['yt:videoId'])}/hqdefault.jpg`,
    description: getText(mediaGroup['media:description']),
    views: views ? Number(views) : null
  };
}

exports.handler = async (event, context) => {
  const auth = requireAuth(context);
  if (!auth.ok) return auth.response;

  try {
    const res = await fetch(FEED_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GacetaPlus/1.0)',
        'Accept': 'application/atom+xml, application/xml, text/xml'
      }
    });

    if (!res.ok) throw new Error(`YouTube respondió ${res.status}`);

    const xml = await res.text();
    const parsed = parser.parse(xml);

    const rawEntries = parsed?.feed?.entry || [];
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

    const videos = entries.slice(0, 7).map(normalizeEntry);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=900',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        playlistId: PLAYLIST_ID,
        videos,
        updated: Date.now()
      })
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
