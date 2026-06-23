import { assertOwnedAssetKey, downloadUrl } from "../lib/assets.mjs";
import { errorResponse, HttpError, json, requireUserId } from "../lib/http.mjs";
import { collection } from "../lib/mongo.mjs";

export async function handler(event) {
  try {
    const userId = requireUserId(event);
    const id = event.pathParameters?.id;
    if (!id) throw new HttpError(400, "Generation id is required.");
    const job = await (await collection("generations")).findOne(
      { _id: id, userId },
      { projection: { _id: 0, userId: 0 } }
    );
    if (!job) throw new HttpError(404, "Generation not found.");

    const response = { ...job };
    delete response.request;
    if (job.resultAssetKey) {
      assertOwnedAssetKey(userId, job.resultAssetKey);
      response.resultUrl = await downloadUrl(job.resultAssetKey);
    }
    return json(200, response);
  } catch (error) {
    return errorResponse(error);
  }
}
