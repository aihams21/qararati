/**
 * scoring.js — كل الحسابات-math. نقية 100%، بلا DOM وبلا شبكة.
 * سهلة الاختبار، ومضمونة إنها ما بتلمس حالة الـ AI إطلاقاً.
 */

/** يحوّل أي قيمة لرقم ضمن [min,max] بشكل آمن */
function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

/**
 * النتيجة الموزونة لخيار واحد.
 * مجموع(درجة × وزن) ÷ مجموع(الأوزان) → رقم 0..10
 */
function scoreOption(optionId, criteria, scores) {
  const active = criteria.filter((c) => c.weight > 0);
  if (active.length === 0) return 0;

  const totalWeight = active.reduce((sum, c) => sum + c.weight, 0);
  const weighted = active.reduce((sum, c) => {
    const raw = scores?.[optionId]?.[c.id];
    return sum + clamp(raw ?? 0, 0, 10) * c.weight;
  }, 0);

  return weighted / totalWeight;
}

/** نتائج كل الخيارات، مرتبة تنازلياً */
function scoreAll(decision) {
  const { options, criteria, scores } = decision;
  const results = options.map((o) => ({
    id: o.id,
    name: o.name,
    score: scoreOption(o.id, criteria, scores),
  }));
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * الفارق بين الأول والثاني.
 * مهم: نرجّع الفرق كرقم، والواجهة تعرضه كـ"فارق" لا كـ"فائز".
 */
function gap(results) {
  if (results.length < 2) return 0;
  return results[0].score - results[1].score;
}

/**
 * تحليل الحساسية — الميزة المميزة للتطبيق.
 *
 * السؤال: "أي معيار لو غيّرنا وزنه بتنقلب النتيجة؟"
 * الفكرة: ننقص وزن كل معيار للنصف، ونشوف لو الترتيب تغيّر.
 * ما بنطلع مع أي خيار — بنطلع مع أي *معيار* يحسم القرار.
 */
function sensitivity(decision) {
  const { options, criteria, scores } = decision;
  const base = scoreAll(decision);
  const baseOrder = base.map((r) => r.id).join('|');

  const influential = [];

  for (const c of criteria) {
    if (c.weight <= 0) continue;

    // ننقص وزن هذا المعيار للنصف
    const halved = criteria.map((x) =>
      x.id === c.id ? { ...x, weight: x.weight / 2 } : x
    );
    const trial = scoreAll({ ...decision, criteria: halved });
    const trialOrder = trial.map((r) => r.id).join('|');

    if (trialOrder !== baseOrder) {
      influential.push({
        criterionId: c.id,
        name: c.name,
        message: `لو خفّضت أهمية «${c.name}» إلى النصف، رتّب الخيارات سينقلب.`,
      });
    }
  }

  // نكتشف الكفة الراجحة: كم معيار يقدّم له كل خيار
  const strengths = { [options[0]?.id]: 0, [options[1]?.id]: 0 };
  for (const o of options) {
    if (strengths[o.id] === undefined) strengths[o.id] = 0;
    for (const c of criteria) {
      const s = scores?.[o.id]?.[c.id] ?? 0;
      if (s >= 7) strengths[o.id] += 1;
    }
  }

  return { influential, strengths, orderChanged: influential.length > 0 };
}

/** المعايير التي لم تُقيَّم بعد — تذكير لطيف بما ينقص */
function unrated(decision) {
  const { options, criteria, scores } = decision;
  const gaps = [];
  for (const c of criteria) {
    for (const o of options) {
      const v = scores?.[o.id]?.[c.id];
      if (v === undefined || v === null) {
        gaps.push({ criterionId: c.id, optionId: o.id, criterion: c.name, option: o.name });
      }
    }
  }
  return gaps;
}

/** جاهزية Decision قبل التحليل */
function completeness(decision) {
  const { options, criteria, scores } = decision;
  const total = options.length * criteria.length;
  const done = total - unrated(decision).length;
  return {
    done,
    total,
    ratio: total === 0 ? 0 : done / total,
  };
}

module.exports = {
  clamp,
  scoreOption,
  scoreAll,
  gap,
  sensitivity,
  unrated,
  completeness,
};
