import { HttpError } from "./http.mjs";
import { getAiApiKey, getAiConfig } from "./config.mjs";

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-5.2";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5-mini";

async function aiSecrets() {
  return getAiConfig();
}

export async function generateText(provider, prompt) {
  return provider === "openai" ? generateOpenAiText(prompt) : generateGeminiText(prompt);
}

export async function analyzeImage(provider, { prompt, asset }) {
  return provider === "openai"
    ? analyzeOpenAiImage({ prompt, asset })
    : analyzeGeminiImage({ prompt, asset });
}

export async function generateImage(provider, { prompt, modelAsset, itemAssets }) {
  return provider === "openai"
    ? generateOpenAiImage({ prompt, modelAsset, itemAssets })
    : generateGeminiImage({ prompt, modelAsset, itemAssets });
}

async function generateGeminiText(prompt) {
  const key = getAiApiKey(await aiSecrets(), "gemini");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${GEMINI_TEXT_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, data.error?.message || "Gemini text generation failed.");
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n") || "";
}

async function generateOpenAiText(prompt) {
  const key = getAiApiKey(await aiSecrets(), "openai");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, data.error?.message || "OpenAI text generation failed.");
  return data.output_text || collectOpenAiText(data);
}

async function analyzeGeminiImage({ prompt, asset }) {
  const key = getAiApiKey(await aiSecrets(), "gemini");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${GEMINI_TEXT_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [
        { text: prompt },
        { inline_data: { mime_type: asset.contentType, data: asset.bytes.toString("base64") } }
      ] }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, data.error?.message || "Gemini image analysis failed.");
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join("\n") || "";
}

async function analyzeOpenAiImage({ prompt, asset }) {
  const key = getAiApiKey(await aiSecrets(), "openai");
  const imageUrl = `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      input: [{ role: "user", content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: imageUrl, detail: "low" }
      ] }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, data.error?.message || "OpenAI image analysis failed.");
  return data.output_text || collectOpenAiText(data);
}

async function generateGeminiImage({ prompt, modelAsset, itemAssets }) {
  const key = getAiApiKey(await aiSecrets(), "gemini");
  const parts = [
    { text: "IDENTITY REFERENCE PHOTO (Image 1): Preserve this person's exact face, skin tone, hair, and body type. This is the person who must appear in the output." },
    { inline_data: { mime_type: modelAsset.contentType, data: modelAsset.bytes.toString("base64") } },
    ...itemAssets.flatMap((item, index) => [
      { text: `CLOTHING REFERENCE PHOTO (Image ${index + 2}): Use this garment as clothing only. Item name: ${item.name}. Category: ${item.category}.` },
      { inline_data: { mime_type: item.asset.contentType, data: item.asset.bytes.toString("base64") } }
    ]),
    { text: prompt }
  ];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, data.error?.message || "Gemini image generation failed.");
  const outputPart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData || part.inline_data);
  const inlineData = outputPart?.inlineData || outputPart?.inline_data;
  if (!inlineData?.data) throw new HttpError(502, "Gemini response did not include an image.");
  return {
    bytes: Buffer.from(inlineData.data, "base64"),
    contentType: inlineData.mimeType || inlineData.mime_type || "image/png",
    model: GEMINI_IMAGE_MODEL
  };
}

async function generateOpenAiImage({ prompt, modelAsset, itemAssets }) {
  const key = getAiApiKey(await aiSecrets(), "openai");
  const dataUrl = (asset) => `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`;
  const content = [
    { type: "input_text", text: "IDENTITY REFERENCE PHOTO (Image 1): Preserve this person's exact face, skin tone, hair, and body type. This is the person who must appear in the output." },
    { type: "input_image", image_url: dataUrl(modelAsset) },
    ...itemAssets.flatMap((item, index) => [
      { type: "input_text", text: `CLOTHING REFERENCE PHOTO (Image ${index + 2}): Use this garment as clothing only. Item name: ${item.name}. Category: ${item.category}.` },
      { type: "input_image", image_url: dataUrl(item.asset) }
    ]),
    { type: "input_text", text: prompt }
  ];
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      input: [{ role: "user", content }],
      tools: [{ type: "image_generation", action: "edit", input_fidelity: "high" }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(response.status, data.error?.message || "OpenAI image generation failed.");
  const output = data.output?.find((entry) => entry.type === "image_generation_call" && entry.result);
  if (!output?.result) throw new HttpError(502, "OpenAI response did not include an image.");
  return { bytes: Buffer.from(output.result, "base64"), contentType: "image/png", model: OPENAI_IMAGE_MODEL };
}

export function parseModelJson(text, errorMessage) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || trimmed.match(/\{[\s\S]*\}/)?.[0] || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    throw new HttpError(502, errorMessage);
  }
}

function collectOpenAiText(data) {
  return (data.output || [])
    .flatMap((entry) => entry.content || [])
    .map((content) => content.text)
    .filter(Boolean)
    .join("\n");
}
