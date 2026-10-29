import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GenerationJobsController } from "./generation-jobs.controller.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { AccountDirectoryService } from "@lib/shared/identity/account-directory.service.js";

vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return {
    ...actual,
    sharedBillingClient: () => ({
      charge: async () => ({ chargedCredits: 1, catalogVersion: 1, duplicated: false }),
      quote: async () => ({ credits: BigInt(1), catalogVersion: 1 }),
      queryBalance: async () => ({ availableCredits: 0, expiring: [] }),
      listTransactions: async () => ({ items: [], total: 0 }),
    }),
  };
});

describe.skipIf(!process.env.IKG57P_DATABASE_URL)(
  "Generation job soft-deleted asset rejection (IKG57P)",
  () => {
    const prisma = new PrismaService();
    const projects = new ProjectService(prisma);
    const MODEL_ID = "ikg57p-image-model";
    let app: Awaited<ReturnType<typeof NestFactory.create>>;
    let base = "";
    const previousDatabase = process.env.DATABASE_URL;

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.IKG57P_DATABASE_URL;
      const sizes = [{ id: "1024x1024", label: "1024x1024" }];
      await prisma.client.catalog_models.upsert({
        where: {
          provider_id_model_id: {
            provider_id: "ikg57p-test",
            model_id: MODEL_ID,
          },
        },
        create: {
          provider_id: "ikg57p-test",
          model_id: MODEL_ID,
          capability_type: "image",
          model_label: "IKG57P Test",
          supported_sizes: sizes,
          supported_aspect_ratios: ["1:1"],
          supported_formats: ["png"],
          default_size: "1024x1024",
          default_aspect_ratio: "1:1",
          features: { reference_image: true },
          channel: "seedream-image",
        },
        update: {
          supported_sizes: sizes,
          default_size: "1024x1024",
          features: { reference_image: true },
        },
      });
      class HarnessModule {}
      Reflect.defineMetadata(
        "design:paramtypes",
        [
          ProjectService,
          GenerationCommandService,
          ModelCapabilityReadService,
          CanvasService,
          MaterialService,
          AssetService,
          AssetStorageService,
          AccountDirectoryService,
          PrismaService,
        ],
        GenerationJobsController,
      );
      Module({
        controllers: [GenerationJobsController],
        providers: [
          { provide: APP_FILTER, useClass: AllExceptionsFilter },
          { provide: PrismaService, useValue: prisma },
          { provide: ProjectService, useValue: projects },
          {
            provide: GenerationCommandService,
            useValue: new GenerationCommandService(prisma),
          },
          {
            provide: ModelCapabilityReadService,
            useValue: new ModelCapabilityReadService(prisma),
          },
          {
            provide: CanvasService,
            useValue: new CanvasService(prisma, projects),
          },
          { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
          {
            provide: AssetService,
            useValue: new AssetService(prisma, new AssetStorageService()),
          },
          {
            provide: AccountDirectoryService,
            useValue: new AccountDirectoryService(prisma),
          },
        ],
      })(HarnessModule);
      app = await NestFactory.create(HarnessModule, {
        logger: false,
        bodyParser: false,
      });
      app.use(json({ limit: "16mb" }));
      app.setGlobalPrefix("api");
      app.use((req: { user: unknown }, _res: unknown, next: () => void) => {
        req.user = { userId: "987654" };
        next();
      });
      await app.listen(0, "127.0.0.1");
      base = await app.getUrl();
    }, 30_000);

    afterAll(async () => {
      await app?.close();
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      await prisma.client.$disconnect();
    });

    async function createAsset() {
      const row = await prisma.client.user_assets.create({
        data: {
          user_id: BigInt(987654),
          project_id: BigInt(0),
          type: "image",
          url: "https://example.com/ikg57p.png",
          width: 1024,
          height: 1024,
          size: BigInt(2048),
        },
      });
      return row.id.toString();
    }

    function submit(projectId: string, body: unknown) {
      return fetch(`${base}/api/projects/${projectId}/generation-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    async function jobCount(projectId: string) {
      return prisma.client.generation_jobs.count({
        where: { project_id: BigInt(projectId) },
      });
    }

    it("正文标签引用的素材软删 → HTTP 400 与信封一致，通用文案拒单，不创建任务", async () => {
      const projectId = (await projects.create("987654", "IKG57P soft-delete ref")).id;
      const assetId = await createAsset();
      await prisma.client.user_assets.update({
        where: { id: BigInt(assetId) },
        data: { is_delete: true },
      });

      const response = await submit(projectId, {
        type: "image",
        input_asset_ids: [assetId],
        expected_output_count: 1,
        parameters: { prompt: "海边日落", model_id: MODEL_ID, aspect_ratio: "1:1" },
        prompt_doc: {
          version: 1,
          segments: [
            { kind: "text", text: "参考" },
            { kind: "asset_ref", asset_id: assetId },
            { kind: "text", text: "的风格" },
          ],
        },
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        code: number;
        msg: string;
        data: unknown;
      };
      expect(body.code).toBe(1034);
      expect(body.msg).toBe("参考素材不存在或无权访问");
      expect(await jobCount(projectId)).toBe(0);
    });

    it("纯参考清单素材软删 → HTTP 400 与信封一致，通用文案拒单", async () => {
      const projectId = (await projects.create("987654", "IKG57P soft-delete plain")).id;
      const assetId = await createAsset();
      await prisma.client.user_assets.update({
        where: { id: BigInt(assetId) },
        data: { is_delete: true },
      });

      const response = await submit(projectId, {
        type: "image",
        input_asset_ids: [assetId],
        expected_output_count: 1,
        parameters: { prompt: "海边日落", model_id: MODEL_ID, aspect_ratio: "1:1" },
      });
      expect(response.status).toBe(400);
      const body = (await response.json()) as {
        code: number;
        msg: string;
        data: unknown;
      };
      expect(body.code).toBe(1034);
      expect(body.msg).toBe("参考素材不存在或无权访问");
      expect(await jobCount(projectId)).toBe(0);
    });

    it("补齐素材后同一提交路径放行 → 201 创建任务", async () => {
      const projectId = (await projects.create("987654", "IKG57P soft-delete restore")).id;
      const assetId = await createAsset();
      await prisma.client.user_assets.update({
        where: { id: BigInt(assetId) },
        data: { is_delete: true },
      });
      const body = {
        type: "image",
        input_asset_ids: [assetId],
        expected_output_count: 1,
        parameters: { prompt: "海边日落", model_id: MODEL_ID, aspect_ratio: "1:1" },
        prompt_doc: {
          version: 1,
          segments: [
            { kind: "text", text: "参考" },
            { kind: "asset_ref", asset_id: assetId },
            { kind: "text", text: "的风格" },
          ],
        },
      };
      const rejected = await submit(projectId, body);
      expect(rejected.status).toBe(400);

      await prisma.client.user_assets.update({
        where: { id: BigInt(assetId) },
        data: { is_delete: false },
      });
      const accepted = await submit(projectId, body);
      expect(accepted.status).toBe(201);
      const created = (await accepted.json()) as {
        code: number;
        data: { generation_job_id: string };
      };
      expect(created.code).toBe(200);
      expect(await jobCount(projectId)).toBe(1);
    });
  },
  240_000,
);
