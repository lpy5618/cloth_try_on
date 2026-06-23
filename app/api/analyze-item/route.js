export const runtime = "nodejs";
export const maxDuration = 45;

const GEMINI_VISION_MODEL = "gemini-2.5-flash";
const OPENAI_VISION_MODEL = "gpt-5-mini";

const CATEGORY_VALUES = new Set(["top", "bottom", "outerwear", "shoes", "accessory"]);

export async function POST(request) {
  try {
    const payload = await request.json();
    const provider = payload.provider === "openai" ? "openai" : "gemini";
    const image = normalizeDataImage(payload.image, "image");

    const result = provider === "openai"
      ? await analyzeWithOpenAI(image)
      : await analyzeWithGemini(image);

    return Response.json(normalizeResult(result));
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error.message || "Item analysis failed" },
      { status: error.status || 500 }
    );
  }
}

async function analyzeWithGemini(image) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw httpError(500, "Missing GEMINI_API_KEY in .env.local.");

  const model = process.env.GEMINI_VISION_MODEL || GEMINI_VISION_MODEL;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: analysisPrompt() },
          { inline_data: { mime_type: image.mimeType, data: image.base64 } }
        ]
      }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, data.error?.message || "Gemini item analysis failed.");
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n");
  return parseJsonText(text);
}

async function analyzeWithOpenAI(image) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw httpError(500, "Missing OPENAI_API_KEY in .env.local.");

  const model = process.env.OPENAI_VISION_MODEL || OPENAI_VISION_MODEL;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: analysisPrompt() },
          { type: "input_image", image_url: image.dataUrl, detail: "low" }
        ]
      }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, data.error?.message || "OpenAI item analysis failed.");
  }

  return parseJsonText(data.output_text || collectOpenAIText(data));
}

function analysisPrompt() {
  return [
    "Analyze this wardrobe item photo.",
    "Return only compact JSON. No markdown.",
    "Schema:",
    "{",
    "  \"name\": \"short human-readable item name\",",
    "  \"category\": \"top|bottom|outerwear|shoes|accessory\",",
    "  \"tags\": [\"color\", \"material\", \"style\", \"season\", \"formality\"]",
    "}",
    "Use English tags so they are easy to search and store."
  ].join("\n");
}

function normalizeDataImage(value, fieldName) {
  if (typeof value !== "string" || !value.startsWith("data:image/")) {
    throw httpError(400, `${fieldName} must be a data:image URL.`);
  }

  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw httpError(400, `${fieldName} must be base64 encoded.`);
  }

  return {
    dataUrl: value,
    mimeType: match[1],
    base64: match[2]
  };
}

function parseJsonText(text = "") {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    throw httpError(502, "AI response was not valid item JSON.");
  }
}

function normalizeResult(result) {
  const category = CATEGORY_VALUES.has(result.category) ? result.category : "top";
  const tags = Array.isArray(result.tags)
    ? result.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 8)
    : [];

  return {
    name: String(result.name || "Untitled item").trim().slice(0, 80),
    category,
    tags
  };
}

function collectOpenAIText(data) {
  return (data.output || [])
    .flatMap((entry) => entry.content || [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n");
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
