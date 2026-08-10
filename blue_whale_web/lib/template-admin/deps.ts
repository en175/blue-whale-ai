import {
  createTemplateAdminRepo,
  createTemplateRepo,
  getPrismaClient,
} from "@blue-whale/persistence";

import { createConfiguredStorage } from "@/lib/assets/deps";
import type { AssetUploadStorage } from "@/lib/assets/handle-upload";

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

/** 模板媒体上传依赖：只构造存储适配（复用画布 TOS/S3 装配），不触碰 Prisma。 */
export function createTemplateUploadDeps(): {
  storage: AssetUploadStorage | null;
} {
  return { storage: createConfiguredStorage()?.uploads ?? null };
}
