import { assertOwnedAssetKey } from "../lib/assets.mjs";
import { errorResponse, HttpError, json, parseJson, requireString, requireUserId } from "../lib/http.mjs";
import { collection } from "../lib/mongo.mjs";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});

export async function handler(event) {
  try {
    const userId = requireUserId(event);
    const body = parseJson(event);
    const request = normalizeRequest(userId, body);
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const jobs = await collection("generations");
    await jobs.insertOne({
      _id: jobId,
      id: jobId,
      userId,
      status: "queued",
      request,
      createdAt: now,
      updatedAt: now
    });

    await lambda.send(new InvokeCommand({
      FunctionName: process.env.GENERATION_WORKER_FUNCTION,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ jobId, userId, request }))
    }));

    return json(202, { jobId, status: "queued" });
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeRequest(userId, body) {
  const modelAssetKey = assertOwnedAssetKey(userId, body.modelAssetKey || "");
  const items = Array.isArray(body.items) ? body.items.slice(0, 8).map((item, index) => ({
    id: requireString(String(item.id || `item-${index + 1}`), "item id", 120),
    name: requireString(String(item.name || `Item ${index + 1}`), "item name", 120),
    category: String(item.category || "unknown").slice(0, 40),
    assetKey: assertOwnedAssetKey(userId, item.assetKey || item.imageAssetKey || "")
  })) : [];
  if (!items.length) throw new HttpError(400, "At least one wardrobe item is required.");
  return {
    provider: body.provider === "openai" ? "openai" : "gemini",
    prompt: requireString(body.prompt, "prompt", 12000),
    occasion: String(body.occasion || "").slice(0, 200),
    modelAssetKey,
    items
  };
}
