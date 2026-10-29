// Tek dosyalık Worker (JavaScript)

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

    return new Response(PAGE_HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    });
  },

  async scheduled(_controller, env) {
    await env.DB.prepare('DELETE FROM notes WHERE expires_at <= ?1').bind(Date.now()).run();
  },
};

const PAGE_HTML = `<!doctype html>
<html lang="tr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Tek Kullanımlık Not — Semih Algan</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { darkMode: 'class' };</script>
</head>
<body class="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
<main class="mx-auto max-w-xl px-4 py-10">
  <header class="mb-8">
    <h1 class="text-2xl font-semibold">Tek Kullanımlık Not</h1>
    <p class="mt-2 text-sm text-zinc-400">
      Notunuz tarayıcınızda şifrelenir. Sunucu yalnızca şifreli halini saklar. Şifre çözme anahtarı linkin <code>#</code> kısmındadır ve sunucuya gönderilmez.
    </p>
  </header>

  <section id="create" class="space-y-4">
    <textarea id="text" maxlength="20000" rows="8" placeholder="Notunuzu yazın..."
      class="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"></textarea>

    <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label class="flex-1 text-sm text-zinc-400">Yok olma süresi
        <select id="mode" class="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-100">
          <option value="read_once">Okunduktan hemen sonra</option>
          <option value="1h">1 saat sonra</option>
          <option value="1d">1 gün sonra</option>
        </select>
      </label>
      <button id="createBtn" class="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium hover:bg-emerald-500 disabled:opacity-50">Link oluştur</button>
    </div>
    <p id="createErr" class="hidden text-sm text-red-400"></p>

    <div id="result" class="hidden space-y-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p class="text-sm text-zinc-400">Bu linki yalnızca alıcıya gönderin.</p>
      <div class="flex gap-2">
        <input id="link" readonly class="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm">
        <button id="copyBtn" class="rounded-lg bg-zinc-800 px-4 hover:bg-zinc-700">Kopyala</button>
      </div>
      <p id="copied" class="hidden text-sm text-emerald-400">Kopyalandı</p>
    </div>
  </section>

  <section id="view" class="hidden space-y-4">
    <p class="text-sm text-zinc-400">
      Bu not size gönderildi. "Notu göster" butonuna basınca açılır. "Okunduktan hemen sonra" seçildiyse not sunucudan kalıcı olarak silinir.
    </p>
    <button id="revealBtn" class="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium hover:bg-emerald-500 disabled:opacity-50">Notu göster</button>
    <p id="viewErr" class="hidden text-sm text-red-400"></p>
    <pre id="content" class="hidden whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm"></pre>
  </section>
</main>

<script>
var $ = function (id) { return document.getElementById(id); };
var enc = new TextEncoder();
var dec = new TextDecoder();

function toB64(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(b64) {
  var s = atob(b64);
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function toB64u(bytes) {
  return toB64(bytes).split('+').join('-').split('/').join('_').split('=').join('');
}
function fromB64u(s) {
  var b = s.split('-').join('+').split('_').join('/');
  while (b.length % 4 !== 0) b += '=';
  return fromB64(b);
}

async function encrypt(text) {
  var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(text)));
  var all = new Uint8Array(iv.length + ct.length);
  all.set(iv);
  all.set(ct, iv.length);
  var raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return { ciphertext: toB64(all), keyStr: toB64u(raw) };
}

async function decrypt(ciphertext, keyStr) {
  var key = await crypto.subtle.importKey('raw', fromB64u(keyStr), 'AES-GCM', false, ['decrypt']);
  var all = fromB64(ciphertext);
  var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12));
  return dec.decode(pt);
}

function showErr(id, msg) {
  var el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideErr(id) {
  $(id).classList.add('hidden');
}

$('createBtn').onclick = async function () {
  hideErr('createErr');
  var text = $('text').value.trim();
  if (!text) return showErr('createErr', 'Önce bir not yazın.');
  $('createBtn').disabled = true;
  try {
    var r = await encrypt(text);
    var res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ciphertext: r.ciphertext, mode: $('mode').value }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bir hata oluştu.');
    $('link').value = location.origin + '/#' + data.id + '.' + r.keyStr;
    $('result').classList.remove('hidden');
  } catch (e) {
    showErr('createErr', (e && e.message) || 'Bir hata oluştu.');
  } finally {
    $('createBtn').disabled = false;
  }
};

$('copyBtn').onclick = async function () {
  try {
    await navigator.clipboard.writeText($('link').value);
  } catch (e) {
    $('link').select();
    document.execCommand('copy');
  }
  $('copied').classList.remove('hidden');
  setTimeout(function () { $('copied').classList.add('hidden'); }, 2000);
};

async function reveal(id, keyStr) {
  hideErr('viewErr');
  $('revealBtn').disabled = true;
  try {
    var res = await fetch('/api/notes/' + encodeURIComponent(id) + '/read', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error);
    $('content').textContent = await decrypt(data.body, keyStr);
    $('content').classList.remove('hidden');
    $('revealBtn').classList.add('hidden');
    history.replaceState(null, '', '/');
  } catch (e) {
    showErr('viewErr', (e && e.message) || 'Not açılamadı.');
    $('revealBtn').disabled = false;
  }
}

function route() {
  var parts = location.hash.slice(1).split('.');
  var id = parts[0];
  var keyStr = parts[1];
  if (id && keyStr) {
    $('create').classList.add('hidden');
    $('view').classList.remove('hidden');
    $('revealBtn').onclick = function () { reveal(id, keyStr); };
  } else {
    $('create').classList.remove('hidden');
    $('view').classList.add('hidden');
  }
}
window.addEventListener('hashchange', route);
route();
</script>
</body>
</html>
`;
