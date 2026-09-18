import type { PrismaClient } from "@prisma/client";

/** Asset 读路径 repo（Prisma-backed），复用部署的 assets 表。
 *  对齐 Java AssetService.listAssets：只读分页列表。
 *  不含 storage_key 等内部字段（对齐 AssetResponse）。 */

export interface AssetView {
  id: string;
  type: string;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  source: string | null;
  created_at: string | null;
  size: number | null;
  generation_job_id: string | null;
  project_id: string | null;
  mime: string | null;
  model: string | null;
  /** IKEXX8：素材库关联两列成对吐出（IKDJNZ 落的数据；未关联为 null）。 */
  material_id: string | null;
  material_group_id: string | null;
  /** IKFYHJ（ADR-0087）：该素材在素材库的校验状态——`Active` / `Processing` / `Failed`。
   *  null = 未关联素材库，或关联了但本地无状态行（早于本功能入库的存量素材）。
   *  **取自本地镜像，可能陈旧**（只跟进素材创建后 10 分钟）；判定「此刻能不能用」
   *  以生成接口为准（那里实时查上游）。`material_status_checked_at` 供判断镜像有多旧。 */
  material_status: string | null;
  material_status_checked_at: string | null;
}

/** 详情路径视图（IKFSSO）：列表字段 + 生成提示词。
 *  只在 `GET /api/assets/:assetId` 用。列表不带 `prompt`——单条上限 4000 字，
 *  而资产库 `fetchAllAssets` 是全量拉取，逐条带提示词会把响应体撑大一个量级。 */
export interface AssetDetailView extends AssetView {
  /** AI 生成素材的原始提示词。上传素材、提取音频（`media_extract`）、
   *  以及合法空串 prompt（IKDLQF：带 target_node_id 时允许空 prompt）均为 null。 */
  prompt: string | null;
}

export interface AssetPage {
  records: AssetView[];
  total: number;
  size: number;
  current: number;
}

export interface AssetListFilter {
  type?: string;
  page: number;
  size: number;
}

/** access/content/Agent resolve 端点需要的内部投影：验归属后读受控元数据。
 *  对齐 Java ProjectAssetAccessService/ProjectAssetContentService 的 Asset 取用字段。 */
/** Agent 读取素材时需要的字段集合。
 *  不含 `content_sha256`：它此前只为 `deriveAssetContentVersion` 而取，内容版本校验已撤除
 *  （IKASSI）。而且按下方 `AssetSourceFields` 的注释，部署表 `assets` 本就没有这一列。 */
export interface AssetInternal {
  storage_key: string | null;
  type: string;
  mime: string | null;
  size: bigint | null;
  duration_seconds: number | null;
}

/** 跨项目复制时从源行拷贝的字段集合（对齐 Java AssetCopyService 逐字段 set）。
 *  部署表 assets 无 content_sha256 / source_asset_id / generation_job_id 列，故不携带。 */
export interface AssetSourceFields {
  type: string;
  storage_key: string | null;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration_ms?: number | null;
  source: string;
}

export interface PendingUploadAsset {
  id: string;
  type: string;
  storage_key: string;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface AssetRepo {
  listByUser(userId: string, filter: AssetListFilter): Promise<AssetPage>;
  /** 逻辑删除当前用户自己的未删除 Asset；不存在或不归属返回 false。 */
  softDeleteOwned(assetId: string, userId: string): Promise<boolean>;
  /** IKCNLP（方案C）：素材-项目关联。幂等 upsert（唯一键 uk_project_asset 冲突即已关联，视为成功）。 */
  linkAssetToProject(input: {
    userId: string;
    assetId: string;
    projectId: string;
  }): Promise<boolean>;
  /** IKCZAT：统计引用该素材的项目数（直接归属 project_id ∪ project_asset 关联，并集去重）。 */
  countReferencingProjects(assetId: string, userId: string): Promise<number>;
  /** 取超期软删行（deleted_at 早于 cutoff，含 storage_key，按 id 升序）——GC 候选。 */
  listGcCandidates(cutoff: Date): Promise<
    { id: bigint; storage_key: string | null }[]
  >;
  /** 给定 storage_key 集合，返回仍有 is_delete=false 活动引用的那些（存在复制副本时保护对象）。 */
  findLiveRefs(storageKeys: string[]): Promise<string[]>;
  /** 物理删除指定 id 行（GC 确认对象已删后清行）。 */
  hardDeleteRows(ids: bigint[]): Promise<number>;
  /**
   * 取当前用户的正常资产（access/content/agent 读取用）；不存在/不归属/已删 → null。
   *
   * **按人查，不按项目查。** 素材是一个人的共享池：素材库列表就是按 user 列的
   * （见 `listByUser`），用户在自己任何一个项目里都看得见、拖得上自己全部素材。项目不是
   * 权限边界——`project` 表只有一个 `owner_id`，没有协作者、没有共享，所以再叠一层
   * `project_id` 挡不住任何人，只挡住用户自己在别的项目里传过的图。
   *
   * 曾经这里带 `projectId`，于是 md5 去重（IKCNLS）跨项目复用素材时必然踩空：复用只写
   * `project_asset` 关联行，`assets.project_id` 还是第一次上传时那个项目，按项目查就查不到。
   * 表现是画布上图看得见、agent 读不到，错话还是「服务端打开文件失败」——像文件坏了。
   */
  findAccessible(
    assetId: string,
    userId: string,
  ): Promise<AssetInternal | null>;
  /** 取当前用户拥有的正常源资产（跨项目复制用）；不存在/不归属/非正常 → null。 */
  findOwnedSource(
    sourceAssetId: string,
    userId: string,
  ): Promise<AssetSourceFields | null>;
  /** 取当前用户自己的单个资产详情（画布/资产库弹窗用）；不存在/不归属/已删 → null。
   *  比列表多带 `prompt`（IKFSSO），见 `AssetDetailView`。 */
  findOwnedById(assetId: string, userId: string): Promise<AssetDetailView | null>;
  /** 在目标项目落下资产副本行（与源共享 storage_key 物理对象），返回新副本视图。 */
  insertCopy(
    projectId: string,
    userId: string,
    source: AssetSourceFields,
  ): Promise<AssetView>;
  createPendingUpload(input: {
    userId: string;
    type: "image" | "video";
    mime: string;
    size: number;
    storageKey: string;
    url: string;
  }): Promise<string>;
  findPendingUpload(
    assetId: string,
    userId: string,
  ): Promise<PendingUploadAsset | null>;
  markUploadReady(assetId: string, userId: string): Promise<boolean>;
  findCommittedUpload(
    userId: string,
    storageKey: string,
  ): Promise<PendingUploadAsset | null>;
  /** IKCNLS：上传 md5 去重——查该用户未删 normal 资产里 md5 相同的最新一条。命中返回资产；无则 null。 */
  findOwnedByMd5(userId: string, md5: string): Promise<PendingUploadAsset | null>;
  /** 按素材库 id 查该用户未删 normal 本地资产（真人人像库导入复用）。 */
  findOwnedByMaterialId(userId: string, materialId: string): Promise<PendingUploadAsset | null>;
  /** IKGQWR：把本地资产绑到素材库素材，**两列一起写**（ADR-0093 决策 5）。
   *
   *  语义是**覆盖**：同一个 `material_id` 只允许一条本地行持有（`uq_asset_material_id` 全库
   *  唯一），谁最后上传谁持有。覆盖是**双向**的——必须先把旧主摘下来再写新值，只做后半步会撞
   *  P2002 报 500（崩溃路径，不是策略分歧）。
   *
   *  `materialGroupId` 允许为 null：上游与本地表都拿不到组 id 时仍要放行关联，代价是删组旁路
   *  （`clearMaterialGroupLink`）漏掉这一行——比因为一个附属列拒绝用户上传划算。 */
  bindMaterialId(input: {
    userId: string;
    assetId: string;
    materialId: string;
    materialGroupId: string | null;
  }): Promise<boolean>;
  createUploadedAsset(input: {
    userId: string;
    projectId: string;
    type: "image" | "video" | "audio";
    mime: string;
    size: number;
    storageKey: string;
    url: string;
    width?: number;
    height?: number;
    duration?: number;
    md5?: string;
    materialId?: string;
    /** IKGQWR：与 `materialId` 成对写入（ADR-0093 决策 2）。 */
    materialGroupId?: string | null;
  }): Promise<PendingUploadAsset>;
  /** IKDJNZ：素材库素材创建成功后，把原始素材与素材库素材绑定（一对多覆盖写）。
   *  校验 asset 归属当前用户；material_id 唯一索引兜底一张素材只关联一个素材库素材。 */
  linkAssetToMaterial(input: {
    userId: string;
    assetId: string;
    materialId: string;
    materialGroupId: string;
  }): Promise<boolean>;
  /** IKDJNZ：素材库素材被删除后，清除本地 assets 行上对应的 material_id 关联。 */
  clearMaterialLink(userId: string, materialId: string): Promise<void>;
  /** IKDJNZ：素材库组被删除后，按组 ID 批量清除本地 assets 行的 material 关联（两列）。 */
  clearMaterialGroupLink(userId: string, materialGroupId: string): Promise<void>;
  /** IKF YHJ：查这批本地 Asset 里「已绑素材库素材」的那些，返回其 material_id。
   *  生成创建期的素材校验门用它覆盖 worker 会自动转 asset:// 的那条绕过路径（ADR-0087 背景缺口 3）。 */
  findBoundMaterialIds(userId: string, assetIds: readonly string[]): Promise<string[]>;
}

const uploadAssetSelect = {
  id: true,
  type: true,
  storage_key: true,
  url: true,
  mime: true,
  size: true,
  width: true,
  height: true,
  duration_ms: true,
} as const;

/** E 层合并后 assets 只剩 duration_ms（毫秒）一列：对外统一以秒暴露，缺省保持 null。 */
export function assetDurationSeconds(
  durationMs: number | null | undefined,
): number | null {
  return durationMs == null ? null : durationMs / 1000;
}

/**
 * 区分「已解析好的资产」与「Prisma 原始行」。
 *
 * `createUploadedAsset` 的 P2002 兜底分支（!726）会直接返回 `toUploadAsset` 的结果，于是
 * `await $transaction(...)` 的类型是两者的联合——两者的 `id` 一个是 `string` 一个是 `bigint`。
 * 内联写 `"id" in row && typeof row.id === "string"` 在这个联合上收不窄，因此用类型谓词把它
 * 显式表达出来。见 `createUploadedAsset` 末尾的注释。
 */
function isPendingUploadAsset(row: unknown): row is PendingUploadAsset {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof (row as { id?: unknown }).id === "string"
  );
}

function toUploadAsset(row: {
  id: bigint;
  type: string;
  storage_key: string | null;
  url: string;
  mime: string | null;
  size: bigint | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
}): PendingUploadAsset | null {
  if (!row.storage_key) return null;
  const { duration_ms: durationMs, ...asset } = row;
  return {
    ...asset,
    id: row.id.toString(),
    storage_key: row.storage_key,
    duration: assetDurationSeconds(durationMs),
  };
}

/** 从生成任务 input 里取提示词；非字符串或纯空白一律视为「无」。
 *
 *  **两种写入口径都认**：常规生成写 `prompt`；场景卡视频重生成写 `prompt_text`
 *  （`scene-card-generation-repo.ts` 自己的读路径也认这个键）。漏掉后者的话，场景卡
 *  产出的视频会显示模型名却没有提示词——`model_id` 走 `parameters.model_id` 的兜底
 *  就是为了同一个场景卡路径，两个字段的兜底得对齐。
 *
 *  IKFSSO：提取音频（media_extract）的 input 只有 source_asset_id，本就没有 prompt；
 *  空串 prompt 是合法输入（IKDLQF：带 target_node_id 时允许空 prompt），
 *  一并按「无」处理，免得前端拿到一条空白提示词。 */
function promptFromJobInput(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { prompt, prompt_text: promptText } = input as {
    prompt?: unknown;
    prompt_text?: unknown;
  };
  for (const candidate of [prompt, promptText]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return null;
}

/** 按 assets 行批量解析生成任务元信息：jobId → 模型展示名 / 提示词。
 *
 *  列表与单查共用的**唯一一次** `generation_jobs` 查询：同一批 `input` 同时喂出两个映射。
 *  `modelByJobId` 两条路径都用；`promptByJobId` 只有详情路径消费（`toAssetDetailView`），
 *  列表刻意丢弃——见 `AssetDetailView` 的体积说明。
 *
 *  model_id 取任务 input 的顶层 model_id 或 parameters.model_id（场景卡等路径）；
 *  展示名查不到时回退 model_id。 */
/** 单次 `IN` 的上限。控制器对 `?size=` **没有上限**（`assets.controller.ts` 只做 `Math.max(1, …)`），
 *  而前端 `fetchAllAssets` 是并发翻页全量拉取——所以这里不能假设「一页就 24 条」。
 *  分批把单个 IN 列表钉在可控规模，避免一次 list 请求丢出上万个绑定参数。
 *  正常情况（默认 size=24）永远只走一批，循环不产生额外往返。 */
const MATERIAL_ID_CHUNK = 500;

/** 批量取这批 asset 关联素材的校验状态（IKFYHJ / ADR-0087）。
 *  与 `resolveAssetJobMeta` 同款：一次批量查，不做 N+1，也不在列表读路径打上游。
 *  带 `user_id` 谓词（决策 1 的纵深防御）；走 `uk_material_assets_material(material_id)`
 *  唯一索引，`user_id` 作残余过滤。
 *  页面里一个素材都没关联时直接返回空 Map——不发查询。 */
async function resolveMaterialStatuses(
  prisma: PrismaClient,
  userId: string,
  rows: { material_id?: string | null }[],
): Promise<Map<string, { status: string; checkedAt: string | null }>> {
  const byMaterialId = new Map<string, { status: string; checkedAt: string | null }>();
  const materialIds = [
    ...new Set(
      rows
        .map((a) => a.material_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (materialIds.length === 0) return byMaterialId;

  for (let i = 0; i < materialIds.length; i += MATERIAL_ID_CHUNK) {
    const chunk = materialIds.slice(i, i + MATERIAL_ID_CHUNK);
    const statusRows = await prisma.material_assets.findMany({
      where: { user_id: BigInt(userId), material_id: { in: chunk } },
      select: { material_id: true, status: true, status_checked_at: true },
    });
    for (const row of statusRows) {
      byMaterialId.set(row.material_id, {
        status: row.status,
        checkedAt: row.status_checked_at?.toISOString() ?? null,
      });
    }
  }
  return byMaterialId;
}

async function resolveAssetJobMeta(
  prisma: PrismaClient,
  rows: { generation_job_id: bigint | null }[],
): Promise<{
  modelByJobId: Map<string, string>;
  promptByJobId: Map<string, string>;
}> {
  const modelByJobId = new Map<string, string>();
  const promptByJobId = new Map<string, string>();
  const jobIds = rows
    .map((a) => a.generation_job_id)
    .filter((id): id is bigint => id != null);
  if (jobIds.length === 0) return { modelByJobId, promptByJobId };

  const jobs = await prisma.generation_jobs.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, input: true },
  });
  const modelIdByJob = new Map<string, string>();
  const modelIds = new Set<string>();
  for (const job of jobs) {
    const input = job.input as
      | { model_id?: string; parameters?: { model_id?: string }; prompt?: unknown }
      | null
      | undefined;
    const modelId = input?.model_id ?? input?.parameters?.model_id;
    if (modelId) {
      modelIdByJob.set(job.id.toString(), modelId);
      modelIds.add(modelId);
    }
    // IKFSSO：同一批 input 顺带取提示词，不额外回表。
    const prompt = promptFromJobInput(input);
    if (prompt !== null) promptByJobId.set(job.id.toString(), prompt);
  }
  if (modelIds.size === 0) return { modelByJobId, promptByJobId };

  const caps = await prisma.generation_model_capability.findMany({
    where: { model_id: { in: [...modelIds] }, enabled: true, is_delete: false },
    select: { model_id: true, model_label: true },
  });
  const labelByModel = new Map<string, string>();
  for (const cap of caps) {
    if (!labelByModel.has(cap.model_id)) labelByModel.set(cap.model_id, cap.model_label);
  }
  for (const [jobId, modelId] of modelIdByJob) {
    modelByJobId.set(jobId, labelByModel.get(modelId) ?? modelId);
  }
  return { modelByJobId, promptByJobId };
}

/** assets 行 → 对外视图（AssetView）。列表与单查共用的字段映射，行为必须一致。 */
function toAssetView(
  a: {
    id: bigint;
    type: string;
    url: string;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    source: string | null;
    gmt_create: Date | null;
    size: bigint | null;
    generation_job_id: bigint | null;
    project_id: bigint | null;
    mime: string | null;
    material_id?: string | null;
    material_group_id?: string | null;
  },
  modelByJobId: Map<string, string>,
  statusByMaterialId: Map<string, { status: string; checkedAt: string | null }>,
): AssetView {
  return {
    id: a.id.toString(),
    type: a.type,
    url: a.url,
    width: a.width,
    height: a.height,
    duration: assetDurationSeconds(a.duration_ms),
    source: a.source ?? null,
    created_at: a.gmt_create?.toISOString() ?? null,
    size: a.size == null ? null : Number(a.size),
    generation_job_id:
      a.generation_job_id == null ? null : a.generation_job_id.toString(),
    project_id: a.project_id == null ? null : a.project_id.toString(),
    mime: a.mime ?? null,
    model:
      a.generation_job_id == null
        ? null
        : (modelByJobId.get(a.generation_job_id.toString()) ?? null),
    material_id: a.material_id ?? null,
    material_group_id: a.material_group_id ?? null,
    // 无关联 / 无状态行 → 查不到 → null（不瞎猜）。
    material_status:
      a.material_id == null
        ? null
        : (statusByMaterialId.get(a.material_id)?.status ?? null),
    material_status_checked_at:
      a.material_id == null
        ? null
        : (statusByMaterialId.get(a.material_id)?.checkedAt ?? null),
  };
}

/** assets 行 → 详情视图（IKFSSO）：复用列表那份字段映射，只追加 `prompt`。
 *  入参类型走 `Parameters<typeof toAssetView>[0]` 而非重抄一遍，两个映射的行结构不会漂。
 *  提示词按 assets 行取而非按 job 取，与 `model` 同源同兜底。 */
function toAssetDetailView(
  a: Parameters<typeof toAssetView>[0],
  modelByJobId: Map<string, string>,
  promptByJobId: Map<string, string>,
  statusByMaterialId: Map<string, { status: string; checkedAt: string | null }>,
): AssetDetailView {
  return {
    ...toAssetView(a, modelByJobId, statusByMaterialId),
    prompt:
      a.generation_job_id == null
        ? null
        : (promptByJobId.get(a.generation_job_id.toString()) ?? null),
  };
}

export function createAssetRepo(prisma: PrismaClient): AssetRepo {
  return {
    async findOwnedById(assetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          is_delete: false,
        },
      });
      if (!row) return null;
      const { modelByJobId, promptByJobId } = await resolveAssetJobMeta(prisma, [row]);
      // 单条：未关联素材库时 resolveMaterialStatuses 直接返回空 Map，不发查询。
      const statusByMaterialId = await resolveMaterialStatuses(prisma, userId, [row]);
      return toAssetDetailView(row, modelByJobId, promptByJobId, statusByMaterialId);
    },
    async softDeleteOwned(assetId, userId) {
      // IKCNLP（方案C）：删除素材 = 软删 assets + 同步删 project_asset 关联，画布节点不动。
      return prisma.$transaction(async (tx) => {
        const result = await tx.assets.updateMany({
          where: {
            id: BigInt(assetId),
            user_id: BigInt(userId),
            is_delete: false,
          },
          data: {
            is_delete: true,
            deleted_at: new Date(),
            version: { increment: 1 },
            gmt_modified: new Date(),
          },
        });
        if (result.count === 1) {
          await tx.project_asset.updateMany({
            where: { asset_id: BigInt(assetId), user_id: BigInt(userId), is_delete: 0 },
            data: { is_delete: 1, gmt_modified: new Date() },
          });
        }
        return result.count === 1;
      });
    },
    async linkAssetToProject({ userId, assetId, projectId }) {
      const aid = BigInt(assetId);
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const existing = await prisma.assets.findFirst({
        where: { id: aid, user_id: uid, is_delete: false },
        select: { id: true },
      });
      if (!existing) return false;
      await prisma.project_asset.upsert({
        where: {
          user_id_asset_id_project_id: { user_id: uid, asset_id: aid, project_id: pid },
        },
        create: { user_id: uid, asset_id: aid, project_id: pid, is_delete: 0 },
        update: { is_delete: 0, gmt_modified: new Date() },
      });
      return true;
    },
    async countReferencingProjects(assetId, userId) {
      // IKCZAT：引用 = 直接归属（assets.project_id ≠ 0）+ project_asset 关联，两来源 project_id 并集去重。
      // 只计存活项目（projects.is_delete=0）：项目删除不清 project_asset（见 project-repo delete/batchDelete），
      // 已删项目不构成真实引用——接口目的就是「删素材前看影响面」，必须反映真实占用。
      const aid = BigInt(assetId);
      const uid = BigInt(userId);
      const [direct, linked] = await Promise.all([
        prisma.assets.groupBy({
          by: ["project_id"],
          where: { id: aid, user_id: uid, is_delete: false, project_id: { not: BigInt(0) } },
        }),
        prisma.project_asset.groupBy({
          by: ["project_id"],
          where: { asset_id: aid, user_id: uid, is_delete: 0 },
        }),
      ]);
      const ids = new Set<string>();
      for (const row of direct) {
        if (row.project_id === BigInt(0)) continue;
        ids.add(row.project_id.toString());
      }
      for (const row of linked) {
        if (row.project_id === BigInt(0)) continue;
        ids.add(row.project_id.toString());
      }
      if (ids.size === 0) return 0;
      const liveProjects = await prisma.project.findMany({
        where: { id: { in: [...ids].map((id) => BigInt(id)) }, is_delete: 0 },
        select: { id: true },
      });
      return liveProjects.length;
    },
    async listGcCandidates(cutoff) {
      const rows = await prisma.assets.findMany({
        where: { is_delete: true, deleted_at: { not: null, lt: cutoff } },
        select: { id: true, storage_key: true },
        orderBy: { id: "asc" },
        // 单轮扫描上限：与 GC_BATCH_LIMIT 同向防堆积，剩余候选下轮继续（G7）。
        take: 1000,
      });
      return rows.map((row) => ({
        id: row.id,
        storage_key: row.storage_key,
      }));
    },
    async findLiveRefs(storageKeys) {
      if (storageKeys.length === 0) return [];
      const rows = await prisma.assets.findMany({
        where: { storage_key: { in: storageKeys }, is_delete: false },
        select: { storage_key: true },
      });
      return [...new Set(rows.map((row) => row.storage_key))].filter(
        (key): key is string => key != null,
      );
    },
    async hardDeleteRows(ids) {
      if (ids.length === 0) return 0;
      const result = await prisma.assets.deleteMany({
        where: { id: { in: ids } },
      });
      return result.count;
    },
    async listByUser(userId, filter) {
      const where = {
        user_id: BigInt(userId),
        is_delete: false,
        ...(filter.type ? { type: filter.type } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.assets.count({ where }),
        prisma.assets.findMany({
          where,
          orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
          skip: (filter.page - 1) * filter.size,
          take: filter.size,
        }),
      ]);
      // 生成模型溯源：按 generation_job_id 批量回查任务 input 的 model_id，再查能力表展示名。
      // 兜底顺序：展示名 → model_id → null（上传资产/任务无模型/查询失败均落到 null 或回退）。
      // IKFSSO：同一批查询顺带解析出的 promptByJobId 列表不用，刻意只取 modelByJobId。
      const { modelByJobId } = await resolveAssetJobMeta(prisma, rows);
      // IKFYHJ：素材校验状态走同一个批量模式（只在有绑定时发一条 IN，不打上游）。
      const statusByMaterialId = await resolveMaterialStatuses(prisma, userId, rows);
      return {
        records: rows.map((a) => toAssetView(a, modelByJobId, statusByMaterialId)),
        total,
        size: filter.size,
        current: filter.page,
      };
    },
    async findAccessible(assetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          status: "normal",
          is_delete: false,
        },
        select: {
          storage_key: true,
          type: true,
          mime: true,
          size: true,
          duration_ms: true,
        },
      });
      return row
        ? {
            storage_key: row.storage_key,
            type: row.type,
            mime: row.mime,
            size: row.size,
            duration_seconds: assetDurationSeconds(row.duration_ms),
          }
        : null;
    },
    async findOwnedSource(sourceAssetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(sourceAssetId),
          user_id: BigInt(userId),
          status: "normal",
          is_delete: false,
        },
      });
      if (!row) return null;
      return {
        type: row.type,
        storage_key: row.storage_key,
        url: row.url,
        mime: row.mime,
        size: row.size,
        width: row.width,
        height: row.height,
        duration_ms: row.duration_ms,
        source: row.source,
      };
    },
    async insertCopy(projectId, userId, source) {
      const row = await prisma.assets.create({
        data: {
          project_id: BigInt(projectId),
          user_id: BigInt(userId),
          type: source.type,
          storage_key: source.storage_key,
          url: source.url,
          mime: source.mime,
          size: source.size,
          width: source.width,
          height: source.height,
          duration_ms: source.duration_ms ?? null,
          source: source.source,
          status: "normal",
        },
      });
      return {
        id: row.id.toString(),
        type: row.type,
        url: row.url,
        width: row.width,
        height: row.height,
        duration: assetDurationSeconds(row.duration_ms),
        source: row.source ?? null,
        created_at: row.gmt_create?.toISOString() ?? null,
        size: row.size == null ? null : Number(row.size),
        generation_job_id:
          row.generation_job_id == null ? null : row.generation_job_id.toString(),
        project_id: row.project_id == null ? null : row.project_id.toString(),
        mime: row.mime ?? null,
        model: null,
        // IKEXX8：跨项目复制出的新 asset 无素材库关联（未关联为 null）。
        material_id: row.material_id ?? null,
        material_group_id: row.material_group_id ?? null,
        // 新副本没关联素材库 → 无校验状态。此处刻意不走 resolveMaterialStatuses：
        // 刚创建的行不可能有状态（且没绑定就无从查），多一次往返没有意义。
        material_status: null,
        material_status_checked_at: null,
      };
    },
    async createPendingUpload(input) {
      const row = await prisma.assets.create({
        data: {
          user_id: BigInt(input.userId),
          project_id: BigInt(0),
          type: input.type,
          storage_key: input.storageKey,
          url: input.url,
          mime: input.mime,
          size: BigInt(input.size),
          source: "uploaded",
          status: "uploading",
        },
      });
      return row.id.toString();
    },
    async findPendingUpload(assetId, userId) {
      const row = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          status: "uploading",
          is_delete: false,
        },
        select: {
          id: true,
          type: true,
          storage_key: true,
          url: true,
          mime: true,
          size: true,
          width: true,
          height: true,
          duration_ms: true,
        },
      });
      if (!row?.storage_key) return null;
      return {
        ...row,
        id: row.id.toString(),
        storage_key: row.storage_key,
        duration: assetDurationSeconds(row.duration_ms),
      };
    },
    async markUploadReady(assetId, userId) {
      const result = await prisma.assets.updateMany({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          status: "uploading",
          is_delete: false,
        },
        data: { status: "normal", version: { increment: 1 } },
      });
      return result.count === 1;
    },
    async findCommittedUpload(userId, storageKey) {
      const row = await prisma.assets.findFirst({
        where: {
          user_id: BigInt(userId),
          storage_key: storageKey,
          status: "normal",
          is_delete: false,
        },
        select: uploadAssetSelect,
      });
      return row ? toUploadAsset(row) : null;
    },
    async findOwnedByMd5(userId, md5) {
      const row = await prisma.assets.findFirst({
        where: {
          user_id: BigInt(userId),
          md5,
          status: "normal",
          is_delete: false,
        },
        orderBy: { id: "desc" },
        select: uploadAssetSelect,
      });
      return row ? toUploadAsset(row) : null;
    },
    async findOwnedByMaterialId(userId, materialId) {
      const row = await prisma.assets.findFirst({
        where: {
          user_id: BigInt(userId),
          material_id: materialId,
          status: "normal",
          is_delete: false,
        },
        select: uploadAssetSelect,
      });
      return row ? toUploadAsset(row) : null;
    },
    async bindMaterialId({ userId, assetId, materialId, materialGroupId }) {
      const uid = BigInt(userId);
      const owned = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: uid,
          is_delete: false,
        },
        select: { id: true, material_id: true, material_group_id: true },
      });
      if (!owned) return false;
      // 已经是它、组也对得上 → 幂等返回，省一次写。
      if (
        owned.material_id === materialId &&
        owned.material_group_id === materialGroupId
      ) {
        return true;
      }
      // IKGQWR（ADR-0093 决策 5）：覆盖写，双向。两步必须同事务。
      await prisma.$transaction(async (tx) => {
        // ① 先把旧主摘下来。`uq_asset_material_id` 是全库唯一（单列），不先清就撞 P2002 → 500。
        await tx.assets.updateMany({
          where: {
            material_id: materialId,
            user_id: uid,
            id: { not: owned.id },
          },
          data: {
            material_id: null,
            material_group_id: null,
            version: { increment: 1 },
            gmt_modified: new Date(),
          },
        });
        // ② 再写到本行，两列一起。
        await tx.assets.update({
          where: { id: owned.id },
          data: {
            material_id: materialId,
            material_group_id: materialGroupId,
            version: { increment: 1 },
            gmt_modified: new Date(),
          },
        });
      });
      return true;
    },
    async createUploadedAsset(input) {
      // IKCNLP（方案C）：上传落库时若归属具体项目（project_id != 0）则自动建 project_asset 关联。
      const row = await prisma.$transaction(async (tx) => {
        // IKGQWR（ADR-0093 决策 5）：新行要占 `uq_asset_material_id` 这个全库唯一键，先把旧主
        // 摘下来，否则 create 直接撞 P2002。与 bindMaterialId 同一套覆盖语义。
        if (input.materialId) {
          await tx.assets.updateMany({
            where: {
              material_id: input.materialId,
              user_id: BigInt(input.userId),
            },
            data: {
              material_id: null,
              material_group_id: null,
              version: { increment: 1 },
              gmt_modified: new Date(),
            },
          });
        }
        const created = await tx.assets.create({
          data: {
            user_id: BigInt(input.userId),
            project_id: BigInt(input.projectId),
            type: input.type,
            storage_key: input.storageKey,
            url: input.url,
            mime: input.mime,
            size: BigInt(input.size),
            ...(input.width == null ? {} : { width: input.width }),
            ...(input.height == null ? {} : { height: input.height }),
            ...(input.duration == null
              ? {}
              : { duration_ms: Math.round(input.duration * 1000) }),
            ...(input.md5 ? { md5: input.md5 } : {}),
            ...(input.materialId ? { material_id: input.materialId } : {}),
            // IKGQWR：组 id 与素材 id 成对写入；拿不到组 id 时留 NULL（见接口注释）。
            ...(input.materialGroupId
              ? { material_group_id: input.materialGroupId }
              : {}),
            source: "uploaded",
            status: "normal",
          },
          select: uploadAssetSelect,
        });
        if (input.projectId !== "0") {
          await tx.project_asset.upsert({
            where: {
              user_id_asset_id_project_id: {
                user_id: BigInt(input.userId),
                asset_id: created.id,
                project_id: BigInt(input.projectId),
              },
            },
            create: {
              user_id: BigInt(input.userId),
              asset_id: created.id,
              project_id: BigInt(input.projectId),
              is_delete: 0,
            },
            update: { is_delete: 0, gmt_modified: new Date() },
          });
        }
        return created;
      }).catch(async (error: unknown) => {
        // 同一素材库 id 已被其它本地行占用：回读那条代表行，避免导入失败
        if ((error as { code?: string }).code === "P2002" && input.materialId) {
          const existing = await prisma.assets.findFirst({
            where: {
              user_id: BigInt(input.userId),
              material_id: input.materialId,
              status: "normal",
              is_delete: false,
            },
            select: uploadAssetSelect,
          });
          const reused = existing ? toUploadAsset(existing) : null;
          if (reused) return reused;
        }
        throw error;
      });
      // !726 引入的 P2002 兜底分支返回的是一条已解析好的资产（`PendingUploadAsset`），与事务正常
      // 返回的 Prisma 行构成联合类型。原来那句内联守卫 `"id" in row && typeof row.id === "string"`
      // 在这个联合上收不窄，`tsc -b` 一直报 TS2345（连带接口实现报 TS2719）——release/2026.09.15
      // 上是红的。换成显式类型谓词，两处一起消掉。
      if (isPendingUploadAsset(row)) return row;
      const asset = toUploadAsset(row);
      if (!asset) throw new Error("Committed upload is missing storage_key");
      return asset;
    },
    async linkAssetToMaterial({ userId, assetId, materialId, materialGroupId }) {
      // IKDJNZ：校验归属（当前用户未删资产），不存在/不归属 → false。
      const owned = await prisma.assets.findFirst({
        where: {
          id: BigInt(assetId),
          user_id: BigInt(userId),
          is_delete: false,
        },
        select: { id: true },
      });
      if (!owned) return false;
      await prisma.assets.update({
        where: { id: owned.id },
        data: {
          material_id: materialId,
          material_group_id: materialGroupId,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
      return true;
    },
    async clearMaterialLink(userId, materialId) {
      // 两列一起清：素材没了之后只清 material_id 会留下悬空的 material_group_id，
      // 前端仍能据此渲染「已入库」角标、生成链路也仍会把它当素材库引用转 asset://。
      await prisma.assets.updateMany({
        where: { material_id: materialId, user_id: BigInt(userId) },
        data: {
          material_id: null,
          material_group_id: null,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
    },
    async clearMaterialGroupLink(userId, materialGroupId) {
      await prisma.assets.updateMany({
        where: { material_group_id: materialGroupId, user_id: BigInt(userId) },
        data: {
          material_id: null,
          material_group_id: null,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
    },
    async findBoundMaterialIds(userId, assetIds) {
      if (assetIds.length === 0) return [];
      const rows = await prisma.assets.findMany({
        where: {
          id: { in: assetIds.map((id) => BigInt(id)) },
          user_id: BigInt(userId),
          is_delete: false,
          material_id: { not: null },
        },
        select: { material_id: true },
      });
      return rows
        .map((row) => row.material_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    },
  };
}
