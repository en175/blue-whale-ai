import { Injectable } from "@nestjs/common";
import { getPrismaClient, type PrismaClient } from "@lib/shared/persistence/index.js";

@Injectable()
export class PrismaService {
  private clientInstance?: PrismaClient;

  get client(): PrismaClient {
    if (!this.clientInstance) {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error("DATABASE_URL required");
      }
      this.clientInstance = getPrismaClient(databaseUrl);
    }
    return this.clientInstance;
  }
}
