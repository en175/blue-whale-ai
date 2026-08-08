import {
  createTemplateAdminRepo,
  createTemplateRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

/** 模板管理用例依赖：wire Prisma template repos（admin CRUD + 读取侧 tags）。 */
export function createTemplateAdminDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  const prisma = getPrismaClient(databaseUrl);
  return {
    admin: createTemplateAdminRepo(prisma),
    templates: createTemplateRepo(prisma),
  };
}
