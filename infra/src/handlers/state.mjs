import { collection } from "../lib/mongo.mjs";
import { errorResponse, HttpError, json, parseJson, requireUserId, routeMethod } from "../lib/http.mjs";

const COLLECTIONS = {
  items: "items",
  outfits: "outfits",
  "prompt-templates": "promptTemplates"
};

export async function handler(event) {
  try {
    const userId = requireUserId(event);
    const method = routeMethod(event);
    const routeCollection = event.pathParameters?.collection;

    if (!routeCollection) return bootstrap(userId);
    const collectionName = COLLECTIONS[routeCollection];
    if (!collectionName) throw new HttpError(404, "Unknown collection.");

    const records = await collection(collectionName);
    const id = event.pathParameters?.id;
    if (method === "GET") {
      if (id) {
        const record = await records.findOne({ _id: id, userId }, { projection: { _id: 0, userId: 0 } });
        if (!record) throw new HttpError(404, "Record not found.");
        return json(200, record);
      }
      const values = await records.find({ userId }, { projection: { _id: 0, userId: 0 } }).sort({ updatedAt: -1 }).toArray();
      return json(200, { records: values });
    }

    if (method === "POST") {
      const record = prepareRecord(parseJson(event), id || crypto.randomUUID());
      await records.insertOne({ _id: record.id, userId, ...record });
      return json(201, record);
    }

    if (method === "PUT") {
      if (!id) throw new HttpError(400, "Record id is required.");
      const record = prepareRecord(parseJson(event), id, false);
      const result = await records.findOneAndUpdate(
        { _id: id, userId },
        { $set: { ...record, updatedAt: new Date().toISOString() } },
        { returnDocument: "after", projection: { _id: 0, userId: 0 } }
      );
      if (!result) throw new HttpError(404, "Record not found.");
      return json(200, result);
    }

    if (method === "DELETE") {
      if (!id) throw new HttpError(400, "Record id is required.");
      const result = await records.deleteOne({ _id: id, userId });
      if (!result.deletedCount) throw new HttpError(404, "Record not found.");
      return json(204, {});
    }

    throw new HttpError(405, "Method not allowed.");
  } catch (error) {
    return errorResponse(error);
  }
}

async function bootstrap(userId) {
  const [items, outfits, promptTemplates, generations] = await Promise.all([
    collection("items"),
    collection("outfits"),
    collection("promptTemplates"),
    collection("generations")
  ]);
  const projection = { _id: 0, userId: 0 };
  const [itemValues, outfitValues, templateValues, generationValues] = await Promise.all([
    items.find({ userId }, { projection }).sort({ updatedAt: -1 }).toArray(),
    outfits.find({ userId }, { projection }).sort({ updatedAt: -1 }).toArray(),
    promptTemplates.find({ userId }, { projection }).sort({ updatedAt: -1 }).toArray(),
    generations.find({ userId }, { projection }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);
  return json(200, {
    items: itemValues,
    outfits: outfitValues,
    promptTemplates: templateValues,
    generations: generationValues
  });
}

function prepareRecord(body, id, isCreate = true) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Record body must be an object.");
  const { _id, userId, createdAt, updatedAt, id: ignoredId, ...record } = body;
  const now = new Date().toISOString();
  return {
    ...record,
    id,
    ...(isCreate ? { createdAt: now } : {}),
    updatedAt: now
  };
}
