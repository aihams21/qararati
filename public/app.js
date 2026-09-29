/**
 * app.js — واجهة «قراراتي»
 *
 * مبدأ التصميم: التطبيق يعرض أرقام ومعلومات فقط.
 * ما في أي نص بيقول "الأفضل" أو "اختاري" — الكود نفسه يمنع ذلك.
 */

'use strict';

// ═══════════ التخزين المحلي ═══════════
// كل البيانات على جهازها فقط. ما في سيرفر بيحفظ قراراتها.
const STORE_KEY = 'qararati.decisions.v1';
const PIN_KEY = 'qararati.pin.v1';

let PIN = '';   // الرمز، يُرسل مع كل طلب كـ header

const store = {
  all() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  },
  save(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
    catch (e) { console.warn('تعذّر الحفظ', e); }
  },
  upsert(d) {
    const list = this.all();
    const i = list.findIndex((x) => x.id === d.id);
    if (i === -1) list.unshift(d); else list[i] = d;
    this.save(list);
  },
  remove(id) {
    this.save(this.all().filter((x) => x.id !== id));
  },
  get(id) { return this.all().find((x) => x.id === id); },
};

const uid = () => Math.random().toString(36).slice(2, 10);

// ═══════════ الحالة ═══════════
let state = null;   // القرار الحالي قيد العمل
let editingId = null;

// ═══════════ أدوات مساعدة ═══════════
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
// بنبحث جوه عنصر معيّن بدل الصفحة كلها — بنحتاجها لما نرسم
// النتائج بمكان متغيّر (شاشة الإنشاء vs شاشة النتيجة).
const within = (root, sel) => {
  const el = typeof root === 'string' ? document.querySelector(root) : root;
  return el ? el.querySelectorAll(sel) : [];
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function busy(on, text) {
  $('#busy').classList.toggle('hidden', !on);
  if (text) $('#busyText').textContent = text;
}

function showView(name) {
  for (const v of ['list', 'new', 'result']) {
    $('#view-' + v).classList.toggle('hidden', v !== name);
  }
  window.scrollTo(0, 0);
}
// ═══════════ منطق الحساب (نفس lib/scoring.js، نسخة المتصفح) ═══════════

const clamp = (n, min, max) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
};

function scoreOption(optionId, criteria, scores) {
  const active = criteria.filter((c) => c.weight > 0);
  if (!active.length) return 0;
  const totalWeight = active.reduce((s, c) => s + c.weight, 0);
  const weighted = active.reduce((s, c) => {
    const raw = scores?.[optionId]?.[c.id];
    return s + clamp(raw ?? 0, 0, 10) * c.weight;
  }, 0);
  return weighted / totalWeight;
}

function scoreAll(decision) {
  const results = decision.options.map((o) => ({
    id: o.id,
    name: o.name,
    score: scoreOption(o.id, decision.criteria, decision.scores),
  }));
  results.sort((a, b) => b.score - a.score);
  return results;
}

const gapOf = (results) => (results.length < 2 ? 0 : results[0].score - results[1].score);

function sensitivity(decision) {
  const base = scoreAll(decision);
  const baseOrder = base.map((r) => r.id).join('|');
  const influential = [];
  for (const c of decision.criteria) {
    if (c.weight <= 0) continue;
    const halved = decision.criteria.map((x) =>
      x.id === c.id ? { ...x, weight: x.weight / 2 } : x
    );
    const trial = scoreAll({ ...decision, criteria: halved });
    if (trial.map((r) => r.id).join('|') !== baseOrder) {
      influential.push({
        criterionId: c.id,
        name: c.name,
        message: `لو خفّضت أهمية «${c.name}» للنصف، رتّب الخيارات بينقلب.`,
      });
    }
  }
  return { influential, orderChanged: influential.length > 0 };
}

function completeness(decision) {
  let done = 0;
  const total = decision.options.length * decision.criteria.length;
  for (const o of decision.options)
    for (const c of decision.criteria)
      if (decision.scores?.[o.id]?.[c.id] != null) done++;
  return { done, total, ratio: total ? done / total : 0 };
}

const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];

/** يحوّل رقم لنص عربي: 5.5 → ٥٫٥ */
function arNum(n, decimals = 1) {
  const fixed = Number(n).toFixed(decimals);
  return fixed.replace(/[0-9]/g, (d) => AR_DIGITS[+d]).replace('.', '٫');
}

const AR_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
// ═══════════ عرض النتائج ═══════════

function renderBars() {
  const results = scoreAll(state);
  const letters = {};
  state.options.forEach((o, i) => { letters[o.id] = AR_LETTERS[i] || '؟'; });

  $('#barsWrap').innerHTML = results.map((r) => {
    const idx = state.options.findIndex((o) => o.id === r.id);
    const cls = ['a', 'b', 'c'][idx] || 'a';
    return `
      <div class="bar-item">
        <div class="bar-top">
          <span class="bar-name">${esc(letters[r.id])} · ${esc(r.name || 'بلا اسم')}</span>
          <span class="bar-val">${arNum(r.score)}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${cls}" data-w="${(r.score * 10).toFixed(0)}"></div>
        </div>
      </div>`;
  }).join('');

  // نترك المتصفح يرسم ثم نحرّك العرض — يعطي أنيميشن ناعم
  requestAnimationFrame(() => {
    $$('#barsWrap .bar-fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
  });

  const g = gapOf(results);
  const wrap = $('#barsWrap').parentElement;
  let note = wrap.querySelector('.gap-note');
  if (g >= 0.15) {
    const txt = `الفارق بين الأوّل والثاني ${arNum(g)} نقطة من ١٠ — فرق ${g < 1 ? 'صغير' : g < 2.5 ? 'متوسط' : 'واضح'}.`;
    if (note) { note.textContent = txt; }
    else {
      note = document.createElement('div');
      note.className = 'gap-note';
      note.textContent = txt;
      $('#barsWrap').after(note);
    }
  } else if (note) {
    note.textContent = 'الخيارات متقاربة جداً — الفرق أقل من ٠.١ نقطة.';
  }
}

function renderSensitivity() {
  const s = sensitivity(state);
  const el = $('#sensitivityWrap');
  if (state.criteria.length < 2) {
    el.innerHTML = '<div class="sens-ok">أضيفي معيارين على الأقل لنقدر نتحسّس أثر الأوزان على النتيجة.</div>';
    return;
  }
  if (!s.influential.length) {
    el.innerHTML = '<div class="sens-ok">النتيجة متينّة: حتى لو خفّضت أهمية أي معيار للنصف، رتّب الخيارات ما بينقلب. يعني الخيارات متكافئة بوزن معاييرك الحالي.</div>';
  } else {
    el.innerHTML = s.influential.map((i) =>
      `<div class="sens-item">${esc(i.message)}</div>`
    ).join('');
  }
}

function renderMatrix() {
  const wrap = $('#matrixWrap');
  if (!state.criteria.length) {
        wrap.innerHTML = '<div class="empty-hint">أضيفي معايير حتى تقدري تقيّمي الخيارات.</div>';
    return;
  }
  wrap.innerHTML = state.criteria.map((c) => {
    const rows = state.options.map((o, i) => {
      const v = state.scores?.[o.id]?.[c.id] ?? 5;
      const cls = ['a', 'b', 'c'][i] || 'a';
      const accent = cls === 'b' ? 'accent-2' : 'accent';
      return `
        <div class="mx-row">
          <span class="mx-label">${esc(AR_LETTERS[i] || '؟')} · ${esc(o.name || '—')}</span>
          <input type="range" class="mx-slider" min="0" max="10" step="1"
                 value="${v}" data-score="${o.id}" data-crit="${c.id}"
                 style="accent-color: var(--${accent})">
          <span class="mx-val" data-val-for="${o.id}-${c.id}">${arNum(v, 0)}</span>
        </div>`;
    }).join('');

    return `
      <div class="mx-crit">
        <div class="mx-crit-name"><span>${esc(c.name)}</span></div>
        ${rows}
        <div class="mx-weight">
          <span>الأهمية</span>
          <input type="range" min="0" max="10" step="1" value="${c.weight}" data-weight="${c.id}">
          <span class="crit-w">${arNum(c.weight, 0)}</span>
        </div>
      </div>`;
  }).join('');
  bindMatrix();
}
// ═══════════ ربط المصفوفة (تحديث حي) ═══════════

function bindMatrix() {
  $$('#matrixWrap input[data-score]').forEach((el) => {
    el.addEventListener('input', () => {
      const { score: optId, crit } = el.dataset;
      state.scores[optId] = state.scores[optId] || {};
      state.scores[optId][crit] = Number(el.value);
      const label = $(`#matrixWrap [data-val-for="${optId}-${crit}"]`);
      if (label) label.textContent = arNum(el.value, 0);
      renderBars();
      renderSensitivity();
    });
  });

  $$('#matrixWrap input[data-weight]').forEach((el) => {
    el.addEventListener('input', () => {
      const c = state.criteria.find((x) => x.id === el.dataset.weight);
      if (!c) return;
      c.weight = Number(el.value);
      const pill = el.nextElementSibling;
      if (pill && pill.classList.contains('crit-w')) pill.textContent = arNum(c.weight, 0);
      renderBars();
      renderSensitivity();
    });
  });
}

// ═══════════ عرض نتائج الذكاء الاصطناعي ═══════════

function renderAI(task, data, out, onNew = false) {
  if (!out) out = $('#aiOut');

  if (task === 'criteria') {
    const list = data.criteria || [];
    if (!list.length) { out.innerHTML = '<div class="ai-err">ما اقترح الذكاء الاصطناعي معايير جديدة.</div>'; return; }
    out.innerHTML = `
      <div class="ai-block">
        <h4>معايير ممكن تضيفيها</h4>
        <div class="ai-adds">
          ${list.map((c) => `<button class="chip-add" data-add-crit="${esc(c)}">+ ${esc(c)}</button>`).join('')}
        </div>
      </div>`;
    // ⚠️ لازم نربط على الحاوية اللي رُسم فيها، مو على #aiOut الثابت.
    //Proposal chips على شاشة الإنشاء بتنرسم بـ #newAiOut، فإذا ربطنا
    // على #aiOut كانو بيظهروا بس ما في handler عليهم = 버튼 ميّت.
    within(out, '[data-add-crit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        addCriterion(btn.dataset.addCrit);
        btn.disabled = true;
        btn.textContent = '✓ ' + btn.textContent.slice(2);
        if (!onNew) renderMatrix();
        toast('تمت الإضافة');
      });
    });
    return;
  }

  if (task === 'analysis') {
    const blocks = (data.options || []).map((o) => {
      const pros = (o.pros || []).map((p) => `<li>${esc(p)}</li>`).join('');
      const cons = (o.cons || []).map((c) => `<li class="ai-cons">${esc(c)}</li>`).join('');
      return `
        <div class="ai-block">
          <h4>${esc(o.name || 'خيار')}</h4>
          ${pros ? `<ul>${pros}</ul>` : ''}
          ${cons ? `<ul>${cons}</ul>` : ''}
        </div>`;
    }).join('');
    const notes = data.notes ? `<div class="ai-block"><h4>الفرق الجوهري</h4><p class="ai-notes">${esc(data.notes)}</p></div>` : '';
    out.innerHTML = blocks + notes;
    return;
  }

  if (task === 'question') {
    out.innerHTML = `<div class="ai-block"><h4>سؤال للتفكير</h4><div class="q">${esc(data.question || '')}</div></div>`;
    return;
  }

  if (task === 'balance') {
    if (data.balanced) {
      out.innerHTML = '<div class="ai-block"><h4>التوازن</h4><div class="sens-ok">تحليلك متوازن بين الخيارين.</div></div>';
    } else {
      const items = (data.findings || []).map((f) => `<li>${esc(f)}</li>`).join('');
      out.innerHTML = `<div class="ai-block"><h4>ملاحظات على التوازن</h4><ul>${items}</ul></div>`;
    }
    return;
  }
}
// __JS_NEXT__ */



// ═══════════ استدعاء الذكاء الاصطناعي ═══════════

/**
 * @param {string} task       اسم المهمة
 * @param {object} payload    البيانات
 * @param {Element} out       الحاوية اللي بنكتب فيها النتيجة
 * @param {boolean} onNew     إذا كانت العملية على شاشة الإنشاء
 */
async function callAI(task, payload, out, onNew = false) {
  // ليش الحاوية جايبة كمعامل: زر «اقتراح معايير» موجود على شاشة
  // الإنشاء، وما في #aiOut هناك (دي بشاشة النتيجة). فلو كتبنا دايماً
  // بـ $('#aiOut') كان الرد بينكتب بعنصر مخفي وما بتظهر النتيجة أبداً.

  const buttons = $$('[data-ai], #btnSuggest');
  buttons.forEach((b) => (b.disabled = true));
  busy(true, 'عم يفكّر… (حتى ٢٠ ثانية)');

  // بنعطي المتصفح مهلة ٣٥ ثانية. لو ما رد، بنلغي الطلب بدل ما
  // نخلي المستخدم يقعد ينطر على شاشة ما بتتغير.
  const ctl = new AbortController();
  const kill = setTimeout(() => ctl.abort(), 35000);

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pin': PIN },
      body: JSON.stringify({ task, payload }),
      signal: ctl.signal,
    });
    const json = await res.json();

    if (res.status === 401) {
      sessionStorage.removeItem(PIN_KEY);
      PIN = '';
      toast('انتهت الجلسة. أدخلي الرمز من جديد.');
      return;
    }
    if (json.ok) {
      renderAI(task, json.data, out, onNew);
    } else {
      showAIFail(out, json.message, task, payload, onNew);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      showAIFail(out, 'الخدمة بطيئة اليوم. جدول المقارنة كامل وشغّال بدونها.', task, payload, onNew);
    } else {
      showAIFail(out, 'ما قدرنا نوصل للخدمة. تأكدي من الإنترنت.', task, payload, onNew);
    }
  } finally {
    clearTimeout(kill);
    busy(false);
    buttons.forEach((b) => (b.disabled = false));
  }
}

/**
 * عند فشل الذكاء الاصطناعي: بنعرض الرسالة + زر «حاول تاني».
 * وقتها بنعرض السبب الحقيقي للمستخدم مع زر لإعادة المحاولة،
 * بدل رسالة ميتة ما فيها حل.
 */
function showAIFail(out, message, task, payload, onNew = false) {
  out.innerHTML =
    '<div class="ai-err">' + esc(message || 'الخدمة مشغولة مؤقتاً.') + '</div>' +
    '<button class="ai-retry" data-retry="' + esc(task) + '">حاول تاني</button>';
  const btn = out.querySelector('[data-retry]');
  if (btn) {
    btn.addEventListener('click', () => callAI(task, payload, out, onNew));
  }
}

function buildPayload() {
  return {
    title: state.title,
    options: state.options.map((o) => ({
      name: o.name,
      notes: o.notes || '',
    })),
    criteria: state.criteria.map((c) => c.name),
  };
}

// ═══════════ نموذج الإنشاء ═══════════

function addOption(name) {
  state.options.push({ id: uid(), name: name || '', notes: '' });
  renderNew();
}

function addCriterion(name) {
  const n = String(name || '').trim();
  if (!n) return;
  if (state.criteria.some((c) => c.name === n)) { toast('هذا المعيار موجود'); return; }
  state.criteria.push({ id: uid(), name: n, weight: 5 });
  renderNew();
}

function renderNew() {
  $('#inTitle').value = state.title;

  // الخيارات
  $('#optionsWrap').innerHTML = state.options.map((o, i) => {
    const cls = ['a', 'b', 'c'][i] || 'a';
    const letter = AR_LETTERS[i] || '؟';
    const canDel = state.options.length > 2;
    return `
      <div class="opt-input" data-opt="${o.id}">
        <span class="opt-chip ${cls}">${letter}</span>
        <input type="text" value="${esc(o.name)}" data-opt-name="${o.id}"
               placeholder="الخيار ${letter}">
        ${canDel ? `<button class="opt-del" data-opt-del="${o.id}" aria-label="حذف">×</button>` : ''}
      </div>`;
  }).join('');

  // المعايير
  $('#criteriaWrap').innerHTML = state.criteria.length
    ? state.criteria.map((c) => `
        <div class="crit" data-crit="${c.id}">
          <span class="crit-name">${esc(c.name)}</span>
          <span class="crit-w" data-crit-w="${c.id}">${c.weight}</span>
          <button class="crit-del" data-crit-del="${c.id}" aria-label="حذف">×</button>
        </div>`).join('')
    : '<div class="empty-hint">لم تُضف معايير بعد. فكّري: شو أكثر شي يهمّك؟</div>';

  // الملاحظات
  $('#notesWrap').innerHTML = state.options.map((o, i) => `
    <div class="note-block">
      <div class="note-head">
        <span class="opt-chip ${['a','b','c'][i] || 'a'}" style="width:22px;height:22px;font-size:.75rem">${AR_LETTERS[i] || '؟'}</span>
        <span>${esc(o.name || 'الخيار ' + (AR_LETTERS[i] || ''))}</span>
      </div>
      <textarea data-note="${o.id}" placeholder="اكتبي اللي تعرفينه عن هذا الخيار…">${esc(o.notes || '')}</textarea>
    </div>`).join('');

  bindNew();
}

function bindNew() {
  $$('#optionsWrap input[data-opt-name]').forEach((el) => {
    el.addEventListener('input', () => {
      const o = state.options.find((x) => x.id === el.dataset.optName);
      if (o) o.name = el.value;
    });
  });

  $$('#optionsWrap [data-opt-del]').forEach((el) => {
    el.addEventListener('click', () => {
      state.options = state.options.filter((x) => x.id !== el.dataset.optDel);
      state.scores = {};
      renderNew();
    });
  });

  $$('#notesWrap [data-note]').forEach((el) => {
    el.addEventListener('input', () => {
      const o = state.options.find((x) => x.id === el.dataset.note);
      if (o) o.notes = el.value;
    });
  });

  $$('#criteriaWrap [data-crit-del]').forEach((el) => {
    el.addEventListener('click', () => {
      state.criteria = state.criteria.filter((x) => x.id !== el.dataset.critDel);
      renderNew();
    });
  });
}

// ═══════════ السجل ═══════════

function renderHistory() {
  const list = store.all();
  $('#emptyState').classList.toggle('hidden', list.length > 0);
  $('#historyList').classList.toggle('hidden', list.length === 0);

  $('#historyList').innerHTML = list.map((d) => {
    const when = new Date(d.updatedAt || d.createdAt).toLocaleDateString('ar', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
    const opts = (d.options || []).map((o, i) =>
      `<span class="hist-opt">${AR_LETTERS[i] || '؟'} · ${esc(o.name || '—')}</span>`
    ).join('');
    return `
      <button class="hist-item" data-open="${d.id}">
        <div class="hist-title">${esc(d.title || 'قرار بدون عنوان')}</div>
        <div class="hist-meta">${when} · ${(d.criteria || []).length} معيار</div>
        <div class="hist-opts">${opts}</div>
      </button>`;
  }).join('');

  $$('#historyList [data-open]').forEach((el) => {
    el.addEventListener('click', () => {
      const d = store.get(el.dataset.open);
      if (!d) return;
      state = JSON.parse(JSON.stringify(d));
      editingId = d.id;
      $('#resultTitle').textContent = d.title || 'قرار';
      $('#aiOut').innerHTML = '';
      renderResult();
    });
  });
}

// ═══════════ عرض النتيجة ═══════════

function renderResult() {
  $('#resultTitle').textContent = state.title || 'قرار';

  const c = completeness(state);
  $('#completePill').textContent = c.total === 0
    ? 'لا توجد معايير'
    : arNum(c.done, 0) + ' من ' + arNum(c.total, 0);

  renderBars();
  renderSensitivity();
  renderMatrix();
  showView('result');
}

// ═══════════ نافذة البداية ═══════════

function startNew() {
  editingId = null;
  state = {
    id: uid(),
    title: '',
    options: [{ id: uid(), name: '', notes: '' }, { id: uid(), name: '', notes: '' }],
    criteria: [],
    scores: {},
    createdAt: new Date().toISOString(),
  };
  $('#inCriterion').value = '';
  $('#aiOut').innerHTML = '';
  renderNew();
  showView('new');
}

// ═══════════ ربط الأحداث العامة ═══════════

function init() {
  // شريط علوي + زر "ابدأ قرار" بالشاشة الفاضية
  $('#btnNew').addEventListener('click', startNew);
  $$('[data-action="new"]').forEach((b) => b.addEventListener('click', startNew));

  // النموذج
  $('#inTitle').addEventListener('input', (e) => { state.title = e.target.value; });

  $('#addOption').addEventListener('click', () => addOption(''));

  $('#addCriterion').addEventListener('click', () => {
    addCriterion($('#inCriterion').value);
    $('#inCriterion').value = '';
  });

  $('#inCriterion').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCriterion($('#inCriterion').value);
      $('#inCriterion').value = '';
    }
  });

  // اقتراح معايير أثناء الإنشاء
  // نفس مسار callAI بالضبط — عشان الفشل يكون بنفس الشكل لكل المهام،
  // ولما يفشل يقترح عليك تكتبي المعايير يدوي بدل ما يضل يقف.
  $('#btnSuggest').addEventListener('click', () => {
    if (!state.title && state.options.every((o) => !o.name)) {
      toast('اكتبي عنوان القرار أو الخيارات أولاً');
      return;
    }
    callAI('criteria', buildPayload(), $('#newAiOut'), true);
  });

  // تحويل لصفحة النتيجة
  $('#btnAnalyze').addEventListener('click', () => {
    const named = state.options.filter((o) => o.name.trim());
    if (named.length < 2) { toast('اكتبي اسم خيارين على الأقل'); return; }
    if (!state.criteria.length) { toast('أضيفي معيار واحد على الأقل'); return; }
    state.options = named;
    // نملأ الدرجات الناقصة بـ ٥ محايد
    for (const o of state.options) {
      state.scores[o.id] = state.scores[o.id] || {};
      for (const cr of state.criteria) {
        if (state.scores[o.id][cr.id] == null) state.scores[o.id][cr.id] = 5;
      }
    }
    renderResult();
  });

  // أزرار الذكاء الاصطناعي في صفحة النتيجة
  $$('[data-ai]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.criteria.length < 1) { toast('أضيفي معايير أولاً'); return; }
      callAI(btn.dataset.ai, buildPayload(), $('#aiOut'));
    });
  });

  // رجوع
  $('#btnBack').addEventListener('click', () => { renderHistory(); showView('list'); });

  // حفظ
  $('#btnSave').addEventListener('click', () => {
    if (!state.title.trim()) { toast('اكتبي عنوان القرار'); return; }
    state.id = editingId || state.id;
    state.updatedAt = new Date().toISOString();
    store.upsert(state);
    editingId = state.id;
    toast('تم الحفظ');
  });

  // حذف
  $('#btnDelete').addEventListener('click', () => {
    if (!confirm('تحذير: حذف هذا القرار نهائياً؟')) return;
    store.remove(state.id);
    toast('تم الحذف');
    renderHistory();
    showView('list');
  });

  // بدء
  renderHistory();
  showView('list');
}

// ═══════════ بوابة الرمز (اختيارية) ═══════════

function initGate() {
  const gate = $('#gate');
  const app = $('#app');

  // لو الرمز مخزّن من جلسة سابقة، نتحقق من صحته مع السيرفر
  PIN = sessionStorage.getItem(PIN_KEY) || '';
  if (PIN) {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    init();
    return;
  }

  gate.classList.remove('hidden');

  const input = $('#pinInput');
  const err = $('#gateErr');

  async function checkPin() {
    const val = input.value.trim();
    if (!val) { err.textContent = 'اكتبي الرمز'; return; }

    err.textContent = '';
    input.disabled = true;
    $('#pinBtn').disabled = true;

    // نتحقق على السيرفر — نقطة خفيفة ما بتلمس Google، فالرد فوري
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: val }),
      });

      if (res.status === 401) {
        err.textContent = 'الرمز غير صحيح';
        input.value = '';
        input.focus();
        return;
      }
      if (!res.ok) { err.textContent = 'تعذّر الاتصال. تأكدي من نت.'; return; }

      // الرمز صح
      PIN = val;
      sessionStorage.setItem(PIN_KEY, val);
      gate.classList.add('hidden');
      app.classList.remove('hidden');
      init();
    } catch {
      err.textContent = 'تعذّر الاتصال. تأكدي من نت.';
    } finally {
      input.disabled = false;
      $('#pinBtn').disabled = false;
    }
  }

  $('#pinBtn').addEventListener('click', checkPin);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkPin(); });
  setTimeout(() => input.focus(), 100);
}

// شغّل
document.addEventListener('DOMContentLoaded', initGate);
