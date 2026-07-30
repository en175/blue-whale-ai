import {
  createConversationRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

export function createConversationDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return createConversationRepo(getPrismaClient(databaseUrl));
}
