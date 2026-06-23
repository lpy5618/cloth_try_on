export const runtime = "nodejs";
export const maxDuration = 60;

const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-image";
const OPENAI_DEFAULT_MODEL = "gpt-5.2";

export async function POST(request) {
  try {
    const payload = await request.json();
    const provider = payload.provider === "openai" ? "openai" : "gemini";
    const modelImage = normalizeDataImage(payload.modelImage, "modelImage");
    const items = validateItems(payload.items || []);
    const prompt = buildTryOnPrompt(payload, items);

    const result = provider === "openai"
      ? await generateWithOpenAI({ prompt, modelImage, items })
      : await generateWithGemini({ prompt, modelImage, items });

    return Response.json(result);
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error.message || "Image generation failed" },
      { status: error.status || 500 }
    );
  }
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw httpError(400, "At least one wardrobe item is required.");
  }

  return items.slice(0, 8).map((item, index) => {
    const generationMode = item.generationMode === "text" ? "text" : "image";
    const normalized = {
      id: item.id || `item-${index + 1}`,
      name: String(item.name || `Item ${index + 1}`),
      category: String(item.category || "unknown"),
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      generationMode
    };

    if (generationMode === "image") {
      normalized.image = normalizeDataImage(item.image, `items[${index}].image`);
    }

    return normalized;
  });
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

function buildTryOnPrompt(payload, items) {
  return String(payload.prompt || [
    "IMAGE ROLES:",
    "- Image 1 is the IDENTITY REFERENCE. Preserve this person's exact face, skin tone, hair, and body type.",
    "- Images 2+ are CLOTHING REFERENCES. Use them only as garments.",
    "",
    "Generate a single photorealistic full-body photo of the exact person from Image 1 wearing the clothing items from Images 2+.",
    "Priority order: face identity, clothing accuracy, natural fabric integration, photo quality.",
    "Do not use a different person. Do not change face, ethnicity, age, or body proportions."
  ].join("\n")).trim();
}

async function generateWithGemini({ prompt, modelImage, items }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw httpError(500, "Missing GEMINI_API_KEY in .env.local.");
  }

  const model = process.env.GEMINI_IMAGE_MODEL || GEMINI_DEFAULT_MODEL;
  const parts = [
    { text: "IDENTITY REFERENCE PHOTO (Image 1): Preserve this person's exact face, skin tone, hair, and body type. This is the person who must appear in the output." },
    { inline_data: { mime_type: modelImage.mimeType, data: modelImage.base64 } },
    ...items.filter((item) => item.image).flatMap((item, index) => ([
      { text: `CLOTHING REFERENCE PHOTO (Image ${index + 2}): Use this garment as clothing only. Item name: ${item.name}. Category: ${item.category}.` },
      { inline_data: { mime_type: item.image.mimeType, data: item.image.base64 } }
    ])),
    { text: prompt }
  ];

  const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, friendlyGeminiError(data.error?.message));
  }

  const outputPart = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData || part.inline_data);
  const inlineData = outputPart?.inlineData || outputPart?.inline_data;
  if (!inlineData?.data) {
    throw httpError(502, "Gemini response did not include an image.");
  }

  const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
  return {
    imageUrl: `data:${mimeType};base64,${inlineData.data}`,
    notes: `Generated with Gemini ${model}.`,
    debug: {
      provider: "gemini",
      model,
      finalPrompt: prompt,
      imageReferenceCount: 1 + items.filter((item) => item.image).length,
      inputStructure: "Image 1 is labeled as identity reference. Images 2+ are labeled as clothing references. Main prompt is sent after all image references.",
      itemInputs: items.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        tags: item.tags,
        generationMode: item.generationMode
      }))
    }
  };
}

async function generateWithOpenAI({ prompt, modelImage, items }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw httpError(500, "Missing OPENAI_API_KEY in .env.local.");
  }

  const model = process.env.OPENAI_IMAGE_MODEL || OPENAI_DEFAULT_MODEL;
  const content = [
    { type: "input_text", text: "IDENTITY REFERENCE PHOTO (Image 1): Preserve this person's exact face, skin tone, hair, and body type. This is the person who must appear in the output." },
    { type: "input_image", image_url: modelImage.dataUrl },
    ...items.filter((item) => item.image).flatMap((item, index) => ([
      { type: "input_text", text: `CLOTHING REFERENCE PHOTO (Image ${index + 2}): Use this garment as clothing only. Item name: ${item.name}. Category: ${item.category}.` },
      { type: "input_image", image_url: item.image.dataUrl }
    ])),
    { type: "input_text", text: prompt }
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }],
      tools: [{ type: "image_generation", action: "edit", input_fidelity: "high" }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, data.error?.message || "OpenAI image generation failed.");
  }

  const output = data.output?.find((entry) => entry.type === "image_generation_call" && entry.result);
  if (!output?.result) {
    throw httpError(502, "OpenAI response did not include an image.");
  }

  return {
    imageUrl: `data:image/png;base64,${output.result}`,
    notes: `Generated with OpenAI ${model}.`,
    debug: {
      provider: "openai",
      model,
      finalPrompt: prompt,
      imageReferenceCount: 1 + items.filter((item) => item.image).length,
      inputStructure: "Image 1 is labeled as identity reference. Images 2+ are labeled as clothing references. Main prompt is sent after all image references.",
      itemInputs: items.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        tags: item.tags,
        generationMode: item.generationMode
      }))
    }
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function friendlyGeminiError(message = "Gemini image generation failed.") {
  if (/quota|rate-limit|rate limit/i.test(message)) {
    return [
      "Gemini image generation quota exceeded for the current project/model.",
      "This is an account or billing quota issue, not a prompt/request-format bug.",
      "For image generation, use an image-capable model such as gemini-2.5-flash-image or gemini-3-pro-image-preview if your Google AI project has access.",
      "Do not switch to gemini-3.5-flash; it is not a valid/current Gemini image-generation model name.",
      "You can also switch the app provider to OpenAI if OPENAI_API_KEY is configured."
    ].join(" ");
  }

  return message;
}
