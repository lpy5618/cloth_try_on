import { generateText, parseModelJson } from "../lib/ai.mjs";
import { errorResponse, HttpError, json, parseJson, requireUserId } from "../lib/http.mjs";

const CATEGORIES = new Set(["top", "bottom", "outerwear", "shoes", "accessory"]);

export async function handler(event) {
  try {
    requireUserId(event);
    const body = parseJson(event);
    const items = normalizeItems(body.items || []);
    if (!items.length) throw new HttpError(400, "At least one available wardrobe item is required.");

    const prompt = [
      "You are a practical wardrobe stylist for a personal virtual try-on app.",
      "Recommend exactly one outfit using only item ids from the provided wardrobe metadata. Do not invent ids.",
      "Prefer one top, one bottom, one pair of shoes, and optionally one outerwear/accessory when suitable.",
      "Avoid items marked retake unless they are clearly the best match.",
      "Return only compact JSON. No markdown.",
      "Schema: {\"itemIds\":[\"id1\"],\"reason\":\"short Chinese explanation\",\"styleNotes\":[\"short Chinese note\"]}",
      `Occasion: ${String(body.occasion || "unspecified")}`,
      `Weather: ${body.weather ? JSON.stringify(body.weather) : "unspecified"}`,
      `Wardrobe items: ${JSON.stringify(items)}`
    ].join("\n");
    const raw = await generateText(body.provider === "openai" ? "openai" : "gemini", prompt);
    const result = parseModelJson(raw, "AI response was not valid recommendation JSON.");
    const allowedIds = new Set(items.map((item) => item.id));
    const seen = new Set();
    const itemIds = Array.isArray(result.itemIds)
      ? result.itemIds.map(String).filter((id) => allowedIds.has(id) && !seen.has(id) && seen.add(id)).slice(0, 8)
      : [];
    if (!itemIds.length) throw new HttpError(502, "AI recommendation did not include usable item ids.");
    return json(200, {
      itemIds,
      reason: String(result.reason || "已根据当前场景推荐一套搭配。").slice(0, 300),
      styleNotes: Array.isArray(result.styleNotes) ? result.styleNotes.map(String).slice(0, 5) : []
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: String(item.id || ""),
      name: String(item.name || "Untitled item").slice(0, 100),
      category: CATEGORIES.has(item.category) ? item.category : "accessory",
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).slice(0, 40)).slice(0, 10) : [],
      quality: String(item.quality || "normal")
    }))
    .filter((item) => item.id && item.quality !== "blocked")
    .slice(0, 120);
}
