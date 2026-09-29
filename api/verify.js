/**
 * api/verify.js — فحص الرمز بدون أي اتصال بـ Google.
 *
 * ليش هذا الملف منفصل: فحص الرمز لازم يكون فوري (أقل من جزء من الثانية).
 * لو استعملنا /api/ai للفحص، كل مرة بتكتب الرمز بتنتظر جواب Google
 * (٥-١٥ ثانية، وأحياناً دقيقة) — وهو تجربة سيئة جداً.
 *
 * هنا بنتحقق من الرمز فقط، بدون ما نلمس Gemini إطلاقاً.
 */

const crypto = require('crypto');

function reply(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

module.exports = function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return reply(res, 405, { error: 'استخدم POST فقط' });
    }

    const expected = process.env.PIN_HASH;
    // ما حُط رمز = التطبيق مفتوح، خلّيناها تمر
    if (!expected) return reply(res, 200, { ok: true, locked: false });

    const provided = (req.body || {}).pin;
    if (!provided || typeof provided !== 'string') {
      return reply(res, 401, { ok: false, error: 'الرمز غير صحيح' });
    }

    const hash = crypto.createHash('sha256').update(provided.trim()).digest('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expected.toLowerCase(), 'hex');

    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return reply(res, ok ? 200 : 401, ok ? { ok: true, locked: true } : { ok: false, error: 'الرمز غير صحيح' });
  } catch (err) {
    return reply(res, 500, { ok: false, error: 'خطأ داخلي', detail: String(err && err.message || err) });
  }
};
