/**
 * api/ai.js — نقطة النهاية الوحيدة على Vercel.
 *
 * هذا الملف هو السبب الوحيد اللي المفتاح بيطلع فيه من السيرفر.
 * لو تحذفه، التطبيق بيشتغل بالحساب المحلي بدون ذكاء اصطناعي.
 */

const crypto = require('crypto');
const { runTask } = require('../lib/gemini');
const { buildPrompt, TASKS } = require('../lib/prompts');
const { sanitizeResponse } = require('../lib/filter');

// حد بسيط: ٢٠ طلب لكل IP في الدقيقة — يمنع أي استهلاك عشوائي للمفتاح
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_LIMIT;
}

function reply(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

/**
 * التحقق من الرمز على السيرفر.
 *
 * ليش هذا ضروري: التحقق بحد ذاته في المتصفح (JavaScript) ما بيحمي
 * المفتاح أبداً — أي حدا بيشوف الكود بيقدر يتجاوزه. لازم السيرفر هو
 * اللي يرفض الطلب بدون رمز صحيح.
 *
 * ما بنخزّن الرمز نفسه: بنقارن hash. و PIN_HASH اختياري — إذا ما حُط،
 * التطبيق مفتوح (نفس سلوك أي تطبيق شخصي).
 */
function checkPin(provided) {
  const expected = process.env.PIN_HASH;
  if (!expected) return true; // ما حُط رمز = مفتوح

  if (!provided || typeof provided !== 'string') return false;

  const hash = crypto.createHash('sha256').update(provided.trim()).digest('hex');
  // مقارنة بزمن ثابت عشان ما نكشف معلومات عن التطابق التدريجي
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected.toLowerCase(), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  try {
    return await handle(req, res);
  } catch (err) {
    // لو في خطأ غير متوقع، نرجع رسالة مفهومة بدل 500 غامض
    console.error('[handler] unexpected:', err);
    try {
      res.status(500).setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ error: 'خطأ داخلي', detail: String(err && err.message || err) }));
    } catch {
      return res.end(JSON.stringify({ error: 'خطأ داخلي' }));
    }
  }
};

async function handle(req, res) {
  if (req.method !== 'POST') {
    return reply(res, 405, { error: 'استخدم POST فقط' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return reply(res, 429, { error: 'طلبات كثيرة خلال وقت قصير. انتظر دقيقة.' });
  }

  const { task, payload } = req.body || {};

  if (!task || !TASKS[task]) {
    return reply(res, 400, { error: 'مهمة غير معروفة' });
  }
  if (!payload || typeof payload !== 'object') {
    return reply(res, 400, { error: 'بيانات غير صالحة' });
  }

  // الشات: المستخدم بيكتب بحرية، فلازم نحدّ حجم الطلب. بدون حد،
  // حدا يقدر يبعت نص ضخم ويستهلك حصة المفتاح كله.
  const size = JSON.stringify(payload).length;
  if (size > 24_000) {
    return reply(res, 413, { error: 'الرسالة طويلة جداً' });
  }

  // التحقق من الرمز قبل أي اتصال بـ Google
  if (!checkPin(req.headers['x-pin'])) {
    return reply(res, 401, { error: 'الرمز غير صحيح' });
  }

  let body;
  try {
    body = buildPrompt(task, payload);
  } catch {
    return reply(res, 400, { error: 'تعذّر بناء الطلب' });
  }

  const result = await runTask(process.env.GEMINI_API_KEY, body);

  if (!result.ok) {
    // 200 مع رسالة لطيفة: الواجهة بتعرف تعرض بديل محلي بدين تعمل كراش
    return reply(res, 200, {
      ok: false,
      error: result.error,
      message:
        result.error === 'AI_NOT_CONFIGURED'
          ? 'الذكاء الاصطناعي غير مُفعّل حالياً.'
          : 'الخدمة مشغولة شوي. جرّبي كمان مرة، وأنا هون.',
    });
  }

  // الطبقة 3: ننقّي الرد قبل ما يوصل للتليفون
  const { data, notes } = sanitizeResponse(task, result.data);

  if (notes.length > 0) {
    console.warn(`[ai] ${task}: نُظّف الرد →`, notes.join(' | '));
  }

  return reply(res, 200, { ok: true, task, data });
};
