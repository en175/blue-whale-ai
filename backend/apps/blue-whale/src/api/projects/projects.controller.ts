import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  DATA_NOT_EXIST_CODE,
  FAILURE_CODE,
  fail,
  ok,
} from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { handleGetSnapshot } from "@lib/shared/snapshot/handle-snapshot.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { resolveProjectListQuery } from "./project-list-query.js";

@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly project: ProjectService,
    private readonly canvas: CanvasService,
    private readonly snapshot: SnapshotService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const resolved = resolveProjectListQuery(query);
    if (resolved.kind === "invalid") {
      return fail(FAILURE_CODE, resolved.reason);
    }
    const options =
      resolved.keyword || resolved.entryKind
        ? {
            ...(resolved.keyword ? { keyword: resolved.keyword } : {}),
            ...(resolved.entryKind ? { kind: resolved.entryKind } : {}),
          }
        : undefined;
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
    @Body() body: { name?: unknown; entry_kind?: unknown },
  ) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rawKind = body.entry_kind;
    if (rawKind !== undefined && rawKind !== "dialog" && rawKind !== "canvas") {
      return fail(FAILURE_CODE, "entry_kind 仅支持 dialog/canvas");
    }
    return ok(await this.project.create(user.userId, name, rawKind));
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
