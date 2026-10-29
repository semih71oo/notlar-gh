const MAX_CIPHERTEXT = 120000;
const MODE_MS = {
  read_once: 7 * 24 * 3600 * 1000,
  '1h': 3600 * 1000,
  '1d': 24 * 3600 * 1000,
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

const notFound = () =>
  json({ error: 'Not bulunamadı. Süresi dolmuş ya da daha önce okunup silinmiş olabilir.' }, 404);

async function createNote(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Geçersiz istek.' }, 400);
  }
  const ciphertext = body.ciphertext;
  const mode = body.mode;

  if (typeof ciphertext !== 'string' || ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT) {
    return json({ error: 'Metin boş veya çok uzun.' }, 400);
  }
  if (mode !== 'read_once' && mode !== '1h' && mode !== '1d') {
    return json({ error: 'Geçersiz süre seçimi.' }, 400);
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO notes (id, body, created_at, expires_at, read_once) VALUES (?1, ?2, ?3, ?4, ?5)'
  )
    .bind(id, ciphertext, now, now + MODE_MS[mode], mode === 'read_once' ? 1 : 0)
    .run();

  return json({ id }, 201);
}

async function readNote(id, env) {
  if (!UUID_RE.test(id)) return notFound();
  const now = Date.now();

  const once = await env.DB.prepare(
    'DELETE FROM notes WHERE id = ?1 AND read_once = 1 AND expires_at > ?2 RETURNING body'
  )
    .bind(id, now)
    .first();
  if (once) return json({ body: once.body });

  const kept = await env.DB.prepare(
    'SELECT body FROM notes WHERE id = ?1 AND read_once = 0 AND expires_at > ?2'
  )
    .bind(id, now)
    .first();
  if (kept) return json({ body: kept.body });

  return notFound();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/notes' && request.method === 'POST') {
      return createNote(request, env);
    }
    const m = url.pathname.match(/^\/api\/notes\/([^/]+)\/read$/);
    if (m && request.method === 'POST') {
      return readNote(m[1], env);
    }
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Bulunamadı.' }, 404);
    }

    // Sayfa dosyaları: public/ klasöründen gelir
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env) {
    await env.DB.prepare('DELETE FROM notes WHERE expires_at <= ?1').bind(Date.now()).run();
  },
};
