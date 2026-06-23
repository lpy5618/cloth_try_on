# Frontend Migration Contract

The existing Next.js app remains the local-development fallback until Cognito sign-in and cloud sync are enabled.

## Authentication

Every cloud request requires a Cognito ID token:

```http
Authorization: Bearer <id-token>
```

## Assets

1. `POST /v1/assets/presign` with `{ "contentType": "image/jpeg", "kind": "wardrobe" }`.
2. Upload the browser file directly with the returned presigned `uploadUrl` and `headers`.
3. Store the returned `assetKey` in item metadata.
4. Use `GET /v1/assets/download?key=<assetKey>` for short-lived display URLs.

## Metadata

- `GET /v1/state` returns `items`, `outfits`, `promptTemplates`, and recent `generations` for the signed-in user.
- `GET|POST /v1/items`
- `GET|PUT|DELETE /v1/items/{id}`
- The same CRUD contract exists for `/v1/outfits` and `/v1/prompt-templates`.

Each record is isolated by the Cognito user `sub`. The Lambda handler rejects client-supplied `userId` and `_id` fields.

## AI Calls

- `POST /v1/analyze-item` takes `{ provider, assetKey }`.
- `POST /v1/recommend-outfit` takes the same metadata-only payload currently used by the local recommendation route.
- `POST /v1/generations` takes `{ provider, prompt, occasion, modelAssetKey, items }`, returning `{ jobId, status }` with status `queued`.
- `GET /v1/generations/{jobId}` returns `queued`, `processing`, `completed`, or `failed`. A completed job includes a short-lived `resultUrl`.

The generation request deliberately uses S3 keys rather than base64 images so API Gateway payload limits do not become a production constraint.
