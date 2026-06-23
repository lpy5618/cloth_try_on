import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HttpError } from "./http.mjs";

const client = new S3Client({});

export function assetsBucket() {
  const bucket = process.env.ASSETS_BUCKET;
  if (!bucket) throw new HttpError(500, "ASSETS_BUCKET is not configured.");
  return bucket;
}

export function assertOwnedAssetKey(userId, key) {
  if (typeof key !== "string" || !key.startsWith(`users/${userId}/`)) {
    throw new HttpError(403, "Asset does not belong to the authenticated user.");
  }
  return key;
}

export async function uploadUrl(key, contentType) {
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: assetsBucket(), Key: key, ContentType: contentType }),
    { expiresIn: 300 }
  );
}

export async function downloadUrl(key, expiresIn = 300) {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: assetsBucket(), Key: key }), { expiresIn });
}

export async function getAsset(key) {
  const response = await client.send(new GetObjectCommand({ Bucket: assetsBucket(), Key: key }));
  const bytes = await response.Body.transformToByteArray();
  return {
    bytes: Buffer.from(bytes),
    contentType: response.ContentType || "image/jpeg"
  };
}

export async function putAsset(key, bytes, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: assetsBucket(),
    Key: key,
    Body: bytes,
    ContentType: contentType
  }));
}

export function toDataUrl(asset) {
  return `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`;
}

export function extensionForContentType(contentType) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  return extensions[contentType] || "jpg";
}
