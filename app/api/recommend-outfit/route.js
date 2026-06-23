export const runtime = "nodejs";
export const maxDuration = 30;

const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const OPENAI_TEXT_MODEL = "gpt-5-mini";

const CATEGORY_VALUES = new Set(["top", "bottom", "outerwear", "shoes", "accessory"]);

export async function POST(request) {
  try {
    const payload = await request.json();
    const provider = payload.provider === "openai" ? "openai" : "gemini";
    const items = normalizeItems(payload.items || []);
    if (!items.length) throw httpError(400, "At least one available wardrobe item is required.");

    const prompt = recommendationPrompt({
      occasion: String(payload.occasion || ""),
      weather: payload.weather || null,
      items
    });
    const result = provider === "openai"
      ? await recommendWithOpenAI(prompt)
      : await recommendWithGemini(prompt);

    return Response.json(normalizeRecommendation(result, items));
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error.message || "Outfit recommendation failed" },
      { status: error.status || 500 }
    );
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: String(item.id || ""),
      name: String(item.name || "Untitled item").slice(0, 100),
      category: CATEGORY_VALUES.has(item.category) ? item.category : "accessory",
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).slice(0, 40)).slice(0, 10) : [],
      quality: String(item.quality || "normal")
    }))
    .filter((item) => item.id && item.quality !== "blocked")
    .slice(0, 120);
}

function recommendationPrompt({ occasion, weather, items }) {
  return [
    "You are a practical wardrobe stylist for a personal virtual try-on app.",
    "Recommend exactly one outfit using only item ids from the provided wardrobe metadata.",
    "Do not invent ids. Prefer one top, one bottom, one pair of shoes, and optionally one outerwear/accessory when suitable.",
    "Avoid items marked retake unless they are clearly the best match.",
    "Return only compact JSON. No markdown.",
    "",
    "Schema:",
    "{",
    "  \"itemIds\": [\"id1\", \"id2\"],",
    "  \"reason\": \"short Chinese explanation\",",
    "  \"styleNotes\": [\"short Chinese note\"]",
    "}",
    "",
    `Occasion: ${occasion || "unspecified"}`,
    `Weather: ${weather ? JSON.stringify(weather) : "unspecified"}`,
    `Wardrobe items: ${JSON.stringify(items)}`
  ].join("\n");
}

async function recommendWithGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw httpError(500, "Missing GEMINI_API_KEY in .env.local.");

  const model = process.env.GEMINI_TEXT_MODEL || GEMINI_TEXT_MODEL;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, data.error?.message || "Gemini recommendation failed.");

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n");
  return parseJsonText(text);
}

async function recommendWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw httpError(500, "Missing OPENAI_API_KEY in .env.local.");

  const model = process.env.OPENAI_TEXT_MODEL || OPENAI_TEXT_MODEL;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw httpError(response.status, data.error?.message || "OpenAI recommendation failed.");
  return parseJsonText(data.output_text || collectOpenAIText(data));
}

function parseJsonText(text = "") {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    throw httpError(502, "AI response was not valid recommendation JSON.");
  }
}

function normalizeRecommendation(result, items) {
  const allowedIds = new Set(items.map((item) => item.id));
  const seen = new Set();
  const itemIds = Array.isArray(result.itemIds)
    ? result.itemIds.map(String).filter((id) => allowedIds.has(id) && !seen.has(id) && seen.add(id)).slice(0, 8)
    : [];

  if (!itemIds.length) throw httpError(502, "AI recommendation did not include usable item ids.");

  return {
    itemIds,
    reason: String(result.reason || "已根据当前场景推荐一套搭配。").slice(0, 300),
    styleNotes: Array.isArray(result.styleNotes) ? result.styleNotes.map(String).slice(0, 5) : []
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
