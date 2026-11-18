require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { sql, initializeDatabase } = require("./neon-db");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ACCESS_CODE = process.env.SCHOOL_ACCESS_CODE || "CHANGE-THIS-CODE";


app.use(express.json({ limit: "7mb" }));


app.use(express.static(path.join(__dirname, "public")));

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const SYSTEM_PROMPT = `
أنت مساعد تعليمي لطلاب المرحلة الثانوية متخصص حصراً في الثقافة المالية.
أجب بالعربية المبسطة وبأسلوب آمن ومتوازن.
اشرح المفاهيم مثل الادخار والميزانية والبنوك والاستثمار ومخاطر الاحتيال.
لا تقدم توصيات استثمارية شخصية أو وعوداً بالربح.
إذا كان السؤال خارج الثقافة المالية، اعتذر ووجّه الطالب لموضوعات الثقافة المالية.
`;

function normalizeQuestion(value) {
  return value
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[؟?.,،!؛:()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function builtInAnswer(question) {
  const q = normalizeQuestion(question);

  const topics = [
    {
      keys: ["ادخار", "اوفر", "توفير"],
      answer: "الادخار هو الاحتفاظ بجزء من المال لاستخدامه في المستقبل بدلاً من إنفاقه كله الآن. ابدأ بتحديد هدف، ثم خصص مبلغاً ثابتاً من مصروفك بانتظام."
    },
    {
      keys: ["ميزانيه", "الميزانيه", "مصروف"],
      answer: "الميزانية خطة بسيطة لتنظيم دخلك ومصروفاتك. اكتب المبلغ المتاح، وحدد احتياجاتك أولاً، ثم خصص جزءاً للادخار، وراجع إنفاقك باستمرار."
    },
    {
      keys: ["استثمار", "استثمر"],
      answer: "الاستثمار هو توظيف المال بهدف تنميته مع مرور الوقت، لكنه يتضمن مخاطر وقد تخسر جزءاً من المال. تعلّم جيداً، ولا تستثمر مالاً تحتاج إليه قريباً، واستشر شخصاً مؤهلاً."
    },
    {
      keys: ["بنك", "بنوك", "حساب بنكي"],
      answer: "البنك مؤسسة مالية تقدم خدمات مثل حفظ الأموال، والحسابات، والتحويلات، والتمويل. قارن الرسوم والشروط، ولا تشارك الرقم السري أو رمز التحقق مع أي شخص."
    },
    {
      keys: ["احتيال", "نصب", "سرقه", "تصيد"],
      answer: "لحماية أموالك: لا تشارك كلمة المرور أو رمز OTP، ولا تضغط على روابط مجهولة، وتحقق من عنوان الموقع والجهة المرسلة. إذا شككت في عملية، تواصل مع البنك من قنواته الرسمية."
    }
  ];

  const found = topics.find(t => t.keys.some(k => q.includes(k)));

  if (found) return found.answer;

  return "سؤال مهم في الثقافة المالية! تذكّر أن القرار المالي الجيد يبدأ بفهم احتياجاتك ومقارنة الخيارات ومعرفة المخاطر. يمكنك إعادة صياغة السؤال أو إضافة تفاصيل لأساعدك بشكل أدق.";
}

async function findSimilar(question) {
  const normalized = normalizeQuestion(question);
  const rows = await sql`SELECT * FROM answer_cache WHERE normalized_question = ${normalized} LIMIT 1`;
  return rows[0] || null;
}
// تسجيل دخول الطلاب
app.post("/api/login", (req, res) => {
  const code = String(req.body?.code || "");

  if (code && code === ACCESS_CODE && ACCESS_CODE !== "CHANGE-THIS-CODE") {
    return res.json({ ok: true });
  }

  if (code === ACCESS_CODE && ACCESS_CODE === "CHANGE-THIS-CODE") {
    return res.status(503).json({
      error: "غيّر كود الدخول الافتراضي في ملف .env أولاً."
    });
  }

  return res.status(401).json({
    error: "كود الدخول غير صحيح."
  });
});

// المساعد الذكي باستخدام Gemini
app.post("/api/ask", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  const code = String(req.body?.code || "");

  if (!code || code !== ACCESS_CODE || ACCESS_CODE === "CHANGE-THIS-CODE") {
    return res.status(401).json({
      error: "يجب تسجيل الدخول بكود المدرسة الصحيح."
    });
  }

  if (question.length < 3 || question.length > 700) {
    return res.status(400).json({
      error: "اكتب سؤالاً من 3 إلى 700 حرف."
    });
  }

  const cached = await findSimilar(question);

  if (cached) {
    await sql`UPDATE answer_cache SET hits = hits + 1 WHERE id = ${cached.id}`;

    return res.json({
      answer: cached.answer,
      source: "cache"
    });
  }

  if (!gemini) {
    return res.status(503).json({
      error: "خدمة الذكاء الاصطناعي غير متاحة حالياً."
    });
  }

  try {
    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: question,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        maxOutputTokens: 700
      }
    });

    const answer = response.text?.trim();

    if (!answer) {
      return res.status(502).json({
        error: "لم يتمكن الذكاء الاصطناعي من إنشاء إجابة."
      });
    }

    await sql`INSERT INTO answer_cache (normalized_question, original_question, answer) VALUES (${normalizeQuestion(question)}, ${question}, ${answer}) ON CONFLICT (normalized_question) DO NOTHING`;

    return res.json({
      answer,
      source: "ai"
    });

  } catch (err) {
    console.error("Gemini request failed:", err.message);

    return res.status(502).json({
      error: "حدث خطأ أثناء معالجة السؤال. حاول مرة أخرى."
    });
  }
});

//

/* حل الأسئلة من الصور */
app.post("/api/ask-image", async (req, res) => {
  const code = String(req.body?.code || "");
  const imageData = String(req.body?.imageData || "");
  const mimeType = String(req.body?.mimeType || "").toLowerCase();

  if (!code || code !== ACCESS_CODE || ACCESS_CODE === "CHANGE-THIS-CODE") {
    return res.status(401).json({
      error: "يجب تسجيل الدخول بكود المدرسة الصحيح."
    });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedTypes.includes(mimeType)) {
    return res.status(400).json({
      error: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP."
    });
  }

  if (!imageData || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
    return res.status(400).json({
      error: "بيانات الصورة غير صحيحة."
    });
  }

  if (imageData.length > 7 * 1024 * 1024) {
    return res.status(413).json({
      error: "حجم الصورة كبير. الحد الأقصى 5 ميجابايت."
    });
  }

  const imageBuffer = Buffer.from(imageData, "base64");

  if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) {
    return res.status(413).json({
      error: "حجم الصورة غير مقبول. الحد الأقصى 5 ميجابايت."
    });
  }

  // التأكد من أن محتوى الملف يطابق نوع الصورة
  const isJpeg =
    imageBuffer.length >= 3 &&
    imageBuffer[0] === 0xff &&
    imageBuffer[1] === 0xd8 &&
    imageBuffer[2] === 0xff;

  const isPng =
    imageBuffer.length >= 8 &&
    imageBuffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );

  const isWebp =
    imageBuffer.length >= 12 &&
    imageBuffer.toString("ascii", 0, 4) === "RIFF" &&
    imageBuffer.toString("ascii", 8, 12) === "WEBP";

  if (
    (mimeType === "image/jpeg" && !isJpeg) ||
    (mimeType === "image/png" && !isPng) ||
    (mimeType === "image/webp" && !isWebp)
  ) {
    return res.status(400).json({
      error: "محتوى الملف لا يطابق نوع الصورة."
    });
  }

  const imageHash = crypto
    .createHash("sha256")
    .update(imageBuffer)
    .digest("hex");

  const imageRows = await sql`SELECT * FROM image_cache WHERE image_hash = ${imageHash} LIMIT 1`;
  const cachedImage = imageRows[0] || null;

  if (cachedImage) {
    await sql`UPDATE image_cache SET hits = hits + 1 WHERE id = ${cachedImage.id}`;

    return res.json({
      answer: cachedImage.answer,
      extractedQuestion: cachedImage.extracted_question,
      source: "image-cache"
    });
  }

  if (!gemini) {
    return res.status(503).json({
      error: "خدمة الذكاء الاصطناعي غير متاحة حالياً."
    });
  }

  try {
    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
      contents: [{
        role: "user",
        parts: [
          {
            text: `
أنت مساعد HEX LEARN التعليمي لطلاب المرحلة الثانوية.
اقرأ السؤال الموجود في الصورة بدقة، ثم أجب عنه بالعربية المبسطة.

التزم بالثقافة المالية فقط، مثل الادخار والميزانية والبنوك
والتضخم والاستثمار ومخاطر الاحتيال.

إذا كان السؤال خارج الثقافة المالية، اكتب فقط:
خارج نطاق الثقافة المالية.

إذا كانت الصورة غير واضحة أو السؤال غير مقروء، اكتب فقط:
الصورة غير واضحة، من فضلك ارفع صورة أوضح.

إذا كان السؤال مناسباً، اجعل أول سطر بهذا الشكل:
السؤال: [نص السؤال المستخرج]

ثم اكتب في السطور التالية:
الحل والشرح:
[الحل مع شرح تعليمي مبسط وخطوات الحل عند الحاجة]

لا تخترع نصاً غير ظاهر في الصورة، ولا تقدم وعوداً بالربح
أو توصيات استثمارية شخصية.
            `
          },
          {
            inlineData: {
              mimeType,
              data: imageBuffer.toString("base64")
            }
          }
        ]
      }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        maxOutputTokens: 1200
      }
    });

    const answer = response.text?.trim();

    if (!answer) {
      return res.status(502).json({
        error: "لم يتمكن الذكاء الاصطناعي من قراءة الصورة."
      });
    }

    if (
      answer.startsWith("خارج نطاق الثقافة المالية") ||
      answer.startsWith("الصورة غير واضحة")
    ) {
      return res.json({
        answer,
        source: "ai"
      });
    }

    const questionMatch = answer.match(/^السؤال:\s*(.+)$/m);
    const extractedQuestion = questionMatch
      ? questionMatch[1].trim()
      : "";

    // حفظ الصورة والحل حتى يستفيد الطلاب من الصورة نفسها لاحقاً
    await sql`INSERT INTO image_cache (image_hash, extracted_question, answer) VALUES (${imageHash}, ${extractedQuestion}, ${answer}) ON CONFLICT (image_hash) DO NOTHING`;

    // حفظ السؤال المستخرج أيضاً ليستفيد منه من يكتبه نصياً
    if (extractedQuestion.length >= 3 && extractedQuestion.length <= 700) {
      await sql`INSERT INTO answer_cache (normalized_question, original_question, answer) VALUES (${normalizeQuestion(extractedQuestion)}, ${extractedQuestion}, ${answer}) ON CONFLICT (normalized_question) DO NOTHING`;
    }

    return res.json({
      answer,
      extractedQuestion,
      source: "ai"
    });

  } catch (err) {
    console.error("Gemini image request failed:", err.message);
    return res.status(502).json({
      error: "حدث خطأ أثناء تحليل الصورة. حاول مرة أخرى."
    });
  }
});

// فحص حالة الموقع
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "HEX LEARN",
    ai: gemini ? "Gemini" : "Built-in"
  });
});

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`HEX LEARN is running at http://localhost:${PORT}`);
    console.log(`AI Provider: ${gemini ? "Gemini" : "Built-in"}`);
  });
}).catch(err => {
  console.error("Neon initialization failed:", err.message);
  process.exit(1);
});
