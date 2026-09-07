// IKARDY：媒体提取音频节点注入画布快照。
// 建任务时插「待开始」占位节点（源视频节点右侧）；提取成功更新为最终音频；失败置 failed。
// 前端无改动：MediaNode 已支持 audio + genStatus generating，水合时对带 jobId 的生成中节点自动 poll。
//
// ⚠️ 所有画布写操作走 withCanvasUpdate：版本守卫 CAS（version 匹配）+ 冲突重试，
// 避免并发提取（本功能多视频并行）或用户保存画布时的 read-modify-write 丢失更新。
import type { PrismaClient } from "@prisma/client";

/** 音频节点放在源视频节点右侧的横向偏移（节点宽约 280 + 间距）。 */
const MEDIA_NODE_OFFSET = 340;
/** read-modify-write 冲突重试上限。 */
const MAX_RETRY = 3;

function parseNodes(nodesJson: unknown): Array<Record<string, any>> {
  if (Array.isArray(nodesJson)) return nodesJson as Array<Record<string, any>>;
  if (typeof nodesJson === "string") {
    try {
      const parsed = JSON.parse(nodesJson);
      return Array.isArray(parsed) ? (parsed as Array<Record<string, any>>) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 版本守卫的画布节点更新：读 nodes_json → mutator 变换 → version CAS 更新，冲突重试。
 * mutator 返回 null 表示不写（找不到目标节点 / 已存在）；否则 { nodes, result }。
 */
async function withCanvasUpdate<T>(
  prisma: PrismaClient,
  projectId: string,
  mutator: (nodes: Array<Record<string, any>>) => {
    nodes: Array<Record<string, any>>;
    result: T;
  } | null,
): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const canvas = await prisma.canvas.findFirst({
      where: { project_id: BigInt(projectId), is_delete: 0 },
      select: { id: true, version: true, nodes_json: true },
    });
    if (!canvas) return null;
    const out = mutator(parseNodes(canvas.nodes_json));
    if (out === null) return null;
    const updated = await prisma.canvas.updateMany({
      where: { id: canvas.id, version: canvas.version },
      data: { nodes_json: out.nodes as never, version: { increment: 1 } },
    });
    if (updated.count === 1) return out.result;
    // 版本冲突（并发写）→ 重读重试
  }
  return null;
}

/** 音频展示名：视频文件名去扩展名 + "(audio)"（如 测试视频.mp4 → 测试视频(audio).mp3）。 */
function audioDisplayName(videoFileName: unknown): string {
  const name = typeof videoFileName === "string" ? videoFileName.trim() : "";
  if (!name) return "提取音频(audio).mp3";
  const base = name.replace(/\.[^./]+$/, "");
  return `${base}(audio).mp3`;
}

/** 建任务（入队前）插入「待开始」音频占位节点：源视频节点右侧，genStatus=generating + jobId（供前端水合轮询）。 */
export async function placeMediaExtractPendingNode(
  prisma: PrismaClient,
  input: { projectId: string; jobId: string; sourceAssetId: string },
): Promise<boolean> {
  const result = await withCanvasUpdate(prisma, input.projectId, (nodes) => {
    const videoNode = nodes.find(
      (n) =>
        n?.type === "mediaNode" &&
        String(n?.data?.assetId) === String(input.sourceAssetId),
    );
    if (!videoNode) return null;
    const nodeId = `media-extract-${input.jobId}`;
    if (nodes.some((n) => n?.id === nodeId)) {
      // 幂等：同 job 已插过（含并发建任务）→ 视为成功，不重复插
      return { nodes, result: true };
    }
    const px = Number(videoNode.position?.x ?? 0);
    const py = Number(videoNode.position?.y ?? 0);
    nodes.push({
      id: nodeId,
      type: "mediaNode",
      position: { x: Math.round(px + MEDIA_NODE_OFFSET), y: Math.round(py) },
      data: {
        src: "",
        fileName: audioDisplayName(videoNode.data?.fileName),
        mediaType: "audio",
        genStatus: "generating",
        progress: 0,
        jobId: input.jobId,
        toolMode: "select",
      },
    });
    return { nodes, result: true };
  });
  return result === true;
}

/** 提取成功：把占位节点更新为最终音频节点（src/assetId/元数据，清 genStatus）。读 job.output_asset_ids 取音频资产 id。 */
export async function updateMediaExtractNodeToAudio(
  prisma: PrismaClient,
  input: {
    jobId: string;
    projectId: string;
    url: string;
    mime: string;
    size: number;
    duration: number | null;
  },
): Promise<boolean> {
  const job = await prisma.generation_jobs.findUnique({
    where: { id: BigInt(input.jobId) },
    select: { output_asset_ids: true },
  });
  const audioAssetId =
    Array.isArray(job?.output_asset_ids) && job.output_asset_ids.length > 0
      ? String(job.output_asset_ids[0])
      : undefined;
  const result = await withCanvasUpdate(prisma, input.projectId, (nodes) => {
    const nodeId = `media-extract-${input.jobId}`;
    const idx = nodes.findIndex((n) => n?.id === nodeId);
    if (idx < 0) return null;
    // 保留占位节点的派生展示名（视频名(audio)）；占位节点缺失时兜底。
    const pendingFileName = nodes[idx]?.data?.fileName;
    nodes[idx] = {
      ...nodes[idx],
      data: {
        src: input.url,
        mediaType: "audio",
        fileName:
          typeof pendingFileName === "string" && pendingFileName.length > 0
            ? pendingFileName
            : audioDisplayName(undefined),
        ...(audioAssetId ? { assetId: audioAssetId } : {}),
        mime: input.mime,
        size: input.size,
        ...(input.duration !== null && input.duration !== undefined
          ? { duration: input.duration }
          : {}),
        progress: 100,
        toolMode: "select",
      },
    };
    return { nodes, result: true };
  });
  return result === true;
}

/** 提取失败：把占位节点置 failed（genStatus=failed + errorText），供画布展示失败态。 */
export async function failMediaExtractNode(
  prisma: PrismaClient,
  input: { jobId: string; projectId: string; code: string; message: string },
): Promise<boolean> {
  const result = await withCanvasUpdate(prisma, input.projectId, (nodes) => {
    const nodeId = `media-extract-${input.jobId}`;
    const idx = nodes.findIndex((n) => n?.id === nodeId);
    if (idx < 0) return null;
    nodes[idx] = {
      ...nodes[idx],
      data: {
        ...nodes[idx]?.data,
        genStatus: "failed",
        errorText: input.message,
        progress: 0,
      },
    };
    return { nodes, result: true };
  });
  return result === true;
}
