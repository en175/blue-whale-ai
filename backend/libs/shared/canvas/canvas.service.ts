import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readPromptPreview, sourceKey } from "./prompt-preview.js";
import { CANVAS_EDGE_LIMITS, DATA_NOT_EXIST_CODE, canvasEdgeSchema, fail, ok, applyPreviewSchema, PROMPT_TEXT_LIMITS as limits } from "@blue-whale/contracts";
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

  async applyPreview(ownerId: string, projectId: string, body: unknown) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const parsed = applyPreviewSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("预览来源或位置无效");
    const { source, position } = parsed.data;
    const key = sourceKey(source);
    let content: { title: string; text: string } | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = await this.repo.getByProject(projectId);
      const nodes = JSON.parse(canvas.nodes ?? "[]") as Array<{ id: string; type: string; data?: Record<string, unknown> }>;
      const existing = nodes.find(node => node.type === "textNode" && sourceKey(node.data?.promptSource) === key);
      if (existing) return ok({ node: existing, canvas, reused: true });
      if (!content) {
        content = await this.repo.getPromptSnapshot(projectId, source) ?? undefined;
        if (!content) {
          const preview = await readPromptPreview(ownerId, projectId, source);
          content = await this.repo.rememberPromptSnapshot(projectId, source, preview);
        }
      }
      const node = { id: `text-${randomUUID()}`, type: "textNode", position, data: { ...content, promptSource: source } };
      const serialized = JSON.stringify([...nodes, node]);
      if (Buffer.byteLength(serialized, "utf8") > limits.canvasBytes) throw new BadRequestException("画布内容超过 4 MiB，原内容未改动");
      const saved = await this.repo.saveIfVersion(projectId, canvas.version, canvas.viewport, serialized, canvas.edges);
      if (saved) return ok({ node, canvas: saved, reused: false });
    }
    throw new ConflictException("画布正在被修改，请重试应用");
  }

  async save(
    ownerId: string,
    projectId: string,
    body: {
      viewport?: unknown;
      nodes?: unknown;
      edges?: unknown;
      expectedVersion?: number | null;
    },
  ) {
    const owned = await this.project.findOwnedById(projectId, ownerId);
    if (!owned) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const viewport = typeof body.viewport === "string" ? body.viewport : null;
    const nodes = typeof body.nodes === "string" ? body.nodes : null;
    // IKDLQF：edges 省略时保留既有连线（旧客户端保存不得清边）；携带时按下文校验后覆盖。
    const edgesProvided = typeof body.edges === "string";
    const edges = edgesProvided ? (body.edges as string) : null;
    let incoming: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
    try {
      incoming = JSON.parse(nodes ?? "[]");
      if (!Array.isArray(incoming) || incoming.some(node => !node || typeof node.id !== "string")) throw new Error();
    } catch {
      throw new BadRequestException("画布节点格式无效，原内容未改动");
    }
    if (Buffer.byteLength(nodes ?? "", "utf8") > limits.canvasBytes) throw new BadRequestException("画布内容超过 4 MiB，原内容未改动");
    // IKDLQF：edges 与 nodes 同构（JSON 数组字符串），校验失败明确拒绝、零写入。
    let incomingEdges: unknown[] = [];
    if (edgesProvided) {
      try {
        incomingEdges = JSON.parse(edges ?? "[]");
        if (!Array.isArray(incomingEdges)) throw new Error();
      } catch {
        throw new BadRequestException("画布连线格式无效，原内容未改动");
      }
      if (Buffer.byteLength(edges ?? "", "utf8") > CANVAS_EDGE_LIMITS.edgesBytes) throw new BadRequestException("连线内容超过 256 KiB，原内容未改动");
      if (incomingEdges.length > CANVAS_EDGE_LIMITS.maxEdges) throw new BadRequestException(`连线数量超过 ${CANVAS_EDGE_LIMITS.maxEdges} 条上限，原内容未改动`);
    }
    const nodeIds = new Set(incoming.map(node => node.id));
    const seenPairs = new Set<string>();
    for (const edge of incomingEdges) {
      const parsed = canvasEdgeSchema.safeParse(edge);
      if (!parsed.success) throw new BadRequestException("画布连线格式无效，原内容未改动");
      if (parsed.data.source === parsed.data.target) throw new BadRequestException("连线不能指向同一节点，原内容未改动");
      if (!nodeIds.has(parsed.data.source) || !nodeIds.has(parsed.data.target)) throw new BadRequestException("连线端点必须引用本次保存的画布节点，原内容未改动");
      const pair = `${parsed.data.source}\0${parsed.data.target}`;
      if (seenPairs.has(pair)) throw new BadRequestException("同一对节点之间只允许一条连线，原内容未改动");
      seenPairs.add(pair);
    }
    for (const node of incoming) {
      if (node.type !== "textNode") continue;
      if ((typeof node.data?.text === "string" && node.data.text.length > limits.text)
        || (typeof node.data?.title === "string" && node.data.title.length > limits.title)) {
        throw new BadRequestException(`文本超限（标题 ${limits.title}，正文 ${limits.text} 字），原内容未改动`);
      }
    }
    const current = await this.repo.getByProject(projectId);
    const previous = JSON.parse(current.nodes ?? "[]") as typeof incoming;
    if ([...previous, ...incoming].some(node => node.data?.promptSource !== undefined)) {
      if (body.expectedVersion === undefined) throw new BadRequestException("保存预览节点必须携带 If-Match");
      if (body.expectedVersion !== current.version) return { code: 412, msg: "Canvas 版本冲突", data: null } as const;
      const seen = new Set<string>();
      for (const node of incoming) {
        const old = previous.find(item => item.id === node.id);
        const key = sourceKey(node.data?.promptSource);
        if (node.data?.promptSource !== undefined || old?.data?.promptSource !== undefined) {
          if (!key || key !== sourceKey(old?.data?.promptSource) || seen.has(key)
            || node.type !== "textNode" || typeof node.data?.text !== "string" || typeof node.data?.title !== "string") {
            throw new BadRequestException("预览来源不可修改或重复，请使用应用入口");
          }
          seen.add(key);
        }
      }
    }
    const saved = await this.repo.saveIfVersion(
      projectId,
      body.expectedVersion === undefined ? current.version : body.expectedVersion,
      viewport,
      nodes,
      edgesProvided ? edges : current.edges,
    );
    if (!saved) return { code: 412, msg: "Canvas 版本冲突", data: null } as const;
    return ok(saved);
  }
}
