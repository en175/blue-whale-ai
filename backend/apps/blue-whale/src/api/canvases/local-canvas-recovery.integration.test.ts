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
    const reservations = await prisma.client.cost_reservations.count();
    const asset = await prisma.client.assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "video", url: `https://assets.invalid/main-${sourceId}.mp4` } });
    const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000012", {
      ...payload, nodes: JSON.stringify([{ id: "video-fallback", type: "mediaNode", data: { assetId: asset.id.toString(), mediaType: "video", src: asset.url, srcH264: "blob:expired-fallback" } }]),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).data).toEqual({ reason: "local_recovery_assets_unavailable", missing: [{ path: "nodes.0.data.srcH264" }] });
    expect((await (await fetch(`${base}/api/projects`)).json()).data).toHaveLength(before.data.length);
    expect(await prisma.client.generation_jobs.count()).toBe(jobs);
    expect(await prisma.client.cost_reservations.count()).toBe(reservations);
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
    const assets = await Promise.all(["image", "video", "audio", "image", "video"].map((type, i) => prisma.client.assets.create({ data: {
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
    const beforeReservations = await prisma.client.cost_reservations.count();
    const response = await request("PUT", id, body);
    expect(response.status).toBe(200);
    const complete = await response.json();
    expect(complete.data.stage).toBe("complete");
    const snapshot = await (await fetch(`${base}/api/projects/${complete.data.targetProjectId}/snapshot`)).json();
    expect(JSON.parse(snapshot.data.canvas.nodes)).toEqual(nodes);
    for (const asset of assets) expect(snapshot.data.assets[asset.id.toString()].access_url).toBe(asset.url);
    for (const asset of assets) {
      await prisma.client.assets.update({ where: { id: asset.id }, data: { user_id: 983004n } });
      try {
        const revoked = await request("GET", id);
        expect(revoked.status).toBe(422);
        const error = await revoked.json();
        expect(error.data.reason).toBe("local_recovery_assets_unavailable");
        expect(JSON.stringify(error)).not.toContain(asset.url);
        expect((await request("PUT", id, body)).status).toBe(422);
      } finally {
        await prisma.client.assets.update({ where: { id: asset.id }, data: { user_id: 983003n } });
      }
    }
    expect((await (await request("GET", id)).json()).data.stage).toBe("complete");
    expect(await prisma.client.generation_jobs.count()).toBe(beforeJobs);
    expect(await prisma.client.cost_reservations.count()).toBe(beforeReservations);
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
    const reservationsBefore = await prisma.client.cost_reservations.count();
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
    expect(await prisma.client.cost_reservations.count()).toBe(reservationsBefore);
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
    await fixtureSql.query("CREATE TRIGGER ikncl3_fail_receipt BEFORE UPDATE ON command_idempotency FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated receipt interruption'");
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
    await fixtureSql.query("CREATE TRIGGER ikncl3_fail_receipt BEFORE UPDATE ON command_idempotency FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'isolated receipt interruption'");
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
    const asset = await prisma.client.assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url: `https://assets.invalid/${sourceId}.png` } });
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
    await prisma.client.assets.update({ where: { id: asset.id }, data: { user_id: 983004n } });
    try {
      expect((await request("GET", id)).status).toBe(422);
      expect((await request("PUT", id, body)).status).toBe(422);
    } finally {
      await prisma.client.assets.update({ where: { id: asset.id }, data: { user_id: 983003n } });
    }
    await prisma.client.assets.update({ where: { id: asset.id }, data: { is_delete: true } });
    try {
      expect((await request("GET", id)).status).toBe(422);
    } finally {
      await prisma.client.assets.update({ where: { id: asset.id }, data: { is_delete: false } });
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
    await prisma.client.command_idempotency.updateMany({ where: { project_id: BigInt(sourceId), operation: "LOCAL_CANVAS_RECOVERY_V1", idempotency_key: id }, data: { gmt_create: new Date("2025-01-01T00:00:00Z"), gmt_modified: new Date("2025-01-01T00:00:00Z") } });
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
    const asset = await prisma.client.assets.create({ data: { user_id: 983003n, project_id: BigInt(sourceId), type: "image", url: `https://assets.invalid/alias-${sourceId}.png` } });
    const response = await request("PUT", "04e0b9cc-04dd-45ad-930b-3c0000000010", {
      ...payload, nodes: JSON.stringify([{ id: "alias-media", type: "mediaNode", data: { assetId: asset.id.toString(), mediaType: "image", src: asset.url, url: "https://other-account.invalid/private.png" } }]),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).data.reason).toBe("local_recovery_assets_unavailable");
  });

  it("拒绝临时文件地址、他人素材、非法来源说明及方案受保护身份", async () => {
    const foreign = await prisma.client.assets.create({ data: { user_id: 983004n, type: "image", url: `https://assets.invalid/foreign-${sourceId}.png` } });
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
});
