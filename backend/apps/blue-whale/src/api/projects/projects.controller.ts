import { Readable } from "node:stream";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import {
  DATA_NOT_EXIST_CODE,
  FAILURE_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@lib/contracts";
import { createProductEventRepo } from "@lib/shared/persistence/index.js";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { createProjectEventStream } from "@lib/shared/project-events/project-event-stream.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { handleGetSnapshot } from "@lib/shared/snapshot/handle-snapshot.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { resolveProjectListQuery } from "./project-list-query.js";

@Controller("projects")
export class ProjectsController {
  private eventRepoInstance?: ReturnType<typeof createProductEventRepo>;

  constructor(
    private readonly project: ProjectService,
    private readonly canvas: CanvasService,
    private readonly snapshot: SnapshotService,
    private readonly prisma: PrismaService,
  ) {}

  private get eventRepo(): ReturnType<typeof createProductEventRepo> {
    if (!this.eventRepoInstance) {
      this.eventRepoInstance = createProductEventRepo(this.prisma.client);
    }
    return this.eventRepoInstance;
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const resolved = resolveProjectListQuery(query);
    if (resolved.kind === "invalid") {
      return fail(FAILURE_CODE, resolved.reason);
    }
    const options = resolved.keyword ? { keyword: resolved.keyword } : undefined;
    if (resolved.kind === "all") {
      return ok(await this.project.listByOwner(user.userId, options));
    }
    if (resolved.kind === "limit") {
      return ok(
        await this.project.listByOwnerRecent(user.userId, resolved.limit, options),
      );
    }
    return ok(
      await this.project.listByOwnerPaged(
        user.userId,
        resolved.page,
        resolved.size,
        options,
      ),
    );
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name?: unknown },
  ) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    return ok(await this.project.create(user.userId, name));
  }

  @Post("batch-delete")
  async batchDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { ids?: unknown },
  ) {
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const ids = rawIds
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
    if (ids.length === 0 || ids.length !== rawIds.length) {
      return fail(FAILURE_CODE, "ids 参数不合法");
    }
    return ok(await this.project.batchDelete(user.userId, ids));
  }

  @Get(":id")
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const project = await this.project.findOwnedById(id, user.userId);
    if (!project) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    return ok(project);
  }

  @Put(":id")
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { name?: unknown },
  ) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail(FAILURE_CODE, "项目名不能为空");
    const project = await this.project.rename(id, user.userId, name);
    if (!project) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    return ok(project);
  }

  @Put(":id/last-opened")
  async touchLastOpened(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const touched = await this.project.touchLastOpened(id, user.userId);
    if (!touched) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    return ok(null);
  }

  @Put(":id/pin")
  async pin(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { pinned?: unknown },
  ) {
    if (typeof body.pinned !== "boolean") {
      return fail(FAILURE_CODE, "pinned 必须为布尔值");
    }
    const project = await this.project.setPinned(id, user.userId, body.pinned);
    if (!project) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    return ok(project);
  }

  @Get(":id/snapshot")
  async getSnapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return handleGetSnapshot(user.userId, id, {
      projects: this.project,
      canvas: this.canvas,
      snapshot: this.snapshot,
    });
  }

  @Get(":id/events")
  async events(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Query("after") after: string | undefined,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    const cursor = after ?? "0";
    if (!/^[0-9]+$/.test(cursor)) {
      res.status(400).json(fail(400, "after 游标无效"));
      return;
    }
    const project = await this.project.findOwnedById(id, user.userId);
    if (!project) {
      res.status(404).json(fail(RESOURCE_NOT_FOUND_CODE, "资源不存在"));
      return;
    }

    const abort = new AbortController();
    res.on("close", () => abort.abort());

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const stream = Readable.fromWeb(
      createProjectEventStream({
        projectId: id,
        after: cursor,
        events: this.eventRepo,
        signal: abort.signal,
      }) as import("node:stream/web").ReadableStream,
    );
    stream.on("error", (error) => {
      logger.error(
        `[project-events] stream error: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!res.writableEnded) res.destroy(error instanceof Error ? error : undefined);
    });
    stream.pipe(res);
  }

  @Delete(":id")
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const deleted = await this.project.delete(id, user.userId);
    if (!deleted) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    return ok();
  }
}
