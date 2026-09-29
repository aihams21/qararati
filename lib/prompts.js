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
