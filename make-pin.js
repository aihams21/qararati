/**
 * make-pin.js — يولّد hash للرمز من اختيارك.
 *
 * ليش hash مش الرمز نفسه؟ لأنه هيك حدا يشوف إعدادات Vercel
 * ما بيعرف يكتب الرمز ويفتح التطبيق.
 *
 * الاستخدام:
 *   node make-pin.js 1234
 * بيطبع السطر اللي تحطه في Vercel.
 */

const crypto = require('crypto');

const pin = process.argv[2];

if (!pin) {
  console.log('الاستخدام: node make-pin.js <الرمز>');
  console.log('مثال:    node make-pin.js 1234');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(pin.trim()).digest('hex');

console.log('\nحط هذا السطر في Vercel (Environment Variables):\n');
console.log('  الاسم:   PIN_HASH');
console.log('  القيمة:  ' + hash + '\n');
console.log('الرمز اللي تحكيه لها: ' + pin.trim() + '\n');
