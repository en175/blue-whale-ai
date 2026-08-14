import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import {
  DATA_NOT_EXIST_CODE,
  FAILURE_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { handleGetSnapshot } from "@lib/shared/snapshot/handle-snapshot.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly project: ProjectService,
    private readonly canvas: CanvasService,
    private readonly snapshot: SnapshotService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return ok(await this.project.listByOwner(user.userId));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name?: unknown },
  ) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail(FAILURE_CODE, "项目名不能为空");
    return ok(await this.project.create(user.userId, name));
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
