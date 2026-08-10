import {
  createAssetRepo,
  createProjectRepo,
  getPrismaClient,
  type AssetRepo,
  type ProjectRepo,
} from "@blue-whale/persistence";

import { createTosStorage, loadTosStorageConfig } from "./tos-storage";
import {
  createS3CompatStorage,
  loadS3CompatStorageConfig,
} from "./s3-compat-storage";
import type { AssetUploadStorage } from "./handle-upload";
import type { AssetReader, AssetSigner } from "./ports";

function prisma() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");
  return getPrismaClient(databaseUrl);
}

/** 对象存储装配：VOLC_TOS 配置优先，其次 S3 兼容（验收 stub / 自建），皆无返回 null（100202）。 */
export function createConfiguredStorage(): {
  signer: AssetSigner;
  reader: AssetReader;
  uploads: AssetUploadStorage;
} | null {
  const tosConfig = loadTosStorageConfig();
  if (tosConfig) return createTosStorage(tosConfig);
  const s3Config = loadS3CompatStorageConfig();
  if (s3Config) return createS3CompatStorage(s3Config);
  return null;
}

/** Assets 用例依赖（列表）：wire Prisma asset repo。 */
export function createAssetsDeps() {
  return { assets: createAssetRepo(prisma()) };
}

/** 用户直传签名依赖：只构造存储适配，不触碰 Prisma。 */
export function createAssetPresignDeps(): {
  storage: AssetUploadStorage | null;
} {
  return { storage: createConfiguredStorage()?.uploads ?? null };
}

/** 用户直传提交依赖：项目归属 + Asset 落库 + 存储 HEAD。 */
export function createAssetCommitDeps(): {
  projects: Pick<ProjectRepo, "findOwnedById">;
  uploads: Pick<AssetRepo, "findCommittedUpload" | "createUploadedAsset">;
  storage: AssetUploadStorage | null;
} {
  const db = prisma();
  return {
    projects: createProjectRepo(db),
    uploads: createAssetRepo(db),
    storage: createConfiguredStorage()?.uploads ?? null,
  };
}

/** 项目资产用例依赖（copy/access/content）：wire project repo（验归属）+ asset repo + 存储。
 *  存储环境不全时 signer/reader 为 null —— 等价 Java 未配 Bean，access/content 判 100202。 */
export function createProjectAssetsDeps() {
  const db = prisma();
  const storage = createConfiguredStorage();
  return {
    project: createProjectRepo(db),
    assets: createAssetRepo(db),
    signer: storage?.signer ?? null,
    reader: storage?.reader ?? null,
  };
}
