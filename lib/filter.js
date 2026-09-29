/**
 * filter.js — الطبقة الثالثة من الحماية: فلتر برمجي.
 *
 * طبقة 1: الـ system prompt بيقوله لا ينصح.
 * طبقة 2: JSON schema بيرجّع رد منظّم.
 * طبقة 3: هون — لو الرد تسرّب جملة توجيهيه، بنشيلها.
 *
 * الفكرة: مافي ضمانة 100% من الـ prompt، فبنفحص الناتج بأنفسنا.
 * هاد اللي بيخلي الفكرة تظل صحيحة حتى لو الموديل "انحرف" يوم.
 */

// كلمات توجيهيه ممنوعة — لو ظهرت بالمحتوى بينتمسح
const BANNED = [
  'أنصحك', 'انصحك', 'أوصيك', 'اوصيك', 'نصيحتي', 'نصحتك',
  'لو كنت مكانك', 'لو كنت مكان', 'في مكانك',
  'الأفضل', 'الافضل', 'أفضل خيار', 'أفضل قرار',
  'الأجدر', 'الأقدر', 'الأنسب', 'الانسب', 'الأسلم', 'الاسلم',
  'أنسب خيار', 'الخيار الأمثل', 'الامثل',
  'اختاري', 'اختار', 'اختاريه', 'تاخذي',
  'يجب أن تختاري', 'روحي على', 'اذهبي إلى',
  'راح تندمين', 'ستندمين', 'رح تندم',
  'صح إنك', 'منشان', 'الخيار الصح',
  'أقل خطراً', 'أأمن', 'القرار الآمن',
  'أنا أرى أن', 'في رأيي', 'رأيي أن',
];

// لو الرد كان فيه أي من هذي، بنرميه كامل ونرجّع بديل محايد
const isContaminated = (text) => {
  if (typeof text !== 'string') return false;

  // نطبّع: نتخلّص من التشكيل وعلامات الترقيم
  const norm = text
    .replace(/[ً-ْـ]/g, '')
    .replace(/[.,!؟?؛;:"']/g, '')
    .toLowerCase()
    .trim();

  // مطابقة عادية (يتجاهل الفراغات بين الكلمات)
  if (BANNED.some((w) => norm.includes(w.toLowerCase()))) return true;

  // مطابقة مُصمّمة لالتقاط التلاعب بحروف مفرّقة (فراغات بين الحروف)
  // نفكّ النص من كل الفراغات، ونقارن مع الكلمات مجرّدة من الفراغات.
  const squashed = norm.replace(/\s+/g, '');
  return BANNED.some((w) => squashed.includes(w.replace(/\s+/g, '')));
};

/**
 * ينقّي نص: إذا كان ملوَّثاً، يرجع البديل المحايد.
 * @returns {{text: string, cleaned: boolean}}
 */
function sanitizeText(text, neutralFallback) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { text: neutralFallback, cleaned: true };
  }
  if (isContaminated(text)) {
    return { text: neutralFallback, cleaned: true };
  }
  return { text, cleaned: false };
}

/** ينقّي قائمة نصوص، ويرمي كل عنصر ملوَّث */
function sanitizeList(list, neutralFallback) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => typeof x === 'string' && x.trim() !== '')
    .filter((x) => !isContaminated(x))
    .map((x) => x.trim());
}

/**
 * يمرّ على كامل رد الـ AI قبل ما يوصل للواجهة.
 * @returns {{data: object, notes: string[]}} notes = تحذيرات للتطوير
 */
function clampScore(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(10, v));
}

function sanitizeResponse(taskKey, data) {
  const notes = [];

  // ═══ الشات ═══

  if (taskKey === 'parse') {
    // المستخدم ما فقد писа نص — هاد ليس قراراً بعد. بنرجّع إشعار
    // بدل ما نخترع له خيارات.
    if (!Array.isArray(data?.options) || data.options.length < 1) {
      return { data: { title: '', options: [], criteria: [] }, notes };
    }

    const options = data.options
      .filter((o) => typeof o?.name === 'string' && o.name.trim())
      .slice(0, 6)
      .map((o) => ({
        name: o.name.trim().slice(0, 80),
        notes: typeof o.notes === 'string' ? o.notes.slice(0, 400) : '',
      }));

    const criteria = (Array.isArray(data?.criteria) ? data.criteria : [])
      .filter((c) => typeof c?.name === 'string' && c.name.trim())
      .slice(0, 10)
      .map((c) => ({
        name: c.name.trim().slice(0, 60),
        weight: clampScore(c.weight ?? 5) ?? 5,
        // الدرجات لازم بعدد الخيارات بالضبط، وإلا ما منستعمل
        scores: (Array.isArray(c.scores) ? c.scores : []).map(clampScore).filter((n) => n !== null),
      }));

    return { data: { title: String(data?.title || '').trim().slice(0, 80), options, criteria }, notes };
  }

  if (taskKey === 'analyze') {
    const tradeoffs = (Array.isArray(data?.tradeoffs) ? data.tradeoffs : [])
      .filter((t) => typeof t?.point === 'string' && t.point.trim())
      .slice(0, 6)
      .map((t) => ({
        point: t.point.trim().slice(0, 80),
        // التفاصيل بتنمحي إذا فيها توجيهية، ويبقى العنوان
        detail: sanitizeText(
          t.detail,
          'هذه نقطة تفرّق بين الخيارين بحسب ما كتبته.'
        ).text,
        impacts: sanitizeList(t.impacts, '').slice(0, 4),
      }));

    const summary = sanitizeText(
      data?.summary,
      'قرأت ما كتبته واستخرجت منه خياراتك والمعايير.'
    ).text;

    const decidingFactor = sanitizeText(
      data?.decidingFactor,
      'ما في معيار واحد حاسم بوضوح'
    ).text;

    const decidingWhy = sanitizeText(
      data?.decidingWhy,
      'لأن باقي المعايير متقاربة بين الخيارين.'
    ).text;

    const question = sanitizeText(
      data?.question,
      'ما الشي الذي تخسره فعلياً لو اخترت الثاني؟'
    ).text;

    return {
      data: {
        summary,
        tradeoffs,
        decidingFactor,
        decidingWhy,
        question,
        missing: sanitizeList(data?.missing, '').slice(0, 3),
      },
      notes,
    };
  }

  if (taskKey === 'chat') {
    return {
      data: {
        reply: sanitizeText(data?.reply, 'وصلتني رسالتك.').text,
        question: sanitizeText(data?.question, '').text,
        insights: sanitizeList(data?.insights, '').slice(0, 4),
      },
      notes,
    };
  }

  if (taskKey === 'criteria') {
    const clean = sanitizeList(data?.criteria, '');
    if (clean.length !== (data?.criteria?.length ?? 0)) {
      notes.push('أُزيلت معايير تحتوي لغة توجيهيه');
    }
    return { data: { criteria: clean.slice(0, 8) }, notes };
  }

  if (taskKey === 'analysis') {
    const options = (data?.options ?? []).map((o) => {
      const pros = sanitizeList(o?.pros, '');
      const cons = sanitizeList(o?.cons, '');
      return {
        name: String(o?.name ?? '').trim(),
        pros: pros.slice(0, 5),
        cons: cons.slice(0, 5),
      };
    });

    const notesText = sanitizeText(
      data?.notes,
      'اكتمل ترتيب المعلومات. راجعي الجدول والأوزان لتحديد الفرق.'
    );
    if (notesText.cleaned) notes.push('استُبدل النص التفسيري لأنه كان موجّهاً');

    return { data: { options, notes: notesText.text }, notes };
  }

  if (taskKey === 'question') {
    const q = sanitizeText(
      data?.question,
      'ما الذي يبقى كما هو في حياتك بعد سنة من الآن؟'
    );
    if (q.cleaned) notes.push('استُبدل السؤال لأنه كان يوجّه لاختيار');
    return { data: { question: q.text }, notes };
  }

  if (taskKey === 'balance') {
    const findings = sanitizeList(data?.findings, '');
    return { data: { balanced: Boolean(data?.balanced), findings }, notes };
  }

  return { data, notes };
}

module.exports = { isContaminated, sanitizeText, sanitizeList, sanitizeResponse, BANNED };
