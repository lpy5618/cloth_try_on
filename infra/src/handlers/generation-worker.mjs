import { extensionForContentType, getAsset, putAsset } from "../lib/assets.mjs";
import { generateImage } from "../lib/ai.mjs";
import { collection } from "../lib/mongo.mjs";

export async function handler(event) {
  const { jobId, userId, request } = event;
  const jobs = await collection("generations");
  const now = () => new Date().toISOString();

  try {
    await jobs.updateOne({ _id: jobId, userId }, { $set: { status: "processing", updatedAt: now() } });
    const modelAsset = await getAsset(request.modelAssetKey);
    const itemAssets = await Promise.all(request.items.map(async (item) => ({
      ...item,
      asset: await getAsset(item.assetKey)
    })));
    const output = await generateImage(request.provider, {
      prompt: request.prompt,
      modelAsset,
      itemAssets
    });
    const resultAssetKey = `users/${userId}/generations/${jobId}/result.${extensionForContentType(output.contentType)}`;
    await putAsset(resultAssetKey, output.bytes, output.contentType);

    await jobs.updateOne(
      { _id: jobId, userId },
      {
        $set: {
          status: "completed",
          resultAssetKey,
          notes: `Generated with ${request.provider} ${output.model}.`,
          debug: {
            provider: request.provider,
            model: output.model,
            finalPrompt: request.prompt,
            inputStructure: "Identity image followed by labeled clothing references.",
            itemIds: request.items.map((item) => item.id)
          },
          completedAt: now(),
          updatedAt: now()
        }
      }
    );
  } catch (error) {
    console.error("Generation worker failed", error);
    await jobs.updateOne(
      { _id: jobId, userId },
      { $set: { status: "failed", error: error.message || "Generation failed.", updatedAt: now() } }
    );
  }
}
