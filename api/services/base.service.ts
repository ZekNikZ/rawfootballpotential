import { Collection, Db } from "mongodb";
import { client } from "../db";

export class BaseService<T> {
  db: Db;
  collection: Collection;

  constructor(collectionName: string) {
    this.db = client.db(process.env.MONGO_DATABASE);
    this.collection = this.db.collection(collectionName);
  }

  async findOne(): Promise<T | null> {
    return await this.collection.findOne<T>();
  }
}
