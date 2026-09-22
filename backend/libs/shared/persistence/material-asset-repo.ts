import type { PrismaClient } from "@prisma/client";

// IKF YHJ：素材校验状态 repo（Prisma-backed）。见 docs/adr/0087-*。
// 该表镜像上游素材状态，是生成任务「该素材能否用作视频生成参考」的判据。
// 唯一键只用 material_id；所有读写都带 user_id 谓词做纵深防御（隔离语义在账号维度）。
//
// 并发写不加 CAS：跟进器、透传镜像、拦截点回写三处会同时写同一行，`version` 列只递增、
// 不参与比较（last-writer-wins 是有意的）。安全方向成立——任何一次写失败或写旧值都只会让行
// 停在非终态（回到「实时查上游」那一路），**不可能把 Failed 写成 Active**。
// 若将来 `version` 要承担真正的乐观锁，三处写入点必须一起改。

export type MaterialAssetStatus = "Processing" | "Active" | "Failed";

export interface MaterialAssetView {
  id: string;
  materialId: string;
  userId: string;
  materialGroupId: string;
  status: MaterialAssetStatus;
  errorCode: string | null;
  errorMessage: string | null;
  statusCheckedAt: Date | null;
}

export interface UpsertProcessingInput {
  userId: string;
  materialId: string;
  materialGroupId: string;
}

export interface MirrorStatusInput {
  userId: string;
  materialId: string;
  status: MaterialAssetStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** 默认 now()；镜像透传响应时用调用时刻。 */
  checkedAt?: Date;
}

export interface MaterialAssetRepo {
  /** CreateAsset 2xx 时落行（status=Processing，此时上游必然如此）。幂等覆盖。 */
  upsertProcessing(input: UpsertProcessingInput): Promise<void>;
  /** 按素材 id 查（带 user_id 谓词）。无则 null。 */
  findByMaterialId(userId: string, materialId: string): Promise<MaterialAssetView | null>;
  /** 镜像上游返回的状态与失败原文（幂等覆盖）。 */
  mirrorStatus(input: MirrorStatusInput): Promise<void>;
  /** DeleteAsset 后清行（硬删）。 */
  deleteByMaterialId(userId: string, materialId: string): Promise<void>;
  /** DeleteAssetGroup 后按组批量清行（硬删）。 */
  deleteByGroupId(userId: string, materialGroupId: string): Promise<void>;
}

function toStatus(raw: string): MaterialAssetStatus {
  if (raw === "Active" || raw === "Failed") return raw;
  return "Processing";
}

function toView(row: {
  id: bigint;
  material_id: string;
  user_id: bigint;
  material_group_id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  status_checked_at: Date | null;
}): MaterialAssetView {
  return {
    id: row.id.toString(),
    materialId: row.material_id,
    userId: row.user_id.toString(),
    materialGroupId: row.material_group_id,
    status: toStatus(row.status),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    statusCheckedAt: row.status_checked_at,
  };
}

export function createMaterialAssetRepo(
  prisma: PrismaClient,
): MaterialAssetRepo {
  return {
    async upsertProcessing({ userId, materialId, materialGroupId }) {
      await prisma.material_assets.upsert({
        where: { material_id: materialId },
        // update 分支刻意**不写 user_id**：唯一键只有 material_id，若哪天上游真返回了跨账号
        // 重号的素材，改写归属等于把别人的行抢过来。保留原归属，让新账号查不到行
        // （→ 走实时查上游 → 拿不到就 fail-closed）比静默易主安全。
        update: {
          material_group_id: materialGroupId,
          status: "Processing",
          error_code: null,
          error_message: null,
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
        create: {
          material_id: materialId,
          user_id: BigInt(userId),
          material_group_id: materialGroupId,
          status: "Processing",
        },
      });
    },
    async findByMaterialId(userId, materialId) {
      const row = await prisma.material_assets.findFirst({
        where: { material_id: materialId, user_id: BigInt(userId) },
      });
      return row ? toView(row) : null;
    },
    async mirrorStatus({
      userId,
      materialId,
      status,
      errorCode,
      errorMessage,
      checkedAt,
    }) {
      // 只更新已存在的行（镜像不得凭空造行：无行意味着没走过 CreateAsset，语义是「未校验」）。
      await prisma.material_assets.updateMany({
        where: {
          material_id: materialId,
          user_id: BigInt(userId),
          // 终局保护：`Failed` 是**吸收态**，不允许被 `Active`/`Processing` 覆写。
          // 反例：一次陈旧的 ListAssets 镜像（本表唯一的批量写入口，ADR 自己标注「纯收益、
          // 不承担正确性」）就能把已判失败的素材翻回 Active，而拦截点信任本地 Active
          // **不再查上游**——等于整条闸门被一次过期响应打开。
          // 反方向仍放行：`Failed` 可以覆写任何状态（「通过之后被撤销」那条路）。
          ...(status === "Failed" ? {} : { status: { not: "Failed" } }),
        },
        data: {
          status,
          error_code: errorCode ?? null,
          error_message: errorMessage ?? null,
          status_checked_at: checkedAt ?? new Date(),
          version: { increment: 1 },
          gmt_modified: new Date(),
        },
      });
    },
    async deleteByMaterialId(userId, materialId) {
      await prisma.material_assets.deleteMany({
        where: { material_id: materialId, user_id: BigInt(userId) },
      });
    },
    async deleteByGroupId(userId, materialGroupId) {
      await prisma.material_assets.deleteMany({
        where: { material_group_id: materialGroupId, user_id: BigInt(userId) },
      });
    },
  };
}
