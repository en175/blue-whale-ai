import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { TARGET_OUTPUT_KEY, type CanvasBinding } from "@lib/contracts";
import { createCanvasRepo } from "./canvas-repo.js";
import {
  RecoveryContractError,
  loadRecoveryOwners,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
} from "./generation-canvas-recovery-repo.js";

const OWNER_ID = 987651n;

function binding(submissionId: string, targetNodeId: string, expected: number): CanvasBinding {
  return {
    protocol_version: 1,
    submission_id: submissionId,
    target_node_id: targetNodeId,
    expected_binding_revision: expected,
    recovery_seed: {
      target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" },
      sources: [],
    },
  };
}

function acceptance(projectId: string, submissionId: string, targetNodeId: string, expected: number): CanvasRecoveryAcceptance {
  return {
    projectId,
    userId: OWNER_ID.toString(),
    binding: binding(submissionId, targetNodeId, expected),
    operation: "generation.create",
    requestHash: `hash-${submissionId}`,
    idempotencyKey: submissionId,
    taskType: "image_generate",
  };
}

describe.skipIf(!process.env.IKQY3H_DATABASE_URL)("节点承接归属并入行表（真库）", () => {
  let prisma: PrismaService;
  let projectId: bigint;
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKQY3H_DATABASE_URL;
    prisma = new PrismaService();
    const row = await prisma.client.project.create({
      data: { owner_id: OWNER_ID, name: `ikqy3h-${Date.now()}`, purpose: "canvas" },
      select: { id: true },
    });
    projectId = row.id;
  });

  beforeEach(async () => {
    await prisma.client.project_node_revisions.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_edges.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_nodes.deleteMany({ where: { project_id: projectId } });
    await prisma.client.generation_canvas_submissions.deleteMany({ where: { project_id: projectId } });
    await prisma.client.generation_canvas_outputs.deleteMany({});
    await prisma.client.project_command_receipts.deleteMany({ where: { project_id: projectId } });
    await prisma.client.project_canvas.deleteMany({ where: { project_id: projectId } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.client.project_node_revisions.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_edges.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_nodes.deleteMany({ where: { project_id: projectId } });
      await prisma.client.generation_canvas_submissions.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_command_receipts.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project_canvas.deleteMany({ where: { project_id: projectId } });
      await prisma.client.project.delete({ where: { id: projectId } });
      await prisma.client.$disconnect();
    }
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  });

  it("目标节点尚未落行：按提交记录推进版本，同版本第二个意图被拒", async () => {
    const pid = projectId.toString();
    const first = await prisma.client.$transaction((tx) =>
      lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000001", "target-1", 0)),
    );
    expect(first.kind).toBe("plan");
    if (first.kind !== "plan") return;
    await prisma.client.$transaction((tx) => writeCanvasRecoveryRows(tx, first.plan, 90001n));

    const owners = await loadRecoveryOwners(prisma.client, projectId, ["target-1"]);
    expect(owners.get("target-1")).toMatchObject({ outputKey: TARGET_OUTPUT_KEY, bindingRevision: 1 });

    await expect(
      prisma.client.$transaction((tx) =>
        lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000002", "target-1", 0)),
      ),
    ).rejects.toMatchObject({ envelope: { code: 409, data: { reason: "canvas_binding_conflict", currentBindingRevision: 1 } } });
  });

  it("节点软删后归属与承接版本保留，旧重放不能夺回", async () => {
    const pid = projectId.toString();
    const first = await prisma.client.$transaction((tx) =>
      lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000011", "target-2", 0)),
    );
    if (first.kind !== "plan") throw new Error("应生成受理计划");
    await prisma.client.$transaction((tx) => writeCanvasRecoveryRows(tx, first.plan, 90002n));

    await prisma.client.project_nodes.create({
      data: {
        project_id: projectId,
        node_id: "target-2",
        type: "mediaNode",
        source: "user",
        owner_submission_id: (await prisma.client.generation_canvas_submissions.findFirstOrThrow({
          where: { project_id: projectId, target_node_id: "target-2" },
          select: { id: true },
        })).id,
        owner_output_key: TARGET_OUTPUT_KEY,
        owner_binding_revision: 1,
        is_delete: 1,
      },
    });

    await expect(
      prisma.client.$transaction((tx) =>
        lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000012", "target-2", 0)),
      ),
    ).rejects.toBeInstanceOf(RecoveryContractError);

    const next = await prisma.client.$transaction((tx) =>
      lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000013", "target-2", 1)),
    );
    expect(next.kind).toBe("plan");
    if (next.kind === "plan") expect(next.plan.bindingRevision).toBe(2);
  });

  it("节点行存在时写归属列；整份保存删除节点保留归属，旧重放仍冲突，复活后归属仍在", async () => {
    const pid = projectId.toString();
    const repo = createCanvasRepo(prisma.client);
    const node = { id: "target-3", type: "mediaNode", position: { x: 1, y: 2 }, data: { mediaType: "image" } };
    await repo.saveIfVersion(pid, null, null, JSON.stringify([node]), "[]");

    const first = await prisma.client.$transaction((tx) =>
      lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000021", "target-3", 0)),
    );
    if (first.kind !== "plan") throw new Error("应生成受理计划");
    await prisma.client.$transaction((tx) => writeCanvasRecoveryRows(tx, first.plan, 90003n));

    const owned = await prisma.client.project_nodes.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: projectId, node_id: "target-3" } },
    });
    expect(owned.owner_submission_id).not.toBeNull();
    expect(owned.owner_output_key).toBe(TARGET_OUTPUT_KEY);
    expect(owned.owner_binding_revision).toBe(1);

    const beforeDelete = await prisma.client.project_canvas.findUniqueOrThrow({ where: { project_id: projectId } });
    await repo.saveIfVersion(pid, beforeDelete.version, null, "[]", "[]");
    const deleted = await prisma.client.project_nodes.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: projectId, node_id: "target-3" } },
    });
    expect(deleted.is_delete).toBe(1);
    expect(deleted.owner_submission_id).toBe(owned.owner_submission_id);
    expect(deleted.owner_binding_revision).toBe(1);

    await expect(
      prisma.client.$transaction((tx) =>
        lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000022", "target-3", 0)),
      ),
    ).rejects.toMatchObject({ envelope: { code: 409, data: { currentBindingRevision: 1 } } });

    const next = await prisma.client.$transaction((tx) =>
      lockCanvasRecoveryForAcceptance(tx, acceptance(pid, "0a1b2c3d-0000-4000-8000-000000000023", "target-3", 1)),
    );
    expect(next.kind).toBe("plan");
    if (next.kind === "plan") expect(next.plan.bindingRevision).toBe(2);

    const beforeRevive = await prisma.client.project_canvas.findUniqueOrThrow({ where: { project_id: projectId } });
    await repo.saveIfVersion(pid, beforeRevive.version, null, JSON.stringify([node]), "[]");
    const revived = await prisma.client.project_nodes.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: projectId, node_id: "target-3" } },
    });
    expect(revived.is_delete).toBe(0);
    expect(revived.owner_submission_id).toBe(owned.owner_submission_id);
    expect(revived.owner_binding_revision).toBe(1);
  });

  it("整份保存改写行表并打开行表权威标记，读取不再回退 JSON", async () => {
    const repo = createCanvasRepo(prisma.client);
    const nodes = [
      { id: "n1", type: "textNode", position: { x: 1, y: 2 }, data: { text: "甲" } },
      { id: "n2", type: "mediaNode", position: { x: 3, y: 4 }, data: { mediaType: "image" } },
    ];
    const edges = [{ id: "e1", source: "n1", target: "n2", data: { refRole: "reference" } }];

    const saved = await repo.saveIfVersion(
      projectId.toString(),
      null,
      JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      JSON.stringify(nodes),
      JSON.stringify(edges),
    );
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!.nodes!)).toEqual(nodes);

    const canvas = await prisma.client.project_canvas.findUniqueOrThrow({ where: { project_id: projectId } });
    expect(canvas.rows_authoritative).toBe(1);
    expect(canvas.nodes_json).toBeNull();
    const rows = await prisma.client.project_nodes.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } });
    expect(rows.map((row) => [row.node_id, row.type, row.pos_x, row.pos_y])).toEqual([
      ["n1", "textNode", 1, 2],
      ["n2", "mediaNode", 3, 4],
    ]);

    const reread = await repo.getByProject(projectId.toString());
    expect(JSON.parse(reread.nodes!)).toEqual(nodes);
    expect(JSON.parse(reread.edges!)).toEqual(edges);
  });
});
