import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { HttpError } from "./http.mjs";

const client = new SSMClient({});
const parameterCache = new Map();
let aiConfigPromise;

async function getParameterValue(parameterName) {
  if (!parameterName) throw new HttpError(500, "Required SSM parameter name is not configured.");
  if (parameterCache.has(parameterName)) return parameterCache.get(parameterName);

  const response = await client.send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }));
  const value = response.Parameter?.Value;
  if (!value) throw new HttpError(500, `SSM parameter ${parameterName} is empty.`);
  parameterCache.set(parameterName, value);
  return value;
}

export async function getMongoUri() {
  return getParameterValue(process.env.MONGODB_PARAMETER_NAME);
}

export function getAiConfig() {
  if (!aiConfigPromise) {
    aiConfigPromise = getParameterValue(process.env.AI_PROVIDER_PARAMETER_NAME).then((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        throw new HttpError(500, "AI provider SSM parameter must contain JSON.");
      }
    });
  }
  return aiConfigPromise;
}

export function getAiApiKey(config, provider) {
  const key = provider === "openai" ? config.OPENAI_API_KEY : config.GEMINI_API_KEY;
  if (!key) throw new HttpError(500, `Missing ${provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"} in AI configuration.`);
  return key;
}
