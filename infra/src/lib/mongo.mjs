import { MongoClient } from "mongodb";
import { getMongoUri } from "./config.mjs";

let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = getMongoUri().then((uri) => {
      const client = new MongoClient(uri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 8000
      });
      return client.connect();
    });
  }
  return clientPromise;
}

export async function getDb() {
  const client = await getClient();
  return client.db(process.env.MONGODB_DATABASE || "cloth_try_on");
}

export async function collection(name) {
  return (await getDb()).collection(name);
}
