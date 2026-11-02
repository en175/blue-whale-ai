import "reflect-metadata";
import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { createPool, type Pool } from "mariadb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanvasApiModule } from "./canvases.module.js";
import { CanvasesController } from "./canvases.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { buildPoolConfig } from "@lib/shared/persistence/db.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

describe.skipIf(!process.env.IKNCL3_DATABASE_URL)("本地恢复画布公开 API", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let sourceId = "";
  let fixtureSql: Pool;
  const previousDatabase = process.env.DATABASE_URL;
  const payload = {
    name: "恢复画布",
    viewport: JSON.stringify({ x: 10, y: 20, zoom: 1 }),
    nodes: JSON.stringify([{ id: "text-restored", type: "textNode", position: { x: 13, y: 37 }, data: { title: "保留名称", text: "保留未提交正文" } }]),
    edges: "[]",
  };

  async function start() {
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    class FixtureModule {}
    Global()(FixtureModule);
    Module({ providers: [
      { provide: CanvasService, useValue: new CanvasService(prisma, projects) },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
    ], exports: [CanvasService, ProjectService, PrismaService, SnapshotService] })(FixtureModule);
    class HarnessModule {}
    Module({ imports: [FixtureModule, CanvasApiModule], controllers: [ProjectsController] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.use(json({ limit: "8mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers["x-test-user"] ?? "983003" };
      next();
    });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKNCL3_DATABASE_URL;
    const databaseUrl = process.env.IKNCL3_DATABASE_URL!;
    expect(new URL(databaseUrl).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    expect(new URL(databaseUrl).pathname).toMatch(/^\/bw_gate_ikncl3(?:_|$)/);
    fixtureSql = createPool(buildPoolConfig(databaseUrl));
    sourceId = (await projects.create("983003", "原画布" )).id;
    await start();
    await fetch(`${base}/api/canvases/${sourceId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' }, body: JSON.stringify({ nodes: JSON.stringify([{ id: "source-text", type: "textNode", data: { text: "原画布不改" } }]), edges: "[]" }) });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.client.$disconnect();
    await fixtureSql?.end();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  });

  async function request(method: string, operationId: string, body?: unknown, user = "983003", source = sourceId) {
    return fetch(`${base}/api/canvases/${source}/local-recoveries/${operationId}`, {
      method, headers: { "content-type": "application/json", "x-test-user": user },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("保存并重新读取独立画布，原画布仍保留原正文", async () => {
    const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000001", payload);
    expect(response.status).toBe(200);
    const envelope = await response.json();
    expect(envelope.data.stage).toBe("complete");
    expect(envelope.data.targetProjectId).not.toBe(sourceId);
    const target = await (await fetch(`${base}/api/canvases?projectId=${envelope.data.targetProjectId}`)).json();
    expect(JSON.parse(target.data.nodes)).toEqual(JSON.parse(payload.nodes));
    const source = await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json();
    expect(JSON.parse(source.data.nodes)[0].data.text).toBe("原画布不改");
  });

  it("拒绝失效备用视频且不创建目标或触发任务计费", async () => {
    const before = await (await fetch(`${base}/api/projects`)).json();
    const jobs = await prisma.client.generation_jobs.count();
    const reservations = await prisma.client.billing_cost_reservations.count();
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "video", url: `https://assets.invalid/main-${sourceId}.mp4` } });
    const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000012", {
      ...payload, nodes: JSON.stringify([{ id: "video-fallback", type: "mediaNode", data: { assetId: asset.id.toString(), mediaType: "video", src: asset.url, srcH264: "blob:expired-fallback" } }]),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).data).toEqual({ reason: "local_recovery_assets_unavailable", missing: [{ path: "nodes.0.data.srcH264" }] });
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length);
    expect(await prisma.client.generation_jobs.count()).toBe(jobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(reservations);
  });

  it("逐项拒绝工具来源与遮罩缺项且不创建部分目标", async () => {
    const before = await (await fetch(`${base}/api/projects`)).json();
    const variants = [
      { videoEnhance: { sourceAssetId: "999999999", lastParams: { resolution: "4k" } } },
      { mediaExtract: { lastInput: { source_asset_id: "999999999", output_format: "mp3" } } },
      { imageErase: { lastInput: { mask_asset_id: "999999999" } } },
      { audioVideoMux: { sourceAssetId: "999999999", sourceNodeId: "audio-source", reserveAudio: true, sync: "none" } },
    ];
    for (const variant of variants) {
      const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000013", {
        ...payload, nodes: JSON.stringify([{ id: "tool-draft", type: "mediaNode", data: { draft: true, genStatus: "draft", ...variant } }]),
      });
      expect(response.status).toBe(422);
      const error = await response.json();
      expect(error.data.reason).toBe("local_recovery_assets_unavailable");
      expect(error.data.missing).toEqual([expect.objectContaining({ assetId: "999999999" })]);
    }
    expect((await request("GET", "04e0b9cc-04dd-45ad-930b-3c0000000013")).status).toBe(404);
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length);
  });

  it("保留合法备用视频、各工具来源和正文链接，关联后重读并逐项复核权限", async () => {
    const assets = await Promise.all(["image", "video", "audio", "image", "video"].map((type, i) => prisma.client.user_assets.create({ data: {
      user_id: 983003n, project_id: BigInt(sourceId), type, url: `https://assets.invalid/control-${sourceId}-${i}?download=1&token=fixture`,
    } })));
    const [image, video, audio, mask, fallback] = assets;
    const tools = [
      { imageEnhance: { sourceAssetId: image.id.toString(), lastParams: { source_asset_id: image.id.toString(), scale: 2 } } },
      { imageOutpaint: { sourceAssetId: image.id.toString(), lastParams: { source_asset_id: image.id.toString() } } },
      { imageCrop: { sourceAssetId: image.id.toString() } },
      { imageCutout: { sourceAssetId: image.id.toString(), lastInput: { source_asset_id: image.id.toString() } } },
      { imageErase: { sourceAssetId: image.id.toString(), lastInput: { source_asset_id: image.id.toString(), mask_asset_id: mask.id.toString() } } },
      { videoEnhance: { sourceAssetId: video.id.toString(), lastParams: { resolution: "4k" } } },
      { mediaExtract: { sourceAssetId: video.id.toString(), lastInput: { source_asset_id: video.id.toString(), output_format: "mp3" } } },
      { sceneSplit: { sourceAssetId: video.id.toString(), lastInput: { source_asset_id: video.id.toString(), granularity: "coarse" } } },
      { smartMatting: { sourceAssetId: video.id.toString(), lastInput: { source_asset_id: video.id.toString() } } },
      { videoSubtitleErase: { sourceAssetId: video.id.toString(), lastInput: { source_asset_id: video.id.toString() } } },
      { audioTrim: { sourceAssetId: audio.id.toString(), lastInput: { source_asset_id: audio.id.toString(), output_format: "mp3" } } },
      { audioSpeed: { sourceAssetId: audio.id.toString(), lastInput: { source_asset_id: audio.id.toString(), speed: 1.2 } } },
      { vocalSplit: { sourceAssetId: audio.id.toString(), lastInput: { source_asset_id: audio.id.toString(), scene: "vocal", output_format: "mp3" } } },
      { audioVideoMux: { sourceAssetId: audio.id.toString(), sourceNodeId: "source-audio", reserveAudio: true, sync: "none", video: { assetId: video.id.toString(), src: video.url, name: "绑定视频" } } },
    ];
    const nodes = [
      { id: "control-video", type: "mediaNode", data: { assetId: video.id.toString(), src: video.url, srcH264: fallback.url, mediaType: "video" } },
      ...tools.map((tool, i) => ({ id: `tool-${i}`, type: "mediaNode", data: { draft: true, genStatus: "draft", ...tool } })),
      { id: "control-text", type: "textNode", data: { text: "参考 https://example.com/help?assetId=999999999", html: '<a href="https://example.com/help">普通链接</a>' } },
      { id: "control-product", type: "productNode", data: { images: [{ id: "gallery-image", src: image.url, assetId: image.id.toString(), enabled: true }] } },
      { id: "control-reference", type: "assetNode", data: { initialRefs: [{ id: "gallery-video", src: video.url, assetId: video.id.toString(), type: "video" }], voice: { name: "音色", src: audio.url } } },
    ];
    const body = { ...payload, nodes: JSON.stringify(nodes) };
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000014";
    const beforeJobs = await prisma.client.generation_jobs.count();
    const beforeReservations = await prisma.client.billing_cost_reservations.count();
    const response = await request("PUT", id, body);
    expect(response.status).toBe(200);
    const complete = await response.json();
    expect(complete.data.stage).toBe("complete");
    const snapshot = await (await fetch(`${base}/api/projects/${complete.data.targetProjectId}/snapshot`)).json();
    expect(JSON.parse(snapshot.data.canvas.nodes)).toEqual(nodes);
    for (const asset of assets) expect(snapshot.data.assets[asset.id.toString()].access_url).toBe(asset.url);
    for (const asset of assets) {
      await prisma.client.user_assets.update({ where: { id: asset.id }, data: { user_id: 983004n } });
      try {
        const revoked = await request("GET", id);
        expect(revoked.status).toBe(422);
        const error = await revoked.json();
        expect(error.data.reason).toBe("local_recovery_assets_unavailable");
        expect(JSON.stringify(error)).not.toContain(asset.url);
        expect((await request("PUT", id, body)).status).toBe(422);
      } finally {
        await prisma.client.user_assets.update({ where: { id: asset.id }, data: { user_id: 983003n } });
      }
    }
    expect((await (await request("GET", id)).json()).data.stage).toBe("complete");
    expect(await prisma.client.generation_jobs.count()).toBe(beforeJobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(beforeReservations);
  });

  it("角色库原身份恢复后保留全文、关联资产并可幂等重读", async () => {
    const materialId = `asset-recovery-${sourceId}`;
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url: `https://assets.invalid/material-${sourceId}.png`, material_id: materialId } });
    await prisma.client.user_material_info.create({ data: { material_id: materialId, user_id: 983003n, material_group_id: `group-recovery-${sourceId}`, status: "Active" } });
    const nodes = [{ id: "role-card", type: "assetNode", position: { x: 10, y: 20 }, data: { kind: "custom", initialRefs: [{ id: "role-reference", src: asset.url, type: "image", assetId: materialId }] } }];
    const body = { ...payload, nodes: JSON.stringify(nodes) };
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000015";
    const beforeJobs = await prisma.client.generation_jobs.count();
    const beforeReservations = await prisma.client.billing_cost_reservations.count();
    const response = await request("PUT", id, body);
    expect(response.status).toBe(200);
    const complete = await response.json();
    expect(complete.data.stage).toBe("complete");
    const snapshot = await (await fetch(`${base}/api/projects/${complete.data.targetProjectId}/snapshot`)).json();
    expect(JSON.parse(snapshot.data.canvas.nodes)).toEqual(nodes);
    expect(snapshot.data.assets[asset.id.toString()].access_url).toBe(asset.url);
    await app.close();
    await start();
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    expect((await (await request("PUT", id, body)).json()).data).toEqual(complete.data);
    const numericBody = { ...body, nodes: JSON.stringify([{ ...nodes[0], data: { ...nodes[0].data, initialRefs: [{ ...nodes[0].data.initialRefs[0], assetId: asset.id.toString() }] } }]) };
    expect((await request("PUT", id, numericBody)).status).toBe(409);
    expect(await prisma.client.generation_jobs.count()).toBe(beforeJobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(beforeReservations);
  });

  it("角色库未知、他人、失效或变更映射在恢复与回读时明确缺项", async () => {
    const materialId = `asset-20261019-${sourceId}-A_1`;
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url: `https://assets.invalid/material-state-${sourceId}.png`, material_id: materialId } });
    const material = { material_id: materialId, user_id: 983003n, material_group_id: `group-state-${sourceId}`, status: "Active" };
    await prisma.client.user_material_info.create({ data: material });
    const nodes = [{ id: "role-state", type: "assetNode", data: { initialRefs: [{ id: "role-state-ref", src: asset.url, type: "image", assetId: materialId }] } }];
    const body = { ...payload, nodes: JSON.stringify(nodes) };
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000016";
    const first = await request("PUT", id, body);
    expect(first.status).toBe(200);
    const complete = await first.json();
    const before = await (await fetch(`${base}/api/projects`)).json();
    const beforeJobs = await prisma.client.generation_jobs.count();
    const beforeReservations = await prisma.client.billing_cost_reservations.count();
    const cases = [
      async () => { await prisma.client.user_material_info.update({ where: { material_id: materialId }, data: { user_id: 983004n } }); },
      async () => { await prisma.client.user_material_info.update({ where: { material_id: materialId }, data: { status: "Processing" } }); },
      async () => { await prisma.client.user_material_info.update({ where: { material_id: materialId }, data: { status: "Failed" } }); },
      async () => { await prisma.client.user_material_info.delete({ where: { material_id: materialId } }); },
      async () => { await prisma.client.user_assets.update({ where: { id: asset.id }, data: { user_id: 983004n } }); },
      async () => { await prisma.client.user_assets.update({ where: { id: asset.id }, data: { is_delete: true } }); },
      async () => { await prisma.client.user_assets.update({ where: { id: asset.id }, data: { status: "disabled" } }); },
      async () => { await prisma.client.user_assets.update({ where: { id: asset.id }, data: { material_id: null } }); },
      async () => { await prisma.client.user_assets.update({ where: { id: asset.id }, data: { url: `https://foreign.invalid/private-${sourceId}.png` } }); },
      async () => { await prisma.client.user_assets.update({ where: { id: asset.id }, data: { type: "video" } }); },
    ];
    for (const mutate of cases) {
      await mutate();
      try {
        for (const response of [await request("GET", id), await request("PUT", id, body), await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000017", body)]) {
          expect(response.status).toBe(422);
          const error = await response.json();
          expect(error.data.reason).toBe("local_recovery_assets_unavailable");
          expect(error.data.missing).toEqual([{ path: "nodes.0.data.initialRefs.0", assetId: materialId }]);
          expect(JSON.stringify(error)).not.toContain("https://");
        }
      } finally {
        await prisma.client.user_assets.update({ where: { id: asset.id }, data: { user_id: 983003n, is_delete: false, status: "normal", material_id: materialId, url: asset.url, type: "image" } });
        await prisma.client.user_material_info.upsert({ where: { material_id: materialId }, create: material, update: { user_id: 983003n, status: "Active" } });
      }
      expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    }
    const unknown = { ...body, nodes: JSON.stringify([{ ...nodes[0], data: { initialRefs: [{ ...nodes[0].data.initialRefs[0], assetId: "asset-unknown-recovery" }] } }]) };
    expect((await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000017", unknown)).status).toBe(422);
    await prisma.client.user_assets.update({ where: { id: asset.id }, data: { material_id: null } });
    const replacement = await prisma.client.user_assets.create({ data: { user_id: 983003n, type: "image", url: asset.url, material_id: materialId } });
    try {
      expect((await request("GET", id)).status).toBe(422);
      expect((await request("PUT", id, body)).status).toBe(422);
    } finally {
      await prisma.client.user_assets.update({ where: { id: replacement.id }, data: { material_id: null } });
      await prisma.client.user_assets.update({ where: { id: asset.id }, data: { material_id: materialId } });
    }
    expect((await request("GET", "04e0b9cc-04dd-45ad-930b-3c0000000017")).status).toBe(404);
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length);
    expect(await prisma.client.generation_jobs.count()).toBe(beforeJobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(beforeReservations);
  });

  it("素材缺失时列出缺项且不创建部分恢复项目", async () => {
    const before = await (await fetch(`${base}/api/projects`)).json();
    const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000002", {
      ...payload,
      nodes: JSON.stringify([{ id: "missing-media", type: "mediaNode", data: { assetId: "999999999", mediaType: "image", src: "https://unavailable.invalid/missing.png" } }]),
    });
    expect(response.status).toBe(422);
    const error = await response.json();
    expect(error.data.reason).toBe("local_recovery_assets_unavailable");
    expect(error.data.missing).toEqual([{ path: "nodes.0.data", assetId: "999999999" }]);
    const after = await (await fetch(`${base}/api/projects`)).json();
    expect(after.data).toHaveLength(before.data.length);
  });

  it("拒绝旧任务执行身份，不创建项目或触发任务副作用", async () => {
    const before = await (await fetch(`${base}/api/projects`)).json();
    const jobsBefore = await prisma.client.generation_jobs.count();
    const reservationsBefore = await prisma.client.billing_cost_reservations.count();
    for (const data of [
      { jobId: 123 },
      { generationRecovery: { submissionId: "old-submission" } },
      { frameInterpolation: { status: "generating" } },
      { genStatus: "checking" },
    ]) {
      const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000003", {
        ...payload, nodes: JSON.stringify([{ id: "new-node", type: "mediaNode", data }]),
      });
      expect(response.status).toBe(422);
      expect((await response.json()).data.reason).toBe("local_recovery_executable_identity");
    }
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length);
    expect(await prisma.client.generation_jobs.count()).toBe(jobsBefore);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(reservationsBefore);
  });

  it("并发重复调用与服务重建只对应一个目标，拒绝同身份更换内容及其他账号", async () => {
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000004";
    const before = await (await fetch(`${base}/api/projects`)).json();
    const responses = await Promise.all(Array.from({ length: 5 }, () => request("PUT", id, payload)));
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200]);
    const results = await Promise.all(responses.map(response => response.json()));
    expect(new Set(results.map(result => result.data.targetProjectId)).size).toBe(1);
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length + 1);
    await app.close();
    await start();
    const recovered = await request("GET", id);
    expect((await recovered.json()).data).toEqual(results[0].data);
    expect((await request("PUT", id, { ...payload, name: "更换内容" })).status).toBe(409);
    expect((await request("GET", id, undefined, "983004")).status).toBe(404);
    expect((await request("PUT", id, payload, "983004")).status).toBe(404);
  });

  it("创建后保存中断可查询 created，重建服务后继续同一目标", async () => {
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000005";
    await fixtureSql.query("CREATE TRIGGER ikncl3_fail_canvas BEFORE INSERT ON canvas FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated save interruption'");
    let targetId = "";
    try {
      expect((await request("PUT", id, payload)).status).toBe(500);
      const partial = await (await request("GET", id)).json();
      expect(partial.data.stage).toBe("created");
      expect(partial.data.version).toBeNull();
      targetId = partial.data.targetProjectId;
    } finally {
      await fixtureSql.query("DROP TRIGGER ikncl3_fail_canvas");
    }
    await app.close();
    await start();
    const resumed = await (await request("PUT", id, payload)).json();
    expect(resumed.data).toMatchObject({ stage: "complete", targetProjectId: targetId });
  });

  it("保存成功但回执写入中断，重建服务后从持久画布确认完成", async () => {
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000006";
    await fixtureSql.query("CREATE TRIGGER ikncl3_fail_receipt BEFORE UPDATE ON project_command_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated receipt interruption'");
    try {
      expect((await request("PUT", id, payload)).status).toBe(500);
    } finally {
      await fixtureSql.query("DROP TRIGGER ikncl3_fail_receipt");
    }
    await app.close();
    await start();
    const confirmed = await (await request("GET", id)).json();
    expect(confirmed.data).toMatchObject({ stage: "complete", version: 0 });
    const before = await (await fetch(`${base}/api/projects`)).json();
    const replay = await (await request("PUT", id, payload)).json();
    expect(replay.data).toEqual(confirmed.data);
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length);
  });

  it("目标在未确认完成前被其他会话编辑时，查询与续作均拒绝覆盖", async () => {
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000007";
    const name = `中断目标 ${sourceId}`;
    await fixtureSql.query("CREATE TRIGGER ikncl3_fail_receipt BEFORE UPDATE ON project_command_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated receipt interruption'");
    try {
      expect((await request("PUT", id, { ...payload, name })).status).toBe(500);
    } finally {
      await fixtureSql.query("DROP TRIGGER ikncl3_fail_receipt");
    }
    const listed = await (await fetch(`${base}/api/projects`)).json();
    const targetId = listed.data.find((project: { name: string }) => project.name === name).id;
    const changed = { nodes: JSON.stringify([{ id: "other", type: "textNode", data: { text: "另一会话新修改" } }]), edges: "[]" };
    expect((await fetch(`${base}/api/canvases/${targetId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": '"0"' }, body: JSON.stringify(changed) })).status).toBe(200);
    expect((await request("GET", id)).status).toBe(409);
    expect((await request("PUT", id, { ...payload, name })).status).toBe(409);
    const target = await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json();
    expect(JSON.parse(target.data.nodes)).toEqual(JSON.parse(changed.nodes));
    expect(target.data.version).toBe(1);
  });

  it("同账号跨项目作品合法关联，删除或撤权后查询不再报告完整恢复", async () => {
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000008";
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url: `https://assets.invalid/${sourceId}.png` } });
    const nodes = [{ id: "restored-media", type: "mediaNode", position: { x: 14, y: 18 }, data: {
      assetId: asset.id.toString(), mediaType: "image", src: asset.url,
      localRecoveryProvenance: { sourceProjectId: sourceId, sourceNodeId: "source-result", sourceJobId: "123" },
    } }];
    const body = { ...payload, nodes: JSON.stringify(nodes) };
    const response = await request("PUT", id, body);
    expect(response.status).toBe(200);
    const complete = await response.json();
    const targetId = complete.data.targetProjectId;
    const snapshot = await (await fetch(`${base}/api/projects/${targetId}/snapshot`)).json();
    expect(snapshot.data.assets[asset.id.toString()].access_url).toBe(asset.url);
    expect(JSON.parse(snapshot.data.canvas.nodes)[0].data.localRecoveryProvenance).toEqual(nodes[0].data.localRecoveryProvenance);
    await prisma.client.user_assets.update({ where: { id: asset.id }, data: { user_id: 983004n } });
    try {
      expect((await request("GET", id)).status).toBe(422);
      expect((await request("PUT", id, body)).status).toBe(422);
    } finally {
      await prisma.client.user_assets.update({ where: { id: asset.id }, data: { user_id: 983003n } });
    }
    await prisma.client.user_assets.update({ where: { id: asset.id }, data: { is_delete: true } });
    try {
      expect((await request("GET", id)).status).toBe(422);
    } finally {
      await prisma.client.user_assets.update({ where: { id: asset.id }, data: { is_delete: false } });
    }
    await prisma.client.project.update({ where: { id: BigInt(sourceId) }, data: { owner_id: 983004n } });
    try {
      expect((await request("GET", id)).status).toBe(404);
    } finally {
      await prisma.client.project.update({ where: { id: BigInt(sourceId) }, data: { owner_id: 983003n } });
    }
    await prisma.client.project.update({ where: { id: BigInt(targetId) }, data: { owner_id: 983004n } });
    try {
      expect((await request("GET", id)).status).toBe(404);
    } finally {
      await prisma.client.project.update({ where: { id: BigInt(targetId) }, data: { owner_id: 983003n } });
    }
    expect((await (await request("GET", id)).json()).data.stage).toBe("complete");
  });

  it("一年后的恢复身份仍能查询同一目标，完成后重试也不覆盖目标新修改", async () => {
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000009";
    const complete = await (await request("PUT", id, payload)).json();
    const targetId = complete.data.targetProjectId;
    await prisma.client.project_command_receipts.updateMany({ where: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id }, data: { gmt_create: new Date("2025-01-01T00:00:00Z"), gmt_modified: new Date("2025-01-01T00:00:00Z") } });
    await app.close();
    await start();
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    const changed = { nodes: JSON.stringify([{ id: "new-edit", type: "textNode", data: { text: "恢复后新增正文" } }]), edges: "[]" };
    await fetch(`${base}/api/canvases/${targetId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": '"0"' }, body: JSON.stringify(changed) });
    expect((await (await request("PUT", id, payload)).json()).data).toEqual(complete.data);
    const current = await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json();
    expect(JSON.parse(current.data.nodes)).toEqual(JSON.parse(changed.nodes));
    expect(current.data.version).toBe(1);
  });

  it("不允许借合法 src 掩盖未授权的 url 别名", async () => {
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url: `https://assets.invalid/alias-${sourceId}.png` } });
    const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000010", {
      ...payload, nodes: JSON.stringify([{ id: "alias-media", type: "mediaNode", data: { assetId: asset.id.toString(), mediaType: "image", src: asset.url, url: "https://other-account.invalid/private.png" } }]),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).data.reason).toBe("local_recovery_assets_unavailable");
  });

  it("拒绝临时文件地址、他人素材、非法来源说明及方案受保护身份", async () => {
    const foreign = await prisma.client.user_assets.create({ data: { user_id: 983004n, type: "image", url: `https://assets.invalid/foreign-${sourceId}.png` } });
    const variants = [
      { data: { src: "blob:expired-object-url" }, reason: "local_recovery_assets_unavailable" },
      { data: { assetId: foreign.id.toString(), src: foreign.url }, reason: "local_recovery_assets_unavailable" },
      { data: { promptSource: { sessionId: "original-session", revisionId: "original-revision", shotNo: 1 } }, reason: "local_recovery_protected_provenance" },
      { data: { localRecoveryProvenance: { sourceProjectId: sourceId, sourceNodeId: "old", jobId: 123 } }, reason: "local_recovery_executable_identity" },
    ];
    for (const variant of variants) {
      const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000011", {
        ...payload, nodes: JSON.stringify([{ id: "independent-node", type: "mediaNode", data: variant.data }]),
      });
      expect(response.status).toBe(422);
      const error = await response.json();
      expect(error.data.reason).toBe(variant.reason);
      expect(JSON.stringify(error)).not.toContain(foreign.url);
    }
    expect((await request("GET", "04e0b9cc-04dd-45ad-930b-3c0000000011")).status).toBe(404);
  });

  it.each([
    { field: "src", mediaType: "image" },
    { field: "src", mediaType: "video" },
    { field: "src", mediaType: "audio" },
    { field: "srcH264", mediaType: "video" },
    { field: "voice.src", mediaType: "audio" },
  ].flatMap(item => ["image", "video", "audio"].filter(type => type !== item.mediaType).flatMap(otherType =>
    [false, true].map(matchingLast => ({ ...item, otherType, matchingLast })),
  )))("首次恢复按 $field 的 $mediaType 类型选择同 URL 资产，另一类型=$otherType，匹配资产后创建=$matchingLast", async ({ field, mediaType, otherType, matchingLast }) => {
    const url = `https://assets.invalid/first-type-${crypto.randomUUID()}`;
    const types = matchingLast ? [otherType, mediaType] : [mediaType, otherType];
    const first = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: types[0]!, url } });
    const second = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: types[1]!, url } });
    const original = matchingLast ? second : first;
    let data: Record<string, unknown> = { src: url, mediaType };
    const expectedIds = [original.id.toString()];
    if (field === "srcH264") {
      const main = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "video", url: `${url}-main` } });
      data = { assetId: main.id.toString(), src: main.url, srcH264: url, mediaType };
      expectedIds.push(main.id.toString());
    } else if (field === "voice.src") {
      data = { voice: { name: "音色", src: url, type: mediaType } };
    }
    const nodes = [{ id: "first-type", type: field === "voice.src" ? "assetNode" : "mediaNode", data }];
    const body = { ...payload, nodes: JSON.stringify(nodes) };
    const id = crypto.randomUUID();
    const before = await (await fetch(`${base}/api/projects`)).json();
    const sourceBefore = await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json();
    const jobs = await prisma.client.generation_jobs.count();
    const reservations = await prisma.client.billing_cost_reservations.count();
    const response = await request("PUT", id, body);
    expect(response.status).toBe(200);
    const complete = await response.json();
    expect(complete.data.stage).toBe("complete");
    const targetId = complete.data.targetProjectId;
    const links = await prisma.client.project_asset.findMany({ where: { project_id: BigInt(targetId), is_delete: 0 }, select: { asset_id: true } });
    expect(links.map(link => link.asset_id.toString()).sort()).toEqual(expectedIds.sort());
    const key = { project_id_operation_idempotency_key: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } };
    const row = await prisma.client.project_command_receipts.findUnique({ where: key });
    expect(row!.result_payload).toMatchObject({ assets: expect.arrayContaining([{
      path: field === "srcH264" ? "nodes.0.data.srcH264" : field === "voice.src" ? "nodes.0.data.voice" : "nodes.0.data",
      url, mediaType, resolvedAssetId: original.id.toString(),
    }]) });
    const substitute = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: mediaType, url } });
    await app.close();
    await start();
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    expect((await (await request("PUT", id, body)).json()).data).toEqual(complete.data);
    expect((await request("PUT", id, { ...body, name: "更换请求" })).status).toBe(409);
    const snapshot = await (await fetch(`${base}/api/projects/${targetId}/snapshot`)).json();
    expect(JSON.parse(snapshot.data.canvas.nodes)).toEqual(nodes);
    expect(snapshot.data.assets[original.id.toString()].access_url).toBe(url);
    expect(snapshot.data.assets[substitute.id.toString()]).toBeUndefined();
    expect(await prisma.client.project_command_receipts.findUnique({ where: key })).toEqual(row);
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length + 1);
    expect(await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json()).toEqual(sourceBefore);
    expect(await prisma.client.generation_jobs.count()).toBe(jobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(reservations);
  });

  it.each([false, true])("首次恢复对同 URL 的不同类型引用分别固定资产，逆序创建=%s", async reverse => {
    const url = `https://assets.invalid/first-multi-${crypto.randomUUID()}`;
    const types = reverse ? ["audio", "video", "image"] : ["image", "video", "audio"];
    const assets = [];
    for (const type of types) assets.push(await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type, url } }));
    const nodes = ["image", "video", "audio"].map(mediaType => ({ id: `first-${mediaType}`, type: "mediaNode", data: { src: url, mediaType } }));
    const body = { ...payload, nodes: JSON.stringify(nodes) };
    const id = crypto.randomUUID();
    const response = await request("PUT", id, body);
    expect(response.status).toBe(200);
    const complete = await response.json();
    const targetId = complete.data.targetProjectId;
    const links = await prisma.client.project_asset.findMany({ where: { project_id: BigInt(targetId), is_delete: 0 }, select: { asset_id: true } });
    expect(links.map(link => link.asset_id.toString()).sort()).toEqual(assets.map(asset => asset.id.toString()).sort());
    const row = await prisma.client.project_command_receipts.findFirst({ where: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } });
    expect(row!.result_payload).toMatchObject({ assets: nodes.map((node, index) => ({
      path: `nodes.${index}.data`, url, mediaType: node.data.mediaType,
      resolvedAssetId: assets.find(asset => asset.type === node.data.mediaType)!.id.toString(),
    })) });
    await app.close();
    await start();
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    expect((await (await request("PUT", id, body)).json()).data).toEqual(complete.data);
    const snapshot = await (await fetch(`${base}/api/projects/${targetId}/snapshot`)).json();
    expect(JSON.parse(snapshot.data.canvas.nodes)).toEqual(nodes);
    for (const asset of assets) expect(snapshot.data.assets[asset.id.toString()].access_url).toBe(url);
  });

  it.each([false, true])("首次恢复拒绝同 URL 的类型不匹配，显式数字身份=%s", async explicitId => {
    const url = `https://assets.invalid/first-reject-${crypto.randomUUID()}`;
    const image = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url } });
    if (explicitId) await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "video", url } });
    const id = crypto.randomUUID();
    const before = await prisma.client.project.count();
    const canvases = await prisma.client.project_canvas.count();
    const links = await prisma.client.project_asset.count();
    const jobs = await prisma.client.generation_jobs.count();
    const reservations = await prisma.client.billing_cost_reservations.count();
    const body = { ...payload, nodes: JSON.stringify([{ id: "first-reject", type: "mediaNode", data: { src: url, mediaType: "video", ...(explicitId ? { assetId: image.id.toString() } : {}) } }]) };
    const response = await request("PUT", id, body);
    expect(response.status).toBe(422);
    const error = await response.json();
    expect(error.data).toEqual({ reason: "local_recovery_assets_unavailable", missing: [{ path: "nodes.0.data", ...(explicitId ? { assetId: image.id.toString() } : {}) }] });
    expect(JSON.stringify(error)).not.toContain(url);
    expect((await request("GET", id)).status).toBe(404);
    expect(await prisma.client.project_command_receipts.count({ where: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } })).toBe(0);
    expect(await prisma.client.project.count()).toBe(before);
    expect(await prisma.client.project_canvas.count()).toBe(canvases);
    expect(await prisma.client.project_asset.count()).toBe(links);
    expect(await prisma.client.generation_jobs.count()).toBe(jobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(reservations);
  });

  it("同 URL 的替代素材不能让已失效的仅 URL 引用报告完成", async () => {
    const cases = [
      { suffix: "src", type: "image", path: "nodes.0.data", node: (url: string) => ({ id: "substitute-src", type: "mediaNode", data: { src: url, mediaType: "image" } }) },
      { suffix: "h264", type: "video", path: "nodes.0.data.srcH264", node: (url: string) => ({ id: "substitute-h264", type: "mediaNode", data: { src: `https://assets.invalid/substitute-main-${sourceId}.mp4`, srcH264: url, mediaType: "video" } }) },
      { suffix: "voice", type: "audio", path: "nodes.0.data.voice", node: (url: string) => ({ id: "substitute-voice", type: "assetNode", data: { voice: { name: "音色", src: url } } }) },
    ];
    const before = await (await fetch(`${base}/api/projects`)).json();
    const sourceBefore = await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json();
    const beforeJobs = await prisma.client.generation_jobs.count();
    const beforeReservations = await prisma.client.billing_cost_reservations.count();
    for (const [index, item] of cases.entries()) {
      const url = `https://assets.invalid/substitute-${item.suffix}-${sourceId}.bin`;
      const original = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: item.type, url } });
      if (item.suffix === "h264") await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "video", url: `https://assets.invalid/substitute-main-${sourceId}.mp4` } });
      const body = { ...payload, nodes: JSON.stringify([item.node(url)]) };
      const id = `04e0b9cc-04dd-45ad-930b-3c000000002${index + 1}`;
      const created = await request("PUT", id, body);
      expect(created.status).toBe(200);
      const complete = await created.json();
      expect(complete.data.stage).toBe("complete");
      const targetId = complete.data.targetProjectId;
      const links = await prisma.client.project_asset.findMany({ where: { project_id: BigInt(targetId), is_delete: 0 }, select: { asset_id: true } });
      expect(links.map(link => link.asset_id.toString())).toContain(original.id.toString());
      const substitute = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: item.type, url } });
      await prisma.client.user_assets.update({ where: { id: original.id }, data: { is_delete: true } });
      try {
        for (const response of [await request("GET", id), await request("PUT", id, body)]) {
          expect(response.status).toBe(422);
          const error = await response.json();
          expect(error.data.reason).toBe("local_recovery_assets_unavailable");
          expect(error.data.missing).toEqual([{ path: item.path }]);
          expect(JSON.stringify(error)).not.toContain(url);
        }
        await app.close();
        await start();
        expect((await request("GET", id)).status).toBe(422);
        expect((await request("PUT", id, body)).status).toBe(422);
        expect(await prisma.client.project_asset.count({ where: { project_id: BigInt(targetId), asset_id: substitute.id } })).toBe(0);
        const target = await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json();
        expect(target.data.version).toBe(complete.data.version);
      } finally {
        await prisma.client.user_assets.update({ where: { id: original.id }, data: { is_delete: false } });
      }
    }
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length + cases.length);
    expect(await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json()).toEqual(sourceBefore);
    expect(await prisma.client.generation_jobs.count()).toBe(beforeJobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(beforeReservations);
  });

  it("原资产仍合法时同 URL 的其他素材不误报缺项，数字资产身份仍拒绝替换", async () => {
    const url = `https://assets.invalid/dual-${sourceId}.png`;
    const original = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url } });
    const body = { ...payload, nodes: JSON.stringify([{ id: "dual-url", type: "mediaNode", data: { src: url, mediaType: "image" } }]) };
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000031";
    const created = await request("PUT", id, body);
    expect(created.status).toBe(200);
    const complete = await created.json();
    const numericBody = { ...payload, nodes: JSON.stringify([{ id: "dual-numeric", type: "mediaNode", data: { assetId: original.id.toString(), src: url, mediaType: "image" } }]) };
    const numericId = "04e0b9cc-04dd-45ad-930b-3c0000000032";
    const numeric = await request("PUT", numericId, numericBody);
    expect(numeric.status).toBe(200);
    const numericComplete = await numeric.json();
    for (const [changed, restore] of [[{ url: `https://foreign.invalid/dual-${sourceId}.png` }, { url }], [{ type: "video" }, { type: "image" }]] as const) {
      await prisma.client.user_assets.update({ where: { id: original.id }, data: changed });
      try {
        const response = await request("GET", id);
        expect(response.status).toBe(422);
        const error = await response.json();
        expect(error.data.reason).toBe("local_recovery_assets_unavailable");
        expect(error.data.missing).toEqual([{ path: "nodes.0.data" }]);
      } finally {
        await prisma.client.user_assets.update({ where: { id: original.id }, data: restore });
      }
    }
    const substitute = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url } });
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    expect((await (await request("PUT", id, body)).json()).data).toEqual(complete.data);
    const links = await prisma.client.project_asset.findMany({ where: { project_id: BigInt(complete.data.targetProjectId), is_delete: 0 }, select: { asset_id: true } });
    expect(links.map(link => link.asset_id.toString())).toEqual([original.id.toString()]);
    await prisma.client.user_assets.update({ where: { id: original.id }, data: { is_delete: true } });
    try {
      for (const [requestId, requestBody, requestComplete] of [[id, body, complete], [numericId, numericBody, numericComplete]] as const) {
        for (const response of [await request("GET", requestId), await request("PUT", requestId, requestBody)]) {
          expect(response.status).toBe(422);
          const error = await response.json();
          expect(error.data.reason).toBe("local_recovery_assets_unavailable");
          expect(error.data.missing).toEqual([{ path: "nodes.0.data", ...(requestComplete === complete ? {} : { assetId: original.id.toString() }) }]);
          expect(JSON.stringify(error)).not.toContain(url);
        }
      }
      expect(await prisma.client.project_asset.count({ where: { project_id: BigInt(complete.data.targetProjectId), asset_id: substitute.id } })).toBe(0);
    } finally {
      await prisma.client.user_assets.update({ where: { id: original.id }, data: { is_delete: false } });
    }
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    expect((await (await request("GET", numericId)).json()).data).toEqual(numericComplete.data);
  });

  it("缺少固定资产身份的旧回执只在能证明原关联时继续核验", async () => {
    const url = `https://assets.invalid/legacy-${sourceId}.png`;
    const original = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url } });
    const body = { ...payload, nodes: JSON.stringify([{ id: "legacy-url", type: "mediaNode", data: { src: url, mediaType: "image" } }]) };
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000033";
    const created = await request("PUT", id, body);
    expect(created.status).toBe(200);
    const complete = await created.json();
    const key = { project_id_operation_idempotency_key: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } };
    const row = await prisma.client.project_command_receipts.findUnique({ where: key });
    const receipt = row!.result_payload as { assets: Array<Record<string, unknown>> } & Record<string, unknown>;
    const legacyAssets = receipt.assets.map(asset => { const copy = { ...asset }; delete copy.resolvedAssetId; return copy; });
    await prisma.client.project_command_receipts.update({ where: key, data: { result_payload: { ...receipt, assets: legacyAssets } } });
    const targetId = complete.data.targetProjectId;
    const substitute = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url } });
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
    expect((await (await request("PUT", id, body)).json()).data).toEqual(complete.data);
    await prisma.client.project_asset.deleteMany({ where: { project_id: BigInt(targetId), asset_id: original.id } });
    await app.close();
    await start();
    try {
      for (const response of [await request("GET", id), await request("PUT", id, body)]) {
        expect(response.status).toBe(422);
        const error = await response.json();
        expect(error.data.reason).toBe("local_recovery_assets_unavailable");
        expect(error.data.missing).toEqual([{ path: "nodes.0.data" }]);
        expect(JSON.stringify(error)).not.toContain(url);
      }
    } finally {
      await prisma.client.project_asset.create({ data: { user_id: 983003n, project_id: BigInt(targetId), asset_id: original.id } });
    }
    await prisma.client.user_assets.update({ where: { id: original.id }, data: { is_delete: true } });
    try {
      for (const response of [await request("GET", id), await request("PUT", id, body)]) {
        expect(response.status).toBe(422);
        expect((await response.json()).data.reason).toBe("local_recovery_assets_unavailable");
      }
      expect(await prisma.client.project_asset.count({ where: { project_id: BigInt(targetId), asset_id: substitute.id } })).toBe(0);
    } finally {
      await prisma.client.user_assets.update({ where: { id: original.id }, data: { is_delete: false } });
    }
    const stored = await prisma.client.project_command_receipts.findUnique({ where: key });
    expect((stored!.result_payload as { assets: Array<Record<string, unknown>> }).assets.every(asset => asset.resolvedAssetId === undefined)).toBe(true);
    expect((await (await request("GET", id)).json()).data).toEqual(complete.data);
  });

  it("首次保存中断后出现同 URL 替代素材时，续作仍按原回执身份建立目标关联", async () => {
    const url = `https://assets.invalid/resume-${sourceId}.png`;
    const original = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url } });
    const body = { ...payload, nodes: JSON.stringify([{ id: "resume-url", type: "mediaNode", data: { src: url, mediaType: "image" } }]) };
    const id = "04e0b9cc-04dd-45ad-930b-3c0000000034";
    await fixtureSql.query("CREATE TRIGGER ikotvx_fail_canvas BEFORE INSERT ON canvas FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated save interruption'");
    let targetId = "";
    try {
      expect((await request("PUT", id, body)).status).toBe(500);
      const partial = await (await request("GET", id)).json();
      expect(partial.data.stage).toBe("created");
      targetId = partial.data.targetProjectId;
    } finally {
      await fixtureSql.query("DROP TRIGGER ikotvx_fail_canvas");
    }
    const substitute = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url } });
    const resumed = await request("PUT", id, body);
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).data.stage).toBe("complete");
    const links = await prisma.client.project_asset.findMany({ where: { project_id: BigInt(targetId), is_delete: 0 }, select: { asset_id: true } });
    expect(links.map(link => link.asset_id.toString())).toEqual([original.id.toString()]);
    expect(await prisma.client.project_asset.count({ where: { project_id: BigInt(targetId), asset_id: substitute.id } })).toBe(0);
    const key = { project_id_operation_idempotency_key: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } };
    const row = await prisma.client.project_command_receipts.findUnique({ where: key });
    expect((row!.result_payload as { assets: Array<{ resolvedAssetId?: string }> }).assets[0].resolvedAssetId).toBe(original.id.toString());
    expect((await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json()).data.version).toBe(0);
  });
  it.each([
    { field: "src", interrupted: false },
    { field: "src", interrupted: true },
    { field: "srcH264", interrupted: false },
    { field: "srcH264", interrupted: true },
    { field: "voice.src", interrupted: false },
    { field: "voice.src", interrupted: true },
  ])("同 URL 异类型素材不阻断原 $field 引用重放，保存中断=$interrupted", async ({ field, interrupted }) => {
    const url = `https://assets.invalid/replay-${sourceId}-${field}-${interrupted}`;
    const type = field === "srcH264" ? "video" : field === "voice.src" ? "audio" : "image";
    const original = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type, url } });
    let data: Record<string, unknown> = { src: url, mediaType: type };
    if (field === "srcH264") {
      const main = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "video", url: `${url}-main` } });
      data = { assetId: main.id.toString(), src: main.url, srcH264: url, mediaType: "video" };
    } else if (field === "voice.src") {
      data = { voice: { name: "音色", src: url, type: "audio" } };
    }
    const body = { ...payload, nodes: JSON.stringify([{ id: "replay-original", type: field === "voice.src" ? "assetNode" : "mediaNode", data }]) };
    const id = crypto.randomUUID();
    if (interrupted) await fixtureSql.query("CREATE TRIGGER ikotvx_replay_fail_canvas BEFORE INSERT ON canvas FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated save interruption'");
    try {
      expect((await request("PUT", id, body)).status).toBe(interrupted ? 500 : 200);
    } finally {
      if (interrupted) await fixtureSql.query("DROP TRIGGER ikotvx_replay_fail_canvas");
    }
    const previous = await (await request("GET", id)).json();
    const targetId = previous.data.targetProjectId;
    const before = await (await fetch(`${base}/api/projects`)).json();
    const sourceBefore = await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json();
    const jobs = await prisma.client.generation_jobs.count();
    const reservations = await prisma.client.billing_cost_reservations.count();
    const substitute = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: type === "image" ? "video" : "image", url } });
    await app.close();
    await start();
    const queried = await request("GET", id);
    expect(queried.status).toBe(200);
    expect((await queried.json()).data).toEqual(previous.data);
    const replay = await request("PUT", id, body);
    expect(replay.status).toBe(200);
    const complete = await replay.json();
    expect(complete.data).toMatchObject({ targetProjectId: targetId, stage: "complete", version: 0 });
    expect((await request("PUT", id, { ...body, name: "更换请求" })).status).toBe(409);
    const snapshot = await (await fetch(`${base}/api/projects/${targetId}/snapshot`)).json();
    expect(JSON.parse(snapshot.data.canvas.nodes)).toEqual(JSON.parse(body.nodes));
    expect(snapshot.data.assets[original.id.toString()].access_url).toBe(url);
    expect(snapshot.data.assets[substitute.id.toString()]).toBeUndefined();
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length);
    expect(await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json()).toEqual(sourceBefore);
    expect(await prisma.client.generation_jobs.count()).toBe(jobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(reservations);
  });
  it.each([
    { field: "initialRefs", type: "image", otherType: "video" },
    { field: "initialRefs", type: "video", otherType: "image" },
    { field: "voice", type: "audio", otherType: "video" },
  ].flatMap(item => [false, true].map(matching => ({ ...item, matching }))))("空 mediaType 沿用 $field 的 $type 声明，存在匹配资产=$matching", async ({ field, type, otherType, matching }) => {
    const url = `https://assets.invalid/type-fallback-${crypto.randomUUID()}`;
    const original = matching ? await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type, url } }) : undefined;
    const other = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: otherType, url } });
    const jobs = await prisma.client.generation_jobs.count();
    const reservations = await prisma.client.billing_cost_reservations.count();
    const sourceBefore = await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json();
    for (const empty of [false, true]) {
      const reference = { id: "typed-reference", src: url, type, ...(empty ? { mediaType: "" } : {}) };
      const data = field === "voice" ? { voice: reference } : { initialRefs: [reference] };
      const body = { ...payload, nodes: JSON.stringify([{ id: "typed-card", type: "assetNode", data }]) };
      const id = crypto.randomUUID();
      const before = [await prisma.client.project.count(), await prisma.client.project_command_receipts.count()];
      const response = await request("PUT", id, body);
      expect(response.status).toBe(matching ? 200 : 422);
      const result = await response.json();
      if (!original) {
        expect(result.data).toEqual({ reason: "local_recovery_assets_unavailable", missing: [{ path: field === "voice" ? "nodes.0.data.voice" : "nodes.0.data.initialRefs.0" }] });
        expect((await request("GET", id)).status).toBe(404);
        expect([await prisma.client.project.count(), await prisma.client.project_command_receipts.count()]).toEqual(before);
        continue;
      }
      expect(result.data.stage).toBe("complete");
      const key = { project_id_operation_idempotency_key: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } };
      const row = await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key });
      expect(row.result_payload).toMatchObject({ assets: [{ url, mediaType: type, resolvedAssetId: original.id.toString() }] });
      const snapshot = await (await fetch(`${base}/api/projects/${result.data.targetProjectId}/snapshot`)).json();
      expect(JSON.parse(snapshot.data.canvas.nodes)).toEqual(JSON.parse(body.nodes));
      expect(snapshot.data.assets[original.id.toString()].access_url).toBe(url);
      expect(snapshot.data.assets[other.id.toString()]).toBeUndefined();
      await app.close();
      await start();
      expect((await (await request("GET", id)).json()).data).toEqual(result.data);
      expect((await (await request("PUT", id, body)).json()).data).toEqual(result.data);
      expect(await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key })).toEqual(row);
    }
    expect(await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json()).toEqual(sourceBefore);
    expect(await prisma.client.generation_jobs.count()).toBe(jobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(reservations);
  });
  it.each(["src", "voice.src", "assetId"].flatMap(field =>
    ["invalid", "audio"].map(mediaType => ({ field, mediaType })),
  ).concat({ field: "srcH264", mediaType: "" }))("$field 拒绝非法或不匹配类型 $mediaType，空值不放宽备用视频", async ({ field, mediaType }) => {
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url: `https://assets.invalid/type-rejection-${crypto.randomUUID()}` } });
    const reference = { src: asset.url, mediaType, ...(field === "assetId" ? { assetId: asset.id.toString() } : {}) };
    const data = field === "srcH264" ? { src: asset.url, mediaType: "", srcH264: asset.url } : field === "voice.src" ? { voice: reference } : reference;
    const id = crypto.randomUUID();
    const before = [await prisma.client.project.count(), await prisma.client.project_command_receipts.count(), await prisma.client.generation_jobs.count(), await prisma.client.billing_cost_reservations.count()];
    const response = await request("PUT", id, { ...payload, nodes: JSON.stringify([{ id: "invalid-type", type: "mediaNode", data }]) });
    expect(response.status).toBe(422);
    expect((await response.json()).data).toEqual({ reason: "local_recovery_assets_unavailable", missing: [{ path: field === "srcH264" ? "nodes.0.data.srcH264" : field === "voice.src" ? "nodes.0.data.voice" : "nodes.0.data", ...(field === "assetId" ? { assetId: asset.id.toString() } : {}) }] });
    expect((await request("GET", id)).status).toBe(404);
    expect([await prisma.client.project.count(), await prisma.client.project_command_receipts.count(), await prisma.client.generation_jobs.count(), await prisma.client.billing_cost_reservations.count()]).toEqual(before);
  });
  it.each(["src", "voice.src", "assetId"].flatMap(field =>
    [false, true].flatMap(interrupted => ["", undefined].map(mediaType => ({ field, interrupted, mediaType }))),
  ))("旧回执 $field 缺少首次类型时拒绝补认，保存中断=$interrupted，类型=$mediaType", async ({ field, interrupted, mediaType }) => {
    const url = `https://assets.invalid/legacy-type-${crypto.randomUUID()}`;
    const type = field === "voice.src" ? "audio" : "image";
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type, url } });
    const reference = { src: url, mediaType: "", ...(field === "assetId" ? { assetId: asset.id.toString() } : {}) };
    const data = field === "voice.src" ? { voice: reference } : reference;
    const body = { ...payload, nodes: JSON.stringify([{ id: "legacy-type", type: "mediaNode", data }]) };
    const id = crypto.randomUUID();
    if (interrupted) await fixtureSql.query("CREATE TRIGGER ikp2lc_legacy_fail_canvas BEFORE INSERT ON canvas FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated save interruption'");
    try {
      expect((await request("PUT", id, body)).status).toBe(interrupted ? 500 : 200);
    } finally {
      if (interrupted) await fixtureSql.query("DROP TRIGGER ikp2lc_legacy_fail_canvas");
    }
    const key = { project_id_operation_idempotency_key: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } };
    const row = await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key });
    const receipt = row.result_payload as { assets: Array<Record<string, unknown>> } & Record<string, unknown>;
    const legacy = { ...receipt, assets: receipt.assets.map(ref => {
      const copy = { ...ref };
      if (mediaType === undefined) delete copy.mediaType;
      else copy.mediaType = mediaType;
      return copy;
    }) };
    await prisma.client.project_command_receipts.update({ where: key, data: { result_payload: legacy } });
    const legacyRow = await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key });
    const sourceBefore = await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json();
    const targetBefore = await (await fetch(`${base}/api/canvases?projectId=${row.resource_id}`)).json();
    const before = [await prisma.client.project.count(), await prisma.client.project_command_receipts.count(), await prisma.client.generation_jobs.count(), await prisma.client.billing_cost_reservations.count()];
    await prisma.client.user_assets.update({ where: { id: asset.id }, data: { type: "video" } });
    await app.close();
    await start();
    for (const restored of [false, true]) {
      if (restored) await prisma.client.user_assets.update({ where: { id: asset.id }, data: { type } });
      for (const response of [await request("GET", id), await request("PUT", id, body)]) {
        expect.soft(response.status).toBe(422);
        expect.soft((await response.json()).data).toEqual({ reason: "local_recovery_assets_unavailable", missing: [{ path: field === "voice.src" ? "nodes.0.data.voice" : "nodes.0.data", ...(field === "assetId" ? { assetId: asset.id.toString() } : {}) }] });
      }
    }
    expect(await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key })).toEqual(legacyRow);
    expect(await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json()).toEqual(sourceBefore);
    expect(await (await fetch(`${base}/api/canvases?projectId=${row.resource_id}`)).json()).toEqual(targetBefore);
    expect([await prisma.client.project.count(), await prisma.client.project_command_receipts.count(), await prisma.client.generation_jobs.count(), await prisma.client.billing_cost_reservations.count()]).toEqual(before);
  });
  it.each(["src", "voice.src", "assetId"].flatMap(field =>
    [false, true].flatMap(interrupted => ["empty", "omitted", "explicit"].map(declaration => ({ field, interrupted, declaration }))),
  ))("$field 首次固定实际类型，声明=$declaration，保存中断=$interrupted", async ({ field, interrupted, declaration }) => {
    const url = `https://assets.invalid/original-type-${crypto.randomUUID()}`;
    const type = field === "voice.src" ? "audio" : field === "assetId" ? "video" : "image";
    const asset = await prisma.client.user_assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type, url } });
    const reference = {
      ...(field === "assetId" ? { assetId: asset.id.toString() } : { src: url }),
      ...(declaration === "omitted" ? {} : { mediaType: declaration === "empty" ? "" : type }),
    };
    const data = field === "voice.src" ? { voice: reference } : reference;
    const nodes = [{ id: "original-type", type: field === "voice.src" ? "assetNode" : "mediaNode", data }];
    const body = { ...payload, nodes: JSON.stringify(nodes) };
    const originalBody = JSON.stringify(body);
    const id = crypto.randomUUID();
    const projectsBefore = await prisma.client.project.count();
    const receiptsBefore = await prisma.client.project_command_receipts.count();
    const jobs = await prisma.client.generation_jobs.count();
    const reservations = await prisma.client.billing_cost_reservations.count();
    const sourceBefore = await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json();
    if (interrupted) await fixtureSql.query("CREATE TRIGGER ikp2lc_fail_canvas BEFORE INSERT ON canvas FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated save interruption'");
    try {
      expect((await request("PUT", id, body)).status).toBe(interrupted ? 500 : 200);
    } finally {
      if (interrupted) await fixtureSql.query("DROP TRIGGER ikp2lc_fail_canvas");
    }
    const previous = await (await request("GET", id)).json();
    expect(previous.data.stage).toBe(interrupted ? "created" : "complete");
    const targetId = previous.data.targetProjectId;
    const key = { project_id_operation_idempotency_key: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id } };
    const receipt = await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key });
    expect(receipt.result_payload).toMatchObject({ assets: [{ mediaType: type, ...(field === "assetId" ? { assetId: asset.id.toString() } : { resolvedAssetId: asset.id.toString() }) }] });
    const targetBefore = await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json();
    await prisma.client.user_assets.update({ where: { id: asset.id }, data: { type: type === "image" ? "video" : "image" } });
    await app.close();
    await start();
    try {
      for (const response of [await request("GET", id), await request("PUT", id, body)]) {
        expect(response.status).toBe(422);
        expect((await response.json()).data).toEqual({ reason: "local_recovery_assets_unavailable", missing: [{ path: field === "voice.src" ? "nodes.0.data.voice" : "nodes.0.data", ...(field === "assetId" ? { assetId: asset.id.toString() } : {}) }] });
      }
      expect(await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key })).toEqual(receipt);
      expect(await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json()).toEqual(targetBefore);
    } finally {
      await prisma.client.user_assets.update({ where: { id: asset.id }, data: { type } });
    }
    expect((await (await request("GET", id)).json()).data).toEqual(previous.data);
    const resumed = await request("PUT", id, body);
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).data).toMatchObject({ targetProjectId: targetId, stage: "complete", version: 0 });
    expect((await request("PUT", id, { ...body, name: "更换请求" })).status).toBe(409);
    const saved = await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json();
    expect(JSON.parse(saved.data.nodes)).toEqual(nodes);
    const edited = await fetch(`${base}/api/canvases/${targetId}`, { method: "PUT", headers: { "content-type": "application/json", "if-match": `"${saved.data.version}"` }, body: JSON.stringify({ nodes: JSON.stringify([...nodes, { id: "new-edit", type: "textNode", data: { text: "目标新编辑" } }]) }) });
    expect(edited.status).toBe(200);
    const editedTarget = await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json();
    expect((await request("PUT", id, body)).status).toBe(200);
    expect(await (await fetch(`${base}/api/canvases?projectId=${targetId}`)).json()).toEqual(editedTarget);
    expect(JSON.stringify(body)).toBe(originalBody);
    expect(await (await fetch(`${base}/api/canvases?projectId=${sourceId}`)).json()).toEqual(sourceBefore);
    const stored = await prisma.client.project_command_receipts.findUniqueOrThrow({ where: key });
    expect(stored.request_hash).toBe(receipt.request_hash);
    expect(stored.result_payload).toMatchObject(receipt.result_payload as Record<string, unknown>);
    expect(await prisma.client.project.count()).toBe(projectsBefore + 1);
    expect(await prisma.client.project_command_receipts.count()).toBe(receiptsBefore + 1);
    expect(await prisma.client.generation_jobs.count()).toBe(jobs);
    expect(await prisma.client.billing_cost_reservations.count()).toBe(reservations);
  });
});
