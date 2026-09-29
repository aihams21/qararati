/**
 * prompts.js — قلب تطبيق «قراراتي»
 *
 * القاعدة الذهبية: النموذج ينظّم المعلومات فقط. لا يقرّر، لا ينحاز، لا ينصح.
 * كل prompt هنا مكتوب ليكون "محايد" أمام أي مدخل، حتى لو كتبت الخيارات
 * بطريقة متحيّزة عمداً.
 */

/** التعليمات الأساسية — تُضاف لكل طلب */
const NEUTRAL_CORE = `
أنت مساعد في تطبيق اسمه «قراراتي». مهمتك الوحيدة: أن تساعد المستخدم على رؤية الفرق بين الخيارات بوضوح.

قواعد ملزمة — لا تكسرها أبداً:
1. ممنوع منعاً باتاً أن توصي أو تحكم أو تختار. لا تكتب: "أنصحك"، "أفضل خيار"، "الأجدر"، "أنسب"، "لو كنت مكانك"، "اختاري".
2. اذكر إيجابيات وسلبيات لكل خيار بنفس المقدار والطول. إذا تفوّق خيار في نقطة، اذكرها إيجابية له مقابل سلبيات في نقاط أخرى. لا تختلق عيوباً.
3. استخدم لغة محايدة. تجنّب المبالغات. لا تبالغ في الإيجابيات ولا في السلبيات.
4. إذا كانت المعلومات ناقصة، اطرح سؤالاً أو نبّه على نقص — لا تفترض.
5. لا تحكم على الشخص ولا على قراره. تعامل مع الخيارات كمعلومات.
6. أجب بالعربية الفصحى المبسّطة، دائماً.
`.trim();

/** وعود المخرجات (JSON schema) — بتخلّي الرد منظّم 100% */

const SCHEMAS = {
  // اقتراح معايير ناقصة
  criteria: {
    type: 'object',
    properties: {
      criteria: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['criteria'],
  },

  // تحليل الفروق
  analysis: {
    type: 'object',
    properties: {
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            pros: { type: 'array', items: { type: 'string' } },
            cons: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'pros', 'cons'],
        },
      },
      notes: { type: 'string' },
    },
    required: ['options'],
  },

  // سؤال واحد عميق
  question: {
    type: 'object',
    properties: {
      question: { type: 'string' },
    },
    required: ['question'],
  },

  // استخراج من نص حرّ — الخطوة الأولى في الشات
  parse: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['name'],
        },
      },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            weight: { type: 'integer' },
            scores: {
              type: 'array',
              items: { type: 'integer' },
            },
          },
          required: ['name'],
        },
      },
    },
    required: ['title', 'options', 'criteria'],
  },

  // تحليل عميق بعد ما فهمنا القرار
  analyze: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      tradeoffs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            point: { type: 'string' },
            detail: { type: 'string' },
            impacts: { type: 'array', items: { type: 'string' } },
          },
          required: ['point', 'detail'],
        },
      },
      decidingFactor: { type: 'string' },
      decidingWhy: { type: 'string' },
      question: { type: 'string' },
      missing: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'tradeoffs', 'decidingFactor', 'decidingWhy', 'question'],
  },

  // رد على رسالة تالية داخل الشات
  chat: {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      question: { type: 'string' },
      insights: { type: 'array', items: { type: 'string' } },
    },
    required: ['reply'],
  },

  // كشف عدم التوازن
  balance: {
    type: 'object',
    properties: {
      balanced: { type: 'boolean' },
      findings: { type: 'array', items: { type: 'string' } },
    },
    required: ['balanced', 'findings'],
  },
};

const TASKS = {
  // ═══ الشات التفاعلي ═══

  // ١) المستخدم كتب كل شي بحرية، إحنا نستخرج_opts و المعايير و الأوزان
  parse: {
    instruction: `
اقرأ ما كتبه المستخدم وفكّله إلى خيارات ومعايير.

الخيارات: كل خيار ممكن يختاره المستخدم. اكتب اسمه كما يفهمه المستخدم
(مثل "الشركة الأولى" أو "وظيفة الكورنيش" أو "الصحراء").
ملاحظات كل خيار: انسخ من كلام المستخدم نفسِه ما قاله عنه — لا تضف تخمين.

المعايير: المعايير الضمنية التي استنتجها من كلامه. لكل معيار وزن من ١ إلى ١٠
يعبّر عن أهمية المعيار عنده.
- إذا ذكر معياراً بوضوح وكرّره، أعطه وزناً عالياً (٧-١٠).
- إذا ذكره مرة عابرة، أعطه وزناً منخفضاً (١-٤).
- استخرج حتى المعايير التي لم يذكرها صراحة بل تلمّح إليها.

الدرجات (scores): لكل معيار، قيّم كل خيار من ٠ إلى ١٠ بناءً على ما كتبه
المستخدم فقط. إن لم يذكر شيئاً عن هذا المعيار لأي خيار، اترك المصفوفة فارغة [].

title: عنوان قصير للقرار من كلمة إلى ثلاث كلمات.
إن كان كلام المستخدم لا يمثّل قراراً بين خيارين، اكتب options بـ خيار واحد
فقط ولا تخترع معايير.
`.trim(),
    schema: SCHEMAS.parse,
  },

  // ٢) التحليل: نقاط الحسم والمقايضات
  analyze: {
    instruction: `
حلّل القرار. لا ترشّح أي خيار ولا تحكم عليه.

summary: جملة واحدة تصف القرار كما فهمته، بدون حكم.

tradeoffs: المقايضات الحقيقية — المادة التي يخسرها مقابل ما يكسبه.
- من ٣ إلى ٥ نقاط.
- point: اسم المقايضة في كلمتين أو ثلاث (مثل «الراتب مقابل الوقت»).
- detail: شرح واضح لكيفية ظهور هذه المقايضة في كلام المستخدم.
- impacts: أسماء الخيارات التي تتأثر بهذه النقطة.

decidingFactor: المعيار الواحد الذي تتوقف عليه نتيجة القرار. لو ما وُجد
معيار واحد حاسم، اذكر المعيارين اللذين يتنافسان.
decidingWhy: لماذا هذا المعيار هو الحاسم، بلغة وصفية. ممنوع أن تقول أي
خيار أفضل.

question: سؤال واحد عميق يساعد المستخدم على حسم مشاعره. يجب أن يكون
مفتوحاً بلا جواب "صحيح"، ويكشف عن معلومة يعرفها هو ولا يعرفها بعد.

missing: معلومات ناقصة لو عُرفت كان القرار أسهل (سؤال واحد أو اثنان).
`.trim(),
    schema: SCHEMAS.analyze,
  },

  // ٣) أي رسالة تالية داخل الشات
  chat: {
    instruction: `
المستخدم يكتب رسالة جديدة في سياق قرار قائم. ردّ عليه من حيث هو.
- reply: رد مباشر على ما قاله، من جملة إلى ثلاث. لا تعِد التحليل كاملاً.
- insights: إذا أضاف معلومة جديدة، استخرج منها ملاحظتين أو ثلاثاً وصفية.
- question: سؤال واحد يعمّق الفهم، أو نص فارغ إذا ما في داعي تسأل.
`.trim(),
    schema: SCHEMAS.chat,
  },

  criteria: {
    instruction: `
المستخدم يريد قراراً ولم يذكر كل المعايير المهمة.
اقترح معايير قد تكون ناقصة. القاعدة:
- ابدأ بما هو مخصص لهذا القرار تحديداً، لا بقوائم عامة.
- لا تكرر المعايير التي كتبها المستخدم.
- رتّبها من الأكثر تأثيراً للأقل.
- من 4 إلى 6 معايير. اكتبها كعبارات قصيرة (كلمة إلى ثلاث كلمات).
`.trim(),
    schema: SCHEMAS.criteria,
  },

  analysis: {
    instruction: `
حلّل كل خيار. لكل خيار:
- 3 إيجابيات و3 سلبيات بالضبط. نفس العدد لكل خيار.
- الإيجابيات والسلبيات مبنية على المعلومات التي كتبها المستخدم، لا على تخمين.
- إذا لم يذكر المستخدم معارضة حقيقية، اكتب ملاحظة محايدة مثل "لم تُذكر سلبيات واضحة".
- "notes": فقرة قصيرة تشرح أين الفرق الحقيقي بين الخيارين، بلغة وصفية لا حكمية.
`.trim(),
    schema: SCHEMAS.analysis,
  },

  question: {
    instruction: `
اطرح سؤالاً واحداً فقط يساعد المستخدم على الوضوح.
- سؤال عميق يفتح زاوية لم يفكر فيها.
- ليس له جواب "صحيح" ولا ترجّح خياراً.
- أمثلة على النوع المطلوب: "على بعد سنة، أي خيار ستشتاق له أكثر؟" أو "ما الذي تخسره فعلياً لو اخترت الثاني؟"
`.trim(),
    schema: SCHEMAS.question,
  },

  balance: {
    instruction: `
راجع هل تحلّل المستخدم الخيارات بتوازن.
- إذا كتب تفاصيل كثيرة لخيار وقليلة للآخر، هذا خلل. وضّحه بلطف.
- إذا كان التحليل متوازناً، أعد balanced=true.
- "findings": ملاحظات وقائعية فقط. لا تقل "يجب أن" أو "ينبغي".
`.trim(),
    schema: SCHEMAS.balance,
  },
};

function buildPrompt(taskKey, payload) {
  const task = TASKS[taskKey];
  if (!task) throw new Error(`Unknown task: ${taskKey}`);

  return {
    // systemInstruction لازم يكون Content object، مش نص عادي
    systemInstruction: {
      role: 'system',
      parts: [{ text: NEUTRAL_CORE }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${task.instruction}\n\n---\nالبيانات:\n${JSON.stringify(payload, null, 2)}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: task.schema,
    },
  };
}

module.exports = { buildPrompt, TASKS, SCHEMAS, NEUTRAL_CORE };
