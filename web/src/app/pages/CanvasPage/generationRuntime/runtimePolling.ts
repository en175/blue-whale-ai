import type { JobDetail } from '@/api/jobs';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import type { RuntimeNodeView } from './types';
import { TARGET_OUTPUT_KEY, PRIMARY_OUTPUT_KEY, type ActiveExecution, type RuntimeContext } from './runtimeState';

const POLL_INTERVAL_MS = 2500;
const POLL_ERROR_INTERVAL_MS = 5000;

export function createPolling(ctx: RuntimeContext) {
  const {
    host, doFetchJobStatus, doFetchRecoveryPage, active, timers,
    unavailableOutputItems, intents, recoveryItemIdOf, readMarker, owns,
    clearTimer, setLedger, queueSettleIntent, schedule,
  } = ctx;

  const poll = (execution: ActiveExecution, jobId: string) => {
    clearTimer(execution.nodeId);
    const tick = () => {
      doFetchJobStatus(jobId)
        .then((detail) => {
          if (!owns(execution, jobId)) return;
          if (detail.status === 'succeeded' || detail.status === 'failed' || detail.status === 'cancelled') {
            timers.delete(execution.nodeId);
            converge(execution, jobId, detail);
            return;
          }
          if (detail.status === 'checking') {
            execution.phase = 'checking';
            host.patchNode(execution.nodeId, { genStatus: 'checking', progress: undefined });
          } else {
            execution.phase = 'generating';
            host.patchNode(execution.nodeId, { genStatus: 'generating', progress: detail.progress });
          }
          timers.set(execution.nodeId, schedule(tick, POLL_INTERVAL_MS));
        })
        .catch(() => {
          if (!owns(execution, jobId)) return;
          timers.set(execution.nodeId, schedule(tick, POLL_ERROR_INTERVAL_MS));
        });
    };
    tick();
  };

  const converge = (execution: ActiveExecution, jobId: string, detail: JobDetail) => {
    const nodeId = execution.nodeId;
    clearTimer(nodeId);
    const mediaType = detail.asset?.type === 'video' || detail.asset?.type === 'audio' ? detail.asset.type : 'image';
    if (detail.status === 'succeeded') host.rememberAsset(detail.asset, mediaType);
    host.applyTerminal(nodeId, jobId, detail);
    if (detail.status === 'cancelled') {
      active.delete(nodeId);
      host.clearActiveJob(nodeId);
      queueSettleIntent(execution);
      return;
    }
    if (detail.status === 'failed') {
      active.delete(nodeId);
      host.clearActiveJob(nodeId);
      return;
    }
    const finishExecution = () => {
      if (active.get(nodeId) !== execution) return;
      active.delete(nodeId);
      host.clearActiveJob(nodeId);
    };
    if (host.findNode(nodeId) == null) { finishExecution(); return; }
    if (detail.status === 'succeeded') host.patchNode(nodeId, { jobId });
    const submissionId = execution.submissionId ?? readMarker(host.findNode(nodeId)!.data)?.submissionId ?? null;
    if (submissionId == null) { finishExecution(); return; }
    const outputs = detail.output_assets ?? [];
    const multi = execution.def?.isMultiOutputSuccess?.(detail) ?? outputs.length > 1;
    if (multi) {
      void fanOutOutputs(execution, submissionId, jobId, detail).finally(finishExecution);
      return;
    }
    finishExecution();
    host.patchNode(nodeId, { generationRecovery: { protocolVersion: 1, submissionId, outputKey: PRIMARY_OUTPUT_KEY } });
    intents.set(submissionId, { kind: 'convert' });
    setLedger({
      recoveryItemId: recoveryItemIdOf(submissionId, PRIMARY_OUTPUT_KEY),
      submissionId, outputKey: PRIMARY_OUTPUT_KEY, nodeId,
      state: 'pending', revision: 0,
    });
  };

  const fanOutOutputs = async (execution: ActiveExecution, submissionId: string, jobId: string, knownDetail?: JobDetail, knownRecord?: GenerationRecoveryRecord) => {
    const nodeId = execution.nodeId;
    try {
      if (!owns(execution, jobId)) return;
      let record = knownRecord ?? null;
      if (record == null) {
        let cursor: string | null = null;
        do {
          const page = await doFetchRecoveryPage(execution.projectId, { cursor });
          if (!owns(execution, jobId)) return;
          record = page.records.find((item) => item.submission_id === submissionId) ?? null;
          cursor = page.next_cursor;
        } while (record == null && cursor != null);
      }
      const outputs = record?.items.filter((item) => item.output_key !== TARGET_OUTPUT_KEY
        && item.state !== 'removed' && item.state !== 'transferred') ?? [];
      if (outputs.length === 0) {
        host.patchNode(nodeId, { genStatus: undefined, progress: 100 });
        return;
      }
      const detail = knownDetail ?? await doFetchJobStatus(jobId).catch(() => null);
      if (!owns(execution, jobId)) return;
      const assets = detail?.output_assets ?? (detail?.asset ? [detail.asset] : []);
      const views = outputs.flatMap((item) => {
        const asset = item.asset_id != null
          ? assets.find((a) => String(a.id) === String(item.asset_id))
          : outputs.length === 1 && item.output_key === PRIMARY_OUTPUT_KEY && item.node_id === nodeId && assets.length === 1
            ? assets[0] : undefined;
        if (asset == null || !asset.id || typeof asset.url !== 'string' || !asset.url.trim()
          || (asset.type !== 'video' && asset.type !== 'audio' && asset.type !== 'image')) return [];
        return [{
          outputKey: item.output_key,
          nodeId: item.node_id,
          assetId: asset.id,
          url: asset.url,
          mediaType: asset.type,
          ...(asset.width != null ? { width: asset.width } : {}),
          ...(asset.height != null ? { height: asset.height } : {}),
          ...(asset.duration != null ? { duration: asset.duration } : {}),
        }];
      });
      if (views.length !== outputs.length) {
        for (const item of outputs) unavailableOutputItems.add(item.recovery_item_id);
        if (host.findNode(nodeId) == null) {
          const seed = record?.recovery_seed?.target;
          const snapshot = record?.previous_target_snapshot as Partial<RuntimeNodeView> | null;
          const plan = record && execution.def?.planRecovery?.(record, host);
          const plannedTarget = plan?.kind === 'apply-outputs' ? plan.unavailableTarget : undefined;
          host.insertMediaNode({
            id: nodeId, type: 'mediaNode',
            position: snapshot?.position ?? plannedTarget?.position ?? { x: seed?.x ?? 0, y: seed?.y ?? 0 },
            data: {
              ...plannedTarget?.data,
              fileName: seed?.name || plannedTarget?.data.fileName || '生成结果',
              mediaType: plannedTarget?.data.mediaType ?? (record?.task_type === 'video_scene_split' || record?.task_type === 'video' ? 'video'
                : record?.task_type === 'vocal_split' || record?.task_type === 'audio' ? 'audio' : 'image'),
              ...(seed ? { width: seed.width, height: seed.height } : {}),
              ...(snapshot?.width != null ? { width: snapshot.width } : {}),
              ...(snapshot?.height != null ? { height: snapshot.height } : {}),
              ...snapshot?.data, jobId,
            },
          });
          for (const source of record?.recovery_seed?.sources ?? []) {
            if (host.findNode(source.node_id) != null) host.addEdge(source.node_id, nodeId);
          }
        }
        host.patchNode(nodeId, { genStatus: undefined, progress: 100 });
        host.toast('warn', '生成结果当前不可用，原卡已保留，请核对素材');
        active.delete(nodeId);
        host.clearActiveJob(nodeId);
        return;
      }
      for (const item of outputs) unavailableOutputItems.delete(item.recovery_item_id);
      const anchor = host.findNode(nodeId);
      const anchorPos = anchor?.position ?? { x: 0, y: 0 };
      const def = execution.def;
      const plan = def?.planFanoutCards
        ? def.planFanoutCards({ jobId, submissionId, anchor, host, outputs: views, detail: detail ?? ({} as JobDetail) })
        : {
          nodes: views.map((item, index) => ({
            id: item.nodeId,
            position: { x: Math.round(anchorPos.x + index * 320), y: Math.round(anchorPos.y + 260) },
            data: { fileName: `生成-${jobId}-${index + 1}`, mediaType: item.mediaType, jobId },
          })),
          edges: [],
        };
      const cardByNodeId = new Map(plan.nodes.map((card) => [card.id, card]));
      const reusesTarget = outputs.some((item) => item.node_id === nodeId);
      if (!reusesTarget) {
        host.markLocallyRemoved(nodeId);
        host.removeMediaNode(nodeId);
      }
      outputs.forEach((item) => {
        const card = cardByNodeId.get(item.node_id);
        if (card == null) return;
        const view = views.find((candidate) => candidate.nodeId === item.node_id);
        const existing = host.findNode(item.node_id);
        const existingMarker = readMarker(existing?.data);
        const applied = existing != null && existingMarker != null
          && existingMarker.submissionId === submissionId && existingMarker.outputKey === item.output_key;
        if (existing == null) {
          host.insertMediaNode({
            id: item.node_id,
            type: 'mediaNode',
            position: card.position,
            data: {
              ...card.data,
              src: view?.url ?? '',
              ...(view?.assetId != null ? { assetId: view.assetId } : {}),
              generationRecovery: { protocolVersion: 1, submissionId, outputKey: item.output_key },
            },
          });
        } else if (!applied) {
          host.patchNode(item.node_id, {
            src: view?.url ?? '',
            ...(view?.assetId != null ? { assetId: view.assetId } : {}),
            jobId,
            ...(view?.mediaType != null ? { mediaType: view.mediaType } : {}),
            ...(view?.duration != null ? { duration: view.duration } : {}),
            generationRecovery: { protocolVersion: 1, submissionId, outputKey: item.output_key },
            genStatus: undefined,
            progress: 100,
          });
        }
        setLedger({
          recoveryItemId: item.recovery_item_id,
          submissionId, outputKey: item.output_key, nodeId: item.node_id,
          state: item.state, revision: item.revision,
        });
      });
      for (const edge of plan.edges) {
        host.addEdge(edge.source, edge.target, undefined, edge.origin != null ? { origin: edge.origin } : undefined);
      }
      intents.set(submissionId, { kind: 'convert' });
      const fanOutProject = host.getProjectId() ?? execution.projectId;
      if (fanOutProject) void host.saveCanvas(fanOutProject).catch(() => {});
    } catch (e) {
      console.warn('[generation-runtime] 多结果投影失败，占位卡保留:', e);
      if (!owns(execution, jobId)) return;
      host.patchNode(nodeId, { genStatus: undefined, progress: 100 });
    }
  };

  return { poll, converge, fanOutOutputs };
}
