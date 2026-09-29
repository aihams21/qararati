/**
 * api/health.js — نقطة تشخيص بسيطة.
 * بترجع 200 دائماً عشان نعرف إذا الـ functions شغالة أصلاً.
 */

module.exports = function handler(req, res) {
  res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify({
    ok: true,
    where: 'vercel-function',
    ai: Boolean(process.env.GEMINI_API_KEY),
    pin: Boolean(process.env.PIN_HASH),
  }));
};
