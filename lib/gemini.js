/**
 * gemini.js — طبقة الاتصال بـ Gemini
 *
 * لماذا fallback؟ جرّبته فعلياً: الموديلات ترجع 503 تحت ضغط الطلبات
 * المجانية. فبنجرب بالترتيب لحد ما واحد يرد. لو كلهم فشلوا، التطبيق
 * بيكمّل شغله المحلي بدون AI — ما بتاخد شاشة فاضية أبداً.
 */

// من الأسرع للأبطأ، وكلهم على الطبقة المجانية
const MODEL_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
];

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** استدعاء موديل واحد مع مهلة زمنية */
async function callModel(apiKey, model, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Empty response from Gemini');
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

/** استخراج JSON من الرد — الموديل أحياناً يلتف بالـ markdown */
function parseJSON(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // محاولة أخيرة: أول { إلى آخر }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Could not parse JSON from model response');
  }
}

/**
 * ينفّذ المهمة عبر سلسلة الموديلات.
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string}>}
 */
async function runTask(apiKey, body) {
  if (!apiKey) {
    return { ok: false, error: 'AI_NOT_CONFIGURED' };
  }

  const errors = [];

  for (const model of MODEL_CHAIN) {
    try {
      const raw = await callModel(apiKey, model, body);
      const data = parseJSON(raw);
      return { ok: true, data };
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
      // 400 = المشكلة في الطلب نفسه، مش في الموديل. ما فائدة نكمل.
      if (err.status === 400 || err.status === 401 || err.status === 403) break;
      // وإلا: 429/503/timeout → جرّب الموديل التالي
    }
  }

  console.error('[gemini] all models failed:', errors.join(' | '));
  return { ok: false, error: 'AI_UNAVAILABLE' };
}

module.exports = { runTask, MODEL_CHAIN };
