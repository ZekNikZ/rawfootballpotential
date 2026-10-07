import { Collection, Db, Document } from "mongodb";
import { client } from "../db";

export class BaseService<T extends Document> {
  db: Db;
  collection: Collection<T>;

  constructor(collectionName: string) {
    this.db = client.db(process.env.MONGO_DATABASE);
    this.collection = this.db.collection<T>(collectionName);
  }

  async findOne(): Promise<T | null> {
    return await this.collection.findOne<T>();
  }
}
