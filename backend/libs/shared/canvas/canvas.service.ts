import { Injectable } from "@nestjs/common";
import { DATA_NOT_EXIST_CODE, fail, ok } from "@blue-whale/contracts";
import { createCanvasRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";

@Injectable()
export class CanvasService {
  private repoInstance?: ReturnType<typeof createCanvasRepo>;

  private get repo(): ReturnType<typeof createCanvasRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createCanvasRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
  ) {}

  async get(ownerId: string, projectId: string) {
    const owned = await this.project.findOwnedById(projectId, ownerId);
    if (!owned) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    return ok(await this.repo.getByProject(projectId));
  }

  getByProject(projectId: string) {
    return this.repo.getByProject(projectId);
  }

  async save(
    ownerId: string,
    projectId: string,
    body: {
      viewport?: unknown;
      nodes?: unknown;
      expectedVersion?: number | null;
    },
  ) {
    const owned = await this.project.findOwnedById(projectId, ownerId);
    if (!owned) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const viewport = typeof body.viewport === "string" ? body.viewport : null;
    const nodes = typeof body.nodes === "string" ? body.nodes : null;
    if (body.expectedVersion !== undefined) {
      const saved = await this.repo.saveIfVersion(
        projectId,
        body.expectedVersion,
        viewport,
        nodes,
      );
      if (!saved) {
        return { code: 412, msg: "Canvas 版本冲突", data: null } as const;
      }
      return ok(saved);
    }
    return ok(await this.repo.save(projectId, viewport, nodes));
  }
}
