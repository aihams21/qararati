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
/**
 * تقسيم نص إلى جمل مع إبقاء الفواصل.
 * بدونها، كلمة توجيهيه وحدة كانت بتسقط الرد كامل — للمستخدم بيضل
 * «وصلتني رسالتك» وهو طلب إجابة.
 */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?؟،؛\n])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * ينقّي نص جملة جملة: بيشيل الجمل التوجيهيه وبيخلّي الباقي.
 * @returns {{text: string, dropped: number}} النص النظيف وعدد الجمل المحذوفة
 */
function sanitizeSentences(text) {
  const parts = splitSentences(text);
  const keep = [];
  let dropped = 0;

  for (const part of parts) {
    if (isContaminated(part)) dropped++;
    else keep.push(part);
  }

  return { text: keep.join(' ').trim(), dropped };
}

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

  if (taskKey === 'table') {
    // الجدول لازم كل صف يكمّل_after الخيارات كلها، وإلا الواجهة بتكسر.
    const rows = (Array.isArray(data?.rows) ? data.rows : [])
      .filter((r) => typeof r?.criterion === 'string' && r.criterion.trim())
      .slice(0, 10)
      .map((r) => ({
        criterion: r.criterion.trim().slice(0, 60),
        weight: clampScore(r.weight ?? 5) ?? 5,
        cells: (Array.isArray(r.cells) ? r.cells : []).slice(0, 6).map((c) => ({
          score: clampScore(c?.score ?? 0) ?? 0,
          note: sanitizeText(c?.note, 'ما ذكره').text.slice(0, 160),
        })),
      }))
      .filter((r) => r.cells.length > 0);

    return {
      data: {
        rows,
        verdict: sanitizeText(data?.verdict, '').text.slice(0, 400),
      },
      notes,
    };
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
    const insights = sanitizeList(data?.insights, '').slice(0, 4);

    // ننقّي الرد جملة جملة. لو سقط كله، نستعمل النقاط بدل ما
    // نرجع فاضي — النقاط عادةً سليمة لأنها وصفية.
    const { text: cleanReply, dropped } = sanitizeSentences(data?.reply);
    if (dropped > 0) notes.push(`chat: شِلنا ${dropped} جملة توجيهيه`);

    let reply = cleanReply;
    if (!reply || isEvasive(reply)) {
      reply = insights.join(' ');
      if (insights.length) notes.push('chat: استعملنا النقاط بدل الرد الممسوح');
    }

    // أسوأ حالة: كل شي اتمسح. ما بنرجع فاضي — الواجهة بتعرض
    // «وصلتني رسالتك» وهي كأنها إجابة، وهي أأذى من رسالة خطأ صريحة.
    if (!reply) {
      notes.push('chat: الرد كله اتمسح — رح يطلب من الموديل تاني');
      reply = '';
    }

    return {
      data: {
        reply,
        question: sanitizeText(data?.question, '').text,
        insights,
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


/**
 * طبقة جودة الرد.
 *
 * المشكلة: حتى بأفضل برومبت، الموديل بيرجع أحياناً كلام عام مثل
 * «بقدر تقرر بنفسك» أو «الأمر بيعتمد عليك». هالكلام ما بيعطي خدمة
 * وبيحبط المستخدم. فلازم نرفضه برمجياً حتى لو مفلتر التوجيهية عدّه نظيف.
 *
 * القاعدة: نطلب من الموديل يعيد المحاولة، وإذا رجّع نفس الشي
 * بنرجع رد غني بدل الرد الفارغ.
 */

/** عبارات التهرّب من الرد — regex بمرونة تلتقط الصيغ المشابهة */
const EVASIVE = [
  /الأمر\s+(بيعتمد|يعتمد|رجع)\s+عليك/,
  /بقد(?:ر|رت)\s+(تقرر|تقرري|تاخذ|تاخذي)\s+بنفسك/,
  /ما\s+في\s+(إجابة|جواب|اختيار)\s+(صح|واحد|صحيحة)/,
  /فكّر\s*(فيها|بالموضوع|في الموضوع)/,
  /الأمر\s+مش\s+سهل/,
  /حسب\s+(الحالة|الوضع|الظروف)/,
  /يعتمد\s+على\s+(نفسك|ظروفك|الحالة)/,
  /لو\s+عندك\s+شيء\s+تستشير/,
  /بالتوفيق/,
  /خذ\s+وقتك/,
  /مش\s+هيمشي\s+مع\s+نفسه/,
];

// ما بنرفض الرد بس لأنو قصير — بنرفضه لو كان قصير *و* فاضي من المحتوى
const MIN_USEFUL_CHARS = 60;

/** هل الرد «مهرّب»؟ يرجع {evasive, reason} أو null */
function isEvasive(text) {
  const t = String(text || '').trim();
  if (!t) return { evasive: true, reason: 'الرد فاضي' };

  for (const re of EVASIVE) {
    if (re.test(t)) return { evasive: true, reason: `عبارة تهرّب: ${re.source}` };
  }
  // رد قصير ما فيه أي معلومة
  if (t.length < MIN_USEFUL_CHARS) {
    return { evasive: true, reason: `الرد قصير جداً (${t.length} حرف)` };
  }
  return null;
}

/** هل الرد يسأل بس وما بيقدّم؟ نسبة الأسئلة للطول */
function questionRatio(text) {
  const t = String(text || '');
  const marks = (t.match(/[؟?]/g) || []).length;
  return t.length ? marks * 25 / t.length : 0;
}

module.exports = {
  isContaminated,
  sanitizeText,
  sanitizeList,
  sanitizeResponse,
  isEvasive,
  questionRatio,
  BANNED,
};
