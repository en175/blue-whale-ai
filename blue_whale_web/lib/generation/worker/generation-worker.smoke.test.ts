/**
 * 端到端 live smoke：真调 ARK + 真 DB，跑通「插 job → worker 出图 → 建素材 → succeeded」。
 * 默认跳过；手动跑须显式带 RUN_LIVE_SMOKE=1 + DATABASE_URL + VOLC_ARK_*：
 *   RUN_LIVE_SMOKE=1 pnpm --filter blue_whale exec vitest run lib/generation/worker/generation-worker.smoke.test.ts
 * 跑一次会真出一张图（花 ARK 额度）+ 写一条 job/asset 到 blue_whale 库。
 */
import { describe, expect, it } from "vitest";

import { getPrismaClient, createWorkerRepo } from "@blue-whale/persistence";

import { createArkImageProvider } from "./ark-image-provider";
import { processNextJob } from "./generation-worker";

describe.skipIf(process.env.RUN_LIVE_SMOKE !== "1")("generation worker live smoke", () => {
  it("queued image job → 真出图 → succeeded + 产出 asset", async () => {
    const prisma = getPrismaClient(process.env.DATABASE_URL!);
    const repo = createWorkerRepo(prisma);

    const job = await prisma.generation_jobs.create({
      data: {
        project_id: BigInt(53),
        user_id: BigInt(13),
        type: "image",
        source: "bottom_dock",
        status: "queued",
        progress: 0,
        input: {
          prompt: "一只柴犬，阳光草地，高清摄影",
          model_id: "doubao-seedream-4-0-250828",
          size: "1k",
          web_search: false,
        },
        expected_output_count: 1,
        next_action_at: new Date(),
        action_identity: `smoke-${Date.now()}`,
        strategy_version: "image-sync-v1",
        fencing_token: 0,
      },
    });

    const id = await processNextJob({
      repo,
      provider: createArkImageProvider(),
      workerId: "smoke",
    });
    expect(id).toBe(job.id.toString());

    const after = await prisma.generation_jobs.findUnique({ where: { id: job.id } });
    console.log("smoke result:", {
      status: after?.status,
      output_asset_ids: after?.output_asset_ids,
      error: after?.error,
    });
    expect(after?.status).toBe("succeeded");

    const aids = (after?.output_asset_ids as number[] | null) ?? [];
    expect(aids.length).toBeGreaterThan(0);
    const assets = await prisma.assets.findMany({ where: { id: { in: aids.map((x) => BigInt(x)) } } });
    for (const a of assets) {
      console.log("smoke asset:", a.id.toString(), a.type, String(a.url).slice(0, 90), `${a.width}x${a.height}`);
    }
    expect(assets.length).toBeGreaterThan(0);
    expect(assets[0].url).toMatch(/^https?:\/\//);

    await prisma.$disconnect();
  }, 120_000);
});
