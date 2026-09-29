/**
 * app.js — واجهة «قراراتي»: الشات.
 *
 * فلسفة الشات: المستخدم ما بيملأ نماذج. بيتكلم بالعادي، والموديل
 * بيستخرج الخيارات والمعايير والأوزان في الخلفية، وبيولّد بطاقة تحليل.
 *
 * ثلاث قواعد ما بنكسرها:
 * 1. ما في توصية أبداً — الفلاتر على السيرفر أي توجّه يتمسح قبل ما يوصلك.
 * 2. كل شي محلي — السجل في localStorage، والمفتاح ما بيوصل للتليفون.
 * 3. لو الرد ما رجّع، لازم نخلي كل شي ينتهي برسالة واضحة وزر محاولة.
 */
(() => {
  'use strict';

  // ═══════════ أدوات صغيرة ═══════════

  const $ = (s, r = document) => r.querySelector(s);
  const within = (root, sel) => {
    const el = typeof root === 'string' ? document.querySelector(root) : root;
    return el ? el.querySelectorAll(sel) : [];
  };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  // نص معروض: متهرّب + معالَج اتجاه. ما بنستخدمه مع HTML جاهز.
  const txt = (s) => bidi(esc(s));

  // نخلي الأرقام إنكليزية عادية — أسهل للعين من الأرقام العربية
  /**
   * كلمة لاتينية وسط نص عربي بتكسر الفقرة (bidi): علامات الترقيم بتطيح
   * بالبداية. منلصّقو ب-directions لنص صريح يحلّها.
   */
  function bidi(s) {
    return String(s ?? '').replace(
      /([A-Za-z][A-Za-z'\u2019\-.]*)/g,
      '<bdi style="display:inline">$1</bdi>'
    );
  }

  const PIN_KEY = 'qararati_pin';
  const LOG_KEY = 'qararati_chat_v1';
  const CTX_KEY = 'qararati_ctx_v1';

  let PIN = sessionStorage.getItem(PIN_KEY) || '';
  let sending = false;

  /** آخر سياق محفوظ — بيكمل من وين ما وقفنا */
  let ctx = load(CTX_KEY, null);
  const history = load(LOG_KEY, []);

  function load(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* الذاكرة ممتلئة — ما بنكسر الشات */
    }
  }

  // ═══════════ التنقّل ═══════════

  const gate = $('#gate');
  const chat = $('#chat');
  const stream = $('#stream');
  const input = $('#input');
  const sendBtn = $('#send');
  const starters = $('#starters');
  const toastEl = $('#toast');

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }

  function scrollDown(smooth = true) {
    requestAnimationFrame(() => {
      stream.scrollTo({ top: stream.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    });
  }

  // ═══════════ بوابة الرمز ═══════════

  function initGate() {
    if (PIN) { open(); return; }
    show(gate);
    const pinInput = $('#pinInput');
    $('#pinBtn').addEventListener('click', checkPin);
    pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkPin(); });
    setTimeout(() => pinInput.focus(), 120);
  }

  async function checkPin() {
    const val = pinInput_value();
    const err = $('#gateErr');
    if (!val) { err.textContent = 'اكتبي الرمز'; return; }
    err.textContent = '';
    pinInput.disabled = true;
    $('#pinBtn').disabled = true;

    try {
      // نقطة خفيفة ما بتلمس Google — الرد فوري
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: val }),
      });
      if (res.status === 401) {
        err.textContent = 'الرمز غير صحيح';
        pinInput.value = '';
        pinInput.focus();
        return;
      }
      if (!res.ok) { err.textContent = 'تعذّر الاتصال. تأكدي من نت.'; return; }
      PIN = val;
      sessionStorage.setItem(PIN_KEY, val);
      open();
    } catch {
      err.textContent = 'تعذّر الاتصال. تأكدي من نت.';
    } finally {
      pinInput.disabled = false;
      $('#pinBtn').disabled = false;
    }
  }

  function pinInput_value() { return $('#pinInput').value.trim(); }

  function open() {
    hide(gate);
    show(chat);
    if (!history.length) greet();
    else renderAll();
    $('#btnNew').addEventListener('click', newChat);
    autoGrow();
    input.focus();
  }

  // ═══════════ بناء الرسائل ═══════════

  function greet() {
    push('ai', {
      html: `<p>هلا. احكيلي عن القرار اللي عم تفكر فيه — بالطريقة اللي بتحكيها، مش لازم يكون مرتب.</p>
             <p class="dim">مثال: «محتار بين وظيفتين: الأولى قريبة وراتبها متوسط، والثانية راتبها ممتاز بس بعيدة.»</p>`,
    });
    show(starters);
  }

  function push(role, body) {
    const msg = { id: uid(), role, ...body };
    history.push(msg);
    save(LOG_KEY, history);
    stream.appendChild(bubble(msg));
    scrollDown();
    return msg;
  }

  function update(msg) {
    const i = history.findIndex((m) => m.id === msg.id);
    if (i > -1) history[i] = msg;
    save(LOG_KEY, history);
    const el = stream.querySelector(`[data-id="${msg.id}"]`);
    if (el) el.replaceWith(bubble(msg));
  }

  function bubble(msg) {
    const el = document.createElement('div');
    el.className = `row ${msg.role}`;
    el.dataset.id = msg.id;

    if (msg.role === 'me') {
      el.innerHTML = `<div class="bubble me-b">${txt(msg.text)}</div>`;
      return el;
    }

    let inner = '';
    if (msg.pending) {
      inner = `<div class="typing"><i></i><i></i><i></i></div>`;
    } else if (msg.html) {
      inner = msg.html;
    }
    el.innerHTML = `<div class="bubble ai-b">${inner}</div>`;
    return el;
  }

  function renderAll() {
    stream.innerHTML = '';
    history.forEach((m) => stream.appendChild(bubble(m)));
    if (history.length) hide(starters);
    scrollDown(false);
  }

  function newChat() {
    if (sending) { toast('خلّيني أخلص هالرد'); return; }
    if (!history.length) return;
    history.length = 0;
    ctx = null;
    save(LOG_KEY, history);
    save(CTX_KEY, ctx);
    stream.innerHTML = '';
    greet();
  }

  // ═══════════ بطاقة التحليل ═══════════

  function card(a) {
    const list = (a.tradeoffs || []).map((t) => `
      <li>
        <strong>${txt(t.point)}</strong>
        ${t.detail ? `<p>${txt(t.detail)}</p>` : ''}
        ${(t.impacts || []).length
          ? `<span class="impacts">${t.impacts.map((i) => `<em>${txt(i)}</em>`).join('')}</span>`
          : ''}
      </li>`).join('');

    const missing = (a.missing || []).length
      ? `<div class="card-missing"><h5>لو عرفتِ هالشي كان قرارك أسهل</h5>
           <ul>${a.missing.map((m) => `<li>${txt(m)}</li>`).join('')}</ul></div>`
      : '';

    return `
      <div class="acard">
        <p class="acard-sum">${txt(a.summary)}</p>

        ${list ? `<div class="acard-sec">
          <h5>وين الفرق الحقيقي</h5>
          <ul class="tradeoffs">${list}</ul>
        </div>` : ''}

        <div class="acard-decide">
          <span class="decide-label">نقطة الحسم</span>
          <strong>${txt(a.decidingFactor)}</strong>
          <p>${txt(a.decidingWhy)}</p>
        </div>

        ${missing}
      </div>`;
  }

  // ═══════════ الاتصال بالموديل ═══════════

  async function ask(task, payload) {
    const ctl = new AbortController();
    const kill = setTimeout(() => ctl.abort(), 40000);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pin': PIN },
        body: JSON.stringify({ task, payload }),
        signal: ctl.signal,
      });

      if (res.status === 401) {
        PIN = '';
        sessionStorage.removeItem(PIN_KEY);
        show(gate);
        hide(chat);
        toast('انتهت الجلسة. أدخلي الرمز من جديد.');
        return { ok: false, gone: true };
      }
      if (res.status === 413) return { ok: false, msg: 'الرسالة طويلة جداً. اختصرها شوي.' };
      if (res.status === 429) return { ok: false, msg: 'طلبات كثيرة خلال وقت قصير. انتظر دقيقة.' };
      return await res.json();
    } catch (err) {
      const slow = err && err.name === 'AbortError';
      return {
        ok: false,
        msg: slow
          ? 'الخدمة بطيئة اليوم. جرّبي كمان مرة.'
          : 'ما قدرنا نوصل. تأكدي من الإنترنت.',
      };
    } finally {
      clearTimeout(kill);
    }
  }

  // ═══════════ إرسال رسالة ═══════════

  async function submit(text) {
    const t = String(text || '').trim();
    if (!t) return;
    if (sending) { toast('خلّيني أخلص هالرد'); return; }

    hide(starters);
    push('me', { text: t });
    input.value = '';
    autoGrow();

    sending = true;
    sendBtn.disabled = true;
    const pending = push('ai', { pending: true });

    try {
      // أول رسالة = استخراج + تحليل. بعدها = محادثة.
      if (!ctx || !ctx.options) {
        const parsed = await ask('parse', { text: t });
        if (!parsed.ok) { fail(pending, parsed.msg); return; }

        if (!parsed.data.options || parsed.data.options.length < 2) {
          update(finish(pending, `<p>ما التقطت خيارين واضحين من هالكلام. 🤖</p>
            <p class="dim">جرّبي تكتبي كل خيار وجواها شي عنه — مثل: «الأولى قريبة والراتب متوسط، والثانية بعيدة بس الراتب أعلى».</p>`));
          return;
        }

        const analyzed = await ask('analyze', {
          title: parsed.data.title,
          options: parsed.data.options,
          criteria: parsed.data.criteria,
        });
        if (!analyzed.ok) {
          // وصلنا للاستخراج بس التحليل فشل — ما بنضيّع كلام المستخدم
          update(finish(pending, `<p>فهمت قرارك: <strong>${esc(parsed.data.title)}</strong>.</p>
            <p class="dim">بس التحليل ما رجّع. جرّبي كمان مرة.</p>`,
            { options: parsed.data.options, title: parsed.data.title }));
          return;
        }

        ctx = { ...parsed.data, analysis: analyzed.data };
        save(CTX_KEY, ctx);
        update(finish(pending, card(analyzed.data)));
      } else {
        const reply = await ask('chat', {
          text: t,
          title: ctx.title,
          options: ctx.options,
          criteria: ctx.criteria,
          analysis: ctx.analysis,
        });
        if (!reply.ok) { fail(pending, reply.msg); return; }

        const d = reply.data;
        let html = `<p>${txt(d.reply)}</p>`;
        if ((d.insights || []).length) {
          html += `<ul class="chat-insights">${d.insights.map((i) => `<li>${txt(i)}</li>`).join('')}</ul>`;
        }
        update(finish(pending, html));
      }
    } catch (err) {
      fail(pending, 'صار خطأ غير متوقع. جرّبي كمان مرة.');
      console.error(err);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function finish(pending, html) {
    return { id: pending.id, role: 'ai', html };
  }

  function fail(pending, msg) {
    update(finish(pending, `<p class="ai-err">${esc(msg || 'الخدمة مشغولة مؤقتاً.')}</p>`));
  }

  // ═══════════ الإدخال ═══════════

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    // Enter يرسل، Shift+Enter سطر جديد
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input.value);
    }
  });
  sendBtn.addEventListener('click', () => submit(input.value));
  within(starters, '.starter').forEach((b) => {
    b.addEventListener('click', () => submit(b.dataset.s));
  });

  document.addEventListener('DOMContentLoaded', initGate);
})();
