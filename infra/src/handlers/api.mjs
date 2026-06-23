import * as analyzeItem from "./analyze-item.mjs";
import * as createGeneration from "./create-generation.mjs";
import * as generationStatus from "./generation-status.mjs";
import * as presignAsset from "./presign-asset.mjs";
import * as recommendOutfit from "./recommend-outfit.mjs";
import * as state from "./state.mjs";
import { errorResponse, HttpError } from "../lib/http.mjs";

const ROUTES = new Map([
  ["POST /v1/assets/presign", presignAsset.handler],
  ["GET /v1/assets/download", presignAsset.handler],
  ["GET /v1/state", state.handler],
  ["POST /v1/analyze-item", analyzeItem.handler],
  ["POST /v1/recommend-outfit", recommendOutfit.handler],
  ["POST /v1/generations", createGeneration.handler],
  ["GET /v1/generations/{id}", generationStatus.handler]
]);

export async function handler(event, context) {
  const method = event.httpMethod?.toUpperCase() || "GET";
  const resource = event.resource || event.requestContext?.resourcePath || event.path;
  const routeHandler = ROUTES.get(`${method} ${resource}`)
    || (resource === "/v1/{collection}" || resource === "/v1/{collection}/{id}" ? state.handler : null);

  if (!routeHandler) {
    return errorResponse(new HttpError(404, "Route not found."));
  }

  return routeHandler(event, context);
}
