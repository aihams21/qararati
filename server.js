/**
 * server.js — للتطوير المحلي فقط.
 * على Vercel ما بنحتاجه: الدالة في api/ai.js بتتولى كل شي.
 * التشغيل: node server.js  ثم افتح http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const handler = require('./api/ai.js');
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Vercel يعطينا res فيه res.status(). خادم Node العادي ما عنده هالشيء،
// فنحطّه يدوي عشان نفس الدالة تشتغل بالمحلين مع بعض.
const resShim = (res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  return res;
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  if (req.url === '/api/ai') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        handler({ method: req.method, headers: req.headers, body: JSON.parse(body || '{}') }, resShim(res));
      } catch {
        res.statusCode = 400;
        res.end('{"error":"طلب غير صالح"}');
      }
    });
    return;
  }

  // ملفات ثابتة
  let file = req.url.split('?')[0];
  if (file === '/') file = '/index.html';
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.statusCode = 404;
    res.end('غير موجود');
    return;
  }
  res.setHeader('Content-Type', MIME[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
}).listen(PORT, () => {
  console.log(`«قراراتي» شغّال على http://localhost:${PORT}`);
});
