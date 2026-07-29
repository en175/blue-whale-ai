import {
  createAssetRepo,
  createProjectRepo,
  getPrismaClient,
  type AssetRepo,
  type ProjectRepo,
} from "@blue-whale/persistence";

import { createTosStorage, loadTosStorageConfig } from "./tos-storage";
import type { AssetUploadStorage } from "./handle-upload";

function prisma() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return getPrismaClient(databaseUrl);
}

/** Assets 用例依赖（列表）：wire Prisma asset repo。 */
export function createAssetsDeps() {
  return { assets: createAssetRepo(prisma()) };
}

/** 用户直传签名依赖：只构造 TOS，不触碰 Prisma。 */
export function createAssetPresignDeps(): { storage: AssetUploadStorage | null } {
  const tosConfig = loadTosStorageConfig();
  return {
    storage: tosConfig ? createTosStorage(tosConfig).uploads : null,
  };
}

/** 用户直传提交依赖：项目归属 + Asset 落库 + TOS HEAD。 */
export function createAssetCommitDeps(): {
  projects: Pick<ProjectRepo, "findOwnedById">;
  uploads: Pick<AssetRepo, "findCommittedUpload" | "createUploadedAsset">;
  storage: AssetUploadStorage | null;
} {
  const db = prisma();
  const tosConfig = loadTosStorageConfig();
  return {
    projects: createProjectRepo(db),
    uploads: createAssetRepo(db),
    storage: tosConfig ? createTosStorage(tosConfig).uploads : null,
  };
}

/** 项目资产用例依赖（copy/access/content）：wire project repo（验归属）+ asset repo + TOS。
 *  TOS 环境不全时 signer/reader 为 null —— 等价 Java 未配 Bean，access/content 判 100202。 */
export function createProjectAssetsDeps() {
  const db = prisma();
  const tosConfig = loadTosStorageConfig();
  const tos = tosConfig ? createTosStorage(tosConfig) : { signer: null, reader: null };
  return {
    project: createProjectRepo(db),
    assets: createAssetRepo(db),
    signer: tos.signer,
    reader: tos.reader,
  };
}
