/**
 * اختبار منطقي بسيط بدون framework — يشتغل بـ: node test/run.js
 */

const assert = require('node:assert/strict');
const { scoreAll, scoreOption, gap, sensitivity, clamp, completeness } = require('../lib/scoring');
const { isContaminated, sanitizeText, sanitizeResponse } = require('../lib/filter');
const { buildPrompt, TASKS } = require('../lib/prompts');

let pass = 0;
let fail = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    results.push(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    results.push(`  ✗ ${name}\n      ${err.message}`);
  }
}

// ─── بيانات اختبار ───────────────────────────────────────────
const decision = {
  options: [
    { id: 'A', name: 'الخيار أ' },
    { id: 'B', name: 'الخيار ب' },
  ],
  criteria: [
    { id: 'c1', name: 'السعر', weight: 8 },
    { id: 'c2', name: 'الجودة', weight: 2 },
  ],
  scores: {
    A: { c1: 5, c2: 9 },
    B: { c1: 9, c2: 3 },
  },
};

// ─── scoring ─────────────────────────────────────────────────
test('clamp يحدّد القيم خارج المدى', () => {
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp('غير رقم', 0, 10), 0);
});

test('scoreOption يحسب المتوسط الموزون', () => {
  // (5*8 + 9*2) / 10 = 58/10 = 5.8
  assert.equal(scoreOption('A', decision.criteria, decision.scores), 5.8);
  // (9*8 + 3*2) / 10 = 78/10 = 7.8
  assert.equal(scoreOption('B', decision.criteria, decision.scores), 7.8);
});

test('scoreAll يرتّب تنازلياً', () => {
  const r = scoreAll(decision);
  assert.equal(r[0].id, 'B');
  assert.equal(r[1].id, 'A');
});

test('gap يحسب الفارق', () => {
  assert.equal(gap(scoreAll(decision)), 2); // 7.8 - 5.8
});

test('سعر زائد على صفر لا يكسر الحساب', () => {
  const d = { ...decision, criteria: [{ id: 'c1', name: 'س', weight: 0 }] };
  assert.equal(scoreOption('A', d.criteria, d.scores), 0);
});

test('معيار بلا وزن لا يغيّر الترتيب', () => {
  const d = {
    ...decision,
    criteria: [
      { id: 'c1', name: 'السعر', weight: 0 },
      { id: 'c2', name: 'الجودة', weight: 5 },
    ],
  };
  const r = scoreAll(d);
  assert.equal(r[0].id, 'A'); // أ على الجودة فقط
});

test('sensitivity يكتشف المعيار الحاسم', () => {
  // A متفوّق في الجودة (8 مقابل 3)، B متفوّق في السعر (6 مقابل 2).
  // وزن السعر 7 والجودة 3 → السعر يفصل فتصدر B.
  const d = {
    ...decision,
    criteria: [
      { id: 'c1', name: 'السعر', weight: 7 },
      { id: 'c2', name: 'الجودة', weight: 3 },
    ],
    scores: { A: { c1: 2, c2: 8 }, B: { c1: 6, c2: 3 } },
  };
  // الأصلي: A=(2*7+8*3)/10=3.8 ، B=(6*7+3*3)/10=5.1 → B
  // بعد تخفيض السعر للنصف: A=(2*3.5+8*3)/10=3.0 ، B=(6*3.5+3*3)/10=2.7 → A
  const s = sensitivity(d);
  assert.equal(s.orderChanged, true);
  assert.ok(s.influential.some((i) => i.criterionId === 'c1'));
  assert.equal(s.influential.some((i) => i.criterionId === 'c2'), false);
});

test('sensitivity لا ينسب الفارق لمعيار غير مؤثر', () => {
  // الخياران متساويان تماماً في السعر، والفرق بالجودة
  const d = {
    ...decision,
    criteria: [
      { id: 'c1', name: 'السعر', weight: 8 },
      { id: 'c2', name: 'الجودة', weight: 2 },
    ],
    scores: { A: { c1: 5, c2: 5 }, B: { c1: 5, c2: 9 } },
  };
  // لو خفّضنا السعر → A يبقى متساوياً في السعر لكن أعلى في الجودة، فاز A
  // لكن لو خفّضنا الجودة أيضاً... نتحقق فقط أن c1 ليس Influential لأن
  // تخفيضه لا يقلب الترتيب (B يبقى أعلى في الجودة)
  const s = sensitivity(d);
  assert.equal(s.influential.some((i) => i.criterionId === 'c1'), false);
});

test('sensitivity لا يكشف شيئاً لو الأوزان متساوية', () => {
  const d = {
    ...decision,
    criteria: [
      { id: 'c1', name: 'أ', weight: 5 },
      { id: 'c2', name: 'ب', weight: 5 },
    ],
    scores: { A: { c1: 5, c2: 5 }, B: { c1: 5, c2: 5 } },
  };
  const s = sensitivity(d);
  assert.equal(s.orderChanged, false);
});

test('completeness يحسب نسبة التعبئة', () => {
  const c = completeness(decision);
  assert.equal(c.total, 4);
  assert.equal(c.done, 4);
  assert.equal(c.ratio, 1);
});

test('البيانات الناقصة تُحسب كغير معبّأة', () => {
  const c = completeness({ ...decision, scores: { A: { c1: 5 } } });
  assert.equal(c.done, 1);
  assert.equal(c.ratio, 0.25);
});

// ─── filter (حماية "لا يقرر عنها") ───────────────────────────
test('يكتشف الجمل التوجيهيه بالعربية', () => {
  assert.equal(isContaminated('أنصحك تاخذي الخيار الأول'), true);
  assert.equal(isContaminated('لو كنت مكانك لاخترت الثاني'), true);
  assert.equal(isContaminated('هذا هو الخيار الأفضل'), true);
});

test('يكتشف التلاعب بالفراغات والهمزات', () => {
  assert.equal(isContaminated('ا ن ص ح ك'), true); // متباعدة
  assert.equal(isContaminated('الافضل'), true);
});

test('ما بيعتبر جملة وصفية عادية ملوّثة', () => {
  assert.equal(isContaminated('الخيار أ أرخص بـ 200 دولار شهرياً'), false);
  assert.equal(isContaminated('الفرق الأساسي في مدة العقد'), false);
});

test('sanitizeText يستبدل النص الملوَّث', () => {
  const r = sanitizeText('أنصحك بالأول', 'بديل محايد');
  assert.equal(r.text, 'بديل محايد');
  assert.equal(r.cleaned, true);
});

test('sanitizeText يمرّر النص النظيف', () => {
  const r = sanitizeText('الخيار أ أوسع بالمساحة', 'بديل');
  assert.equal(r.cleaned, false);
  assert.equal(r.text, 'الخيار أ أوسع بالمساحة');
});

test('sanitizeResponse ينقّي تحليل الخيارات', () => {
  const dirty = {
    options: [
      { name: 'أ', pros: ['أنصحك فيه', 'سعره جيد'], cons: ['محدود'] },
    ],
    notes: 'منشان هذا هو الأفضل',
  };
  const { data, notes } = sanitizeResponse('analysis', dirty);
  assert.equal(data.options[0].pros.length, 1);
  assert.equal(data.options[0].pros[0], 'سعره جيد');
  assert.notEqual(data.notes, 'منشان هذا هو الأفضل');
  assert.ok(notes.length > 0);
});

test('sanitizeResponse يضمن توازن ٣ مقابل ٣', () => {
  const ok = {
    options: [{ name: 'أ', pros: ['١', '٢', '٣'], cons: ['١', '٢', '٣'] }],
  };
  const { data } = sanitizeResponse('analysis', ok);
  assert.equal(data.options[0].pros.length, 3);
});

// ─── prompts ─────────────────────────────────────────────────
test('كل المهام لها schema', () => {
  for (const key of Object.keys(TASKS)) {
    const p = buildPrompt(key, { test: true });
    assert.ok(p.generationConfig.responseSchema, `${key} بلا schema`);
    assert.equal(p.generationConfig.responseMimeType, 'application/json');
    assert.ok(p.systemInstruction.parts[0].text.includes('ممنوع'));
  }
});

test('الـ prompt النظامي يمنع النصح', () => {
  const p = buildPrompt('question', {});
  const sys = p.systemInstruction.parts[0].text;
  assert.ok(sys.includes('ممنوع منعاً باتاً'));
  assert.ok(sys.includes('لا تكتب'));
  assert.equal(p.systemInstruction.role, 'system');
});

// ─── النتيجة ─────────────────────────────────────────────────
console.log('\nاختبارات «قراراتي»\n' + '─'.repeat(40));
console.log(results.join('\n'));
console.log('─'.repeat(40));

// ─── الشات: الاستخراج والتحليل ────────────────────────────────

test('sanitizeResponse يحدّد الخيارات والمعايير من نص حرّ', () => {
  const { data } = sanitizeResponse('parse', {
    title: 'وظيفتين',
    options: [{ name: 'قريبة', notes: 'راتب متوسط' }, { name: 'بعيدة', notes: 'راتب ممتاز' }],
    criteria: [{ name: 'الراتب', weight: 9, scores: [5, 9] }],
  });
  if (data.title !== 'وظيفتين') fail('العنوان');
  if (data.options.length !== 2) fail('عدد الخيارات');
  if (data.criteria[0].name !== 'الراتب') fail('اسم المعيار');
});

test('parse يحدّ الأوزان والدرجات بين ٠ و ١٠', () => {
  const { data } = sanitizeResponse('parse', {
    title: 'x',
    options: [{ name: 'أ' }, { name: 'ب' }],
    criteria: [{ name: 'م', weight: 99, scores: [15, -4] }],
  });
  if (data.criteria[0].weight !== 10) fail('الوزن ما انحدّ');
  if (data.criteria[0].scores[0] !== 10) fail('الدرجة العليا ما انحدّرت');
  if (data.criteria[0].scores[1] !== 0) fail('الدرجة السالبة ما انعدّلت');
});

test('parse يرفض نص ما فيه قرار واضح', () => {
  const { data } = sanitizeResponse('parse', { title: 'x', options: [], criteria: [] });
  if (data.options.length !== 0) fail('اخترع خيار من فراغ');
});

test('analyze يمسح التوجيهية من كل حقل', () => {
  const { data } = sanitizeResponse('analyze', {
    summary: 'أنصحك بالأولى',
    tradeoffs: [{ point: 'الراتب مقابل الوقت', detail: 'الأفضل أن تختاري الأولى', impacts: ['أ'] }],
    decidingFactor: 'الأفضل هو الراتب',
    decidingWhy: 'لأنها أفضل خيار',
    question: 'أي خيار ستشتاق له؟',
  });
  if (data.summary.includes('أنصحك')) fail('الملخّص');
  if (data.tradeoffs[0].detail.includes('الأفضل')) fail('التفاصيل');
  if (data.decidingFactor.includes('الأفضل')) fail('نقطة الحسم');
  if (data.decidingWhy.includes('أفضل')) fail('سبب الحسم');
  if (!data.question.includes('تشتاق')) fail('السؤال الطاهر');
});

test('analyze يحافظ على عنوان المقايضة حتى لو التفاصيل اتمسحت', () => {
  const { data } = sanitizeResponse('analyze', {
    summary: 'ملخص نظيف تماماً',
    tradeoffs: [{ point: 'الراتب مقابل الوقت', detail: 'اختاري الأولى', impacts: [] }],
    decidingFactor: 'الراتب',
    decidingWhy: 'لأنه ذكره مرتين في كلامه',
    question: 'سؤال؟',
  });
  if (data.tradeoffs[0].point !== 'الراتب مقابل الوقت') fail('العنوان اتمسح');
  if (data.tradeoffs[0].detail.includes('اختاري')) fail('التفاصيل ما انمسحت');
});

test('chat ينقّي الرد والرسائل', () => {
  const { data } = sanitizeResponse('chat', {
    reply: 'أنصحك تاخذي الأول',
    question: 'اختاري بعناية',
    insights: ['نقطة نظيفة', 'لو كنت مكانك'],
  });
  if (data.reply.includes('أنصحك')) fail('الرد');
  if (data.question.includes('اختاري')) fail('السؤال');
  if (data.insights.length !== 1) fail('نقطة ملوّثة ما انمسحت');
});

test('كل مهام الشات لها schema', () => {
  for (const k of ['parse', 'analyze', 'chat']) {
    if (!TASKS[k] || !TASKS[k].schema) fail(`مهمة الشات ${k} بلا schema`);
  }
});

console.log(`نجح: ${pass}   فشل: ${fail}\n`);
process.exit(fail ? 1 : 0);
