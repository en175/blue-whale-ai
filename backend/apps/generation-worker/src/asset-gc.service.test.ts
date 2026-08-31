// IKBMDM G1：GC 核心逻辑单测。纯函数直接验证；collectBatch 依赖注入假 prisma/storage/审计。
import { describe, expect, it, vi } from "vitest";

import {
  AssetGcService,
  delayDaysFromEnv,
  GC_BATCH_LIMIT,
  intervalMsFromEnv,
} from "./asset-gc.service.js";

describe("AssetGcService env 解析", () => {
  it("delayDaysFromEnv: 合法整数天数直接采用", () => {
    expect(delayDaysFromEnv({ ASSET_GC_DELAY_DAYS: "3" } as never)).toBe(3);
    expect(delayDaysFromEnv({ ASSET_GC_DELAY_DAYS: "30" } as never)).toBe(30);
  });

  it("delayDaysFromEnv: 非法/缺省回退默认 7", () => {
    for (const raw of ["abc", "-1", "1.5", ""]) {
      expect(
        delayDaysFromEnv({ ASSET_GC_DELAY_DAYS: raw } as never),
      ).toBe(7);
    }
    expect(delayDaysFromEnv({} as never)).toBe(7);
  });

  it("intervalMsFromEnv: 合法毫秒数（>=1000）直接采用", () => {
    expect(
      intervalMsFromEnv({ ASSET_GC_INTERVAL_MS: "60000" } as never),
    ).toBe(60000);
  });

  it("intervalMsFromEnv: 非法/过小/缺省回退 1 小时", () => {
    for (const raw of ["abc", "999", "0", "-5", ""]) {
      expect(intervalMsFromEnv({ ASSET_GC_INTERVAL_MS: raw } as never)).toBe(
        3600000,
      );
    }
    expect(intervalMsFromEnv({} as never)).toBe(3600000);
  });
});

describe("AssetGcService.collectBatch", () => {
  /** 组装服务：fake prisma client 经 createAssetRepo 派生 repo，fake storage/audit 注入。 */
  const mkService = ({
    findMany,
    deleteMany,
    uploads,
    audit,
  }: {
    findMany?: ReturnType<typeof vi.fn>;
    deleteMany?: ReturnType<typeof vi.fn>;
    uploads?: { deleteMultiObjects: ReturnType<typeof vi.fn> } | null;
    audit?: ReturnType<typeof vi.fn>;
  }) =>
    new AssetGcService(
      {
        client: {
          assets: {
            // findLiveRefs 的默认查询：无 live 引用。
            findMany: findMany ?? vi.fn(async () => []),
            deleteMany: deleteMany ?? vi.fn(async () => 0),
          },
        },
      } as never,
      { uploads: uploads ?? null } as never,
      { create: audit ?? vi.fn(async () => ({})) } as never,
    );

  it("storage_key 为 NULL 的行不触发 TOS 删除、也不计入硬删", async () => {
    const deleteMulti = vi.fn(async () => {});
    const hardDelete = vi.fn(async () => 0);
    const svc = mkService({ deleteMany: hardDelete, uploads: { deleteMultiObjects: deleteMulti } });
    await svc.collectBatch([
      { id: BigInt(1), storage_key: null },
      { id: BigInt(2), storage_key: null },
    ]);
    // 无 TOS 调用 + 无硬删：byKey 里没有 key，findLiveRefs 也空
    expect(deleteMulti).not.toHaveBeenCalled();
    expect(hardDelete).not.toHaveBeenCalled();
  });

  it("删除成功时物理回收 stale 对象、硬删行并写审计", async () => {
    const keys: string[] = [];
    const deleteMulti = vi.fn(async (storageKeys: string[]) => {
      keys.push(...storageKeys);
    });
    const hardDelete = vi.fn(async () => 1);
    const audit = vi.fn(async () => ({}) as never);
    const svc = mkService({ deleteMany: hardDelete, uploads: { deleteMultiObjects: deleteMulti }, audit });
    await svc.collectBatch([{ id: BigInt(5), storage_key: "k/5" }]);

    expect(keys).toEqual(["k/5"]);
    expect(hardDelete).toHaveBeenCalledWith({ where: { id: { in: [BigInt(5)] } } });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0][0]).toMatchObject({ action: "gc-hard-delete" });
  });

  it("仍被 live 行引用的 key 不删除、不硬删、不写审计", async () => {
    const deleteMulti = vi.fn();
    const hardDelete = vi.fn(async () => 0);
    const audit = vi.fn();
    // findLiveRefs 查询 assets.findMany 返回 live 引用行
    const findMany = vi.fn().mockResolvedValue([
      { storage_key: "k/shared" },
      { storage_key: "k/shared" },
    ]);
    const svc = mkService({ findMany, deleteMany: hardDelete, uploads: { deleteMultiObjects: deleteMulti }, audit });
    await svc.collectBatch([{ id: BigInt(5), storage_key: "k/shared" }]);

    expect(deleteMulti).not.toHaveBeenCalled();
    expect(hardDelete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("TOS 未配置时整轮抛错（不静默空转）", async () => {
    const svc = mkService({ uploads: null });
    await expect(
      svc.collectBatch([{ id: BigInt(5), storage_key: "k/5" }]),
    ).rejects.toThrow("对象存储未配置");
  });

  it("共享 storage_key 的多行归并到同一批删除", async () => {
    const keys: string[] = [];
    const deleteMulti = vi.fn(async (storageKeys: string[]) => {
      keys.push(...storageKeys);
    });
    const hardDelete = vi.fn(async () => 2);
    const svc = mkService({ deleteMany: hardDelete, uploads: { deleteMultiObjects: deleteMulti } });
    await svc.collectBatch([
      { id: BigInt(1), storage_key: "k/same" },
      { id: BigInt(2), storage_key: "k/same" },
    ]);
    expect(keys).toEqual(["k/same"]);
    expect(hardDelete).toHaveBeenCalledWith({ where: { id: { in: [BigInt(1), BigInt(2)] } } });
  });

  it("删除对象失败时行保留、不硬删、不写审计", async () => {
    const deleteMulti = vi.fn(async () => {
      throw new Error("TOS batch delete partial failure");
    });
    const hardDelete = vi.fn();
    const audit = vi.fn();
    const svc = mkService({ deleteMany: hardDelete, uploads: { deleteMultiObjects: deleteMulti }, audit });
    await svc.collectBatch([{ id: BigInt(5), storage_key: "k/5" }]);
    expect(hardDelete).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
