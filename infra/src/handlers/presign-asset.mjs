import { assertOwnedAssetKey, downloadUrl, extensionForContentType, uploadUrl } from "../lib/assets.mjs";
import { errorResponse, HttpError, json, parseJson, requireString, requireUserId, routeMethod } from "../lib/http.mjs";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function handler(event) {
  try {
    const userId = requireUserId(event);
    if (routeMethod(event) === "GET") {
      const key = assertOwnedAssetKey(userId, event.queryStringParameters?.key || "");
      return json(200, { assetKey: key, downloadUrl: await downloadUrl(key) });
    }

    const body = parseJson(event);
    const contentType = requireString(body.contentType, "contentType", 80).toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new HttpError(400, "Only JPEG, PNG, and WebP uploads are supported.");

    const kind = String(body.kind || "asset").replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "asset";
    const key = `users/${userId}/assets/${kind}/${crypto.randomUUID()}.${extensionForContentType(contentType)}`;
    return json(200, {
      assetKey: key,
      uploadUrl: await uploadUrl(key, contentType),
      headers: { "Content-Type": contentType },
      expiresIn: 300
    });
  } catch (error) {
    return errorResponse(error);
  }
}
