// IKBMDM：Asset 延迟 GC 服务。复用 generation-worker 的 @Interval 定时器，
// 扫描软删超期（ASSET_GC_DELAY_DAYS，默认 7 天）的 assets 行 → 引用核对 →
// 物理删除 TOS 对象 → 物理删除行。任一环节失败记日志，不阻塞后续批次。
import { Injectable, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createAssetRepo } from "@blue-whale/persistence";
import { createLogger } from "@blue-whale/core/logging";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";

const logger = createLogger("generation-worker");

/** GC 单轮处理上限：防止一轮内堆积过多导致定时器错位（下轮自然续扫）。 */
export const GC_BATCH_LIMIT = 200;

/** 纯十进制整数环境值解析：非数字/小数/空白均视为非法（避免 parseInt 静默截断 "1.5"→1）。 */
function parseIntegerEnv(raw: string | undefined): number | null {
  if (raw == null || !/^\d+$/.test(raw.trim())) return null;
  return Number.parseInt(raw, 10);
}

export function delayDaysFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = parseIntegerEnv(env.ASSET_GC_DELAY_DAYS);
  return value != null ? value : 7;
}

export function intervalMsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = parseIntegerEnv(env.ASSET_GC_INTERVAL_MS);
  // 非法（NaN/负数）回落默认 1 小时，避免 1ms 忙循环（IKBMDM F4）。
  return value != null && value >= 1000 ? value : 3600000;
}

@Injectable()
export class AssetGcService implements OnModuleInit {
  private repoInstance?: ReturnType<typeof createAssetRepo>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AssetStorageService,
    private readonly operationLog: OperationLogService,
  ) {}

  private get repo(): ReturnType<typeof createAssetRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createAssetRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  async onModuleInit(): Promise<void> {
    // 与 RecoveryService 同构：worker 启动时立即跑一轮，不等首个 interval。
    await this.run();
  }

  @Interval(intervalMsFromEnv())
  async run(): Promise<void> {
    try {
      await this.runGcOnce();
    } catch (error) {
      logger.error(
        `asset GC run failed${
          error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
        }`,
      );
    }
  }

  private async runGcOnce(): Promise<void> {
    const days = delayDaysFromEnv();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const candidates = await this.repo.listGcCandidates(cutoff);
    logger.info(
      `asset GC: ${candidates.length} candidate(s) older than ${days} day(s)`,
    );
    if (candidates.length === 0) return;

    // 批内分块：每块各自核对引用、删对象、删行，失败不拖垮整轮。
    for (let offset = 0; offset < candidates.length; offset += GC_BATCH_LIMIT) {
      const batch = candidates.slice(offset, offset + GC_BATCH_LIMIT);
      await this.collectBatch(batch);
    }
  }

  async collectBatch(
    batch: { id: bigint; storage_key: string | null }[],
  ): Promise<void> {
    const byKey = new Map<string, bigint[]>();
    for (const candidate of batch) {
      if (!candidate.storage_key) continue;
      const ids = byKey.get(candidate.storage_key) ?? [];
      ids.push(candidate.id);
      byKey.set(candidate.storage_key, ids);
    }

    const storageKeys = [...byKey.keys()];
    const liveRefs = await this.repo.findLiveRefs(storageKeys);
    const staleKeys = storageKeys.filter((key) => !liveRefs.includes(key));

    const deletedIds: bigint[] = [];
    const deletedKeys: string[] = [];
    if (staleKeys.length > 0) {
      const uploads = this.storage.uploads;
      // TOS 未配置时不再静默空转：整轮失败并留待下轮重试（IKBMDM F7）。
      if (!uploads) {
        throw new Error("asset GC skipped: 对象存储未配置（对象无法物理回收）");
      }
      try {
        await uploads.deleteMultiObjects(staleKeys);
        for (const key of staleKeys) {
          for (const id of byKey.get(key) ?? []) deletedIds.push(id);
          deletedKeys.push(key);
        }
      } catch (error) {
        logger.error(
          `asset GC deleteMultiObjects failed (${staleKeys.length} keys)${
            error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
          }`,
        );
      }
    }

    if (deletedIds.length > 0) {
      await this.repo.hardDeleteRows(deletedIds);
      // 强删属安全关键写操作，物理回收必须有审计证据（ADR-0018 §6 fail-closed）。
      // 无登录操作者，operator 落 "system"，与后台入口一致走 admin_operation_logs。
      try {
        await this.operationLog.create({
          category: "asset",
          action: "gc-hard-delete",
          target: `延迟 GC 物理删除（${deletedIds.length} 行 / ${deletedKeys.length} 对象）`,
          detail: JSON.stringify({
            batchSize: batch.length,
            objectKeys: deletedKeys.length,
            deletedRows: deletedIds.length,
          }),
          operator: "system",
        });
      } catch (error) {
        // 审计失败不静默吞掉：至少上报日志，避免不可逆操作完全无痕。
        // 【有意偏离 ADR-0018 §7 fail-closed】与后台入口同策略：审计写失败仅告警不阻断，
        // 物理删除照常完成——资产删除不在 ADR §7 强制清单；GC 定时任务若被审计写失败卡死
        // 会静默停止回收，代价高于缺一条审计记录（2026-08-28 IKBMDM 评审确认）。
        logger.error(
          `asset GC audit write failed${
            error instanceof Error ? `\n${error.stack}` : `: ${String(error)}`
          }`,
        );
      }
    }
    logger.info(
      `asset GC batch done: ${batch.length} candidate(s), ` +
        `${liveRefs.length} still referenced (kept), ` +
        `${deletedIds.length} hard-deleted`,
    );
  }
}
