// netlify/functions/feed.js
// Trae el feed RSS de La Gaceta Mercantil (actualidad o cnv), lo parsea
// y devuelve los últimos 7 ítems en formato JSON listo para consumir.
// Protegido con Netlify Identity: requiere JWT válido para responder.

const { XMLParser } = require('fast-xml-parser');
const { requireAuth } = require('./_auth');

const SOURCES = {
  actualidad: 'https://lagacetamercantil.com.ar/category/actualidad/feed/',
  cnv: 'https://lagacetamercantil.com.ar/category/cnv/feed/'
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  trimValues: true
});

function getText(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'number') return String(field);
  if (field.__cdata) return field.__cdata;
  if (field['#text']) return field['#text'];
  return '';
}

function extractThumbnail(item) {
  // Fuentes posibles, en orden de preferencia
  if (item['media:thumbnail']?.['@_url']) return item['media:thumbnail']['@_url'];
  if (item['media:content']?.['@_url']) return item['media:content']['@_url'];

  const enc = item.enclosure;
  if (enc?.['@_url'] && /image/i.test(enc['@_type'] || '')) return enc['@_url'];

  // Buscar primera <img> dentro del contenido
  const html = getText(item['content:encoded']) || getText(item.description) || '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) return m[1];

  return null;
}

function normalizeItem(item) {
  const cats = item.category;
  const categories = (Array.isArray(cats) ? cats : [cats])
    .map(getText)
    .filter(Boolean);

  return {
    title: getText(item.title),
    link: getText(item.link),
    pubDate: getText(item.pubDate),
    author: getText(item['dc:creator']) || getText(item.author),
    categories,
    description: getText(item.description),
    content: getText(item['content:encoded']) || getText(item.description),
    thumbnail: extractThumbnail(item)
  };
}

exports.handler = async (event, context) => {
  const auth = requireAuth(context);
  if (!auth.ok) return auth.response;

  const source = event.queryStringParameters?.source;

  if (!source || !SOURCES[source]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Parámetro source inválido. Usar: actualidad | cnv' })
    };
  }

  try {
    const res = await fetch(SOURCES[source], {
      headers: {
        // UA de navegador real para evitar bloqueos anti-bot.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      redirect: 'follow'
    });

    if (!res.ok) {
      // Logueamos detalles para poder diagnosticar desde Netlify Functions logs.
      console.error(`Feed ${source} HTTP ${res.status}: ${res.statusText}`);
      throw new Error(`Origen respondió ${res.status} ${res.statusText}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml);

    const channel = parsed?.rss?.channel;
    if (!channel) throw new Error('Estructura RSS inesperada');

    const rawItems = channel.item || [];
    const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];

    const articles = itemsArray.slice(0, 7).map(normalizeItem);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=180, s-maxage=180, stale-while-revalidate=600',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        source,
        articles,
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
