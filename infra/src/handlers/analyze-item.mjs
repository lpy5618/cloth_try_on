import { assertOwnedAssetKey, getAsset } from "../lib/assets.mjs";
import { analyzeImage, parseModelJson } from "../lib/ai.mjs";
import { errorResponse, json, parseJson, requireUserId } from "../lib/http.mjs";

const CATEGORIES = new Set(["top", "bottom", "outerwear", "shoes", "accessory"]);

export async function handler(event) {
  try {
    const userId = requireUserId(event);
    const body = parseJson(event);
    const assetKey = assertOwnedAssetKey(userId, body.assetKey || "");
    const image = await getAsset(assetKey);
    const prompt = [
      "Analyze this wardrobe item photo.",
      "Return only compact JSON. No markdown.",
      "Schema: {\"name\":\"short human-readable item name\",\"category\":\"top|bottom|outerwear|shoes|accessory\",\"tags\":[\"color\",\"material\",\"style\",\"season\",\"formality\"]}",
      "Use English tags so they are easy to search and store."
    ].join("\n");
    const raw = await analyzeImage(body.provider === "openai" ? "openai" : "gemini", { prompt, asset: image });
    const parsed = parseModelJson(raw, "AI response was not valid item JSON.");
    return json(200, {
      name: String(parsed.name || "Untitled item").trim().slice(0, 80),
      category: CATEGORIES.has(parsed.category) ? parsed.category : "top",
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean).slice(0, 8) : []
    });
  } catch (error) {
    return errorResponse(error);
  }
}
