import {
  createGenerationInboxRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createGenerationInboxDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createGenerationInboxRepo(getPrismaClient(databaseUrl));
}
