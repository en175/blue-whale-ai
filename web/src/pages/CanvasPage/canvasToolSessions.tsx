import { useEffect, type ComponentProps } from 'react';
import type { Node, Viewport } from '@xyflow/react';
import {
  createToolSessionRuntime,
  type ToolSessionHandle,
} from './toolSessionRuntime';
import type { ToolSessionDeps } from './toolSessionCoordinator';
import { assembleCanvasTools, registerCanvasTool } from './canvasToolRegistry';
import {
  createAudioTrimSession,
  createAudioSpeedSession,
  createVocalSplitSession,
  type AudioToolSessionHost,
  type VocalSplitSessionHost,
  type AudioSpeedSessionHost,
} from './audioToolSessions';
import type { AudioTrimInput } from '@lib/contracts/audio-trim';
import {
  createAudioVideoSplitSession,
  type AudioVideoSplitHost,
} from './audioVideoSplitSession';
import {
  createSceneSplitSession,
  type SceneSplitHost,
} from './sceneSplitSession';
import {
  createSmartMattingSession,
  type SmartMattingHost,
} from './smartMattingSession';
import {
  createCutoutSession,
  createOutpaintSession,
  applyOutpaintPreset,
  type CutoutHost,
  type OutpaintHost,
} from './imageToolSessions';
import {
  createCropSession,
  cropBoundsOf,
  cropSpaceOf,
  applyCropPreset,
  type CropHost,
} from './cropSession';
import {
  createImageEraseSession,
  createSubtitleEraseSession,
  beginEraseStroke,
  moveEraseStroke,
  endEraseStroke,
  beginSubtitleBox,
  moveSubtitleBox,
  endSubtitleBox,
  type ImageEraseHost,
  type SubtitleEraseHost,
} from './maskToolSessions';
import {
  createAudioMixSession,
  addAudioMixInput,
  createAudioVideoMuxSession,
  bindAudioVideoMuxWire,
  bindAudioVideoMuxVideo,
  unbindAudioVideoMux,
  editAudioVideoMuxParams,
  type AudioMixHost,
  type AudioVideoMuxHost,
} from './compoundToolSessions';
import {
  createImageEnhanceSession,
  createVideoEnhanceSession,
  createFrameInterpolationSession,
  type PanelToolHost,
} from './panelToolSessions';
import {
  mediaContentBox,
  MEDIA_CONTENT_TOP_OFFSET,
} from './components/MediaNode/mediaContentSize';
import { mediaCardToolbarVisible } from './components/MediaNode/toolbarVisibility';
import { computeFollowAnchor, FOLLOW_PAD, FOLLOW_GAP } from './followDialog';
import {
  canUndoMaskEdit,
  canRedoMaskEdit,
  undoMaskEdit,
  redoMaskEdit,
} from './eraseMask';
import {
  canUndoSubtitleBoxEdit,
  canRedoSubtitleBoxEdit,
  canResetSubtitleBoxEdit,
  canAddSubtitleBox,
  undoSubtitleBoxEdit,
  redoSubtitleBoxEdit,
  resetSubtitleBoxEdit,
} from './subtitleEraseBoxes';
import { maskHasPaintArea } from './imageErase';
import { imageCutoutSceneGateReason } from './imageCutout';
import { minCropSideDisplay } from './imageCrop';
import {
  audioVideoMuxIdentityOf,
  audioVideoMuxVideoError,
  isAudioVideoMuxDraftNode,
} from './audioVideoMux';
import { isEditableKeyboardTarget } from './components/Canvas/keyboardDelete';
import ImageEraseDialog from './components/ImageEraseDialog';
import VideoSubtitleEraseDialog from './components/VideoSubtitleEraseDialog';
import VideoAudioSplitDialog from './components/VideoAudioSplitDialog';
import AudioTrimBar from './components/AudioTrimBar';
import AudioSpeedBar from './components/AudioSpeedBar';
import AudioMixBar from './components/AudioMixBar';
import AudioVideoMuxPanel from './components/AudioVideoMuxPanel';
import VocalSplitDialog from './components/VocalSplitDialog';
import SceneSplitDialog from './components/SceneSplitDialog';
import SmartMattingDialog from './components/SmartMattingDialog';
import CutoutToolbar from './components/CutoutToolbar';
import CropDialog from './components/CropDialog';
import OutpaintDialog from './components/OutpaintDialog';
import ImageEnhanceDialog from './components/ImageEnhanceDialog';
import VideoEnhanceDialog from './components/VideoEnhanceDialog';
import FrameInterpolationDialog from './components/FrameInterpolationDialog';

export interface CanvasToolHosts {
  erase: ImageEraseHost;
  subtitleErase: SubtitleEraseHost;
  audioVideoSplit: AudioVideoSplitHost;
  audioTrim: AudioToolSessionHost<AudioTrimInput>;
  audioSpeed: AudioSpeedSessionHost;
  vocalSplit: VocalSplitSessionHost;
  sceneSplit: SceneSplitHost;
  smartMatting: SmartMattingHost;
  cutout: CutoutHost;
  outpaint: OutpaintHost;
  crop: CropHost;
  audioMix: AudioMixHost;
  audioVideoMux: AudioVideoMuxHost;
  panels: PanelToolHost;
}
export interface CanvasToolView {
  nodes: Node[];
  viewport: Viewport;
  size: { width: number; height: number };
  nodeBox(node: Node): { width: number; height: number };
  projectId: string | null;
  submittingNodeId: string | null;
  /** IKJR9J：当前被拖卡 id 集合（null=无拖拽），锚定卡命中即拖拽隐藏其浮层 */
  dragHiddenIds: Set<string> | null;
  createEnhanceDraft(id: string): string | undefined;
  createVideoEnhanceDraft(id: string): string | undefined;
  createFrameInterpolationDraft(id: string): string | undefined;
  changeVideoParams(
    id: string,
    resolution: Parameters<
      NonNullable<ComponentProps<typeof VideoEnhanceDialog>['onParamsChange']>
    >[0],
  ): void;
  changeFrameParams(
    id: string,
    fps: Parameters<
      NonNullable<
        ComponentProps<typeof FrameInterpolationDialog>['onParamsChange']
      >
    >[0],
  ): void;
}

/** 面板装配所需的最小句柄面：草稿卡可见性与悬浮工具条节点只读快照并按 nodeId 开会话。 */
type PanelAssemblyHandle = Pick<
  ToolSessionHandle<{ nodeId: string }, string>,
  'getSnapshot' | 'open'
>;
/** 唯一工具注册入口。状态、提交定义、专属 UI 和原节点回调在同一注册项内绑定。 */
export function createCanvasToolSessions(
  getHosts: () => Partial<CanvasToolHosts>,
  getView: () => CanvasToolView,
  getDeps: () => ToolSessionDeps,
) {
  const runtime = createToolSessionRuntime();
  const nodeOf = (id: string) => getView().nodes.find((node) => node.id === id);
  function centerAnchor(
    node: Node | undefined,
    halfWidth: number,
    top = false,
    compact = false,
  ) {
    const { size, viewport, nodeBox } = getView();
    if (!node || size.width <= 0) return null;
    const box = nodeBox(node),
      zoom = viewport.zoom || 1;
    const center = Math.round(
      node.position.x * zoom + viewport.x + (box.width * zoom) / 2,
    );
    const pad = compact ? 0 : FOLLOW_PAD;
    return {
      left: Math.max(
        pad + halfWidth,
        Math.min(center, size.width - halfWidth - pad),
      ),
      top: top
        ? Math.round(Math.max(8, node.position.y * zoom + viewport.y - 52))
        : compact
          ? Math.max(
              8,
              Math.round(
                node.position.y * zoom + viewport.y + box.height * zoom + 16,
              ),
            )
          : Math.round(
              node.position.y * zoom +
                viewport.y +
                box.height * zoom +
                FOLLOW_GAP,
            ),
    };
  }
  function panelAnchor(node: Node | undefined) {
    const { size, viewport, nodeBox } = getView();
    if (!node || size.width <= 0) return null;
    const box = nodeBox(node);
    return computeFollowAnchor({
      nodeX: node.position.x,
      nodeY: node.position.y,
      nodeWidth: box.width,
      nodeHeight: box.height,
      viewport,
      containerWidth: size.width,
      containerHeight: size.height,
      dialogWidth: 320,
    });
  }
  /** IKJR9J 拖拽隐藏命中判定：仅浮层锚定卡在被拖集合中才隐藏（拖别的卡原地不动） */
  const dragHiddenOf = (id: string | undefined | null) =>
    id != null && (getView().dragHiddenIds?.has(id) ?? false);
  /** 高清/HD 面板共享装配：草稿卡可见性与悬浮工具条节点，差异仅素材身份属性（插帧为重开重建模式，不并入）。 */
  const enhancePanelDraft = (
    identityKey: 'imageEnhance' | 'videoEnhance',
    h: PanelAssemblyHandle,
    node: Node,
  ) => {
    const v = h.getSnapshot();
    return node.type === 'mediaNode' && node.data[identityKey]
      ? {
          hidden: v.hidden === true,
          visible: v.visible === true && v.state?.nodeId === node.id,
          open: () => {
            h.open(node.id, getDeps());
          },
        }
      : null;
  };
  const enhancePanelToolbarNode = (h: PanelAssemblyHandle): Node | null => {
    const v = h.getSnapshot();
    const node = v.state && nodeOf(v.state.nodeId);
    return v.visible && node && mediaCardToolbarVisible(node.data)
      ? node
      : null;
  };
  const mark = (
    node: Node,
    target: string | undefined,
    patch: Record<string, unknown>,
  ) =>
    node.id === target
      ? { ...node, data: { ...node.data, soloToolbarHidden: true, ...patch } }
      : node;
  const entries = {
    erase: registerCanvasTool(
      runtime,
      createImageEraseSession(() => getHosts().erase!),
      {
        callbacks: (h) => ({
          onEraseImage: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) => {
          const s = h.getSnapshot().state;
          return mark(node, s?.nodeId, {
            eraseEditing: s && {
              ops: s.mask.ops,
              liveOp: s.liveOp,
              onStrokeStart: (point: Parameters<typeof beginEraseStroke>[1]) =>
                h.edit((state) => beginEraseStroke(state, point)),
              onStrokeMove: (point: Parameters<typeof moveEraseStroke>[1]) =>
                h.edit((state) => moveEraseStroke(state, point)),
              onStrokeEnd: () => h.edit(endEraseStroke),
            },
          });
        },
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          if (!s) return null;
          const node = nodeOf(s.nodeId),
            d = node?.data;
          const display = node
            ? mediaContentBox({
                mediaType: 'image',
                width: typeof d?.width === 'number' ? d.width : undefined,
                height: typeof d?.height === 'number' ? d.height : undefined,
              })
            : null;
          const space =
            display &&
            typeof d?.width === 'number' &&
            typeof d?.height === 'number'
              ? {
                  displayWidth: display.width,
                  displayHeight: display.height,
                  naturalWidth: d.width,
                  naturalHeight: d.height,
                }
              : null;
          return (
            <ImageEraseDialog
              onClose={h.close}
              onSendTextErase={() => h.send('text')}
              onSendMask={() => h.send('mask')}
              tool={s.tool}
              onToolChange={(tool) => h.edit((state) => ({ ...state, tool }))}
              brushRadius={s.brushRadius}
              onBrushRadiusChange={(brushRadius) =>
                h.edit((state) => ({ ...state, brushRadius }))
              }
              canUndo={canUndoMaskEdit(s.mask)}
              canRedo={canRedoMaskEdit(s.mask)}
              onUndo={() =>
                h.edit((state) => ({
                  ...state,
                  mask: undoMaskEdit(state.mask),
                }))
              }
              onRedo={() =>
                h.edit((state) => ({
                  ...state,
                  mask: redoMaskEdit(state.mask),
                }))
              }
              hasPaint={
                display
                  ? maskHasPaintArea(s.mask.ops, display.width, display.height)
                  : s.mask.ops.some((op) => !op.erase)
              }
              maskSpace={space}
              submitting={submitting}
              toolbarAnchor={centerAnchor(node, 60, true, true)}
              sendBarAnchor={centerAnchor(node, 120)}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
    cutout: registerCanvasTool(
      runtime,
      createCutoutSession(() => getHosts().cutout!),
      {
        callbacks: (h) => ({
          onCutoutImage: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, {}),
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          const node = s && nodeOf(s.nodeId);
          if (!s || !node) return null;
          return (
            <CutoutToolbar
              onClose={h.close}
              scene={s.scene}
              onSceneChange={(scene) =>
                h.edit((state) => ({ ...state, scene }))
              }
              needContour={s.needContour}
              onNeedContourChange={(needContour) =>
                h.edit((state) => ({ ...state, needContour }))
              }
              contourSize={s.contourSize}
              onContourSizeChange={(contourSize) =>
                h.edit((state) => ({ ...state, contourSize }))
              }
              needCropBackground={s.needCropBackground}
              onNeedCropBackgroundChange={(needCropBackground) =>
                h.edit((state) => ({ ...state, needCropBackground }))
              }
              sendDisabledReason={imageCutoutSceneGateReason(
                node.data,
                s.scene,
              )}
              submitting={submitting}
              onSend={h.send}
              followAnchor={centerAnchor(node, 60, false, true)}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
    crop: registerCanvasTool(
      runtime,
      createCropSession(() => getHosts().crop!),
      {
        canvasLayers(h) {
          const s = h.getSnapshot().state;
          const node = s && nodeOf(s.nodeId);
          if (!s || !node) return { cropFrame: null };
          const bounds = cropBoundsOf(node),
            space = cropSpaceOf(node, bounds);
          return {
            cropFrame: {
              bounds,
              rect: s.rect,
              preset: s.preset,
              minSide: space ? minCropSideDisplay(space) : 0,
              onRectChange: (rect) => h.edit((state) => ({ ...state, rect })),
              onDarkAreaClick: h.close,
              dragHidden: dragHiddenOf(s.nodeId),
            },
          };
        },
        callbacks: (h) => ({
          onCropImage: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, { cropEditing: true }),
        render(h) {
          const s = h.getSnapshot().state;
          if (!s) return null;
          const node = nodeOf(s.nodeId);
          return (
            <CropDialog
              preset={s.preset}
              onPresetChange={(preset) => {
                if (node)
                  h.edit((state) => applyCropPreset(state, node, preset));
              }}
              onConfirm={h.send}
              onClose={h.close}
              followAnchor={centerAnchor(node, 190)}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
    outpaint: registerCanvasTool(
      runtime,
      createOutpaintSession(() => getHosts().outpaint!),
      {
        blocksCanvasDrag: (h) => h.getSnapshot().state !== null,
        canvasLayers(h) {
          const s = h.getSnapshot().state;
          const node = s && nodeOf(s.nodeId);
          return {
            outpaintFrame:
              s && node
                ? {
                    rect: outpaintGeometry(node).rect,
                    expands: s.expands,
                    onExpandChange: (expands) =>
                      h.edit((state) => ({ ...state, expands })),
                    dragHidden: dragHiddenOf(s.nodeId),
                  }
                : null,
          };
        },
        callbacks: (h) => ({
          onOutpaintImage: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, {}),
        render(h) {
          const s = h.getSnapshot().state;
          const node = s && nodeOf(s.nodeId);
          if (!s || !node) return null;
          const { rect } = outpaintGeometry(node),
            { size, viewport } = getView();
          const zoom = viewport.zoom || 1;
          const center =
            (rect.x -
              s.expands.left +
              (rect.width + s.expands.left + s.expands.right) / 2) *
              zoom +
            viewport.x;
          const anchor =
            size.width > 0
              ? {
                  left: Math.round(
                    Math.max(
                      FOLLOW_PAD + 180,
                      Math.min(center, size.width - FOLLOW_PAD - 180),
                    ),
                  ),
                  top: Math.round(
                    (node.position.y +
                      rect.height +
                      MEDIA_CONTENT_TOP_OFFSET +
                      s.expands.bottom) *
                      zoom +
                      viewport.y +
                      FOLLOW_GAP,
                  ),
                }
              : null;
          return (
            <OutpaintDialog
              onClose={h.close}
              sourceSize={{ width: rect.width, height: rect.height }}
              expands={s.expands}
              onPresetSelect={(preset) =>
                h.edit((state) => applyOutpaintPreset(state, node, preset))
              }
              onSend={h.send}
              followAnchor={anchor}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
    subtitleErase: registerCanvasTool(
      runtime,
      createSubtitleEraseSession(() => getHosts().subtitleErase!),
      {
        callbacks: (h) => ({
          onVideoSubtitleErase: (nodeId, mode) => {
            h.open({ nodeId, mode }, getDeps());
          },
        }),
        decorateNode(h, node) {
          const s = h.getSnapshot().state;
          return mark(node, s?.nodeId, {
            subtitleErasePaused: true,
            ...(s?.mode === 'box'
              ? {
                  subtitleEraseEditing: {
                    boxes: s.boxes.boxes,
                    liveBox: s.liveBox,
                    onBoxStart: (
                      point: Parameters<typeof beginSubtitleBox>[1],
                    ) =>
                      h.edit((state) =>
                        beginSubtitleBox(state, point, () =>
                          getHosts().subtitleErase!.warn(
                            '检测框最多 20 个，请先撤销后重试',
                          ),
                        ),
                      ),
                    onBoxMove: (point: Parameters<typeof moveSubtitleBox>[1]) =>
                      h.edit((state) => moveSubtitleBox(state, point)),
                    onBoxEnd: () => h.edit(endSubtitleBox),
                  },
                }
              : {}),
          });
        },
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          if (!s) return null;
          return (
            <VideoSubtitleEraseDialog
              mode={s.mode}
              onClose={h.close}
              onSend={h.send}
              canUndo={canUndoSubtitleBoxEdit(s.boxes)}
              canRedo={canRedoSubtitleBoxEdit(s.boxes)}
              canReset={canResetSubtitleBoxEdit(s.boxes)}
              onUndo={() =>
                h.edit((state) => ({
                  ...state,
                  boxes: undoSubtitleBoxEdit(state.boxes),
                }))
              }
              onRedo={() =>
                h.edit((state) => ({
                  ...state,
                  boxes: redoSubtitleBoxEdit(state.boxes),
                }))
              }
              onReset={() =>
                h.edit((state) => ({
                  ...state,
                  boxes: resetSubtitleBoxEdit(state.boxes),
                }))
              }
              boxLimitReached={!canAddSubtitleBox(s.boxes)}
              submitting={submitting}
              sendBlockedReason={
                s.mode === 'box' && s.boxes.boxes.length === 0
                  ? '请先拉框：在画面上拉矩形框圈出要擦除的字幕区域'
                  : null
              }
              sendBarAnchor={centerAnchor(nodeOf(s.nodeId), 130)}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
    audioVideoSplit: registerCanvasTool(
      runtime,
      createAudioVideoSplitSession(() => getHosts().audioVideoSplit!),
      {
        callbacks: (h) => ({
          onAudioVideoSplit: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, { splitEditing: true }),
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          return (
            s && (
              <VideoAudioSplitDialog
                onClose={h.close}
                format={s.format}
                onFormatChange={(format) =>
                  h.edit((state) => ({ ...state, format }))
                }
                onSend={h.send}
                submitting={submitting}
                sendBarAnchor={centerAnchor(nodeOf(s.nodeId), 130)}
                dragHidden={dragHiddenOf(s.nodeId)}
              />
            )
          );
        },
      },
    ),
    audioTrim: registerCanvasTool(
      runtime,
      createAudioTrimSession(() => getHosts().audioTrim!),
      {
        callbacks: (h) => ({
          onTrimAudio: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode(h, node) {
          const s = h.getSnapshot().state;
          return mark(node, s?.nodeId, {
            trimEditing: {
              selection: s?.selection ?? { start: 0, end: 0 },
              duration:
                typeof node.data.duration === 'number' ? node.data.duration : 0,
              onSelectionChange: (
                selection: NonNullable<typeof s>['selection'],
              ) => h.edit((state) => ({ ...state, selection })),
            },
          });
        },
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          return (
            s && (
              <AudioTrimBar
                onClose={h.close}
                start={s.selection.start}
                end={s.selection.end}
                format={s.format}
                onFormatChange={(format) =>
                  h.edit((state) => ({ ...state, format }))
                }
                onSend={h.send}
                submitting={submitting}
                anchor={centerAnchor(nodeOf(s.nodeId), 130)}
                dragHidden={dragHiddenOf(s.nodeId)}
              />
            )
          );
        },
      },
    ),
    audioMix: registerCanvasTool(
      runtime,
      createAudioMixSession(() => getHosts().audioMix!),
      {
        callbacks: (h) => ({
          onMixAudio: (id) => {
            h.open(id, getDeps());
          },
        }),
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          const node = s && nodeOf(s.sourceNodeId);
          if (!s || !node) return null;
          return (
            <AudioMixBar
              source={node}
              candidates={getView().nodes.filter(
                (n) =>
                  n.id !== node.id &&
                  n.type === 'mediaNode' &&
                  n.data?.mediaType === 'audio',
              )}
              selected={s.selectedInputs}
              onAdd={(input) =>
                h.edit((state) =>
                  addAudioMixInput(getHosts().audioMix!, state, input),
                )
              }
              onRemove={(assetId) =>
                h.edit((state) => ({
                  ...state,
                  selectedInputs: state.selectedInputs.filter(
                    (input) => input.assetId !== assetId,
                  ),
                }))
              }
              projectId={getView().projectId ?? ''}
              format={s.format}
              onFormatChange={(format) =>
                h.edit((state) => ({ ...state, format }))
              }
              onSend={h.send}
              onClose={h.close}
              submitting={submitting}
              anchor={centerAnchor(node, 170)}
              dragHidden={dragHiddenOf(s.sourceNodeId)}
            />
          );
        },
      },
    ),
    audioSpeed: registerCanvasTool(
      runtime,
      createAudioSpeedSession(() => getHosts().audioSpeed!),
      {
        callbacks: (h) => ({
          onAudioSpeed: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, {
            speedEditing: { speed: h.getSnapshot().state?.speed ?? 1 },
          }),
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          return (
            s && (
              <AudioSpeedBar
                onClose={h.close}
                speed={s.speed}
                onSpeedChange={(speed) =>
                  h.edit((state) => ({ ...state, speed }))
                }
                onSend={h.send}
                submitting={submitting}
                anchor={centerAnchor(nodeOf(s.nodeId), 130)}
                dragHidden={dragHiddenOf(s.nodeId)}
              />
            )
          );
        },
      },
    ),
    sceneSplit: registerCanvasTool(
      runtime,
      createSceneSplitSession(() => getHosts().sceneSplit!),
      {
        callbacks: (h) => ({
          onSceneSplit: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, { splitEditing: true }),
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          return (
            s && (
              <SceneSplitDialog
                onClose={h.close}
                granularity={s.granularity}
                onGranularityChange={(granularity) =>
                  h.edit((state) => ({ ...state, granularity }))
                }
                onSend={h.send}
                submitting={submitting}
                sendBarAnchor={centerAnchor(nodeOf(s.nodeId), 130)}
                dragHidden={dragHiddenOf(s.nodeId)}
              />
            )
          );
        },
      },
    ),
    vocalSplit: registerCanvasTool(
      runtime,
      createVocalSplitSession(() => getHosts().vocalSplit!),
      {
        callbacks: (h) => ({
          onVocalBackgroundSplit: (id) => {
            h.open(id, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, { splitEditing: true }),
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          return (
            s && (
              <VocalSplitDialog
                onClose={h.close}
                scene={s.scene}
                onSceneChange={(scene) =>
                  h.edit((state) => ({ ...state, scene }))
                }
                format={s.format}
                onFormatChange={(format) =>
                  h.edit((state) => ({ ...state, format }))
                }
                onSend={h.send}
                submitting={submitting}
                sendBarAnchor={centerAnchor(nodeOf(s.nodeId), 130)}
                dragHidden={dragHiddenOf(s.nodeId)}
              />
            )
          );
        },
      },
    ),
    smartMatting: registerCanvasTool(
      runtime,
      createSmartMattingSession(() => getHosts().smartMatting!),
      {
        callbacks: (h) => ({
          onSmartMatting: (nodeId, mode) => {
            h.open({ nodeId, mode }, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          mark(node, h.getSnapshot().state?.nodeId, { splitEditing: true }),
        render(h) {
          const { state: s, submitting } = h.getSnapshot();
          return (
            s && (
              <SmartMattingDialog
                onClose={h.close}
                mode={s.mode}
                format={s.format}
                onFormatChange={(format) =>
                  h.edit((state) => ({ ...state, format }))
                }
                backgroundColor={s.backgroundColor}
                onBackgroundColorChange={(backgroundColor) =>
                  h.edit((state) => ({ ...state, backgroundColor }))
                }
                onSend={h.send}
                submitting={submitting}
                sendBarAnchor={centerAnchor(nodeOf(s.nodeId), 170)}
                dragHidden={dragHiddenOf(s.nodeId)}
              />
            )
          );
        },
      },
    ),
    audioVideoMux: registerCanvasTool(
      runtime,
      createAudioVideoMuxSession(() => getHosts().audioVideoMux!),
      {
        connect: (source, target) =>
          isAudioVideoMuxDraftNode(target)
            ? bindAudioVideoMuxWire(getHosts().audioVideoMux!, source, target)
            : null,
        wireStart: (h, nodeId) =>
          h.edit((state) => ({
            ...state,
            wireDragging:
              nodeId !== null &&
              audioVideoMuxVideoError(nodeOf(nodeId)) === null,
          })),
        draft: (h, node) =>
          node.type === 'mediaNode' && node.data.audioVideoMux
            ? {
                hidden: true,
                visible: h.getSnapshot().state?.draftId === node.id,
                open: () => {
                  h.open({ draftId: node.id }, getDeps());
                },
              }
            : null,
        callbacks: (h) => ({
          onComposeAudioVideo: (sourceNodeId) => {
            h.open({ sourceNodeId }, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          h.getSnapshot().state
            ? { ...node, data: { ...node.data, soloToolbarHidden: true } }
            : node,
        render(h) {
          const s = h.getSnapshot().state;
          const node = s && nodeOf(s.draftId);
          if (!s || !node) return null;
          return (
            <AudioVideoMuxPanel
              identity={audioVideoMuxIdentityOf(node)!}
              onClose={h.close}
              onReserveChange={(reserveAudio) =>
                editAudioVideoMuxParams(getHosts().audioVideoMux!, node.id, {
                  reserveAudio,
                })
              }
              onSyncChange={(sync) =>
                editAudioVideoMuxParams(getHosts().audioVideoMux!, node.id, {
                  sync,
                })
              }
              onBindLibraryVideo={(video) =>
                bindAudioVideoMuxVideo(
                  getHosts().audioVideoMux!,
                  node.id,
                  video,
                )
              }
              onUnbind={() =>
                unbindAudioVideoMux(getHosts().audioVideoMux!, node.id)
              }
              wireBinding={s.wireDragging}
              onSend={h.send}
              followAnchor={panelAnchor(node)}
              dragHidden={dragHiddenOf(s.draftId)}
            />
          );
        },
      },
    ),
    imageEnhance: registerCanvasTool(
      runtime,
      createImageEnhanceSession(() => getHosts().panels!),
      {
        draft: (h, node) => enhancePanelDraft('imageEnhance', h, node),
        toolbarNode: (h) => enhancePanelToolbarNode(h),
        callbacks: (h) => ({
          onEnhanceImage: (id) => {
            const draftId = getView().createEnhanceDraft(id);
            if (draftId) h.open(draftId, getDeps());
          },
        }),
        render(h) {
          const { state: s, visible, submitting } = h.getSnapshot();
          if (!visible || !s) return null;
          return (
            <ImageEnhanceDialog
              key={s.seed.ts}
              onClose={h.close}
              onSend={h.send}
              sourceDims={s.seed.sourceDims}
              initialParams={s.seed.initialParams}
              generating={nodeOf(s.nodeId)?.data.genStatus === 'generating'}
              submitting={submitting || getView().submittingNodeId === s.nodeId}
              followAnchor={panelAnchor(nodeOf(s.nodeId))}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
    videoEnhance: registerCanvasTool(
      runtime,
      createVideoEnhanceSession(() => getHosts().panels!),
      {
        draft: (h, node) => enhancePanelDraft('videoEnhance', h, node),
        toolbarNode: (h) => enhancePanelToolbarNode(h),
        callbacks: (h) => ({
          onVideoEnhance: (id) => {
            const draftId = getView().createVideoEnhanceDraft(id);
            if (draftId) h.open(draftId, getDeps());
          },
        }),
        render(h) {
          const { state: s, visible, submitting } = h.getSnapshot();
          if (!visible || !s) return null;
          return (
            <VideoEnhanceDialog
              key={s.seed.ts}
              onClose={h.close}
              onSend={h.send}
              onParamsChange={(value) =>
                getView().changeVideoParams(s.nodeId, value)
              }
              initialResolution={s.seed.initialResolution}
              generating={nodeOf(s.nodeId)?.data.genStatus === 'generating'}
              submitting={submitting}
              followAnchor={panelAnchor(nodeOf(s.nodeId))}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
    frameInterpolation: registerCanvasTool(
      runtime,
      createFrameInterpolationSession(() => getHosts().panels!),
      {
        draft: (h, node) =>
          node.type === 'mediaNode' && node.data.frameInterpolation
            ? {
                hidden: h.getSnapshot().hidden === true,
                visible:
                  h.getSnapshot().visible === true &&
                  h.getSnapshot().state?.nodeId === node.id,
                open: () => {
                  h.open(node.id, getDeps());
                },
              }
            : null,
        modal: (h) => h.getSnapshot().visible === true,
        callbacks: (h) => ({
          onFrameInterpolation: (id) => {
            const draftId = getView().createFrameInterpolationDraft(id);
            if (draftId) h.open(draftId, getDeps());
          },
        }),
        decorateNode: (h, node) =>
          h.getSnapshot().visible
            ? { ...node, data: { ...node.data, soloToolbarHidden: true } }
            : node,
        render(h) {
          const { state: s, visible, submitting } = h.getSnapshot();
          if (!visible || !s) return null;
          return (
            <FrameInterpolationDialog
              key={s.seed.ts}
              onClose={h.close}
              onSend={h.send}
              onParamsChange={(fps) =>
                getView().changeFrameParams(s.nodeId, fps)
              }
              initialFps={s.seed.initialFps}
              generating={nodeOf(s.nodeId)?.data.genStatus === 'generating'}
              submitting={submitting || s.inFlight}
              followAnchor={panelAnchor(nodeOf(s.nodeId))}
              dragHidden={dragHiddenOf(s.nodeId)}
            />
          );
        },
      },
    ),
  };
  const tools = assembleCanvasTools(entries);
  return {
    ...tools,
    runtime,
    hasPanel: () =>
      Object.values(entries).some(
        (entry) => entry.handle.getSnapshot().visible === true,
      ),
    eraseHistory() {
      const s = entries.erase.handle.getSnapshot().state;
      return {
        active: s !== null,
        canUndo: s ? canUndoMaskEdit(s.mask) : false,
        canRedo: s ? canRedoMaskEdit(s.mask) : false,
        undo: () =>
          entries.erase.handle.edit((state) => ({
            ...state,
            mask: undoMaskEdit(state.mask),
          })),
        redo: () =>
          entries.erase.handle.edit((state) => ({
            ...state,
            mask: redoMaskEdit(state.mask),
          })),
      };
    },
  };
}
function outpaintGeometry(node: Node) {
  const box = mediaContentBox({
    mediaType: node.data.mediaType as 'image' | undefined,
    width: typeof node.data.width === 'number' ? node.data.width : undefined,
    height: typeof node.data.height === 'number' ? node.data.height : undefined,
  });
  return {
    rect: {
      x: node.position.x,
      y: node.position.y + MEDIA_CONTENT_TOP_OFFSET,
      width: box.width,
      height: box.height,
    },
  };
}
export type CanvasToolKind = keyof ReturnType<
  typeof createCanvasToolSessions
>['entries'];
export function useCanvasToolSessionEffects(
  tools: ReturnType<typeof createCanvasToolSessions>,
) {
  const dedicated = tools.runtime.escDefersToToolSessionHandler();
  useEffect(() => {
    if (!dedicated) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableKeyboardTarget(event.target))
        return;
      event.preventDefault();
      tools.dedicatedEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tools, dedicated]);
}
