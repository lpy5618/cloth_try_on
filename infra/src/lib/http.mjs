export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "http://localhost:3000",
      "Vary": "Origin"
    },
    body: JSON.stringify(body)
  };
}

export function errorResponse(error) {
  console.error(error);
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  return json(statusCode, { error: error.message || "Internal server error" });
}

export function parseJson(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export function requireUserId(event) {
  const claims = event.requestContext?.authorizer?.claims || {};
  const userId = claims.sub;
  if (!userId) throw new HttpError(401, "Authentication is required.");
  return userId;
}

export function requireString(value, name, maxLength = 4000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${name} is required.`);
  }
  return value.trim().slice(0, maxLength);
}

export function routeMethod(event) {
  return event.httpMethod?.toUpperCase() || "GET";
}
