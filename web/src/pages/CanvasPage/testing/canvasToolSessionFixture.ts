import type { Node } from '@xyflow/react';
import {
  createCanvasToolSessions,
  type CanvasToolHosts,
  type CanvasToolKind,
  type CanvasToolView,
} from '../canvasToolSessions';
import { buildAudioVideoMuxIdentity } from '../audioVideoMux';
import { buildImageOutpaintInput } from '../imageOutpaint';

export function canvasToolSessionFixture() {
  let projectId = 'p1';
  const warnings: string[] = [],
    errors: string[] = [],
    selected: string[] = [],
    handedOff: string[] = [];
  let taskCount = 0,
    draftCount = 0,
    dismissed = 0,
    inFlight = false;
  const pending: { resolve(): void; reject(error: Error): void }[] = [];
  const nodes: Node[] = ['image', 'video', 'audio'].map((type, i) => ({
    id: type,
    type: 'mediaNode',
    position: { x: i * 600, y: 0 },
    data: {
      mediaType: type,
      assetId: String(i + 1),
      src: `https://assets/${type}.png`,
      fileName: `${type}.mp3`,
      width: 1024,
      height: 768,
      duration: 30,
      mime: 'image/png',
    },
  }));
  for (const kind of [
    'imageEnhance',
    'videoEnhance',
    'frameInterpolation',
  ] as const)
    nodes.push({
      id: kind,
      type: 'mediaNode',
      position: { x: 0, y: 400 },
      data: {
        mediaType: kind === 'imageEnhance' ? 'image' : 'video',
        draft: true,
        [kind]: { sourceAssetId: '1' },
      },
    });
  const task = () => {
    taskCount += 1;
    return new Promise<void>((resolve, reject) =>
      pending.push({ resolve, reject }),
    );
  };
  const getNode = (id: string) => nodes.find((node) => node.id === id);
  const common = {
    getProjectId: () => projectId,
    getSourceNode: getNode,
    getNode,
    newTargetId: () => 'result',
    warn: (message: string) => warnings.push(message),
    error: (message: string) => errors.push(message),
  };
  const createTask = async () => {
    await task();
    return { job_id: 'job' };
  };
  const handoff = async () => {
    handedOff.push('job');
  };
  const hosts: CanvasToolHosts = {
    erase: {
      ...common,
      encodeMask: async () => new File(['mask'], 'mask.png'),
      uploadMask: async () => ({ asset_id: 'mask' }),
      createTask,
      handoff,
    },
    subtitleErase: { ...common, createTask, handoff },
    audioVideoSplit: { ...common, createTask, handoff },
    audioTrim: { ...common, createTask, handoff },
    audioSpeed: {
      ...common,
      createTask,
      handoff: async (_, __, beforeApply) => {
        beforeApply();
        await handoff();
      },
    },
    // IKJJR5：人声分离发送即退会话、任务链路归宿主 runTask（pending promise 模式同 task）
    vocalSplit: { ...common, runTask: task },
    sceneSplit: { ...common, isSending: () => false, runTask: task },
    smartMatting: {
      ...common,
      newClientToken: () => 'token',
      isSending: () => false,
      runTask: task,
    },
    cutout: { ...common, createTask, handoff },
    outpaint: {
      ...common,
      clearPickState() {},
      prepareTask: (input) => ({
        projectId: input.projectId,
        source: input.source,
        targetNodeId: 'result',
        payload: buildImageOutpaintInput(
          input.sourceAssetId,
          'result',
          input.ratios,
        )!,
      }),
      startTask: task,
    },
    crop: {
      ...common,
      uploadFile: async () => {
        await task();
        return {
          asset_id: 'crop',
          status: 'ready',
          type: 'image',
          duration: null,
          url: 'https://assets/crop.png',
          width: 1024,
          height: 768,
          mime: 'image/png',
          size: 100,
        };
      },
      handoff: () => {
        handedOff.push('crop');
      },
    },
    audioMix: {
      ...common,
      isInFlight: () => inFlight,
      setInFlight: (value) => {
        inFlight = value;
      },
      canApply: (id) => id === projectId,
      linkAssets: async () => {},
      createTask,
      handoff,
    },
    audioVideoMux: {
      ...common,
      createDraft(source) {
        const id = `mux-${++draftCount}`;
        nodes.push({
          id,
          type: 'mediaNode',
          position: { x: 600, y: 600 },
          data: {
            mediaType: 'video',
            draft: true,
            audioVideoMux: buildAudioVideoMuxIdentity(
              source.id,
              String(source.data.assetId),
            ),
          },
        });
        return id;
      },
      patchIdentity: (id, identity) => {
        getNode(id)!.data.audioVideoMux = identity;
      },
      removeBindEdges() {},
      addVideoEdge() {},
      isInFlight: () => inFlight,
      setInFlight: (value) => {
        inFlight = value;
      },
      canApply: (id) => id === projectId,
      createTask,
      handoff,
    },
    panels: {
      ...common,
      getNodes: () => nodes,
      canOpen: () => true,
      activate() {},
      isValidTarget: (id, kind) => Boolean(getNode(id)?.data[kind]),
      isFrameInFlight: () => false,
      isVideoEnhanceInFlight: () => false,
      startImage: task,
      startVideo: task,
      startFrame: async () => {
        await task();
        return true;
      },
      httpError: (message) => errors.push(message),
    },
  };
  const deps = {
    dismissGenPanels: () => {
      dismissed += 1;
    },
    selectNode: (id: string) => selected.push(id),
  };
  const view: CanvasToolView = {
    nodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    size: { width: 1200, height: 900 },
    nodeBox: () => ({ width: 280, height: 324 }),
    projectId,
    submittingNodeId: null,
    dragHiddenIds: null,
    createEnhanceDraft: (id) => id,
    createVideoEnhanceDraft: (id) => id,
    createFrameInterpolationDraft: (id) => id,
    changeVideoParams() {},
    changeFrameParams() {},
  };
  const tools = createCanvasToolSessions(
    () => hosts,
    () => view,
    () => deps,
  );
  tools.runtime.setProject(projectId);
  const open: Record<CanvasToolKind, () => boolean> = {
    erase: () => tools.entries.erase.handle.open('image', deps),
    cutout: () => tools.entries.cutout.handle.open('image', deps),
    crop: () => tools.entries.crop.handle.open('image', deps),
    outpaint: () => tools.entries.outpaint.handle.open('image', deps),
    subtitleErase: () =>
      tools.entries.subtitleErase.handle.open(
        { nodeId: 'video', mode: 'smart' },
        deps,
      ),
    audioVideoSplit: () =>
      tools.entries.audioVideoSplit.handle.open('video', deps),
    audioTrim: () => tools.entries.audioTrim.handle.open('audio', deps),
    audioMix: () => tools.entries.audioMix.handle.open('audio', deps),
    audioSpeed: () => tools.entries.audioSpeed.handle.open('audio', deps),
    sceneSplit: () => tools.entries.sceneSplit.handle.open('video', deps),
    vocalSplit: () => tools.entries.vocalSplit.handle.open('video', deps),
    smartMatting: () =>
      tools.entries.smartMatting.handle.open(
        { nodeId: 'video', mode: 'portrait' },
        deps,
      ),
    audioVideoMux: () =>
      tools.entries.audioVideoMux.handle.open({ sourceNodeId: 'audio' }, deps),
    imageEnhance: () =>
      tools.entries.imageEnhance.handle.open('imageEnhance', deps),
    videoEnhance: () =>
      tools.entries.videoEnhance.handle.open('videoEnhance', deps),
    frameInterpolation: () =>
      tools.entries.frameInterpolation.handle.open('frameInterpolation', deps),
  };
  const launch: Record<CanvasToolKind, () => void> = {
    erase: () => tools.callbacks.onEraseImage!('image'),
    cutout: () => tools.callbacks.onCutoutImage!('image'),
    crop: () => tools.callbacks.onCropImage!('image'),
    outpaint: () => tools.callbacks.onOutpaintImage!('image'),
    subtitleErase: () =>
      tools.callbacks.onVideoSubtitleErase!('video', 'smart'),
    audioVideoSplit: () => tools.callbacks.onAudioVideoSplit!('video'),
    audioTrim: () => tools.callbacks.onTrimAudio!('audio'),
    audioMix: () => tools.callbacks.onMixAudio!('audio'),
    audioSpeed: () => tools.callbacks.onAudioSpeed!('audio'),
    sceneSplit: () => tools.callbacks.onSceneSplit!('video'),
    vocalSplit: () => tools.callbacks.onVocalBackgroundSplit!('video'),
    smartMatting: () => tools.callbacks.onSmartMatting!('video', 'portrait'),
    audioVideoMux: () => tools.callbacks.onComposeAudioVideo!('audio'),
    imageEnhance: () => tools.callbacks.onEnhanceImage!('imageEnhance'),
    videoEnhance: () => tools.callbacks.onVideoEnhance!('videoEnhance'),
    frameInterpolation: () =>
      tools.callbacks.onFrameInterpolation!('frameInterpolation'),
  };
  const send: Record<CanvasToolKind, () => boolean> = {
    erase: () => tools.entries.erase.handle.send('text'),
    cutout: tools.entries.cutout.handle.send,
    crop: tools.entries.crop.handle.send,
    outpaint: () => {
      tools.entries.outpaint.handle.edit((state) => ({
        ...state,
        expands: { top: 20, bottom: 0, left: 0, right: 0 },
      }));
      return tools.entries.outpaint.handle.send();
    },
    subtitleErase: tools.entries.subtitleErase.handle.send,
    audioVideoSplit: tools.entries.audioVideoSplit.handle.send,
    audioTrim: tools.entries.audioTrim.handle.send,
    audioMix: () => {
      tools.entries.audioMix.handle.edit((state) => ({
        ...state,
        selectedInputs: [
          { assetId: '9', name: '混合', src: 'https://assets/other.mp3' },
        ],
      }));
      return tools.entries.audioMix.handle.send();
    },
    audioSpeed: () => {
      tools.entries.audioSpeed.handle.edit((state) => ({ ...state, speed: 2 }));
      return tools.entries.audioSpeed.handle.send();
    },
    sceneSplit: tools.entries.sceneSplit.handle.send,
    vocalSplit: tools.entries.vocalSplit.handle.send,
    smartMatting: tools.entries.smartMatting.handle.send,
    audioVideoMux: () => {
      const id =
        tools.entries.audioVideoMux.handle.getSnapshot().state!.draftId;
      const node = getNode(id)!;
      node.data.audioVideoMux = {
        ...buildAudioVideoMuxIdentity('audio', '3'),
        video: {
          assetId: '2',
          nodeId: 'video',
          name: '视频',
          duration: 30,
          width: 1024,
          height: 768,
        },
      };
      return tools.entries.audioVideoMux.handle.send();
    },
    imageEnhance: () =>
      tools.entries.imageEnhance.handle.send({
        version_tier: 'lite',
        multiple: 2,
        generative_enhance_mode: 'fidelity_first',
        enable_correct_color: false,
      }),
    videoEnhance: () => tools.entries.videoEnhance.handle.send('4k'),
    frameInterpolation: () => tools.entries.frameInterpolation.handle.send(60),
  };
  return {
    tools,
    hosts,
    view,
    deps,
    nodes,
    open,
    launch,
    send,
    pending,
    warnings,
    errors,
    selected,
    handedOff,
    setProject(id: string) {
      projectId = id;
      view.projectId = id;
      tools.runtime.setProject(id);
    },
    taskCount: () => taskCount,
    draftCount: () => draftCount,
    dismissed: () => dismissed,
    inFlight: () => inFlight,
  };
}
