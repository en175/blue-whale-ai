// IKJJQU：恢复契约 v1 的纯函数规则测试——B.7 旧客户端守护、游标编码校验、保存请求摘要。
// 受理/保存的事务性场景（竞争、唯一归属、回滚）在 ikjjqu-canvas-recovery.integration.test.ts
// 用真实数据库验证（本文件只测无 IO 的判定逻辑）。
import { describe, expect, it } from "vitest";

import { RECOVERY_REASONS, recoveryItemId, TARGET_OUTPUT_KEY } from "@lib/contracts";

import {
  RecoveryContractError,
  canvasRecoverySaveRequestHash,
  decodeRecoveryCursor,
  encodeRecoveryCursor,
  guardLegacyCanvasWrite,
} from "./generation-canvas-recovery-repo.js";

const MARKER = { protocolVersion: 1, submissionId: "0a1b2c3d-0000-4000-8000-000000000000", outputKey: TARGET_OUTPUT_KEY };

function markedNode(id: string, overrides: Record<string, unknown> = {}) {
  return { id, type: "mediaNode", position: { x: 1, y: 2 }, data: { generationRecovery: { ...MARKER }, assetId: "7", ...overrides } };
}

describe("guardLegacyCanvasWrite（B.7 旧客户端守护）", () => {
  it("受保护卡的名字/位置/尺寸普通编辑放行", () => {
    const previous = [markedNode("n1")];
    const incoming = [markedNode("n1", { generationRecovery: { ...MARKER } })];
    (incoming[0]!.position as { x: number }).x = 99;
    incoming[0]!.data!.fileName = "改名";
    expect(() => guardLegacyCanvasWrite(previous, incoming)).not.toThrow();
  });

  it("没有恢复变更却使受保护卡缺席 → 428 recovery_protocol_required", () => {
    try {
      guardLegacyCanvasWrite([markedNode("n1")], []);
      throw new Error("应拒绝");
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryContractError);
      expect((error as RecoveryContractError).envelope).toEqual({
        code: 428,
        msg: expect.any(String),
        data: { reason: RECOVERY_REASONS.protocolRequired },
      });
    }
  });

  it("改变受保护标记（承接/任务身份）→ 拒绝", () => {
    const tampered = markedNode("n1", { generationRecovery: { ...MARKER, submissionId: "0a1b2c3d-0000-4000-8000-ffffffffffff" } });
    expect(() => guardLegacyCanvasWrite([markedNode("n1")], [tampered])).toThrow(RecoveryContractError);
  });

  it("剥离受保护标记 → 拒绝", () => {
    const stripped = markedNode("n1");
    delete (stripped.data as Record<string, unknown>).generationRecovery;
    expect(() => guardLegacyCanvasWrite([markedNode("n1")], [stripped])).toThrow(RecoveryContractError);
  });

  it("新增受保护标记（无既有标记的节点）→ 拒绝", () => {
    const forged = { id: "n2", type: "mediaNode", data: { generationRecovery: { ...MARKER } } };
    expect(() => guardLegacyCanvasWrite([], [forged as never])).toThrow(RecoveryContractError);
  });

  it("结果资产（mediaNode.assetId）不可变 → 拒绝", () => {
    const swapped = markedNode("n1", { assetId: "8" });
    expect(() => guardLegacyCanvasWrite([markedNode("n1")], [swapped])).toThrow(RecoveryContractError);
  });

  it("未受保护的普通节点自由编辑不受影响", () => {
    const plain = [{ id: "text-1", type: "textNode", data: { text: "a" } }];
    const edited = [{ id: "text-1", type: "textNode", data: { text: "b" } }];
    expect(() => guardLegacyCanvasWrite(plain as never, edited as never)).not.toThrow();
  });
});

describe("恢复页游标（B.5）", () => {
  it("编码后解码还原；含协议版本、项目 ID、首屏上界与最后扫描 ID", () => {
    const cursor = { v: 1, projectId: "55", maxId: 30, lastId: 12 };
    expect(decodeRecoveryCursor(encodeRecoveryCursor(cursor))).toEqual(cursor);
  });

  it("非法游标（乱码/协议版本不符）→ null（调用方判 400）", () => {
    expect(decodeRecoveryCursor("!!!not-base64!!!")).toBeNull();
    const wrongVersion = encodeRecoveryCursor({ v: 2, projectId: "55", maxId: 1, lastId: 0 });
    expect(decodeRecoveryCursor(wrongVersion)).toBeNull();
  });

  it("跨项目游标可被调用方识别（projectId 不匹配由 service 判 400）", () => {
    const cursor = decodeRecoveryCursor(encodeRecoveryCursor({ v: 1, projectId: "55", maxId: 1, lastId: 0 }));
    expect(cursor?.projectId).not.toBe("56");
  });
});

describe("保存请求摘要（B.6）", () => {
  const base = {
    ownerId: "9",
    projectId: "55",
    expectedVersion: 3 as number | null,
    viewport: "{}",
    nodes: "[]",
    edges: "[]",
    confirmEmpty: false,
    commandId: "0a1b2c3d-0000-4000-8000-000000000001",
    changes: [
      { recoveryItemId: recoveryItemId("0a1b2c3d-0000-4000-8000-000000000002", TARGET_OUTPUT_KEY), expectedRevision: 1, action: "apply" },
    ],
  };

  it("同载荷摘要稳定；If-Match/文档/变更任一变化摘要变化", () => {
    const hash = canvasRecoverySaveRequestHash(base);
    expect(canvasRecoverySaveRequestHash(base)).toBe(hash);
    expect(canvasRecoverySaveRequestHash({ ...base, expectedVersion: 4 })).not.toBe(hash);
    expect(canvasRecoverySaveRequestHash({ ...base, nodes: '[{"id":"n1"}]' })).not.toBe(hash);
    expect(canvasRecoverySaveRequestHash({ ...base, changes: [...base.changes, { recoveryItemId: "gcr:x:y", expectedRevision: 0, action: "remove" }] })).not.toBe(hash);
  });

  it("变更数组顺序不影响摘要（规范化排序）", () => {
    const a = canvasRecoverySaveRequestHash({ ...base, changes: base.changes });
    const reordered = canvasRecoverySaveRequestHash({
      ...base,
      changes: [{ ...base.changes[0]!, action: "remove" }, { ...base.changes[0]! }],
    });
    // 同一变更集内部顺序变化：两项不同内容排序后应与逆序一致
    const set1 = canvasRecoverySaveRequestHash({
      ...base,
      changes: [
        { recoveryItemId: "gcr:a:b", expectedRevision: 1, action: "apply" },
        { recoveryItemId: "gcr:c:d", expectedRevision: 2, action: "remove" },
      ],
    });
    const set2 = canvasRecoverySaveRequestHash({
      ...base,
      changes: [
        { recoveryItemId: "gcr:c:d", expectedRevision: 2, action: "remove" },
        { recoveryItemId: "gcr:a:b", expectedRevision: 1, action: "apply" },
      ],
    });
    expect(set1).toBe(set2);
    expect(a).not.toBe(reordered);
  });
});
