/* ============================================
 * CanvasPage 画布编辑页：节点/连线/工具栏编排
 * ============================================ */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Map as MapIcon, Link, Link2Off, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { newNodeId } from './nodeId';
import { nextDraftPosition, type SpawnBox } from './draftSpawn';
import { imageMediaRefsOf, imageRefSourceError, isImageDraftNode, readAssetId } from './mediaRefs';
import { cancelledTerminalAction, hasGenerationRecord, isInPlaceRegenTarget } from './mediaReEdit';
import {
  isVideoDraftNode,
  MAX_VIDEO_REFS,
  readRefRole,
  videoMediaRefsOf,
  videoRefConflict,
  videoRefSourceError,
  type VideoRefRole,
} from './videoMediaRefs';
import { REF_LIMITS, refOverflowToast } from '@/utils/ref-overflow';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import type { MediaGenStatus } from './components/MediaNode';
import type { MediaDims } from './components/MediaNode/mediaContentSize';
import {
  isMediaExtractNodeId,
  mediaExtractNodeId,
  mediaExtractTerminalPatch,
  snapshotHasMediaExtractNode,
} from './mediaExtract';
import CanvasHeader from './components/CanvasHeader';
import AgentPanel from './components/AgentPanel';
import CanvasToolbar from './components/CanvasToolbar';
import BottomDialog, { type VideoGenOptions, type BottomRefItem, type VideoGenSeedParams } from './components/BottomDialog';
import ImageDialog, { type UploadedFile, type ImageGenSeedParams, type ImageTextAttachment } from './components/ImageDialog';
import AudioDialog, { type CanvasPickItem, type AudioRefItem } from './components/AudioDialog';
import MusicDialog, { type MusicGenOptions } from './components/MusicDialog';
import SharedAssetsModal from './components/SharedAssetsModal';
import LegacyHistoryModal from './components/LegacyHistoryModal';
import AssetsPickerModal from './components/AssetsPickerModal';
import CharacterLibraryModal from './components/CharacterLibraryModal';
import type { MaterialAsset } from '@/api/material';
import type { AssetCardKind } from './components/AssetCardNode';
import type { CanvasProject } from './components/ProjectSelector';
import FlowCanvas from './components/Canvas';
import { addEdge, useEdgesState, type Connection, type Edge, type Node, type Viewport, type OnSelectionChangeParams } from '@xyflow/react';
import { useAuthStore } from '@/stores/auth';
import { fetchMe, fetchQuota, toSessionUser } from '@/api/auth';
import {
  fetchProjects,
  createProject,
  renameProject,
  deleteProject,
  projectKeys,
} from '@/api/projects';
import { UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, fetchAllAssets, fetchAssetDetail, linkAssetToProject, type AssetRecord, type AssetType, type UploadCompleteData } from '@/api/assets';
import AssetDetailModal from '@/pages/Assets/components/AssetDetailModal';
import { rememberAssetUrl } from './components/AgentPanel/MessageAssetPreview';
import { applyPromptPreview, createConversationQuote, listLegacyCardHistory, saveCanvasDoc, serializeEdges, serializeNodes, type LegacyCardHistoryItem } from '@/api/canvas';
import { isApiError } from '@/api/http';
import { useAuthPromptStore } from '@/stores/authPrompt';
import { blockIfQuotaInsufficient, openRechargeForQuotaError } from '@/utils/quotaGate';
import type { GenerationCardBlock, SessionContentBlock } from '@/api/agentSessions';
import {
  createGenerationJob,
  cancelGenerationJob,
  retryGenerationJob,
  fetchJobStatus,
  createMediaExtraction,
  readJobFailText,
  type ImageJobParameters,
  type VideoJobParameters,
  type AudioJobParameters,
} from '@/api/jobs';
import { removeCancelledGenerationNode } from './generationPolling';
import {
  saveSharedAsset,
  type SaveSharedAssetRequest,
  type SharedAssetView,
} from '@/api/sharedAssets';
import { uploadAssetFile } from '@/utils/upload';
import { takeGenHandoff, type GenHandoff } from '@/utils/gen-handoff';
import { takeAgentHandoff } from '@/utils/agent-handoff';
import { defaultProjectName } from '@/lib/projectName';
import { useCanvasDoc } from './hooks/useCanvasDoc';
import { collectMediaBlocks, type CanvasGalleryRef } from './collectMediaBlocks';
import { QUOTE_TEXT_LIMIT, extractTextNodeText, quoteChipLabel, readPromptSource, textQuoteBlock, type QuoteConversationInput } from './quoteConversation';
import {
  canvasLocationSearch,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
  shouldReturnToProjectsAfterDelete,
} from './canvasQuery';
import styles from './index.module.css';

type ToolMode = 'drag' | 'select';

export default function CanvasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  // 优先选中 ?project= 指定的画布（顶部展示该画布名）；切换时回写同一 query 以便刷新还原
  const [currentId, setCurrentId] = useState(() => readCanvasIdFromSearch(searchParams));
  const [showAgent, setShowAgent] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [showBottomDialog, setShowBottomDialog] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  /** 「到节点选择」：画布节点选取模式（image/video/audio 对应三个底部对话框；product 商品卡选图） */
  const [pickMode, setPickMode] = useState<'image' | 'video' | 'audio' | 'product' | 'asset' | null>(null);
  /** 选取发起对话框（决定选取结果注入哪个对话框；视频对话框可同时选图片/视频节点） */
  const [pickTarget, setPickTarget] = useState<'image' | 'video' | 'audio' | 'product' | 'asset' | null>(null);
  /** 视频草稿「到节点选择」的目标参考角色（IKDMQS）：首帧/尾帧由 Dock 入口显式指定，缺省普通参考 */
  const [pickRefRole, setPickRefRole] = useState<VideoRefRole | null>(null);
  /** 商品卡选取目标节点ID（选中的图片注入哪个商品卡） */
  const [pickProductId, setPickProductId] = useState<string | null>(null);
  /** 资产卡选取目标节点ID（选中的图片注入哪个资产卡） */
  const [pickAssetId, setPickAssetId] = useState<string | null>(null);
  /** 画布节点选取/角色库多选结果（ts 驱动注入图片对话框） */
  const [imagePickResult, setImagePickResult] = useState<{ ts: number; files: UploadedFile[] } | null>(null);
  /** 画布节点选取/角色库多选结果（ts 驱动注入视频对话框参考视频） */
  const [videoPickResult, setVideoPickResult] = useState<{ ts: number; items: BottomRefItem[] } | null>(null);
  /** 画布节点选取/角色库多选结果（ts 驱动注入视频对话框参考图片） */
  const [videoDlgImagePickResult, setVideoDlgImagePickResult] = useState<{ ts: number; items: BottomRefItem[] } | null>(null);
  /** 画布节点选取结果（ts 驱动注入商品卡） */
  const [productPickResult, setProductPickResult] = useState<{ ts: number; productId: string; image: { id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string } } | null>(null);
  /** 画布节点选取结果（ts 驱动注入资产卡） */
  const [assetPickResult, setAssetPickResult] = useState<{ ts: number; assetId: string; ref: CanvasGalleryRef } | null>(null);
  /** 角色库弹窗状态 */
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  /** 角色库发起目标（决定选中结果注入哪个对话框） */
  const [characterLibraryTarget, setCharacterLibraryTarget] = useState<'image' | 'video' | 'asset' | null>(null);
  const [showAudioDialog, setShowAudioDialog] = useState(false);
  const [showMusicDialog, setShowMusicDialog] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  /** 连线（受控持有：水合恢复、自动保存签名、目标节点附件推导共用，IKDLQF） */
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  /** 连线最新值（避免闭包陈旧：提交前落盘与附件推导用） */
  const edgesRef = useRef<Edge[]>([]);
  edgesRef.current = edges;
  /** 生成中节点判定（IKDMQQ）：执行期间目标参数与输入连线只读 */
  const isGeneratingNode = (id: string) =>
    mediaNodesRef.current.some(
      (n) => n.id === id && (n.data as Record<string, unknown> | undefined)?.genStatus === 'generating',
    );
  /** 建立连线（受控去重 + custom 流光渲染形态；与服务端保存校验同口径拒绝重复 (source,target)）。
   *  refRole（IKDMQS）写入 edge.data.refRole 随连线持久化：first 首帧 / last 尾帧，缺省普通参考 */
  const addCanvasEdge = (source: string, target: string, refRole?: VideoRefRole) => {
    setEdges((eds) => {
      if (eds.some((e) => e.source === source && e.target === target)) return eds;
      return addEdge(
        {
          source,
          target,
          sourceHandle: null,
          targetHandle: null,
          type: 'custom',
          style: { stroke: '#444' },
          ...(refRole && refRole !== 'reference' ? { data: { refRole } } : {}),
        },
        eds,
      );
    });
  };
  /** 图片草稿参考连线校验（IKDMQR）：仅当目标是图片草稿且来源是媒体节点时介入——
   *  仅有效图片媒体结果可连入；重复素材（按 assetId 归一，兼容三形态）与超上限明确拒绝，不静默丢弃输入。
   *  文本/商品/资产卡等来源与非草稿目标沿用既有语义（文本附件/未来切片），本函数放行。 */
  const validateImageRefConnect = (sourceId: string, targetId: string): boolean => {
    const target = mediaNodesRef.current.find((n) => n.id === targetId);
    if (!isImageDraftNode(target)) return true;
    const source = mediaNodesRef.current.find((n) => n.id === sourceId);
    if (!source) return true;
    const err = imageRefSourceError(source);
    if (err) {
      showToast('warn', err);
      return false;
    }
    const refs = imageMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    const assetId = readAssetId((source.data ?? {}) as Record<string, unknown>)!;
    if (refs.some((r) => r.assetId === assetId)) {
      showToast('warn', '该素材已连入当前草稿');
      return false;
    }
    if (refs.length >= REF_LIMITS.image) {
      showToast('warn', refOverflowToast(['image']));
      return false;
    }
    return true;
  };
  /** 视频草稿参考连线校验（IKDMQS）：仅当目标是视频草稿且来源是媒体节点时介入——
   *  连线默认普通参考角色（首帧/尾帧在 Dock 显式指定，不按连入顺序猜测）；
   *  仅有效媒体结果可连入；重复素材（按 assetId 归一）与超上限明确拒绝，不静默丢弃输入。
   *  文本/商品/资产卡等来源与非草稿目标沿用既有语义，本函数放行。 */
  const validateVideoRefConnect = (sourceId: string, targetId: string, role: VideoRefRole = 'reference'): boolean => {
    const target = mediaNodesRef.current.find((n) => n.id === targetId);
    if (!isVideoDraftNode(target)) return true;
    const source = mediaNodesRef.current.find((n) => n.id === sourceId);
    if (!source) return true;
    const err = videoRefSourceError(source, role);
    if (err) {
      showToast('warn', err);
      return false;
    }
    const refs = videoMediaRefsOf(targetId, edgesRef.current, mediaNodesRef.current);
    const assetId = readAssetId((source.data ?? {}) as Record<string, unknown>)!;
    const occupied =
      refs.reference.some((r) => r.assetId === assetId) ||
      [refs.first, refs.last].some((r) => r?.assetId === assetId);
    if (occupied) {
      showToast('warn', '该素材已连入当前草稿');
      return false;
    }
    if (role === 'first') {
      if (refs.first) {
        showToast('warn', '首帧已指定，请先移除现有首帧');
        return false;
      }
      return true;
    }
    if (role === 'last') {
      if (!refs.first) {
        showToast('warn', '尾帧必须与首帧一起使用，请先指定首帧');
        return false;
      }
      if (refs.last) {
        showToast('warn', '尾帧已指定，请先移除现有尾帧');
        return false;
      }
      return true;
    }
    const videoCount = refs.reference.filter((r) => r.mediaType === 'video').length;
    if ((source.data as Record<string, unknown>).mediaType === 'video') {
      if (videoCount >= MAX_VIDEO_REFS) {
        showToast('warn', refOverflowToast(['video'], { video: MAX_VIDEO_REFS }));
        return false;
      }
    } else if (refs.reference.length >= REF_LIMITS.image) {
      showToast('warn', refOverflowToast(['image']));
      return false;
    }
    return true;
  };
  /** 建立连线：拒绝自环（生成中节点的输入连线只读 IKDMQQ：向目标新建连线被拦截）；
 *  图片草稿目标的来源校验见 validateImageRefConnect */
  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || params.source === params.target) return;
      if (isGeneratingNode(params.target)) {
        showToast('warn', '生成中，输入连线只读');
        return;
      }
      if (!validateImageRefConnect(params.source, params.target)) return;
      if (!validateVideoRefConnect(params.source, params.target)) return;
      addCanvasEdge(params.source, params.target);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setEdges],
  );
  /** 连线变更守卫（IKDMQQ）：生成中节点的入边删除变更被拦截（剪刀等 remove 路径统一收口） */
  const guardEdgesChange: typeof onEdgesChange = (changes) => {
    const allowed = changes.filter((c) => {
      if (c.type !== 'remove') return true;
      const edge = edgesRef.current.find((e) => e.id === c.id);
      return edge ? !isGeneratingNode(edge.target) : true;
    });
    if (allowed.length < changes.length) showToast('warn', '生成中，输入连线只读');
    if (allowed.length > 0) onEdgesChange(allowed);
  };
  const [uploadedNodes] = useState<Node[]>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warn'; msg: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  /** 显示 toast 提示 */
  const showToast = useCallback((type: 'success' | 'error' | 'warn', msg: string) => {
    setToast({ type, msg });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }, []);
  const [textNodes, setTextNodes] = useState<Node[]>([]);
  const [mediaNodes, setMediaNodes] = useState<Node[]>([]);
  const [productNodes, setProductNodes] = useState<Node[]>([]);
  const [assetNodes, setAssetNodes] = useState<Node[]>([]);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  /** 工具栏加号 →「资产库选择」弹窗开关 */
  const [showAssetsPicker, setShowAssetsPicker] = useState(false);
  /** 资产选择弹窗的打开来源（决定 mediaTypes 过滤与确认后的去向）：
   *  toolbar 画布工具栏（全类型落画布）/ bottomImage|bottomVideo 视频 dock / imageDialog 图片 dock / agentPanel Agent 面板 */
  const [assetsPickerTarget, setAssetsPickerTarget] = useState<'toolbar' | 'bottomImage' | 'bottomVideo' | 'imageDialog' | 'agentPanel'>('toolbar');
  /** 打开资产选择弹窗（记录来源入口，确认时按来源路由） */
  const openAssetsPicker = (target: typeof assetsPickerTarget) => {
    setAssetsPickerTarget(target);
    setShowAssetsPicker(true);
  };
  /** 资产库选择 → Agent 面板待发附件（ts 驱动注入，画布侧已落节点） */
  const [agentAssetPicks, setAgentAssetPicks] = useState<{ ts: number; blocks: SessionContentBlock[] } | null>(null);
  const [assetsModalDefaultTab, setAssetsModalDefaultTab] = useState<string | undefined>(undefined);
  const [assetsModalDefaultFilter, setAssetsModalDefaultFilter] = useState<string | undefined>(undefined);
  const [assetDetailTarget, setAssetDetailTarget] = useState<AssetRecord | null>(null);
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);
  const assetDetailRequestIdRef = useRef(0);
  /** label 有值时是生成卡引用（侧边栏渲染成胶囊）；无 label 是普通 @ 文本预填；mediaBlocks 携带媒体元数据 */
  const [agentContext, setAgentContext] = useState<{
    text: string;
    label?: string;
    skillId?: string;
    skillName?: string;
    ts: number;
    mediaBlocks?: SessionContentBlock[];
  } | null>(null);

  /** 首页发送框携带草稿跳转：打开 Agent 弹框并注入输入框，随后清除导航状态避免刷新重复注入。
   *  智能体附件（首页 + 上传的图/视频）经模块变量 handoff 带入：此处上传得 assetId 构造
   *  asset_ref 媒体块挂进 agentContext.mediaBlocks，复用 AgentPanel 既有的注入链路。 */
  useEffect(() => {
    const state = location.state as { agentText?: string; skillId?: string; skillName?: string } | null;
    if (!state?.agentText && !state?.skillId) return;
    const attachments = takeAgentHandoff();
    const inject = async () => {
      let mediaBlocks: SessionContentBlock[] | undefined;
      if (attachments && attachments.length > 0) {
        const blocks: SessionContentBlock[] = [];
        for (const item of attachments) {
          if (item.assetId != null) {
            // 资产库选择项：已有 assetId，直接复用（不重复上传），preview 即永久 URL
            rememberAssetUrl(String(item.assetId), item.preview);
            blocks.push({
              type: 'asset_ref',
              url: item.preview,
              name: item.name,
              media_type: item.kind,
              display_label: item.name,
              asset_id: String(item.assetId),
            });
          } else if (item.file) {
            const uploaded = await uploadFileToAsset(item.file, item.kind);
            if (uploaded) {
              // 用 complete 返回的永久 URL（不是会被 revoke 的 objectURL），
              // 并登记进 MessageAssetPreview 的缓存：发送后乐观气泡立刻能显示缩略图
              rememberAssetUrl(uploaded.asset_id, uploaded.url);
              blocks.push({
                type: 'asset_ref',
                url: uploaded.url,
                name: item.name,
                media_type: item.kind,
                display_label: item.name,
                asset_id: uploaded.asset_id,
              });
            } else {
              console.warn('首页附件上传失败，已跳过:', item.name);
            }
            URL.revokeObjectURL(item.preview);
          } else {
            console.warn('首页附件缺少 file/assetId，已跳过:', item.name);
          }
        }
        mediaBlocks = blocks.length > 0 ? blocks : undefined;
      }
      setAgentContext({
        text: state.agentText ?? '',
        skillId: state.skillId ?? '',
        skillName: state.skillName ?? '',
        ts: Date.now(),
        mediaBlocks,
      });
      setShowAgent(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
    };
    void inject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);
  /** 节点工具条带入图片对话框的初始值（ts 作为 key 强制重挂载以注入初始值）；
   *  params 是首页 AI图片 带入的生成参数（选中首页所选模型/清晰度/宽高比）；
   *  targetNodeId/attachments 仅图片媒体节点面板发起时存在（IKDLQF）：提交携带 target_node_id，
   *  附件在打开当下按连线快照，面板只读展示 */
  const [imageSeed, setImageSeed] = useState<{ ts: number; text: string; files: UploadedFile[]; params?: ImageGenSeedParams; targetNodeId?: string; attachments?: ImageTextAttachment[] } | null>(null);
  /** 面板当前绑定的图片草稿节点 id（IKDMQQ）：仅草稿入口（侧栏新建/点击草稿卡）设置；
   *  草稿被删除/取消或成功转成品卡时由清理 effect 结束绑定并关闭面板 */
  const [imageDraftId, setImageDraftId] = useState<string | null>(null);
  /** 面板当前绑定的视频草稿节点 id（IKDMQS）：仅草稿入口（侧栏新建/点击草稿卡）设置；
   *  生命周期与图片草稿绑定一致 */
  const [videoDraftId, setVideoDraftId] = useState<string | null>(null);
  /** 节点工具条带入视频对话框的初始参考；
   *  params 是首页 AI视频 带入的生成参数（选中首页所选模型/比例/清晰度/时长/模式） */
  const [videoSeed, setVideoSeed] = useState<{ ts: number; refs: BottomRefItem[]; text?: string; params?: VideoGenSeedParams; targetNodeId?: string; attachments?: ImageTextAttachment[] } | null>(null);
  /** 音频对话框的重挂载 key；草稿入口（IKDMQT）同时携带文字描述/模型/目标节点 */
  const [audioSeed, setAudioSeed] = useState<{ ts: number; text?: string; modelId?: string; targetNodeId?: string } | null>(null);
  /** 面板当前绑定的音频草稿节点 id（IKDMQT）：仅草稿入口（侧栏新建/点击草稿卡）设置；
   *  生命周期与图片/视频草稿绑定一致 */
  const [audioDraftId, setAudioDraftId] = useState<string | null>(null);
  /** 侧栏新建草稿的显式选中请求（IKDMQV）：新卡自动选中并取消其余。
   *  经 Canvas 内部 setNodes 应用——直接经 nodes selected 字段传播会因 React Flow
   *  selection store 的时序差报双选中，把自动打开的绑定面板当多选误关 */
  const [selectRequest, setSelectRequest] = useState<{ id: string; ts: number } | null>(null);
  /** 首页 AI视频/AI图片 生成交接：消费后置入此 ref，待项目就绪触发创建任务 */
  const pendingGenRef = useRef<GenHandoff | null>(null);
  /** 首页 AI视频/AI图片 发送带入：唤起底部对话框（参数带入、内容清空），同时直接创建生成任务（生成卡落画布） */
  useEffect(() => {
    const state = location.state as { genKind?: 'video' | 'image' } | null;
    if (!state?.genKind) return;
    const handoff = takeGenHandoff();
    if (!handoff) {
      // 刷新/直开页面：交接数据已失效，仅清导航状态
      navigate(location.pathname + location.search, { replace: true, state: null });
      return;
    }
    if (handoff.kind === 'video') {
      // 参数带入对话框；refs/text 不带（内容不保留，任务由 firePendingGen 直接创建）
      setVideoSeed({
        ts: Date.now(),
        refs: [],
        params: {
          modelId: handoff.modelId,
          aspectRatio: handoff.aspectRatio,
          resolution: handoff.resolution,
          duration: handoff.duration,
          mode: handoff.mode,
        },
      });
      setShowBottomDialog(true);
      setShowImageDialog(false);
      setShowAudioDialog(false);
      setShowMusicDialog(false);
    } else {
      setImageSeed({
        ts: Date.now(),
        text: '',
        files: [],
        params: { modelId: handoff.modelId, ratio: handoff.ratio, size: handoff.size },
      });
      setShowImageDialog(true);
      setShowBottomDialog(false);
      setShowAudioDialog(false);
      setShowMusicDialog(false);
    }
    pendingGenRef.current = handoff;
    // 项目已就绪则立即创建生成节点；未就绪由 currentId 变化后的 effect 重试
    actionsRef.current.firePendingGen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.pathname, location.search, navigate]);
  /** 当前视口（拖拽/缩放结束更新），自动保存时序列化提交 */
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.1 });
  /** FlowCanvas 注册的屏幕点→flow 坐标转换（无参默认取视口中心），注册前回退原点附近 */
  const spawnPosRef = useRef<(screenPt?: { x: number; y: number }) => { x: number; y: number }>(
    () => ({ x: 300, y: 200 }),
  );
  const registerSpawnPosition = useCallback(
    (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => {
      spawnPosRef.current = fn;
    },
    [],
  );
  /** 新节点出生位：以视口中心为原点在小范围内随机错乱堆叠。
   *  不避碰、不外扩，新节点都落在中心 ±80px 的方形区域内，自然堆叠。 */
  const spawnPosition = () => {
    const c = spawnPosRef.current();
    return {
      x: Math.round(c.x + (Math.random() * 160 - 80)),
      y: Math.round(c.y + (Math.random() * 160 - 80)),
    };
  };
  /** 底部 Dock 预留高度（屏幕像素）：草稿出生点纵向避开即将打开的面板区域（IKDMQQ） */
  const DOCK_RESERVE_PX = 300;
  /** 既有节点的占位盒（flow 坐标）：媒体节点按内容区规则估算并加标题余量，其余按默认尺寸 */
  const nodeBoxOf = (n: Node): SpawnBox => {
    const d = (n.data ?? {}) as Record<string, unknown>;
    if (n.type === 'mediaNode') {
      const box = mediaContentBox({
        mediaType: d.mediaType as 'image' | 'video' | 'audio' | undefined,
        width: typeof d.width === 'number' ? d.width : undefined,
        height: typeof d.height === 'number' ? d.height : undefined,
        ratio: d.targetRatio as string | undefined,
      });
      return { x: n.position.x, y: n.position.y, width: box.width, height: box.height + 44 };
    }
    return { x: n.position.x, y: n.position.y, width: 320, height: 340 };
  };
  /** 草稿卡出生位（IKDMQQ）：视口中心附近空位，避开底部 Dock 预留区与既有节点 */
  const spawnDraftPosition = () => {
    const center = spawnPosRef.current();
    const dockTop = spawnPosRef.current({ x: window.innerWidth / 2, y: window.innerHeight - DOCK_RESERVE_PX }).y;
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    return nextDraftPosition({ center, dockTop, nodes: nodes.map(nodeBoxOf) });
  };
  /** 画布保存状态：idle 未保存 / saving 保存中 / saved 已保存 / error 保存失败 */
  const applyMutation = useMutation({ mutationFn: applyPromptPreview });
  const applyingRef = useRef(false);
  const [applying, setApplying] = useState(false);
  const [saveEpoch, setSaveEpoch] = useState(0);
  const savePromiseRef = useRef<Promise<unknown> | null>(null);
  const activeProjectRef = useRef(currentId);
  activeProjectRef.current = currentId;
  const [focusViewport, setFocusViewport] = useState<Viewport>();
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** 最近一次保存成功时间（HH:mm） */
  const [savedAt, setSavedAt] = useState('');
  /** 画布乐观锁版本号（来自快照；null 表示从未保存，If-Match 传 missing） */
  const versionRef = useRef<number | null>(null);
  /** 最近一次加载/保存成功的内容签名，避免重复保存 */
  const lastSavedRef = useRef('');
  /** 尚未被服务端确认保存的新增节点 ID——「添加失败」回滚用。
   *  自动保存发起时对当前集合做快照：成功清快照、失败只回滚快照，
   *  请求飞行中新增的节点留给下一轮保存处理，不会被误判为添加失败。 */
  const pendingNodeIdsRef = useRef<Set<string>>(new Set());
  /** 回滚未保存成功的新增节点：从画布移除并释放 blob URL */
  const rollbackPendingNodes = useCallback((ids: Set<string>) => {
    if (ids.size === 0) return;
    [...mediaNodesRef.current, ...textNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current].forEach((n) => {
      if (ids.has(n.id)) {
        const src = n.data?.src as string | undefined;
        if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
      }
    });
    setTextNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    setMediaNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    setProductNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    setAssetNodes((prev) => prev.filter((n) => !ids.has(n.id)));
    ids.forEach((id) => pendingNodeIdsRef.current.delete(id));
  }, []);
  const updateUser = useAuthStore((s) => s.updateUser);
  const setQuota = useAuthStore((s) => s.setQuota);
  /** 新建商品节点序号（商品 1、商品 2…） */
  const productSeq = useRef(0);

  // 画布页面加载时获取当前登录用户信息（鉴权判断 + 身份展示，失败静默降级）
  useEffect(() => {
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, [updateUser]);

  // IKBN0G：画布顶栏不再挂 UserDropdown，配额改由本页拉取，供生成前余额拦截
  useEffect(() => {
    let alive = true;
    fetchQuota()
      .then((d) => {
        if (alive) setQuota(d.quota);
      })
      .catch(() => {
        if (alive) setQuota(null);
      });
    return () => {
      alive = false;
    };
  }, [setQuota]);

  // 加载项目列表；?project= 不在列表中时回退首项；无项目自动创建
  useEffect(() => {
    let alive = true;
    fetchProjects()
      .then(async (list) => {
        if (!alive) return;
        let mapped = list.map((p) => ({ id: String(p.id), name: p.name }));
        if (mapped.length === 0) {
          try {
            const created = await createProject('未命名项目');
            if (!alive) return;
            mapped = [{ id: String(created.id), name: created.name }];
          } catch {
            /* 创建失败静默降级：空项目列表 */
          }
        }
        setProjects(mapped);
        setCurrentId((prev) => pickCanvasIdAfterLoad(prev, mapped.map((m) => m.id)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** 地址栏改 query（含后退）时切回对应画布 */
  useEffect(() => {
    const fromQuery = readCanvasIdFromSearch(new URLSearchParams(location.search));
    if (fromQuery) setCurrentId(fromQuery);
  }, [location.search]);

  /** 当前画布写入 ?project=，刷新后回到同一张画布；保留其它 query 与 location.state */
  useEffect(() => {
    if (!currentId) return;
    const currentSearch = new URLSearchParams(location.search);
    if (readCanvasIdFromSearch(currentSearch) === currentId) return;
    navigate(
      {
        pathname: location.pathname,
        search: canvasLocationSearch(currentSearch, currentId),
      },
      { replace: true, state: location.state },
    );
    // 只在选中画布变化时回写，避免地址栏输入被旧 currentId 覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  /** 切换 Project 即切换画布与对话历史：面板随之收起（IKDLD4），展开状态不跨项目携带。
   *  覆盖点选 / 新建 / 删除后自动切换 / 地址栏前进后退等全部 currentId 迁移路径。
   *  空串 → 首项目 是初始水合（含首页交接降级路径），不是用户切换，不关面板。 */
  const prevProjectIdRef = useRef(currentId);
  useEffect(() => {
    const prev = prevProjectIdRef.current;
    prevProjectIdRef.current = currentId;
    if (!prev || prev === currentId) return;
    setShowAgent(false);
    setFocusViewport(undefined);
  }, [currentId]);

  /** 加载当前项目快照（画布水合：节点 + 视口 + 版本号），失败静默降级为空画布 */
  const { doc, assets: snapshotAssets, refetch, acceptDoc, legacyMigration } = useCanvasDoc(currentId);

  /** 旧生成卡迁移历史（IKDLQK）：水合后拉取，无历史或读取失败时入口隐藏 */
  const [legacyHistory, setLegacyHistory] = useState<LegacyCardHistoryItem[] | null>(null);
  const [showLegacyHistory, setShowLegacyHistory] = useState(false);

  /** 迁移报告提示（IKDLQK）：按报告签名去重，同一报告只提示一次；失败附标题与原因 */
  const migrationToastRef = useRef('');
  useEffect(() => {
    if (!legacyMigration) return;
    const signature = JSON.stringify(legacyMigration);
    if (migrationToastRef.current === signature) return;
    migrationToastRef.current = signature;
    const { migrated, failed } = legacyMigration;
    if (failed.length === 0) {
      if (migrated.length > 0) showToast('success', `已将 ${migrated.length} 张旧生成卡转换为普通文本节点`);
      return;
    }
    const detail = failed.slice(0, 2).map((item) => `「${item.title || item.nodeId}」${item.reason}`).join('；');
    const failedText = `${failed.length} 张旧生成卡未能迁移（${detail}${failed.length > 2 ? ' 等' : ''}），原卡片已保留`;
    showToast('warn', migrated.length > 0 ? `已转换 ${migrated.length} 张旧生成卡；${failedText}` : failedText);
  }, [legacyMigration, showToast]);

  useEffect(() => {
    if (!doc || !currentId) {
      setLegacyHistory(null);
      return;
    }
    let cancelled = false;
    listLegacyCardHistory(currentId)
      .then((res) => { if (!cancelled) setLegacyHistory(res.items); })
      .catch(() => { if (!cancelled) setLegacyHistory(null); });
    return () => { cancelled = true; };
  }, [doc, currentId]);

  /** 为服务端加载的节点注入交互回调（JSON 不含函数） */
  const attachCallbacks = (node: Node): Node => {
    const base: Node = { ...node, position: node.position ?? { x: 0, y: 0 }, data: { ...node.data, toolMode } };
    switch (node.type) {
      case 'textNode':
        base.data = {
          ...base.data,
          onDelete: (id: string) => setTextNodes((prev) => prev.filter((n) => n.id !== id)),
          onTitleChange: (id: string, title: string) => setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, title } } : n)),
          onTextChange: (id: string, text: string) => setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, text } } : n)),
          onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
          onChange: (id: string, html: string) => {
            setTextNodes((prev) =>
              prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, html } } : n))
            );
          },
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
        };
        break;
      case 'mediaNode':
        base.data = {
          ...base.data,
          onDelete: (id: string) => {
            setMediaNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
          onRetryJob: (id: string) => actionsRef.current.retryJob(id),
          onReEdit: (id: string) => actionsRef.current.reEdit(id),
          onGenImage: (id: string) => actionsRef.current.genImage(id),
          onGenVideo: (id: string) => actionsRef.current.genVideo(id),
          onGenAudio: (id: string) => actionsRef.current.genAudio(id),
          onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
        };
        break;
      case 'productNode':
        base.data = {
          ...base.data,
          // 节点内上传素材携带当前项目（运行期注入，不持久化）
          projectId: currentId,
          onDelete: (id: string) => {
            setProductNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
          onProductChange: (id: string, patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string }) => handleProductChange(id, patch),
          onPickFromCanvas: (id: string) => {
            setPickMode('product');
            setPickTarget('product');
            setPickProductId(id);
          },
        };
        break;
      case 'assetNode':
        base.data = {
          ...base.data,
          // 节点内上传素材携带当前项目（运行期注入，不持久化）
          projectId: currentId,
          onDelete: (id: string) => {
            setAssetNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onGenerateImage: () => actionsRef.current.openImageDialog(),
          onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
          onCardChange: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => handleCardChange(id, patch),
          onPickFromCanvas: (id: string) => {
            setPickMode('asset');
            setPickTarget('asset');
            setPickAssetId(id);
          },
        };
        break;
      default:
        break;
    }
    return base;
  };

  /** 解析后端节点引用的资产（data/顶层的 asset_id、reference_asset_ids）。
   *  素材 URL 以 snapshot 资产字典为唯一来源：查不到一律返回 null（调用方标「素材已被删除」），不再回退内嵌 url */
  const resolveAssetRef = (node: Node): { url: string; type: string; assetId?: string } | null => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const raw = node as unknown as Record<string, unknown>;
    const candidates: unknown[] = [
      data.asset_id,
      raw.asset_id,
      data.assetId,
      raw.assetId,
      data.assetID,
      raw.assetID,
      data.sourceAssetId,
      raw.sourceAssetId,
      Array.isArray(data.reference_asset_ids) ? data.reference_asset_ids[0] : undefined,
      Array.isArray(raw.reference_asset_ids) ? raw.reference_asset_ids[0] : undefined,
    ];
    for (const c of candidates) {
      if (c == null || c === '') continue;
      const asset = snapshotAssets[String(c)];
      if (asset?.access_url) return { url: asset.access_url, type: asset.type, assetId: String(c) };
    }
    return null;
  };

  /** 解析 references 数组元素 → 资产 ID（兼容 assetId 数字/字符串与 o.id 历史形态）。
   *  素材 URL 以 snapshot 资产字典为唯一来源，无 assetId 的条目一律按「素材已被删除」处理 */
  const readRefLookupId = (r: unknown): string | undefined => {
    if (typeof r === 'number' || typeof r === 'string') return r === '' ? undefined : String(r);
    if (r != null && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const aid = o.asset_id ?? o.assetId ?? o.id;
      if (aid != null && aid !== '') return String(aid);
    }
    return undefined;
  };

  /** 解析 references 数组元素 → 媒体类型（image/video） */
  const resolveRefType = (r: unknown): 'image' | 'video' => {
    if (r != null && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const t = (o.type ?? o.media_type) as string | undefined;
      if (t === 'video') return 'video';
      // 检查 MIME 类型
      const mime = o.mime as string | undefined;
      if (mime?.startsWith('video/')) return 'video';
    }
    return 'image';
  };

  /** 后端节点类型映射为本地节点：reference 参考卡→资产卡，text→文本节点，其余按资产引用试解为媒体节点 */
  const mapBackendNode = (node: Node): Node | null => {
    const raw = node as unknown as Record<string, unknown>;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const position = node.position ?? { x: 0, y: 0 };

    // 参考卡（Agent 计划产物）：cardType 对应资产卡五种类型
    if (node.type === 'reference') {
      const cardType = typeof raw.cardType === 'string' ? raw.cardType : 'custom';
      const kind: AssetCardKind = (
        ['style', 'character', 'object', 'environment', 'custom'] as AssetCardKind[]
      ).includes(cardType as AssetCardKind)
        ? (cardType as AssetCardKind)
        : 'custom';
      const refsRaw = Array.isArray(raw.references) ? raw.references : [];
      // 参考图有效性以 snapshot 资产字典为唯一来源：命中→access_url；查不到→保留条目并标 missing（渲染占位），不再静默丢弃
      const initialRefs = refsRaw.map((r, i) => {
        const type = resolveRefType(r);
        const lookupAid = readRefLookupId(r);
        const url = lookupAid != null ? snapshotAssets[lookupAid]?.access_url : undefined;
        const base = { id: `ref-hydra-${node.id}-${i}`, type };
        return url
          ? { ...base, src: url, assetId: lookupAid }
          : { ...base, src: '', missing: true, ...(lookupAid ? { assetId: lookupAid } : {}) };
      });
      const desc = (data.content ?? data.desc ?? raw.content) as unknown;
      return {
        id: node.id,
        type: 'assetNode',
        position,
        data: {
          kind,
          initialRefs,
          initialDesc: typeof desc === 'string' ? desc : '',
        },
      };
    }

    // 文本节点
    if (node.type === 'text') {
      const html = (data.html ?? data.content ?? data.text ?? raw.content ?? raw.text ?? '') as unknown;
      return {
        id: node.id,
        type: 'textNode',
        position,
        data: { html: typeof html === 'string' ? html : '' },
      };
    }

    // 其余未知类型：按资产引用尽力还原为媒体节点；素材查不到时保留节点并标「素材已被删除」（不再静默丢弃）
    const ref = resolveAssetRef(node);
    const prompt = (data.prompt ?? raw.prompt) as unknown;
    if (!ref) {
      return {
        id: node.id,
        type: 'mediaNode',
        position,
        data: {
          src: '',
          mediaType: 'image',
          fileName: `参考 ${node.id}`,
          prompt: typeof prompt === 'string' ? prompt : undefined,
          assetMissing: true,
        },
      };
    }
    return {
      id: node.id,
      type: 'mediaNode',
      position,
      data: {
        src: ref.url,
        mediaType: ref.type === 'video' ? 'video' : 'image',
        fileName: `参考 ${node.id}`,
        prompt: typeof prompt === 'string' ? prompt : undefined,
        assetId: ref.assetId,
      },
    };
  };

  /** 水合期素材解析：所有素材一律用 assetId 匹配 snapshot 资产字典取 access_url，不走节点内嵌 src。
   *  - 命中 → src 替换为 access_url
   *  - 无 assetId 或字典查不到 → 标缺失（媒体节点 assetMissing / 商品图与参考图 missing），渲染「素材已被删除」
   *  - 瞬时态跳过：生成中/失败/取消（自有 UI，不依赖素材）、blob: 预览（上传中） */
  const resolveNodeAssets = (node: Node): Node => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (node.type === 'mediaNode') {
      if (data.genStatus) return node;
      if (typeof data.src === 'string' && (data.src as string).startsWith('blob:')) return node;
      const aid = (data.assetId ?? data.asset_id ?? data.assetID) as string | number | undefined;
      const asset = aid != null && aid !== '' ? snapshotAssets[String(aid)] : undefined;
      const url = asset?.access_url;
      if (url) {
        // 水合即回填资产字典里的真实尺寸：前端数据足够时不再经历 方形→实测 跳变与多余自动保存
        const fill: Record<string, number> = {};
        if (typeof data.width !== 'number' && typeof asset?.width === 'number') fill.width = asset.width;
        if (typeof data.height !== 'number' && typeof asset?.height === 'number') fill.height = asset.height;
        return data.src === url && !data.assetMissing && Object.keys(fill).length === 0
          ? node
          : { ...node, data: { ...data, ...fill, src: url, assetMissing: undefined } };
      }
      return data.assetMissing ? node : { ...node, data: { ...data, assetMissing: true } };
    }
    if (node.type === 'productNode') {
      const images = data.images;
      if (!Array.isArray(images)) return node;
      let changed = false;
      const next = images.map((img) => {
        const item = (img ?? {}) as Record<string, unknown>;
        if (typeof item.src === 'string' && item.src.startsWith('blob:')) return img; // 上传中
        const aid = (item.assetId ?? item.asset_id) as string | number | undefined;
        const url = aid != null && aid !== '' ? snapshotAssets[String(aid)]?.access_url : undefined;
        if (url) {
          if (item.src === url && !item.missing) return img;
          changed = true;
          return { ...item, src: url, missing: undefined };
        }
        if (item.missing) return img;
        changed = true;
        return { ...item, src: '', missing: true };
      });
      return changed ? { ...node, data: { ...data, images: next } } : node;
    }
    if (node.type === 'assetNode') {
      const refs = data.initialRefs;
      if (!Array.isArray(refs)) return node;
      let changed = false;
      const next = refs.map((r) => {
        const ref = (r ?? {}) as Record<string, unknown>;
        if (typeof ref.src === 'string' && ref.src.startsWith('blob:')) return r; // 上传中
        const aid = (ref.assetId ?? ref.asset_id) as string | number | undefined;
        const url = aid != null && aid !== '' ? snapshotAssets[String(aid)]?.access_url : undefined;
        if (url) {
          if (ref.src === url && !ref.missing) return r;
          changed = true;
          return { ...ref, src: url, missing: undefined };
        }
        if (ref.missing) return r;
        changed = true;
        return { ...ref, src: '', missing: true };
      });
      return changed ? { ...node, data: { ...data, initialRefs: next } } : node;
    }
    return node;
  };

  /** 画布文档加载完成：按类型分发节点并注入回调；切换项目时先清空 */
  useEffect(() => {
    if (!doc) {
      setTextNodes([]);
      setMediaNodes([]);
      setProductNodes([]);
      setAssetNodes([]);
      setEdges([]);
      versionRef.current = null;
      lastSavedRef.current = '';
      setSaveStatus('idle');
      return;
    }
    const t: Node[] = [];
    const m: Node[] = [];
    const p: Node[] = [];
    const a: Node[] = [];
    doc.nodes.forEach((node) => {
      if (node.type === 'textNode') t.push(attachCallbacks(node));
      else if (node.type === 'mediaNode') m.push(attachCallbacks(resolveNodeAssets(node)));
      else if (node.type === 'productNode') p.push(attachCallbacks(resolveNodeAssets(node)));
      else if (node.type === 'assetNode') a.push(attachCallbacks(resolveNodeAssets(node)));
      else {
        // 后端节点类型（reference 参考卡 / text 等）：映射为本地节点后归类（映射内部已按资产字典解析/标缺失）
        const mapped = mapBackendNode(node);
        if (mapped) {
          const attached = attachCallbacks(resolveNodeAssets(mapped));
          if (mapped.type === 'assetNode') a.push(attached);
          else if (mapped.type === 'textNode') t.push(attached);
          else m.push(attached);
        } else if (import.meta.env.DEV) {
          console.warn('[canvas] 无法映射的后端节点:', JSON.stringify(node).slice(0, 800));
        }
      }
    });
    // 商品序号从已加载节点数接续，避免新建重名
    productSeq.current = p.length;
    if (import.meta.env.DEV) {
      console.info(`[canvas] 水合节点：text ${t.length} / media ${m.length} / product ${p.length} / asset ${a.length}（version=${doc.version}）`);
    }
    setTextNodes(t);
    setMediaNodes(m);
    setProductNodes(p);
    setAssetNodes(a);
    // 水合恢复连线：持久形状 {id, source, target, data?} 补回 custom 流光渲染属性；
    // data 承载连线关系属性（IKDMQS 视频参考角色 refRole）随连线恢复；
    // 兜底过滤悬空端点（服务端保存校验已保证引用完整，此处防御旧/坏数据渲染告警）
    const hydratedIds = new Set([...t, ...m, ...p, ...a].map((n) => n.id));
    const hydratedEdges: Edge[] = doc.edges
      .filter((e) => hydratedIds.has(e.source) && hydratedIds.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'custom',
        style: { stroke: '#444' },
        ...(e.data ? { data: e.data } : {}),
      }));
    setEdges(hydratedEdges);
    // 同步乐观锁版本/视口，并记录内容签名避免加载后立即重复保存
    versionRef.current = doc.version;
    setViewport(doc.viewport);
    lastSavedRef.current = JSON.stringify(doc.viewport) + serializeNodes([...t, ...m, ...p, ...a]) + serializeEdges(hydratedEdges);
    // 水合恢复：「生成中」媒体节点恢复任务轮询。
    // IK9R8X：jobId 后端返回字符串，兼容 string/number 双形态（历史画布文档已持久化字符串）。
    m
      .filter(
        (n) =>
          n.data.genStatus === 'generating' &&
          (typeof n.data.jobId === 'number' || typeof n.data.jobId === 'string') &&
          !settledExtractNodesRef.current.has(n.id),
      )
      .forEach((n) => pollJobRef.current(n.id, n.data.jobId as number | string));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, snapshotAssets]);

  /** 连线端点级联删除（IKDLQF）：仅当节点真实离开画布时清理其连线，覆盖键盘删除/工具条删除/回滚等全部删除路径。
   *  不按「当前存在的节点」反查：挂载首批 effect 的节点列表尚在水合前，会把刚恢复的连线误清。 */
  const canvasNodeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(
      [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes, ...uploadedNodes].map((n) => n.id),
    );
    const prevIds = canvasNodeIdsRef.current;
    canvasNodeIdsRef.current = ids;
    if (prevIds.size === 0) return;
    const removed = new Set<string>();
    prevIds.forEach((id) => {
      if (!ids.has(id)) removed.add(id);
    });
    if (removed.size === 0) return;
    setEdges((prev) => {
      const next = prev.filter((e) => !removed.has(e.source) && !removed.has(e.target));
      return next.length === prev.length ? prev : next;
    });
  }, [textNodes, mediaNodes, productNodes, assetNodes, uploadedNodes, setEdges]);

  /** 画布变更后 800ms 防抖自动保存：PUT /api/canvases/:projectId（If-Match 乐观锁） */
  useEffect(() => {
    if (!currentId || !doc || applyingRef.current) return;
    const timer = window.setTimeout(() => {
      if (applyingRef.current || savePromiseRef.current) return;
      const nodes = [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes];
      const sig = JSON.stringify(viewport) + serializeNodes(nodes) + serializeEdges(edges);
      if (sig === lastSavedRef.current) return;
      if (import.meta.env.DEV) {
        console.info(`[canvas] 自动保存：${nodes.length} 个节点 / ${edges.length} 条连线（version=${versionRef.current}）`);
      }
      lastSavedRef.current = sig;
      setSaveStatus('saving');
      // 快照本次请求覆盖的未保存新增节点；飞行中再新增的留给下一轮保存
      const pendingSnapshot = new Set(pendingNodeIdsRef.current);
      savePromiseRef.current = saveCanvasDoc(currentId, { viewport, nodes, edges }, versionRef.current)
        .then((saved) => {
          versionRef.current = saved.version;
          pendingSnapshot.forEach((id) => pendingNodeIdsRef.current.delete(id));
          setSaveStatus('saved');
          setSaveEpoch(value => value + 1);
          setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
        })
        .catch((e) => {
          // 释放签名，允许下次变更时重试
          lastSavedRef.current = '';
          // 本次请求里有未保存的新增节点 → 添加失败：回滚节点（画布上不保留添加失败的节点）
          const hadPendingAdds = pendingSnapshot.size > 0;
          if (isApiError(e) && e.status === 412) {
            // 版本冲突：回滚未保存节点 + toast，然后重新加载最新画布数据
            setSaveStatus('error');
            showToast('warn', '画布版本冲突，当前编辑已保留，请先复制正文再刷新复核');
          } else {
            // 网络/服务端错误：新增节点回滚，已有节点的编辑保留、左下角提示保存失败
            if (hadPendingAdds) rollbackPendingNodes(pendingSnapshot);
            setSaveStatus('error');
            showToast('error', hadPendingAdds ? '添加失败，请重试' : '保存失败，请重试');
            console.warn('画布自动保存失败:', e);
          }
        }).finally(() => { savePromiseRef.current = null; });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [textNodes, mediaNodes, productNodes, assetNodes, edges, viewport, currentId, doc, refetch, applying, saveEpoch]);

  /** 创建文本节点 */
  const handleAddTextNode = () => {
    const newNode: Node = {
      id: newNodeId('text'),
      type: 'textNode',
      position: spawnPosition(),
      data: {
        html: '',
        onDraftError: handleDraftError,
        toolMode,
        onDelete: (id: string) => {
          setTextNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onChange: (id: string, html: string) => {
          setTextNodes((prev) =>
            prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, html } } : n))
          );
        },
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(newNode.id);
    setTextNodes((prev) => [...prev, newNode]);
  };

  /** 复制节点到旁边 */
  const handleDuplicateNode = (id: string) => {
    const t = textNodesRef.current.find((n) => n.id === id);
    if (t) {
      const copy: Node = { ...t, id: newNodeId('text'), position: { x: t.position.x + 40, y: t.position.y + 40 }, data: { ...t.data } };
      delete copy.data.promptSource;
      pendingNodeIdsRef.current.add(copy.id);
      setTextNodes((prev) => [...prev, copy]);
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
      const copy: Node = { ...m, id: newNodeId('media'), position: { x: m.position.x + 40, y: m.position.y + 40 }, data: { ...m.data } };
      pendingNodeIdsRef.current.add(copy.id);
      setMediaNodes((prev) => [...prev, copy]);
    }
  };

  /**
   * 添加到对话的文本引用（IKDLQJ）：先把点击当刻正文冻结成服务端引用快照，再注入胶囊。
   * 超限或快照创建失败明确提示、不产生胶囊——节点原文与输入框既有内容都不改动。
   */
  const quoteTextIntoChat = async (input: QuoteConversationInput) => {
    if (input.text.length > QUOTE_TEXT_LIMIT) {
      showToast('warn', `正文超过 ${QUOTE_TEXT_LIMIT} 字上限，未添加到对话`);
      return;
    }
    try {
      const { quote } = await createConversationQuote({
        projectId: currentId,
        nodeId: input.nodeId,
        title: input.title,
        text: input.text,
        source: input.source ?? null,
      });
      const label = quoteChipLabel(input.title, input.text);
      const blocks = [textQuoteBlock({ nodeId: input.nodeId, chipId: String(input.ts), label, quote }), ...(input.extraBlocks ?? [])];
      setAgentContext({ text: `@${label}`, label, ts: input.ts, mediaBlocks: blocks });
      setShowAgent(true);
    } catch (e) {
      showToast('error', isApiError(e) ? `添加到对话失败：${e.message}` : '添加到对话失败，请检查网络后重试');
    }
  };

  /** 添加节点内容到 Agent 聊天 */
  const handleAddToChatNode = (id: string) => {
    const ts = Date.now();
    const p = productNodesRef.current.find((n) => n.id === id);
    if (p) {
      const name = (p.data?.name as string) || '商品';
      const mediaBlocks = collectMediaBlocks(p, String(ts));
      console.log('[handleAddToChatNode] productNode, mediaBlocks:', mediaBlocks.length);
      setAgentContext({
        text: `@${name}`,
        label: name,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
      return;
    }
    const t = textNodesRef.current.find((n) => n.id === id);
    if (t) {
      // IKDLQJ：正文走引用快照；空正文节点没有可引用内容，维持纯 @ 标签
      const text = extractTextNodeText(t.data as Record<string, unknown> | undefined);
      if (text) {
        void quoteTextIntoChat({
          nodeId: t.id,
          title: typeof t.data?.title === 'string' ? t.data.title : '',
          text,
          source: readPromptSource(t.data?.promptSource),
          ts,
        });
      } else {
        const label = '文本节点';
        setAgentContext({ text: `@${label}`, label, ts });
        setShowAgent(true);
      }
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
      if (m.data?.assetMissing) {
        showToast('warn', '素材已被删除');
        return;
      }
      const type = m.data?.mediaType === 'video' ? '视频' : '图片';
      const label = `[${type}] ${m.data?.fileName || ''}`;
      const mediaBlocks = collectMediaBlocks(m, String(ts));
      console.log('[handleAddToChatNode] mediaNode, mediaBlocks:', mediaBlocks.length);
      setAgentContext({
        text: label,
        label,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
      return;
    }
    const a = assetNodesRef.current.find((n) => n.id === id);
    if (a) {
      const gc = a.data?.generationCard as { shotTitle?: string; prompt?: string } | undefined;
      const kindTitle: Record<string, string> = {
        style: '风格卡',
        character: '角色卡',
        object: '物体卡',
        environment: '环境卡',
        custom: '自定义卡',
        generation: '生成卡',
      };
      const name = gc?.shotTitle || kindTitle[(a.data?.kind as string) ?? 'custom'] || '资产卡';
      // IKDLQJ：生成卡的当前提示词同样捕获为引用快照，不再只发旧 revision 指针；显式挂载的素材引用随行
      const prompt = typeof gc?.prompt === 'string' ? gc.prompt : '';
      if (gc && prompt.trim()) {
        void quoteTextIntoChat({
          nodeId: a.id,
          title: gc.shotTitle ?? '',
          text: prompt,
          ts,
          extraBlocks: collectMediaBlocks(a, String(ts)),
        });
        return;
      }
      const mediaBlocks = collectMediaBlocks(a, String(ts));
      console.log('[handleAddToChatNode] assetNode, mediaBlocks:', mediaBlocks.length, 'refs:', (a.data?.initialRefs as unknown[] | undefined)?.length ?? 0);
      setAgentContext({
        text: `@${name}`,
        label: name,
        ts,
        mediaBlocks: mediaBlocks.length > 0 ? mediaBlocks : undefined,
      });
      setShowAgent(true);
    }
  };

  /** 节点操作引用（避免闭包过期） */
  const actionsRef = useRef({
    duplicate: handleDuplicateNode,
    addToChat: handleAddToChatNode,
    openImageDialog: () => {},
    cancelJob: (_id: string) => {},
    retryJob: (_id: string) => {},
    reEdit: (_id: string) => {},
    genImage: (_id: string) => {},
    genVideo: (_id: string) => {},
    genAudio: (_id: string) => {},
    extractAudio: async (_id: string) => {},
    download: (_id: string) => {},
    showDetails: (_id: string) => {},
    firePendingGen: () => {},
  });
  actionsRef.current = { ...actionsRef.current, duplicate: handleDuplicateNode, addToChat: handleAddToChatNode };

  /** 唤起底部图片对话框（工具栏图片图标 / 资产卡「生成图片」共用） */
  const handleOpenImageDialog = () => {
    setShowImageDialog(true);
    setShowBottomDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
  };

  /** 节点选取时读取资产 ID：兼容 assetId/asset_id/assetID 三形态（后端写入节点为下划线形态） */
  const readNodeAssetId = (data: Record<string, unknown>): string | number | undefined =>
    (data.assetId ?? data.asset_id ?? data.assetID) as string | number | undefined;

  /** 画布节点单击：选取模式下点击对应类型节点带入对话框，其他节点取消选取；
   *  非选取模式点击草稿身份卡（IKDMQQ 图片 / IKDMQS 视频 / IKDMQT 音频）：打开绑定面板继续编辑（待生成/生成中查看/失败修改） */
  const handleCanvasNodeClick = (node: Node) => {
    if (!pickMode || !pickTarget) {
      const data = (node.data ?? {}) as Record<string, unknown>;
      // IKDMQU Q10：保存失败时暂停切换编辑目标，提示重试（发送路径由 flushCanvasSave 单独拦截）；
      // 重开当前绑定目标不算切换，放行——面板恢复后编辑写回同节点可继续触发保存重试
      if (
        node.type === 'mediaNode' &&
        isInPlaceRegenTarget(node) &&
        saveStatus === 'error' &&
        node.id !== imageDraftId &&
        node.id !== videoDraftId &&
        node.id !== audioDraftId
      ) {
        showToast('warn', '保存失败，请重试');
        return;
      }
      if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'image') {
        openImageDraftDialog(node.id);
      }
      if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'video') {
        openVideoDraftDialog(node.id);
      }
      if (node.type === 'mediaNode' && data.draft === true && data.mediaType === 'audio') {
        openAudioDraftDialog(node.id);
      }
      // IKDMQU P1：单选有生成记录的成品卡自动打开对应生成面板（编辑写回原卡，发送后原卡重新生成）；
      // 上传素材卡无生成记录，不自动打开（Q4）；重新生成中/失败态的卡 jobId 仍在，可打开查看或调整重发
      if (node.type === 'mediaNode' && hasGenerationRecord(node)) {
        openMediaDraftDialog(node.id, data.mediaType);
      }
      return;
    }
    const data = (node.data ?? {}) as Record<string, unknown>;
    // IKDMQR：草稿绑定面板的「到节点选择」建立来源→草稿连线（与画布连线同一关系）；
    // 非法来源明确提示原因，不注入面板本地列表
    if (pickMode === 'image' && pickTarget === 'image' && imageDraftId) {
      if (node.type === 'mediaNode' && validateImageRefConnect(node.id, imageDraftId)) {
        addCanvasEdge(node.id, imageDraftId);
      }
      setPickMode(null);
      setPickTarget(null);
      setPickProductId(null);
      setPickAssetId(null);
      return;
    }
    // IKDMQS：视频草稿绑定面板的「到节点选择」建立来源→草稿连线，角色由发起入口显式指定
    // （首帧/尾帧/普通参考）；普通参考对图片与视频来源均开放
    if (pickTarget === 'video' && videoDraftId && (pickMode === 'image' || pickMode === 'video')) {
      if (node.type === 'mediaNode' && validateVideoRefConnect(node.id, videoDraftId, pickRefRole ?? undefined)) {
        addCanvasEdge(node.id, videoDraftId, pickRefRole ?? undefined);
      }
      setPickMode(null);
      setPickTarget(null);
      setPickRefRole(null);
      setPickProductId(null);
      setPickAssetId(null);
      return;
    }
    const isReadyMedia =
      node.type === 'mediaNode' &&
      typeof data.src === 'string' &&
      !data.genStatus;
    // 素材失效（已被删除/查不到）：阻断选取
    if (isReadyMedia && data.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    // 上传中的节点（blob 预览、无 assetId）：暂不可选取，否则发送时素材会被静默丢弃
    if (isReadyMedia && (data.src as string).startsWith('blob:')) {
      showToast('warn', '素材上传中，请稍候再选择');
      return;
    }
    if (pickMode === 'image' && isReadyMedia && data.mediaType !== 'video') {
      if (pickTarget === 'video') {
        // 视频对话框发起的图片节点选取 → 注入其参考图片
        setVideoDlgImagePickResult({
          ts: Date.now(),
          items: [{
            preview: data.src as string,
            type: 'image',
            assetId: readNodeAssetId(data),
          }],
        });
      } else {
        setImagePickResult({
          ts: Date.now(),
          files: [{
            id: `node-${node.id}`,
            url: data.src as string,
            type: 'image',
            name: (data.fileName as string) || node.id,
            assetId: readNodeAssetId(data),
          }],
        });
      }
    } else if (pickMode === 'video' && isReadyMedia && data.mediaType === 'video') {
      setVideoPickResult({
        ts: Date.now(),
        items: [{
          preview: data.src as string,
          type: 'video',
          assetId: readNodeAssetId(data),
        }],
      });
    } else if (pickMode === 'product' && isReadyMedia && data.mediaType === 'image') {
      // 商品卡发起的图片节点选取 → ts 驱动注入目标商品卡（仅图片，商品卡不支持视频）
      const targetId = pickProductId;
      if (targetId) {
        const newImage = {
          id: `node-${node.id}-${Date.now()}`,
          src: data.src as string,
          enabled: true,
          type: 'image' as const,
          ...(readNodeAssetId(data) ? { assetId: String(readNodeAssetId(data)!) } : {}),
        };
        setProductPickResult({ ts: Date.now(), productId: targetId, image: newImage });
      }
    } else if (pickMode === 'asset' && isReadyMedia && data.mediaType !== 'audio') {
      // 资产卡发起的图片/视频节点选取 → ts 驱动注入目标资产卡
      const targetId = pickAssetId;
      if (targetId) {
        const mediaType: 'image' | 'video' = data.mediaType === 'video' ? 'video' : 'image';
        const newRef = {
          id: `node-${node.id}-${Date.now()}`,
          src: data.src as string,
          type: mediaType,
          ...(readNodeAssetId(data) ? { assetId: String(readNodeAssetId(data)!) } : {}),
        };
        setAssetPickResult({ ts: Date.now(), assetId: targetId, ref: newRef });
      }
    }
    setPickMode(null);
    setPickTarget(null);
    setPickProductId(null);
    setPickAssetId(null);
  };

  /** 画布空白处单击：取消节点选取模式 */
  const handleCanvasPaneClick = () => {
    setPickMode(null);
    setPickTarget(null);
    setPickProductId(null);
    setPickAssetId(null);
    // Q9：点击空白隐藏生成面板（面板编辑已实时写回节点 data，隐藏不丢弃内容）。
    // 空白点击在 React Flow 是 PaneClick；onSelectionChange 的空选中可能是
    // 「取消旧选中→选中新卡」的过渡事件，不能作为关闭依据（IKDMQV）。
    if (imageDraftId) setShowImageDialog(false);
    if (videoDraftId) setShowBottomDialog(false);
    if (audioDraftId) setShowAudioDialog(false);
  };

  /** 选中变化（IKDMQU P1/Q9，IKDMQV 修订）：多选或单选切换到非绑定目标时隐藏面板；
   *  单选命中绑定目标时保持/恢复面板可见。
   *  空选中（nodes=[]）不在此处理——真空白点击由 onPaneClick 关闭（Q9 本义），
   *  节点删除由面板绑定清理 effect 关闭。
   *  仅隐藏不清绑定 id——保留「最近编辑目标」供 Q10 保存失败时放行重开原节点。
   *  选取参考模式进行中不关闭——用户正在为面板挑参考（pickMode 在 onNodeClick 尾部才清空，
   *  selection 变化先到达，此时 pickMode 仍活跃）。 */
  const handleSelectionChange = ({ nodes }: OnSelectionChangeParams) => {
    if (pickMode || pickTarget) return;
    // 事件参数在程序化改选中时会滞后误报（React Flow 内部 selection store 与受控 nodes
    // 的同步窗口：侧栏新建草稿 deselect 旧卡 + select 新卡，事件可能报旧卡+新卡双选中，
    // 把刚打开的面板当多选误关）——以受控 state 为准：state 明确 selected:false 的排除
    const candidates = nodes.filter((n) => {
      const m = mediaNodesRef.current.find((x) => x.id === n.id);
      return !m || m.selected !== false;
    });
    const soloId = candidates.length === 1 ? candidates[0]!.id : null;
    const syncPanelVisible = (
      boundId: string | null,
      setShow: (visible: boolean) => void,
    ) => {
      if (!boundId) return;
      if (soloId && soloId === boundId) {
        setShow(true); // 命中绑定目标：保持/恢复（修复程序化选中误报把面板当多选误关）
        return;
      }
      if (soloId || candidates.length > 1) setShow(false); // 单选其他卡或多选：隐藏
      // 空选中：不动作（真空白点击由 onPaneClick 处理，节点删除由绑定清理 effect 处理）
    };
    syncPanelVisible(imageDraftId, setShowImageDialog);
    syncPanelVisible(videoDraftId, setShowBottomDialog);
    syncPanelVisible(audioDraftId, setShowAudioDialog);
  };

  /** 节点拖拽结束：同步本次全部拖动节点的新坐标到父组件 state，触发自动保存。
   *  多选整组拖拽时 React Flow 第三参含同组全部节点；只回写被抓取节点会让父层坐标过期，
   *  下一次媒体合并 effect 用过期坐标覆盖画布内部状态，导致同组节点跳变（IKDKII 验收缺陷） */
  const handleNodeDragStop = (_node: Node, draggedNodes: Node[]) => {
    const positions = new Map(draggedNodes.map((n) => [n.id, n.position]));
    const applyDraggedPositions = (prev: Node[]) =>
      prev.map((n) => {
        const position = positions.get(n.id);
        return position ? { ...n, position } : n;
      });
    setTextNodes(applyDraggedPositions);
    setMediaNodes(applyDraggedPositions);
    setProductNodes(applyDraggedPositions);
    setAssetNodes(applyDraggedPositions);
  };

  // 资产卡等非节点入口：清空旧 seed，保证打开的是空白对话框
  actionsRef.current.openImageDialog = () => {
    setImageSeed(null);
    handleOpenImageDialog();
  };

  /** 绑定面板打开时的失效参考提示（IKDMQU Q3）：连线仍在但来源已失效（被推导过滤，不展示也不消费），
   *  明确告知避免静默丢弃；仅统计媒体来源连线，文本附件不受影响 */
  const warnStaleMediaRefs = (targetNodeId: string, kind: 'image' | 'video') => {
    const byId = new Map(mediaNodesRef.current.map((n) => [n.id, n]));
    const stale = edgesRef.current.some((e) => {
      if (e.target !== targetNodeId) return false;
      const source = byId.get(e.source);
      if (!source || source.type !== 'mediaNode') return false;
      return kind === 'image'
        ? imageRefSourceError(source) !== null
        : videoRefSourceError(source, readRefRole(e)) !== null;
    });
    if (stale) showToast('warn', '部分参考素材已失效，已忽略');
  };

  /** 按媒体类型打开对应绑定面板（IKDMQU）：图片/视频/音频统一派发，编辑实时写回本卡 */
  const openMediaDraftDialog = (nodeId: string, mediaType: unknown) => {
    if (mediaType === 'video') openVideoDraftDialog(nodeId);
    else if (mediaType === 'audio') openAudioDraftDialog(nodeId);
    else openImageDraftDialog(nodeId);
  };

  /** 打开绑定指定草稿的图片面板（IKDMQQ）：带入草稿已保存的参数与当前连线文本附件 */
  const openImageDraftDialog = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    setImageDraftId(nodeId);
    setImageSeed({
      ts: Date.now(),
      text: typeof d.prompt === 'string' ? d.prompt : '',
      files: [],
      params: {
        modelId: typeof d.draftModelId === 'string' ? d.draftModelId : undefined,
        ratio: typeof d.draftRatio === 'string' ? d.draftRatio : undefined,
        size: typeof d.draftSize === 'string' ? d.draftSize : undefined,
      },
      targetNodeId: nodeId,
      attachments: textAttachmentsOf(nodeId),
    });
    warnStaleMediaRefs(nodeId, 'image');
    handleOpenImageDialog();
  };

  /** 侧栏图片入口（IKDMQQ）：每次点击新建独立图片草稿卡，自动选中并打开绑定面板；
   *  草稿不进 pendingNodeIds 回滚集合——保存失败时草稿与当前编辑保留，随下次保存重试 */
  const handleAddImageDraft = () => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'image',
        fileName: '图片草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        toolMode,
        onDelete: (id: string) => {
          setMediaNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    setMediaNodes((prev) => [...deselect(prev), node]);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    openImageDraftDialog(nodeId);
  };

  /** 面板编辑实时写回草稿节点（IKDMQQ）：参数随节点 data 进入自动保存，刷新后恢复 */
  const handleImageDraftParamsChange = (
    nodeId: string,
    patch: { prompt?: string; modelId?: string; size?: string; ratio?: string },
  ) => {
    const data: Record<string, unknown> = {};
    if (patch.prompt !== undefined) data.prompt = patch.prompt;
    if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
    if (patch.size !== undefined) data.draftSize = patch.size;
    if (patch.ratio !== undefined) {
      data.draftRatio = patch.ratio;
      // 卡片占位形状跟随所选比例（沿用 targetRatio 语义）
      data.targetRatio = patch.ratio;
    }
    if (Object.keys(data).length === 0) return;
    patchMediaNode(nodeId, data);
  };

  /** 面板绑定清理（IKDMQQ；IKDMQU 扩展到成品卡）：绑定被其它入口取代、节点被删除/取消、
   *  或草稿身份结束且无生成记录时结束绑定并关闭面板；有生成记录的成品卡持续可绑定（重新生成中 jobId 仍在） */
  useEffect(() => {
    if (!imageDraftId) return;
    if (imageSeed?.targetNodeId !== imageDraftId) {
      setImageDraftId(null);
      return;
    }
    const node = mediaNodes.find((n) => n.id === imageDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || (d.draft !== true && !hasGenerationRecord(node))) {
      setImageDraftId(null);
      setShowImageDialog(false);
    }
  }, [imageDraftId, imageSeed, mediaNodes]);

  /** 打开绑定指定草稿的视频面板（IKDMQS）：带入草稿已保存的参数与当前连线文本附件 */
  const openVideoDraftDialog = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    setVideoDraftId(nodeId);
    setVideoSeed({
      ts: Date.now(),
      refs: [],
      text: typeof d.prompt === 'string' ? d.prompt : '',
      params: {
        modelId: typeof d.draftModelId === 'string' ? d.draftModelId : undefined,
        aspectRatio: typeof d.draftRatio === 'string' ? d.draftRatio : undefined,
        resolution: typeof d.draftSize === 'string' ? d.draftSize : undefined,
        duration: typeof d.draftDuration === 'number' ? d.draftDuration : undefined,
        mode: typeof d.draftMode === 'string' ? d.draftMode : undefined,
      },
      targetNodeId: nodeId,
      attachments: textAttachmentsOf(nodeId),
    });
    warnStaleMediaRefs(nodeId, 'video');
    setShowBottomDialog(true);
    setShowImageDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
  };

  /** 侧栏视频入口（IKDMQS）：每次点击新建独立视频草稿卡，自动选中并打开绑定面板；
   *  位置避开底部 Dock 预留区（与图片草稿同一出生点算法） */
  const handleAddVideoDraft = () => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'video',
        fileName: '视频草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        toolMode,
        onDelete: (id: string) => {
          setMediaNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    setMediaNodes((prev) => [...deselect(prev), node]);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    openVideoDraftDialog(nodeId);
  };

  /** 面板编辑实时写回视频草稿节点（IKDMQS）：参数随节点 data 进入自动保存，刷新后恢复 */
  const handleVideoDraftParamsChange = (
    nodeId: string,
    patch: { prompt?: string; modelId?: string; size?: string; ratio?: string; duration?: number; mode?: string },
  ) => {
    const data: Record<string, unknown> = {};
    if (patch.prompt !== undefined) data.prompt = patch.prompt;
    if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
    if (patch.size !== undefined) data.draftSize = patch.size;
    if (patch.duration !== undefined) data.draftDuration = patch.duration;
    if (patch.mode !== undefined) data.draftMode = patch.mode;
    if (patch.ratio !== undefined) {
      data.draftRatio = patch.ratio;
      data.targetRatio = patch.ratio;
    }
    if (Object.keys(data).length === 0) return;
    patchMediaNode(nodeId, data);
  };

  /** 面板绑定清理（IKDMQS；IKDMQU 扩展到成品卡，同图片） */
  useEffect(() => {
    if (!videoDraftId) return;
    if (videoSeed?.targetNodeId !== videoDraftId) {
      setVideoDraftId(null);
      return;
    }
    const node = mediaNodes.find((n) => n.id === videoDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || (d.draft !== true && !hasGenerationRecord(node))) {
      setVideoDraftId(null);
      setShowBottomDialog(false);
    }
  }, [videoDraftId, videoSeed, mediaNodes]);

  /** 打开绑定指定草稿的音频面板（IKDMQT）：带入草稿已保存的文字描述与模型 */
  const openAudioDraftDialog = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    setAudioDraftId(nodeId);
    setAudioSeed({
      ts: Date.now(),
      text: typeof d.prompt === 'string' ? d.prompt : '',
      modelId: typeof d.draftModelId === 'string' ? d.draftModelId : undefined,
      targetNodeId: nodeId,
    });
    setShowAudioDialog(true);
    setShowBottomDialog(false);
    setShowImageDialog(false);
    setShowMusicDialog(false);
  };

  /** 侧栏音频入口（IKDMQT）：每次点击新建独立音频草稿卡，自动选中并打开绑定面板；
   *  位置避开底部 Dock 预留区（与图片/视频草稿同一出生点算法）；
   *  音频草稿只有文字描述与模型，无比例/分辨率/时长参数 */
  const handleAddAudioDraft = () => {
    const nodeId = newNodeId('media-draft');
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: spawnDraftPosition(),
      selected: true,
      data: {
        src: '',
        mediaType: 'audio',
        fileName: '音频草稿',
        genStatus: 'draft',
        draft: true,
        prompt: '',
        toolMode,
        onDelete: (id: string) => {
          setMediaNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    const deselect = (prev: Node[]) => prev.map((n) => (n.selected ? { ...n, selected: false } : n));
    setTextNodes(deselect);
    setProductNodes(deselect);
    setAssetNodes(deselect);
    setMediaNodes((prev) => [...deselect(prev), node]);
    setSelectRequest({ id: nodeId, ts: Date.now() });
    openAudioDraftDialog(nodeId);
  };

  /** 面板编辑实时写回音频草稿节点（IKDMQT）：参数随节点 data 进入自动保存，刷新后恢复 */
  const handleAudioDraftParamsChange = (
    nodeId: string,
    patch: { prompt?: string; modelId?: string },
  ) => {
    const data: Record<string, unknown> = {};
    if (patch.prompt !== undefined) data.prompt = patch.prompt;
    if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
    if (Object.keys(data).length === 0) return;
    patchMediaNode(nodeId, data);
  };

  /** 面板绑定清理（IKDMQT；IKDMQU 扩展到成品卡，同图片） */
  useEffect(() => {
    if (!audioDraftId) return;
    if (audioSeed?.targetNodeId !== audioDraftId) {
      setAudioDraftId(null);
      return;
    }
    const node = mediaNodes.find((n) => n.id === audioDraftId);
    const d = (node?.data ?? {}) as Record<string, unknown>;
    if (!node || (d.draft !== true && !hasGenerationRecord(node))) {
      setAudioDraftId(null);
      setShowAudioDialog(false);
    }
  }, [audioDraftId, audioSeed, mediaNodes]);

  /** 同步 toolMode 到所有文本节点和媒体节点 */
  useEffect(() => {
    setTextNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
    setMediaNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
    setProductNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
    setAssetNodes((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
  }, [toolMode]);

  /** 项目切换/新建前的落盘闸门（IKDMQQ Q19）：先把未防抖编辑落盘；保存失败停留当前项目并提示重试。
   *  顺带修复「带未保存编辑切换项目丢失修改」的旧缺口。 */
  const ensureSavedBeforeProjectSwitch = async (): Promise<boolean> => {
    if (!currentId || !doc) return true;
    const projectId = currentId;
    applyingRef.current = true;
    try {
      return await flushCanvasSave(projectId);
    } catch (e) {
      showToast('error', '保存失败，请重试');
      console.warn('项目切换前画布落盘失败:', e);
      return false;
    } finally {
      applyingRef.current = false;
    }
  };

  /** 选择项目 */
  const handleSelect = async (id: string) => {
    if (!id || id === currentId) return;
    if (!(await ensureSavedBeforeProjectSwitch())) return;
    setCurrentId(id);
  };

  /** 重命名项目：PUT /api/projects/:id，成功后更新列表项 */
  const handleRename = (id: string, newName: string) => {
    renameProject(id, newName)
      .then((updated) => {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, name: updated.name } : p)),
        );
      })
      .catch(() => undefined);
  };

  /** 删除当前画布后回到项目列表；删除其他项目时留在当前画布。 */
  const handleDelete = (id: string) => {
    deleteProject(id)
      .then(() => {
        const remaining = projects.filter((p) => p.id !== id);
        setProjects(remaining);
        // 项目卡片页缓存含已删除项目；返回前清除，确保挂载后重新请求最新列表。
        queryClient.removeQueries({ queryKey: projectKeys.all });
        if (shouldReturnToProjectsAfterDelete(currentId, id)) {
          navigate('/projects');
          return;
        }
      })
      .catch(() => undefined);
  };

  /** 新建项目：POST /api/projects 并切换选中（撞名由后端自动追加 (2)(3)）；先过落盘闸门（IKDMQQ） */
  const handleNewProject = async () => {
    if (!(await ensureSavedBeforeProjectSwitch())) return;
    try {
      const created = await createProject(defaultProjectName());
      const item: CanvasProject = { id: String(created.id), name: created.name };
      setProjects((prev) => [item, ...prev]);
      setCurrentId(item.id);
    } catch {
      /* 创建失败不影响画布操作 */
    }
  };

  /**
   * 单文件落到画布：本地预览立即可见，后台三步上传成功后换永久 URL。
   * 工具栏多选和 Agent 侧边栏「+」（IKBA6C）共用这一条，避免会话附件与画布各传一次。
   */
  const placeFileOnCanvas = (file: File): Promise<{ asset_id: string; url: string }> => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      return Promise.reject(new Error('只支持图片或视频'));
    }
    const limit = UPLOAD_SIZE_LIMIT[isImage ? 'image' : 'video'];
    if (file.size > limit) {
      return Promise.reject(new Error(`文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限`));
    }
    const nodeId = newNodeId('media');
    const localSrc = URL.createObjectURL(file);
    pendingNodeIdsRef.current.add(nodeId);
    setMediaNodes((prev) => [
      ...prev,
      {
        id: nodeId,
        type: 'mediaNode',
        position: spawnPosition(),
        data: {
          src: localSrc,
          fileName: file.name,
          mediaType: isVideo ? 'video' : 'image',
          toolMode,
          onDelete: (id: string) => {
            setMediaNodes((current) => {
              const node = current.find((n) => n.id === id);
              if (node?.data?.src) URL.revokeObjectURL(node.data.src as string);
              return current.filter((n) => n.id !== id);
            });
          },
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
          onRetryJob: (id: string) => actionsRef.current.retryJob(id),
          onReEdit: (id: string) => actionsRef.current.reEdit(id),
          onGenImage: (id: string) => actionsRef.current.genImage(id),
          onGenVideo: (id: string) => actionsRef.current.genVideo(id),
          onGenAudio: (id: string) => actionsRef.current.genAudio(id),
          onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
        },
      },
    ]);
    return uploadAssetFile(file, { projectId: currentId || undefined })
      .then((done) => {
        setMediaNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId) return n;
            URL.revokeObjectURL(localSrc);
            return {
              ...n,
              data: {
                ...n.data,
                src: done.url || localSrc,
                assetId: done.asset_id,
                mime: done.mime,
                width: done.width,
                height: done.height,
                duration: done.duration ?? undefined,
                size: done.size,
              },
            };
          }),
        );
        return { asset_id: done.asset_id, url: done.url };
      })
      .catch((err) => {
        // 上传登记失败 = 添加失败：节点不留在画布，移除并释放 blob URL
        console.warn(`画布上传登记失败（${file.name}）：`, err);
        URL.revokeObjectURL(localSrc);
        pendingNodeIdsRef.current.delete(nodeId);
        setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
        showToast('error', `「${file.name}」添加失败，请重试`);
        throw err instanceof Error ? err : new Error('上传失败');
      });
  };

  /** 上传文件生成媒体节点：本地预览立即上画布，后台三步上传登记，成功后换永久 URL；
   *  上传失败时 placeFileOnCanvas 内部已移除节点并 toast「添加失败，请重试」 */
  const handleUploadFile = (files: File[]) => {
    files.forEach((file) => {
      void placeFileOnCanvas(file).catch(() => {
        // 前置校验失败（类型不支持/超大小上限）发生在节点创建前：无节点可清理，仅提示
        showToast('error', `「${file.name}」添加失败，请重试`);
      });
    });
  };

  /** 从资产 URL 提取展示名（无元数据字段时的兜底命名） */
  const assetDisplayName = (asset: AssetRecord): string => {
    try {
      const last = new URL(asset.url).pathname.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : `资产-${asset.id}`;
    } catch {
      return `资产-${asset.id}`;
    }
  };

  /** 资产库选择弹窗 → 确认选中的已有资产批量落到画布（多选）：
   *  直接以 /api/assets 返回的 id 作为 assetId 建媒体节点，不走 TOS 上传；
   *  后台补 link 关联，确保素材进入当前项目 snapshot 字典（刷新后不判缺失）。
   *  返回是否成功（项目未就绪时 false，由调用方决定是否提示）。 */
  const placeAssetsOnCanvas = (selectedAssets: AssetRecord[]): boolean => {
    if (!currentId) return false;

    const nodes: Node[] = selectedAssets.map((asset) => {
      const fileNameFromUrl = assetDisplayName(asset);
      const nodeId = newNodeId('media');
      return {
        id: nodeId,
        type: 'mediaNode' as const,
        // 多节点在视口中心 ±80px 范围内自然错乱堆叠，与单节点添加行为一致
        position: spawnPosition(),
        data: {
          src: asset.url,
          fileName: fileNameFromUrl,
          mediaType: asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image',
          assetId: String(asset.id),
          width: asset.width ?? undefined,
          height: asset.height ?? undefined,
          duration: asset.duration ?? undefined,
          size: asset.size ?? undefined,
          toolMode,
          onDelete: (id: string) => {
            setMediaNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onReEdit: (id: string) => actionsRef.current.reEdit(id),
          onGenImage: (id: string) => actionsRef.current.genImage(id),
          onGenVideo: (id: string) => actionsRef.current.genVideo(id),
          onGenAudio: (id: string) => actionsRef.current.genAudio(id),
          onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
        },
      };
    });

    nodes.forEach((node) => pendingNodeIdsRef.current.add(node.id));
    setMediaNodes((prev) => [...prev, ...nodes]);

    // 幂等补关联：素材已属当前项目也无副作用；失败仅提示，不影响节点展示
    selectedAssets.forEach((asset) => {
      linkAssetToProject(currentId, asset.id).catch((err) => {
        console.warn('资产关联项目失败：', err);
        showToast('warn', '资产关联项目失败，请稍后重试');
      });
    });
    return true;
  };

  /** 资产选择弹窗统一确认路由（IKC3RY 模块D 八入口）：
   *  按打开来源分发——画布工具栏/Agent 面板落画布节点（Agent 面板额外挂会话附件），
   *  dock 对话框注入参考素材（带 assetId，发送时免重复上传）。
   *  选择行为与该入口现有上传一致：数量上限/超限提示由各消费方既有链路兜底。 */
  const handleAssetsPickerSelect = (selectedAssets: AssetRecord[]) => {
    const target = assetsPickerTarget;
    setShowAssetsPicker(false);
    if (selectedAssets.length === 0) return;

    if (target === 'bottomImage' || target === 'bottomVideo') {
      // 视频 dock：注入 BottomDialog 参考素材（图片/视频分开注入，走 externalPick 既有上限保护与去重）
      const kind = target === 'bottomImage' ? 'image' : 'video';
      const items: BottomRefItem[] = selectedAssets
        .filter((a) => a.type === kind)
        .map((a) => ({ preview: a.url, type: kind, assetId: a.id }));
      if (items.length === 0) return;
      if (target === 'bottomImage') {
        setVideoDlgImagePickResult({ ts: Date.now(), items });
      } else {
        setVideoPickResult({ ts: Date.now(), items });
      }
      return;
    }
    if (target === 'imageDialog') {
      // 图片 dock：注入 ImageDialog 参考图（externalPick 既有上限保护与去重）
      const files: UploadedFile[] = selectedAssets
        .filter((a) => a.type === 'image')
        .map((a) => ({ id: `asset-${a.id}`, url: a.url, type: 'image' as const, name: assetDisplayName(a), assetId: a.id }));
      if (files.length === 0) return;
      setImagePickResult({ ts: Date.now(), files });
      return;
    }
    if (target === 'agentPanel') {
      // Agent 面板：与上传一致落画布节点（IKBA6C），并挂 ready 会话附件
      if (!placeAssetsOnCanvas(selectedAssets)) {
        showToast('error', '项目未就绪，请稍后重试');
        return;
      }
      const blocks: SessionContentBlock[] = selectedAssets
        .filter((a) => a.type === 'image' || a.type === 'video')
        .map((a) => ({
          type: 'asset_ref',
          url: a.url,
          name: assetDisplayName(a),
          media_type: (a.type === 'video' ? 'video' : 'image') as 'image' | 'video',
          display_label: assetDisplayName(a),
          asset_id: String(a.id),
        }));
      if (blocks.length > 0) setAgentAssetPicks({ ts: Date.now(), blocks });
      return;
    }
    // 默认（画布工具栏）：全类型批量落画布
    if (!placeAssetsOnCanvas(selectedAssets)) {
      showToast('error', '项目未就绪，请稍后重试');
    }
  };

  /* ============ 生成任务编排：创建 → 占位节点 → 轮询 → 产物挂载 ============ */

  /** 媒体节点最新列表（轮询中判断节点是否仍存在） */
  const mediaNodesRef = useRef<Node[]>([]);
  mediaNodesRef.current = mediaNodes;
  /** 文本节点最新列表（避免闭包陈旧） */
  const textNodesRef = useRef<Node[]>([]);
  textNodesRef.current = textNodes;
  /** 资产卡节点最新列表（避免闭包陈旧） */
  const assetNodesRef = useRef<Node[]>([]);
  assetNodesRef.current = assetNodes;
  /** 商品节点最新列表（避免闭包陈旧） */
  const productNodesRef = useRef<Node[]>([]);
  productNodesRef.current = productNodes;
  /** 生成节点轮询定时器（节点 id → timer） */
  const jobTimersRef = useRef<Map<string, number>>(new Map<string, number>());
  /** 取消接口已确认成功的节点：忽略仍在飞行中的旧轮询响应。 */
  const locallyRemovedGenerationNodesRef = useRef<Set<string>>(new Set());
  /** 已本地收敛的提取节点：快照若仍停留在 generating，水合不得再开轮询。 */
  const settledExtractNodesRef = useRef<Set<string>>(new Set());
  /** 节点当前活跃任务登记（IKDMQV）：轮询启动即同步写入，响应到达时核对——
   *  迟到旧任务响应（创建/重试后仍在飞行的旧 promise）直接丢弃，不覆盖当前任务状态或结果。
   *  用同步 ref 而非节点 data：patch jobId 经 React 提交有延迟，首个响应可能先于提交到达。 */
  const activeJobByNodeRef = useRef<Map<string, string>>(new Map());

  // 卸载时清理全部轮询
  useEffect(() => {
    const timers = jobTimersRef.current;
    const activeJobs = activeJobByNodeRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
      activeJobs.clear();
    };
  }, []);

  /** 更新媒体节点 data 局部字段 */
  const patchMediaNode = (nodeId: string, patch: Record<string, unknown>) => {
    setMediaNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  };

  /** 浏览器实测媒体尺寸回填：仅写缺失/不一致字段，避免触发无谓自动保存 */
  const handleMediaDims = (nodeId: string, dims: MediaDims) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (data.width !== dims.width) patch.width = dims.width;
    if (data.height !== dims.height) patch.height = dims.height;
    if (typeof dims.duration === 'number' && typeof data.duration !== 'number') patch.duration = dims.duration;
    if (Object.keys(patch).length === 0) return;
    patchMediaNode(nodeId, patch);
  };

  /** 轮询函数引用（供水合恢复调用，避免声明顺序依赖） */
  const pollJobRef = useRef<(nodeId: string, jobId: number | string) => void>(() => {});

  /** 轮询任务状态直至终态：succeeded 挂载产物 / failed 展示错误 / cancelled 收敛。
   *  启动即登记本任务为节点活跃任务（IKDMQV）：后启动的轮询覆盖登记，
   *  旧任务迟到的飞行中响应因登记不匹配被丢弃，不得覆盖当前任务。 */
  const pollJob = (nodeId: string, jobId: number | string) => {
    const existing = jobTimersRef.current.get(nodeId);
    if (existing) window.clearTimeout(existing);
    activeJobByNodeRef.current.set(nodeId, String(jobId));
    const tick = () => {
      fetchJobStatus(jobId)
        .then((detail) => {
          const node = mediaNodesRef.current.find((n) => n.id === nodeId);
          if (!node) return; // 节点已删除
          if (activeJobByNodeRef.current.get(nodeId) !== String(jobId)) return; // 迟到旧任务响应——节点已承接新任务，丢弃且不续链
          if (locallyRemovedGenerationNodesRef.current.has(nodeId)) {
            jobTimersRef.current.delete(nodeId);
            return;
          }
          if (isMediaExtractNodeId(nodeId)) {
            const extractPatch = mediaExtractTerminalPatch(
              detail,
              typeof node.data?.fileName === 'string' ? node.data.fileName : undefined,
            );
            if (extractPatch) {
              jobTimersRef.current.delete(nodeId);
              settledExtractNodesRef.current.add(nodeId);
              patchMediaNode(nodeId, extractPatch);
              return;
            }
          }
          if (detail.status === 'succeeded') {
            jobTimersRef.current.delete(nodeId);
            const originalType = node.data?.mediaType;
            const assetType = detail.asset?.type;
            patchMediaNode(nodeId, {
              genStatus: undefined,
              progress: 100,
              errorText: undefined,
              src: detail.asset?.url ?? '',
              mediaType: (assetType === 'audio' || assetType === 'video' || assetType === 'image')
                ? assetType
                : (originalType ?? 'image'),
              fileName: `生成-${jobId}`,
              assetId: detail.asset?.id,
              width: detail.asset?.width ?? undefined,
              height: detail.asset?.height ?? undefined,
              duration: detail.asset?.duration ?? undefined,
              // 原位草稿成功（IKDMQQ）：草稿身份结束转为普通成品卡；
              // draftModelId/draftSize/draftRatio 保留为该卡的生成参数记录（再次编辑复制切片复用）
              draft: undefined,
            });
            return;
          }
          if (detail.status === 'failed') {
            jobTimersRef.current.delete(nodeId);
            patchMediaNode(nodeId, {
              genStatus: 'failed',
              errorText: readJobFailText(detail.error),
            });
            return;
          }
          if (detail.status === 'cancelled') {
            jobTimersRef.current.delete(nodeId);
            if (cancelledTerminalAction(node) === 'restore') {
              // IKDMQU Q5：成品卡重新生成被取消 → 恢复成品态，保留旧素材与最新编辑
              patchMediaNode(nodeId, { genStatus: undefined, progress: undefined, errorText: undefined });
              return;
            }
            setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
            return;
          }
          patchMediaNode(nodeId, { progress: detail.progress });
          jobTimersRef.current.set(nodeId, window.setTimeout(tick, 2500));
        })
        .catch((e) => {
          console.warn('任务轮询失败，稍后重试:', e);
          jobTimersRef.current.set(nodeId, window.setTimeout(tick, 5000));
        });
    };
    tick();
  };

  /** 创建生成任务：立即上画布「生成中」占位节点，创建成功后启动轮询。
   *  videoRefs 仅 video：首尾帧（图片）或普通参考素材（图/视频）assetId/materialId，与 input_asset_ids 互斥。
   *  素材库引用（Asset- 前缀）走 *_material_id / reference_materials；同一帧位 asset 与 material 互斥。
   *  targetNodeId 仅图片/视频（IKDLQF/IKDLQG）：从对应媒体节点面板发起时携带，服务端按最新画布推导连线文本附件。
   *  目标是草稿身份节点时（IKDMQQ）：不再新建占位卡，草稿原地转生成中，结果回填同一张卡 */
  const startGenerationJob = (
    type: 'image' | 'video' | 'audio',
    parameters: ImageJobParameters | VideoJobParameters | AudioJobParameters,
    inputAssetIds?: string[],
    videoRefs?: {
      firstFrameAssetId?: string;
      lastFrameAssetId?: string;
      referenceAssetIds?: string[];
      firstFrameMaterialId?: string;
      lastFrameMaterialId?: string;
      referenceMaterials?: Array<{ id: string; type: 'image' | 'video' }>;
    },
    targetNodeId?: string,
  ) => {
    if (!currentId) {
      console.warn('未选中项目，无法创建生成任务');
      return;
    }
    if (targetNodeId && blockInvalidDraft(edgesRef.current.filter(e => e.target === targetNodeId).map(e => e.source))) return;
    if (blockIfQuotaInsufficient()) return;
    // 原位模式（IKDMQQ 草稿 + IKDMQU 成品卡原卡重新生成）：目标节点原地承接任务，身份/位置/连线保持不变
    const inPlaceNode = targetNodeId
      ? mediaNodesRef.current.find((n) => n.id === targetNodeId && isInPlaceRegenTarget(n))
      : undefined;
    const inPlaceNodeId = inPlaceNode?.id;
    if (inPlaceNodeId) {
      const isDraftTarget =
        ((inPlaceNode!.data ?? {}) as Record<string, unknown>).draft === true;
      patchMediaNode(inPlaceNodeId, {
        genStatus: 'generating',
        progress: 0,
        errorText: undefined,
        // 草稿无素材可显示，改名提示生成内容（IKDMQQ）；
        // 成品卡保留原文件名——旧素材继续显示，生成中由状态角标标记（IKDMQU Q5）
        ...(isDraftTarget
          ? {
              fileName:
                type === 'video' ? '视频生成中' : type === 'audio' ? '音频生成中' : '图片生成中',
            }
          : {}),
        prompt: parameters.prompt,
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
      });
    }
    const nodeId = inPlaceNodeId ?? newNodeId('media-gen');
    if (!inPlaceNodeId) {
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: spawnPosition(),
      data: {
        genStatus: 'generating',
        progress: 0,
        mediaType: type,
        fileName: type === 'video' ? '视频生成中' : type === 'audio' ? '音频生成中' : '图片生成中',
        prompt: parameters.prompt,
        targetRatio: 'aspect_ratio' in parameters ? parameters.aspect_ratio : undefined,
        toolMode,
        onDelete: (id: string) => {
          setMediaNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
        onRetryJob: (id: string) => actionsRef.current.retryJob(id),
        onDuplicate: (id: string) => actionsRef.current.duplicate(id),
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onReEdit: (id: string) => actionsRef.current.reEdit(id),
        onGenImage: (id: string) => actionsRef.current.genImage(id),
        onGenVideo: (id: string) => actionsRef.current.genVideo(id),
        onGenAudio: (id: string) => actionsRef.current.genAudio(id),
        onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
        onDownload: (id: string) => actionsRef.current.download(id),
        onShowDetails: (id: string) => actionsRef.current.showDetails(id),
        onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
        onMediaDims: handleMediaDims,
      },
    };
    setMediaNodes((prev) => [...prev, node]);
    }
    // 发起前的活跃任务登记（IKDMQV）：create 返回时核对——期间若被重试等其他提交接管，
    // 放弃本次结果（不 patch、不开轮询），与 handleRetryJob 的接管核对对称
    const activeAtCreate = activeJobByNodeRef.current.get(nodeId);
    try {
      createGenerationJob(currentId, {
        type,
        expected_output_count: 1,
        parameters,
        input_asset_ids: inputAssetIds,
        first_frame_asset_id: videoRefs?.firstFrameAssetId,
        last_frame_asset_id: videoRefs?.lastFrameAssetId,
        reference_asset_ids: videoRefs?.referenceAssetIds?.length
          ? videoRefs.referenceAssetIds
          : undefined,
        first_frame_material_id: videoRefs?.firstFrameMaterialId,
        last_frame_material_id: videoRefs?.lastFrameMaterialId,
        reference_materials: videoRefs?.referenceMaterials?.length
          ? videoRefs.referenceMaterials
          : undefined,
        // 仅从图片/视频媒体节点面板发起时携带（IKDLQF/IKDLQG）；其余入口连字段都不上送
        ...(targetNodeId ? { target_node_id: targetNodeId } : {}),
      })
        .then((created) => {
          if (activeJobByNodeRef.current.get(nodeId) !== activeAtCreate) return;
          patchMediaNode(nodeId, { jobId: created.generation_job_id });
          pollJob(nodeId, created.generation_job_id);
        })
        .catch((e) => {
          /** 原位目标回退：草稿回待生成保留参数（IKDMQQ/IKDMQS/IKDMQT）；
           *  成品卡恢复成品态保留旧素材与最新编辑（IKDMQU Q5，同取消恢复） */
          const rollbackInPlace = () => {
            const node = mediaNodesRef.current.find((n) => n.id === nodeId);
            if (!node) return;
            if (((node.data ?? {}) as Record<string, unknown>).draft === true) {
              patchMediaNode(nodeId, {
                genStatus: 'draft',
                progress: undefined,
                fileName: type === 'video' ? '视频草稿' : type === 'audio' ? '音频草稿' : '图片草稿',
              });
            } else {
              patchMediaNode(nodeId, { genStatus: undefined, progress: undefined, errorText: undefined });
            }
          };
          const takenOver = () => activeJobByNodeRef.current.get(nodeId) !== activeAtCreate;
          if (openRechargeForQuotaError(e)) {
            if (takenOver()) return; // 已被其他提交接管：回退不得覆盖新任务状态
            if (inPlaceNodeId) rollbackInPlace();
            else setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
            return;
          }
          if (isApiError(e) && e.status === 401) {
            if (!takenOver()) {
              if (inPlaceNodeId) rollbackInPlace();
              else setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
            }
            useAuthPromptStore.getState().addResume(() => {
              startGenerationJob(type, parameters, inputAssetIds, videoRefs, targetNodeId);
            });
            return;
          }
          if (takenOver()) return; // 已被接管：失败态不得覆盖新任务的执行状态
          patchMediaNode(nodeId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '创建任务失败',
          });
        });
    } catch (e: unknown) {
      // 同步异常兜底（如 crypto.randomUUID 在 HTTP 下不可用）
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: isApiError(e) ? e.message : '创建任务失败',
      });
    }
  };

  /** 取消生成：接口确认后立即移除卡片，避免测试站状态延迟造成持续轮询。 */
  const handleCancelJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
    if (!currentId || jobId == null) return;
    void cancelGenerationJob(currentId, jobId)
      .then(() => {
        locallyRemovedGenerationNodesRef.current.add(nodeId);
        removeCancelledGenerationNode(
          nodeId,
          jobTimersRef.current,
          (id) => setMediaNodes((prev) => prev.filter((n) => n.id !== id)),
        );
      })
      .catch((e) => {
        console.warn('取消生成失败:', e);
      });
  };

  /** 重试失败任务：retry 接口创建新任务（沿用失败任务冻结快照），节点回到生成中。
   *  与「修改后新生成」（面板发送 → createGenerationJob 新任务新快照）是两条独立路径：
   *  重试不改输入也不落盘画布——历史失败任务输入保持不变（IKDMQV）。 */
  const handleRetryJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
    if (!currentId || !jobId) return;
    // 防重入：首次点击已置 generating（重试按钮随失败占位消失，此处拦截双击与迟到回调交错）
    if ((node?.data as Record<string, unknown> | undefined)?.genStatus === 'generating') return;
    if (blockIfQuotaInsufficient()) return;
    patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '' });
    // 登记发起重试时的任务为核对基准：retry 返回前若被新任务接管（面板重新提交），放弃本次结果不覆盖
    activeJobByNodeRef.current.set(nodeId, String(jobId));
    try {
      retryGenerationJob(currentId, jobId)
        .then((created) => {
          if (activeJobByNodeRef.current.get(nodeId) !== String(jobId)) return;
          patchMediaNode(nodeId, { jobId: created.generation_job_id });
          pollJob(nodeId, created.generation_job_id);
        })
        .catch((e) => {
          if (activeJobByNodeRef.current.get(nodeId) !== String(jobId)) return;
          if (openRechargeForQuotaError(e)) {
            patchMediaNode(nodeId, {
              genStatus: 'failed',
              errorText: isApiError(e) ? e.message : '余额不足',
            });
            return;
          }
          if (isApiError(e) && e.status === 401) {
            patchMediaNode(nodeId, { genStatus: 'failed', errorText: '' });
            useAuthPromptStore.getState().addResume(() => {
              handleRetryJob(nodeId);
            });
            return;
          }
          patchMediaNode(nodeId, {
            genStatus: 'failed',
            errorText: isApiError(e) ? e.message : '重试失败',
          });
        });
    } catch (e: unknown) {
      patchMediaNode(nodeId, {
        genStatus: 'failed',
        errorText: isApiError(e) ? e.message : '重试失败',
      });
    }
  };
  actionsRef.current.cancelJob = handleCancelJob;
  actionsRef.current.retryJob = handleRetryJob;
  pollJobRef.current = pollJob;

  /* ============ 节点工具条：重新编辑/生成图片/生成视频/生成音频/下载 ============ */

  /** 被点节点 → 对话框参考素材描述（素材已被删除的节点不可作为参考/下载来源） */
  const nodeRefOf = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (node?.data?.assetMissing) {
      showToast('warn', '素材已被删除');
      return null;
    }
    const src = node?.data?.src as string | undefined;
    if (!src) return null;
    const type: 'image' | 'video' = node?.data?.mediaType === 'video' ? 'video' : 'image';
    const name = (node?.data?.fileName as string) || id;
    const prompt = typeof node?.data?.prompt === 'string' ? (node.data.prompt as string) : '';
    const assetId = readNodeAssetId((node?.data ?? {}) as Record<string, unknown>);
    return { src, type, name, prompt, assetId };
  };

  /** 目标节点的文本附件（IKDLQF）：连线 target 为该节点、source 为 textNode 且 data.text 为 string；
   *  顺序即 edges 数组顺序（连入顺序），面板打开当下取快照 */
  const textAttachmentsOf = (targetNodeId: string): ImageTextAttachment[] =>
    edgesRef.current
      .filter((e) => e.target === targetNodeId)
      .map((e) => textNodesRef.current.find((n) => n.id === e.source))
      .filter((n): n is Node => n?.type === 'textNode' && typeof n.data?.text === 'string')
      .map((n) => ({
        nodeId: n.id,
        title: typeof n.data.title === 'string' && n.data.title ? (n.data.title as string) : '文本节点',
        text: n.data.text as string,
      }));

  /** 目标面板附件重排（IKDLQH）：把该目标文本附件边子序列原地重排为新顺序（其余边相对位置不变，
   *  各目标顺序独立），并同步面板 seed 的附件快照顺序（保持 ts 不重挂载面板）。重排随自动保存持久化。
   *  面板快照与当前连线不一致（如打开期间来源被断开）时不重排。 */
  const handleReorderAttachments = (targetNodeId: string, orderedNodeIds: string[]) => {
    const liveIds = textAttachmentsOf(targetNodeId).map((a) => a.nodeId);
    if (
      liveIds.length !== orderedNodeIds.length ||
      !orderedNodeIds.every((id) => liveIds.includes(id))
    )
      return;
    setEdges((prev) => {
      const slots = prev
        .map((e, i) => (e.target === targetNodeId && orderedNodeIds.includes(e.source) ? i : -1))
        .filter((i) => i >= 0);
      if (slots.length !== orderedNodeIds.length) return prev;
      const edgeBySource = new Map(slots.map((i) => [prev[i]!.source, prev[i]!]));
      const next = [...prev];
      slots.forEach((slot, k) => {
        next[slot] = edgeBySource.get(orderedNodeIds[k]!)!;
      });
      return next;
    });
    const syncAttachments = (atts: ImageTextAttachment[] | undefined) => {
      if (!atts) return atts;
      const byId = new Map(atts.map((a) => [a.nodeId, a]));
      return orderedNodeIds.map((id) => byId.get(id)!);
    };
    setImageSeed((s) =>
      s?.targetNodeId === targetNodeId ? { ...s, attachments: syncAttachments(s.attachments) } : s,
    );
    setVideoSeed((s) =>
      s?.targetNodeId === targetNodeId ? { ...s, attachments: syncAttachments(s.attachments) } : s,
    );
  };

  /** 草稿绑定时面板文本附件实时跟随画布连线（IKDMQQ）；非草稿绑定沿用打开当下快照。
   *  IKDLQH 的连线重排直接改变 edges 顺序，草稿绑定面板因此天然跟随，无需额外同步。 */
  const imageDraftAttachments = useMemo(
    () => (imageDraftId ? textAttachmentsOf(imageDraftId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageDraftId, edges, textNodes],
  );

  /** 视频草稿绑定面板的文本附件实时跟随画布连线（IKDMQS，同图片草稿） */
  const videoDraftAttachments = useMemo(
    () => (videoDraftId ? textAttachmentsOf(videoDraftId) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoDraftId, edges, textNodes],
  );

  /** 草稿绑定面板的图片媒体参考（IKDMQR）：按连线实时推导，Dock 显示即提交输入（同源）。
   *  连线持久化后刷新/重开项目同样经此推导恢复展示。 */
  const imageDraftMediaRefs = useMemo(
    () => (imageDraftId ? imageMediaRefsOf(imageDraftId, edges, mediaNodes) : undefined),
    [imageDraftId, edges, mediaNodes],
  );

  /** Dock 移除图片参考（IKDMQR）：断开对应连线——仅改变关系，不删除来源素材卡，
   *  也不影响其他目标对同一来源的引用（按 (source,target) 精确匹配）。 */
  const handleRemoveImageMediaRef = (draftId: string, sourceNodeId: string) => {
    setEdges((prev) => prev.filter((e) => !(e.source === sourceNodeId && e.target === draftId)));
  };

  /** 草稿绑定面板的视频媒体参考（IKDMQS）：按连线角色实时分组推导，Dock 显示即提交输入（同源）。
   *  角色随连线持久化，刷新/重开项目后经同一推导恢复展示。 */
  const videoDraftMediaRefs = useMemo(
    () => (videoDraftId ? videoMediaRefsOf(videoDraftId, edges, mediaNodes) : undefined),
    [videoDraftId, edges, mediaNodes],
  );

  /** Dock 移除视频参考（IKDMQS）：断开对应连线（首帧/尾帧/普通参考同一路径） */
  const handleRemoveVideoRef = (draftId: string, sourceNodeId: string) => {
    setEdges((prev) => prev.filter((e) => !(e.source === sourceNodeId && e.target === draftId)));
  };

  /** Dock 显式改变参考角色（IKDMQS）：改写连线的 edge.data.refRole。
   *  帧位占用/尾帧配首帧约束与服务端同口径，冲突时明确提示不静默替换。 */
  const handleSetVideoRefRole = (draftId: string, sourceNodeId: string, role: VideoRefRole) => {
    const source = mediaNodesRef.current.find((n) => n.id === sourceNodeId);
    const sourceErr = source ? videoRefSourceError(source, role) : null;
    if (sourceErr) {
      showToast('warn', sourceErr);
      return;
    }
    const refs = videoMediaRefsOf(draftId, edgesRef.current, mediaNodesRef.current);
    if (role === 'first' && refs.first && refs.first.nodeId !== sourceNodeId) {
      showToast('warn', '首帧已指定，请先移除现有首帧');
      return;
    }
    if (role === 'last') {
      if (!refs.first) {
        showToast('warn', '尾帧必须与首帧一起使用，请先指定首帧');
        return;
      }
      if (refs.last && refs.last.nodeId !== sourceNodeId) {
        showToast('warn', '尾帧已指定，请先移除现有尾帧');
        return;
      }
    }
    setEdges((prev) =>
      prev.map((e) =>
        e.source === sourceNodeId && e.target === draftId
          ? { ...e, data: role === 'reference' ? undefined : { refRole: role } }
          : e,
      ),
    );
  };

  /** 重新编辑（IKDMQU）：三类媒体卡统一走绑定面板——编辑实时写回本卡、发送后原卡重新生成（Q1）；
   *  图片/视频参数与参考连线经 openXxxDraftDialog 恢复；音频此前落入图片分支，本切片补齐绑定 */
  const handleNodeReEdit = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    if (!node || node.type !== 'mediaNode') return;
    openMediaDraftDialog(id, ((node.data ?? {}) as Record<string, unknown>).mediaType);
  };

  /** 生成图片：图片对话框 + 图片；IKDLQF 起携带目标节点与连线文本附件快照 */
  const handleNodeGenImage = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    setImageSeed({
      ts: Date.now(),
      text: '',
      files: [{ id: `node-${id}`, url: ref.src, type: ref.type, name: ref.name, assetId: ref.assetId }],
      targetNodeId: id,
      attachments: textAttachmentsOf(id),
    });
    handleOpenImageDialog();
  };

  /** 生成视频：视频对话框 + 图片（带 assetId，发送时免重传直传 ID）；
   *  被点节点是视频媒体节点时携带目标节点与连线文本附件快照（IKDLQG），图片节点维持参考素材旧语义 */
  const handleNodeGenVideo = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    setVideoSeed({
      ts: Date.now(),
      refs: [{ preview: ref.src, type: ref.type, ...(ref.assetId != null ? { assetId: ref.assetId } : {}) }],
      ...(ref.type === 'video' ? { targetNodeId: id, attachments: textAttachmentsOf(id) } : {}),
    });
    setShowBottomDialog(true);
    setShowImageDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
  };

  /** 生成音频：打开音频对话框 */
  const handleNodeGenAudio = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    setAudioSeed({ ts: Date.now() });
    setShowAudioDialog(true);
    setShowBottomDialog(false);
    setShowImageDialog(false);
    setShowMusicDialog(false);
  };

  /** 视频整段提取音频：后端创建任务并注入音频节点；前端用返回的 job_id 轮询，终态本地收敛。 */
  const handleNodeExtractAudio = async (id: string) => {
    const node = mediaNodesRef.current.find((item) => item.id === id);
    const assetId = node?.data?.assetId as string | number | undefined;
    if (node?.data?.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    if (!currentId) {
      showToast('warn', '未选中项目，无法提取音频');
      return;
    }
    if (node?.data?.mediaType !== 'video' || assetId == null) {
      showToast('warn', '当前视频尚未关联资产，无法提取音频');
      return;
    }

    try {
      const created = await createMediaExtraction(currentId, {
        source_asset_id: assetId,
        output_format: 'mp3',
      });
      const nodes = await refetch();
      if (!snapshotHasMediaExtractNode(nodes, created.job_id)) {
        showToast('warn', '提取任务已创建，但画布节点尚未出现，请刷新画布');
        return;
      }
      pollJob(mediaExtractNodeId(created.job_id), created.job_id);
    } catch (error) {
      if (!isApiError(error)) showToast('error', '音频提取任务创建失败');
    }
  };

  /** 下载：优先 fetch blob 触发下载，跨域失败回退新标签页打开 */
  const handleNodeDownload = async (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    try {
      const res = await fetch(ref.src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = ref.name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(ref.src, '_blank', 'noopener');
    }
  };

  /** 查看媒体详情：先展示节点快照，再按 assetId 补全完整资产字段。 */
  const handleNodeShowDetails = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    const data = (node?.data ?? {}) as Record<string, unknown>;
    if (node?.data?.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    const type = data.mediaType;
    const url = data.src;
    if (!node || (type !== 'image' && type !== 'video' && type !== 'audio') || typeof url !== 'string') {
      showToast('warn', '当前媒体暂无可展示的详情');
      return;
    }

    const assetId = data.assetId ?? data.asset_id ?? data.assetID;
    const fallbackAsset: AssetRecord = {
      id: typeof assetId === 'string' || typeof assetId === 'number' ? assetId : node.id,
      type,
      url,
      width: typeof data.width === 'number' ? data.width : null,
      height: typeof data.height === 'number' ? data.height : null,
      duration: typeof data.duration === 'number' ? data.duration : null,
      size: typeof data.size === 'number' ? data.size : null,
      source: null,
      model: null,
      created_at: null,
    };

    setAssetDetailTarget(fallbackAsset);
    const requestId = ++assetDetailRequestIdRef.current;
    if (typeof assetId !== 'string' && typeof assetId !== 'number') {
      setAssetDetailLoading(false);
      return;
    }
    setAssetDetailLoading(true);

    void fetchAssetDetail(assetId)
      .then((asset) => {
        // 请求结束前用户可能关闭或切换到其他资产，避免用旧响应覆盖当前弹框。
        if (requestId !== assetDetailRequestIdRef.current) return;
        setAssetDetailTarget((current) =>
          current && String(current.id) === String(fallbackAsset.id) ? asset : current,
        );
        setAssetDetailLoading(false);
      })
      .catch(() => {
        if (requestId === assetDetailRequestIdRef.current) setAssetDetailLoading(false);
      });
  };

  const handleCloseAssetDetail = () => {
    assetDetailRequestIdRef.current += 1;
    setAssetDetailTarget(null);
    setAssetDetailLoading(false);
  };

  actionsRef.current.reEdit = handleNodeReEdit;
  actionsRef.current.genImage = handleNodeGenImage;
  actionsRef.current.genVideo = handleNodeGenVideo;
  actionsRef.current.genAudio = handleNodeGenAudio;
  actionsRef.current.extractAudio = handleNodeExtractAudio;
  actionsRef.current.download = handleNodeDownload;
  actionsRef.current.showDetails = handleNodeShowDetails;

  /** 应用事实来自已持久化的文本节点来源，删除与刷新后自然同步。 */
  const appliedCardIds = useMemo(() => new Set(textNodes.flatMap(node => {
    const source = node.data.promptSource as GenerationCardBlock['source'];
    return source ? [`${source.revisionId}#${source.shotNo}`] : [];
  })), [textNodes]);

  /** 等待在途保存完成并立即落盘当前画布编辑（IKDLQE 应用预览的保存串行化模式；IKDLQF 目标生图提交复用）。
   *  返回 false 表示等待期间项目已切换，调用方应中止后续动作。
   *  调用方须持有 applyingRef 闸口，阻断 800ms 防抖自动保存与本函数并发。 */
  const flushCanvasSave = async (projectId: string): Promise<boolean> => {
    await savePromiseRef.current;
    if (activeProjectRef.current !== projectId) return false;
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    const signature = JSON.stringify(viewport) + serializeNodes(nodes) + serializeEdges(edgesRef.current);
    if (signature === lastSavedRef.current) return true;
    const saved = await saveCanvasDoc(projectId, { viewport, nodes, edges: edgesRef.current }, versionRef.current);
    versionRef.current = saved.version;
    lastSavedRef.current = signature;
    pendingNodeIdsRef.current.clear();
    return true;
  };

  const handleAgentCardApply = async (payload: GenerationCardBlock) => {
    if (applyingRef.current || !currentId || !payload.source) return;
    const projectId = currentId;
    applyingRef.current = true;
    setApplying(true);
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      if (!(await flushCanvasSave(projectId))) return;
      const result = await applyMutation.mutateAsync({ projectId, source: payload.source, position: spawnPosition() });
      if (activeProjectRef.current !== projectId) return;
      const savedNodes = JSON.parse(result.canvas.nodes ?? '[]') as Node[];
      const savedEdges = JSON.parse(result.canvas.edges ?? '[]') as Edge[];
      const savedViewport = JSON.parse(result.canvas.viewport ?? 'null') as Viewport | null;
      acceptDoc({ id: result.canvas.id, version: result.canvas.version, nodes: savedNodes, edges: savedEdges, viewport: savedViewport ?? viewport });
      const target = result.node.position;
      setFocusViewport({ x: window.innerWidth / 3 - target.x, y: window.innerHeight / 2 - target.y - 135, zoom: 1 });
      setSaveStatus('saved');
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      setSaveStatus('error');
      showToast('error', error instanceof Error ? error.message : '应用失败，请重试');
    } finally { applyingRef.current = false; setApplying(false); }
  };

  /** 底部对话框发送 */
  /** 视频对话发送：参考素材上传取 assetId → 创建视频生成任务。
   *  草稿绑定模式（IKDMQS）：参考由连线按角色推导（首帧/尾帧 → first/last_frame_asset_id，
   *  普通参考 → reference_asset_ids），面板本地 refs 不再参与；与 Dock 显示逐项一致。
   *  非草稿绑定路径沿用旧语义：首尾帧模式按对话框校验后的 2 张图（第 1 张首帧、第 2 张尾帧），
   *  其余模式图片/视频混合走 reference_asset_ids。
   *  携带 targetNodeId 时（IKDLQG/IKDMQS）：先等待在途保存并落盘当前画布编辑
   *  （同 IKDLQE 应用预览的保存串行化），保证服务端按连线推导附件时读到最新正文，再携带 target_node_id 提交 */
  const handleDialogSend = async (text: string, opts: VideoGenOptions, refs: BottomRefItem[]) => {
    const targetNodeId = videoSeed?.targetNodeId;
    if (targetNodeId && currentId) {
      const projectId = currentId;
      applyingRef.current = true;
      try {
        if (!(await flushCanvasSave(projectId))) return; // 等待期间项目已切换，中止提交
      } catch (e) {
        // 落盘失败则不提交：否则服务端读到的正文可能缺未防抖落盘的编辑
        showToast('error', '保存失败，请重试');
        console.warn('生成前画布落盘失败:', e);
        return;
      } finally {
        applyingRef.current = false;
      }
    }
    const parameters: VideoJobParameters = {
      prompt: text,
      model_id: opts.modelId,
      aspect_ratio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: opts.duration,
    };
    // 草稿绑定模式（IKDMQS）：连线角色推导提交输入——画布来源都带 assetId（无素材库 material 路径）
    if (videoDraftId && videoSeed?.targetNodeId === videoDraftId) {
      const draftRefs = videoMediaRefsOf(videoDraftId, edgesRef.current, mediaNodesRef.current);
      // 组合校验与 Dock 同源（videoRefConflict）：能力位由面板按所选模型约束，此处提交防线
      // 传全能力位只校验互斥语义（帧↔参考混用、尾帧配首帧），能力位不支持由服务端 400 兜底
      const conflict = videoRefConflict(draftRefs, {
        firstFrame: true,
        lastFrame: true,
        firstLastFrame: true,
        referenceImage: true,
      });
      if (conflict) {
        showToast('warn', conflict);
        return;
      }
      const hasFrames = !!(draftRefs.first || draftRefs.last);
      if (hasFrames) {
        startGenerationJob('video', parameters, undefined, {
          firstFrameAssetId: draftRefs.first?.assetId,
          lastFrameAssetId: draftRefs.last?.assetId,
        }, targetNodeId);
        return;
      }
      const referenceAssetIds = draftRefs.reference.map((r) => r.assetId);
      startGenerationJob(
        'video',
        parameters,
        undefined,
        referenceAssetIds.length > 0 ? { referenceAssetIds } : undefined,
        targetNodeId,
      );
      return;
    }
    if (!refs.length) {
      startGenerationJob('video', parameters, undefined, undefined, targetNodeId);
      return;
    }
    // 解析引用：Asset- 前缀 = 素材库素材（走 *_material_id/reference_materials）；
    // 其余（本地 Asset id / 本地上传）走 asset 字段。两类不可混用于同一帧位（后端 400）。
    const resolved: Array<{ assetId: string | null; materialId: string | null; type: 'image' | 'video' }> = [];
    let failedCount = 0;
    for (const r of refs) {
      // 素材库 ID 实测为小写 asset- 前缀（如 asset-20260820153209-6c9z8），大小写不敏感判定；
      // 本地 Asset id 为纯数字（BigInt），不冲突。
      if (typeof r.assetId === 'string' && /^asset-/i.test(r.assetId)) {
        resolved.push({ assetId: null, materialId: r.assetId, type: r.type });
        continue;
      }
      const id = await resolveRefAssetId({ file: r.file, url: r.preview, name: `ref-${r.type}`, type: r.type, assetId: r.assetId });
      if (id == null) failedCount += 1;
      resolved.push({ assetId: id, materialId: null, type: r.type });
    }
    if (opts.mode === 'keyframe') {
      const [first, last] = resolved;
      if (!first || !last || (!first.assetId && !first.materialId) || (!last.assetId && !last.materialId)) {
        console.warn('首尾帧素材上传失败，任务未创建');
        showToast('error', '参考素材上传失败，任务未创建，请重试');
        return;
      }
      startGenerationJob('video', parameters, undefined, {
        firstFrameAssetId: first.assetId ?? undefined,
        lastFrameAssetId: last.assetId ?? undefined,
        firstFrameMaterialId: first.materialId ?? undefined,
        lastFrameMaterialId: last.materialId ?? undefined,
      }, targetNodeId);
      return;
    }
    const referenceAssetIds = resolved
      .filter((r): r is { assetId: string; materialId: null; type: 'image' | 'video' } => r.assetId !== null)
      .map((r) => r.assetId);
    const referenceMaterials = resolved
      .filter((r): r is { assetId: null; materialId: string; type: 'image' | 'video' } => r.materialId !== null)
      .map((r) => ({ id: r.materialId, type: r.type }));
    // 素材解析失败的项会被过滤丢弃：toast 告知，避免用户误以为全部参考已生效
    if (failedCount > 0) {
      showToast('warn', failedCount === refs.length ? '参考素材上传失败，请重试' : `${failedCount} 个参考素材上传失败，已跳过`);
    }
    startGenerationJob(
      'video',
      parameters,
      undefined,
      referenceAssetIds.length > 0 || referenceMaterials.length > 0
        ? {
            ...(referenceAssetIds.length > 0 ? { referenceAssetIds } : {}),
            ...(referenceMaterials.length > 0 ? { referenceMaterials } : {}),
          }
        : undefined,
      targetNodeId,
    );
  };

  /** 扩展工具菜单选择：资产库/商品等预留联调入口（音频按钮已改为直开对话框） */
  const handleToolMenuSelect = (menu: string, item: string) => {
    // 暂时隐藏音频菜单分支（音频改为直开对话框），注释保留后续恢复
    // if (menu === 'audio' && item === 'generate') {
    //   setAudioSeed(null);
    //   setShowAudioDialog((prev) => !prev);
    //   setShowBottomDialog(false);
    //   setShowImageDialog(false);
    //   setShowMusicDialog(false);
    //   return;
    // }
    // if (menu === 'audio' && item === 'music') {
    //   setShowMusicDialog((prev) => !prev);
    //   setShowBottomDialog(false);
    //   setShowImageDialog(false);
    //   setShowAudioDialog(false);
    //   return;
    // }
    if (menu === 'assets' && item === 'shared') {
      setAssetsModalDefaultTab(undefined);
      setAssetsModalDefaultFilter('all-assets');
      setShowAssetsModal(true);
      return;
    }
    if (menu === 'assets') {
      // 风格卡/角色卡/物体卡/环境卡/自定义卡 → 生成对应资产卡节点
      handleCreateAssetCard(item as AssetCardKind);
      return;
    }
    if (menu === 'goods' && item === 'create') {
      handleCreateProduct();
      return;
    }
    if (menu === 'goods' && item === 'import') {
      setAssetsModalDefaultTab('goods');
      setAssetsModalDefaultFilter(undefined);
      setShowAssetsModal(true);
      return;
    }
    console.log('Tool menu select:', menu, item);
  };

  /** 新建商品节点（工具栏 商品 → 新建商品） */
  const handleCreateProduct = () => {
    productSeq.current += 1;
    const node: Node = {
      id: newNodeId('product'),
      type: 'productNode',
      position: spawnPosition(),
      data: {
        name: `商品 ${productSeq.current}`,
        detail: '',
        images: [],
        toolMode,
        // 节点内上传素材携带当前项目（运行期注入，不持久化）
        projectId: currentId,
        onDelete: (id: string) => {
          setProductNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
        onProductChange: (id: string, patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string }) => handleProductChange(id, patch),
        onPickFromCanvas: (id: string) => {
          setPickMode('product');
          setPickTarget('product');
          setPickProductId(id);
        },
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(node.id);
    setProductNodes((prev) => [...prev, node]);
  };

  /** 新建资产卡节点（工具栏 资产库 → 风格卡/角色卡/物体卡/环境卡/自定义卡） */
  const handleCreateAssetCard = (kind: AssetCardKind) => {
    const node: Node = {
      id: newNodeId(`asset-${kind}`),
      type: 'assetNode',
      position: spawnPosition(),
      data: {
        kind,
        toolMode,
        // 节点内上传素材携带当前项目（运行期注入，不持久化）
        projectId: currentId,
        onDelete: (id: string) => {
          setAssetNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onGenerateImage: () => actionsRef.current.openImageDialog(),
        onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
        onCardChange: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => handleCardChange(id, patch),
        onPickFromCanvas: (id: string) => {
          setPickMode('asset');
          setPickTarget('asset');
          setPickAssetId(id);
        },
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(node.id);
    setAssetNodes((prev) => [...prev, node]);
  };

  /* ============ 保存到共享资产 ============ */

  /** 商品内容变更同步（组件内 images/detail 是 local state，需回写 node.data，否则右键保存读到空值） */
  const handleProductChange = (
    nodeId: string,
    patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string },
  ) => {
    setProductNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.images !== undefined ? { images: patch.images } : {}),
                ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
              },
            }
          : n,
      ),
    );
  };

  /** 资产卡内容变更同步（组件内 refs/desc/voice 是 local state，需回写 node.data，否则右键保存读到空值） */
  const handleCardChange = (
    nodeId: string,
    patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null },
  ) => {
    setAssetNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.refs !== undefined ? { initialRefs: patch.refs } : {}),
                ...(patch.desc !== undefined ? { initialDesc: patch.desc } : {}),
                ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
              },
            }
          : n,
      ),
    );
  };

  /** 通用保存请求 + toast 反馈 */
  const doSaveSharedAsset = async (req: SaveSharedAssetRequest, successMsg: string) => {
    console.log('[SaveAssets] doSaveSharedAsset 请求', req);
    try {
      const result = await saveSharedAsset(req);
      console.log('[SaveAssets] 保存结果', result);
      // created:false = 后端判定已存在（幂等/去重），未写入新快照——不能提示「已保存」误导用户
      if (result.created) {
        showToast('success', successMsg);
      } else {
        showToast('warn', '该内容已在共享资产中，未重复创建；如需更新请先删除旧条目');
      }
      return result;
    } catch (e) {
      console.warn('[SaveAssets] 保存失败', e);
      if (!isApiError(e)) showToast('error', '保存失败，请重试');
      return null;
    }
  };

  /** 媒体节点保存到共享资产（画布右键 → 保存到共享资产） */
  const handleSaveMediaToAssets = async (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) {
      console.warn('[SaveAssets] 未找到媒体节点', nodeId);
      showToast('error', '节点不存在');
      return;
    }
    const nd = node.data as Record<string, unknown>;
    const mediaType = (nd.mediaType || nd.type) as 'image' | 'video' | 'audio' | undefined;
    const assetId = nd.assetId ?? nd.asset_id ?? nd.assetID;
    const fileName = (nd.fileName || nd.name) as string | undefined;
    const src = nd.src as string | undefined;
    console.log('[SaveAssets] handleSaveMediaToAssets', { nodeId, assetId, mediaType, src });
    if (!mediaType) {
      console.warn('[SaveAssets] 无 mediaType，无法保存', { nodeId, data: nd });
      showToast('error', '节点类型异常，无法保存');
      return;
    }
    let sourceAssetId = assetId ? String(assetId) : '';
    if (!sourceAssetId && src) {
      // 共享资产加回画布的节点无 assetId：按 URL 反查资产库拿源素材 ID
      try {
        const records = await fetchAllAssets(mediaType);
        const hit = records.find((r) => r.url === src);
        if (hit) sourceAssetId = String(hit.id);
      } catch (err) {
        console.warn('[SaveAssets] 按 URL 反查资产失败', err);
      }
    }
    if (!sourceAssetId) {
      console.warn('[SaveAssets] 无 assetId，无法保存', { nodeId, data: nd });
      showToast('error', '请先上传素材后再保存');
      return;
    }
    const name = fileName || `媒体-${mediaType}`;
    await doSaveSharedAsset(
      {
        assetType: 'media',
        kind: mediaType,
        sourceAssetId,
        name,
      },
      `已保存「${name}」到共享资产`,
    );
  };

  /** 文本节点保存到共享资产 */
  const handleSaveTextToAssets = async (nodeId: string) => {
    const node = textNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const html = (node.data?.html as string) || '';
    if (!html) {
      showToast('error', '文本内容为空，无法保存');
      return;
    }
    await doSaveSharedAsset(
      { assetType: 'text', snapshot: { html } },
      '已保存文本到共享资产',
    );
  };

  /** 资产卡节点保存到共享资产 */
  const handleSaveCardToAssets = async (nodeId: string) => {
    const node = assetNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data as {
      kind: AssetCardKind;
      initialRefs?: Array<{ id: string; src: string }>;
      initialDesc?: string;
      voice?: { name: string; src: string };
    };
    // 仅保存可识别的卡片类型
    if (data.kind === 'generation' || !data.kind) {
      showToast('error', '生成卡暂不支持保存到共享资产');
      return;
    }
    const refs = data.initialRefs ?? [];
    const desc = data.initialDesc ?? '';
    if (refs.length === 0 && !desc) {
      showToast('error', '请先为卡片补充参考图或描述');
      return;
    }
    await doSaveSharedAsset(
      {
        assetType: 'card',
        kind: data.kind as 'style' | 'character' | 'object' | 'environment' | 'custom',
        snapshot: {
          referenceImages: refs,
          description: desc,
          ...(data.kind === 'character' && data.voice ? { voice: data.voice } : {}),
        },
      },
      `已保存「${({ style: '风格卡', character: '角色卡', object: '物体卡', environment: '环境卡', custom: '自定义卡' } as const)[data.kind]}」到共享资产`,
    );
  };

  /** 商品节点保存到共享资产 */
  const handleSaveGoodsToAssets = async (nodeId: string) => {
    const node = productNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data as { name?: string; detail?: string; images?: Array<{ id: string; src: string; enabled: boolean }> };
    const name = data.name || '商品';
    await doSaveSharedAsset(
      {
        assetType: 'goods',
        snapshot: {
          name,
          detail: data.detail || '',
          images: (data.images || []).map((img) => ({ id: img.id, src: img.src, enabled: img.enabled })),
        },
      },
      `已保存「${name}」到共享资产`,
    );
  };

  /** 共享资产添加回画布：按 assetType 构造对应节点 */
  const handleAddSharedAsset = async (item: SharedAssetView): Promise<boolean> => {
    if (!currentId) return false;
    try {
      switch (item.assetType) {
        case 'media': {
          // 媒体：用共享资产快照 URL 创建节点。
          // 注意：item.id 是 shared_assets 表 ID，不是 assets 源素材 ID，
          // 不能写入 assetId（否则再次保存时 sourceAssetId 无效 → 后端 100202）。
          // 快照不含源素材 ID，故此处不设 assetId，保存时走「请先上传素材」提示。
          const snapshot = item.snapshot as { url: string };
          const kind = item.kind as 'image' | 'video' | 'audio';
          const mediaType = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image';
          const node: Node = {
            id: newNodeId('media'),
            type: 'mediaNode',
            position: spawnPosition(),
            data: {
              src: snapshot.url,
              fileName: item.name || `资产-${Date.now()}`,
              mediaType,
              toolMode,
              onDelete: (id: string) => {
                setMediaNodes((prev) => prev.filter((n) => n.id !== id));
              },
              onDuplicate: (id: string) => actionsRef.current.duplicate(id),
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
              onReEdit: (id: string) => actionsRef.current.reEdit(id),
              onGenImage: (id: string) => actionsRef.current.genImage(id),
              onGenVideo: (id: string) => actionsRef.current.genVideo(id),
              onGenAudio: (id: string) => actionsRef.current.genAudio(id),
              onExtractAudio: (id: string) => actionsRef.current.extractAudio(id),
              onDownload: (id: string) => actionsRef.current.download(id),
              onShowDetails: (id: string) => actionsRef.current.showDetails(id),
              onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
              onMediaDims: handleMediaDims,
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setMediaNodes((prev) => [...prev, node]);
          return true;
        }
        case 'card': {
          // 卡片：构造资产卡节点
          const snapshot = item.snapshot as {
            referenceImages: Array<{ id: string; src: string }>;
            description?: string;
            voice?: { name: string; src: string };
          };
          const kind = item.kind as AssetCardKind;
          const node: Node = {
            id: newNodeId('asset'),
            type: 'assetNode',
            position: spawnPosition(),
            data: {
              kind,
              initialRefs: snapshot.referenceImages,
              initialDesc: snapshot.description,
              toolMode,
              // 节点内上传素材携带当前项目（运行期注入，不持久化）
              projectId: currentId,
              onDelete: (id: string) => {
                setAssetNodes((prev) => prev.filter((n) => n.id !== id));
              },
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
              onGenerateImage: () => actionsRef.current.openImageDialog(),
              onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
              onCardChange: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => handleCardChange(id, patch),
              onPickFromCanvas: (id: string) => {
                setPickMode('asset');
                setPickTarget('asset');
                setPickAssetId(id);
              },
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          if (snapshot.voice) {
            (node.data as Record<string, unknown>).voice = snapshot.voice;
          }
          pendingNodeIdsRef.current.add(node.id);
          setAssetNodes((prev) => [...prev, node]);
          return true;
        }
        case 'goods': {
          // 商品：构造商品节点
          const snapshot = item.snapshot as {
            name: string;
            detail?: string;
            images: Array<{ id: string; src: string; enabled?: boolean }>;
          };
          const node: Node = {
            id: newNodeId('product'),
            type: 'productNode',
            position: spawnPosition(),
            data: {
              name: snapshot.name,
              detail: snapshot.detail || '',
              images: snapshot.images.map((img) => ({ ...img, enabled: img.enabled ?? true })),
              toolMode,
              // 节点内上传素材携带当前项目（运行期注入，不持久化）
              projectId: currentId,
              onDelete: (id: string) => {
                setProductNodes((prev) => prev.filter((n) => n.id !== id));
              },
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
              onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
              onProductChange: (id: string, patch: { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string }) => handleProductChange(id, patch),
              onPickFromCanvas: (id: string) => {
                setPickMode('product');
                setPickTarget('product');
                setPickProductId(id);
              },
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setProductNodes((prev) => [...prev, node]);
          return true;
        }
        case 'text': {
          // 文本：构造文本节点
          const snapshot = item.snapshot as { html: string };
          const node: Node = {
            id: newNodeId('text'),
            type: 'textNode',
            position: spawnPosition(),
            data: {
              html: snapshot.html,
              toolMode,
              onDelete: (id: string) => {
                setTextNodes((prev) => prev.filter((n) => n.id !== id));
              },
              onChange: (id: string, html: string) => {
                setTextNodes((prev) =>
                  prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, html } } : n))
                );
              },
              onDuplicate: (id: string) => actionsRef.current.duplicate(id),
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
              onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setTextNodes((prev) => [...prev, node]);
          return true;
        }
        case 'scene': {
          // 场景卡：调用 add-to-project 接口获取 sceneCardId
          showToast('warn', '场景卡需通过场景卡面板添加');
          return false;
        }
        default:
          return false;
      }
    } catch (e) {
      console.warn('添加共享资产到画布失败:', e);
      return false;
    }
  };

  /** 画布媒体节点 → 音频对话框「从画布选择」数据源 */
  const canvasMedia: CanvasPickItem[] = useMemo(
    () =>
      mediaNodes
        .filter((n) => n.data?.src)
        .map((n) => ({
          id: n.id,
          src: n.data.src as string,
          name: (n.data.fileName as string) || n.id,
          mediaType: (n.data.mediaType as 'image' | 'video' | 'audio') ?? 'image',
        })),
    [mediaNodes],
  );

  /** 音频对话发送：创建音频生成任务（无参考素材）。
   *  草稿绑定模式（IKDMQT）：先等待在途保存并落盘当前画布编辑（同图片/视频草稿），
   *  再携带 target_node_id 提交；绑定以 audioDraftId 为准（seed 可能残留旧草稿值），
   *  工具条等非草稿入口沿用直接提交 */
  const handleAudioDialogSend = async (text: string, modelId: string, _refs: AudioRefItem[]) => {
    const targetNodeId =
      audioDraftId && audioSeed?.targetNodeId === audioDraftId ? audioDraftId : undefined;
    if (targetNodeId && currentId) {
      const projectId = currentId;
      applyingRef.current = true;
      try {
        if (!(await flushCanvasSave(projectId))) return; // 等待期间项目已切换，中止提交
      } catch (e) {
        // 落盘失败则不提交：任务目标节点尚未持久化，提交会因目标不存在被拒
        showToast('error', '保存失败，请重试');
        console.warn('生成前画布落盘失败:', e);
        return;
      } finally {
        applyingRef.current = false;
      }
    }
    startGenerationJob('audio', { prompt: text, model_id: modelId }, undefined, undefined, targetNodeId);
  };

  /** AI 音乐对话发送 */
  const handleMusicDialogSend = (
    text: string,
    model: string,
    opts: MusicGenOptions,
    refs: AudioRefItem[],
  ) => {
    console.log('Music dialog send:', text, model, opts, refs);
  };

  /** 上传单个文件到服务器，返回 assetId */
  const uploadFileToAsset = async (file: File, type: 'image' | 'video' | 'audio'): Promise<UploadCompleteData | null> => {
    try {
      const assetType: AssetType = type;
      const presign = await fetchUploadPresign({ type: assetType, mime: file.type, size: file.size });
      await putToPresignedUrl(presign, file);
      const complete = await completeUpload({
        type: assetType,
        mime: file.type,
        size: file.size,
        storage_key: presign.storage_key,
        project_id: currentId || undefined,
      });
      return complete;
    } catch (e) {
      console.warn('上传文件失败:', e);
      return null;
    }
  };

  /** 从 URL fetch 文件为 Blob → File（用于画布选取时没有原始 File 的场景） */
  const fetchUrlAsFile = async (url: string, name: string, _type: string): Promise<File | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const blob = await res.blob();
      // 使用 blob 自带的 MIME 类型，而非硬编码
      const mimeType = blob.type || _type || 'image/png';
      return new File([blob], name, { type: mimeType });
    } catch {
      return null;
    }
  };

  /** 参考素材 → assetId：优先复用已有 assetId，其次上传原始 File，否则从 URL 下载后上传 */
  const resolveRefAssetId = async (item: {
    file?: File;
    url: string;
    name: string;
    type: 'image' | 'video';
    assetId?: string | number;
  }): Promise<string | null> => {
    if (item.assetId) return String(item.assetId);
    let fileToUpload: File | null = item.file ?? null;
    if (!fileToUpload && /^https?:/.test(item.url)) {
      fileToUpload = await fetchUrlAsFile(
        item.url,
        item.name,
        item.type === 'video' ? 'video/mp4' : 'image/*',
      );
    }
    if (!fileToUpload) return null;
    const uploaded = await uploadFileToAsset(fileToUpload, item.type);
    return uploaded ? uploaded.asset_id : null;
  };

  /** 收集图片参考 assetId：绑定模式（IKDMQR 草稿 + IKDMQU 成品卡）按连线推导（与 Dock 显示同源）；
   *  其余入口（生成图片带入原图/资产卡等）沿用面板 files——有 assetId 直用，否则上传取 ID */
  const collectImageInputAssetIds = async (
    targetNodeId: string | undefined,
    files: UploadedFile[],
    useEdgeRefs = false,
  ): Promise<string[]> => {
    if (
      targetNodeId &&
      (useEdgeRefs || isImageDraftNode(mediaNodesRef.current.find((n) => n.id === targetNodeId)))
    ) {
      const ids: string[] = [];
      for (const ref of imageMediaRefsOf(targetNodeId, edgesRef.current, mediaNodesRef.current)) {
        if (!ids.includes(ref.assetId)) ids.push(ref.assetId);
      }
      return ids;
    }
    const ids: string[] = [];
    for (const f of files.filter((item) => item.type === 'image')) {
      // 已有 assetId 直接使用
      if (f.assetId) {
        ids.push(String(f.assetId));
        continue;
      }
      // 有原始 File 对象，直接上传；没有则从 URL 获取（如画布选取的节点）
      let fileToUpload: File | null = f.file ?? null;
      if (!fileToUpload && f.url.startsWith('http')) {
        fileToUpload = await fetchUrlAsFile(f.url, f.name, 'image/*');
      }
      if (fileToUpload) {
        const uploaded = await uploadFileToAsset(fileToUpload, 'image');
        if (uploaded) ids.push(uploaded.asset_id);
      }
    }
    return ids;
  };

  /** 图片对话发送：上传参考图 → 创建图片生成任务。
   *  从图片媒体节点面板发起时（IKDLQF）：先等待在途保存并落盘当前画布编辑
   *  （同 IKDLQE 应用预览的保存串行化），保证服务端按连线推导附件时读到最新正文，再携带 target_node_id 提交 */
  const handleImageDialogSend = async (
    text: string,
    modelId: string,
    size: string,
    ratio: string,
    files: UploadedFile[],
  ) => {
    const targetNodeId = imageSeed?.targetNodeId;
    // IKDMQU：成品卡绑定时参考同样按连线推导（绑定判定与音频发送同口径）
    const inputAssetIds = await collectImageInputAssetIds(
      targetNodeId,
      files,
      imageDraftId != null && targetNodeId === imageDraftId,
    );

    if (targetNodeId && currentId) {
      const projectId = currentId;
      applyingRef.current = true;
      try {
        if (!(await flushCanvasSave(projectId))) return; // 等待期间项目已切换，中止提交
      } catch (e) {
        // 落盘失败则不提交：否则服务端读到的正文可能缺未防抖落盘的编辑
        showToast('error', '保存失败，请重试');
        console.warn('生成前画布落盘失败:', e);
        return;
      } finally {
        applyingRef.current = false;
      }
    }

    if (targetNodeId && currentId) {
      const projectId = currentId;
      applyingRef.current = true;
      try {
        if (!(await flushCanvasSave(projectId))) return; // 等待期间项目已切换，中止提交
      } catch (e) {
        // 落盘失败则不提交：否则服务端读到的正文可能缺未防抖落盘的编辑
        showToast('error', '保存失败，请重试');
        console.warn('生成前画布落盘失败:', e);
        return;
      } finally {
        applyingRef.current = false;
      }
    }

    startGenerationJob('image', {
      prompt: text,
      model_id: modelId,
      aspect_ratio: ratio,
      size,
    }, inputAssetIds.length > 0 ? inputAssetIds : undefined, undefined, targetNodeId);
  };

  /** 触发首页生成交接：创建生成任务落节点（等于底部对话框按下发送），幂等——触发后即清 pending */
  const firePendingGen = () => {
    const handoff = pendingGenRef.current;
    if (!handoff) return;
    if (!currentId) return; // 项目未就绪：等 currentId 变化后由 effect 重试
    if (!doc) return; // 文档未加载：此刻 setMediaNodes 会被 doc 水合 effect 清空，等 doc 就绪再触发
    pendingGenRef.current = null;
    if (handoff.kind === 'video') {
      // 参考素材（图/视频）上传取 assetId：首尾帧模式走 first/lastFrameAssetId（首页已校验恰好 2 张图），
      // 其余模式走 reference_asset_ids
      (async () => {
        const parameters: VideoJobParameters = {
          prompt: handoff.text,
          model_id: handoff.modelId,
          aspect_ratio: handoff.aspectRatio,
          resolution: handoff.resolution,
          duration: handoff.duration,
        };
        if (!handoff.refs.length) {
          startGenerationJob('video', parameters);
          return;
        }
        if (handoff.mode === 'keyframe') {
          const [first, last] = handoff.refs;
          const firstAssetId = first ? await resolveRefAssetId({
            file: first.file, url: first.preview, name: 'ref-image', type: first.type, assetId: first.assetId,
          }) : null;
          const lastAssetId = last ? await resolveRefAssetId({
            file: last.file, url: last.preview, name: 'ref-image', type: last.type, assetId: last.assetId,
          }) : null;
          // 不再 seed 进底部对话框，objectURL 在此自行释放
          if (!firstAssetId || !lastAssetId) {
            console.warn('首尾帧素材上传失败，任务未创建');
            handoff.refs.forEach((r) => { if (r.file) URL.revokeObjectURL(r.preview); });
            return;
          }
          startGenerationJob('video', parameters, undefined, {
            firstFrameAssetId: firstAssetId,
            lastFrameAssetId: lastAssetId,
          });
          handoff.refs.forEach((r) => { if (r.file) URL.revokeObjectURL(r.preview); });
          return;
        }
        const referenceAssetIds: string[] = [];
        for (const r of handoff.refs) {
          const assetId = await resolveRefAssetId({
            file: r.file,
            url: r.preview,
            name: `ref-${r.type}`,
            type: r.type,
            assetId: r.assetId,
          });
          if (assetId) referenceAssetIds.push(assetId);
        }
        startGenerationJob(
          'video',
          parameters,
          undefined,
          referenceAssetIds.length > 0 ? { referenceAssetIds } : undefined,
        );
        // 不再 seed 进底部对话框，objectURL 在此自行释放
        handoff.refs.forEach((r) => { if (r.file) URL.revokeObjectURL(r.preview); });
      })();
    } else {
      // 图片：参考图先上传取 assetId（资产库选择项直接复用），再创建任务（同 handleImageDialogSend）
      (async () => {
        const inputAssetIds: string[] = [];
        for (const f of handoff.files) {
          if (f.assetId != null) {
            inputAssetIds.push(String(f.assetId));
            continue;
          }
          if (!f.file) continue;
          const uploaded = await uploadFileToAsset(f.file, 'image');
          if (uploaded) inputAssetIds.push(uploaded.asset_id);
        }
        startGenerationJob('image', {
          prompt: handoff.text,
          model_id: handoff.modelId,
          aspect_ratio: handoff.ratio,
          size: handoff.size,
        }, inputAssetIds.length > 0 ? inputAssetIds : undefined);
        // 不再 seed 进图片对话框，objectURL 在此自行释放
        handoff.files.forEach((f) => { if (f.file) URL.revokeObjectURL(f.url); });
      })();
    }
    // 触发后清导航状态（消费时不提前清，避免 location 变化重跑消费 effect 重复注入对话框）
    navigate(location.pathname + location.search, { replace: true, state: null });
  };
  actionsRef.current.firePendingGen = firePendingGen;

  /** 项目/文档就绪后触发首页生成交接（消费时已就绪则已被消费 effect 立即触发，此处幂等重试） */
  useEffect(() => {
    actionsRef.current.firePendingGen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, doc]);

  return (
    <div className={styles.canvasPage}>
      {/* 顶部工具栏 */}
      <CanvasHeader
        projects={projects}
        currentProjectId={currentId}
        onSelectProject={handleSelect}
        onRenameProject={handleRename}
        onDeleteProject={handleDelete}
        onNewProject={handleNewProject}
        onToggleAgent={() => setShowAgent(!showAgent)}
        onShowLegacyHistory={legacyHistory && legacyHistory.length > 0 ? () => setShowLegacyHistory(true) : undefined}
        hideAgentEntry={showAgent}
      />

      <AssetDetailModal
        asset={assetDetailTarget}
        loading={assetDetailLoading}
        onClose={handleCloseAssetDetail}
      />

      {/* 画布区域 */}
      <div className={styles.canvasWrapper}>
        {applying && <div role="status" style={{ position: 'fixed', inset: 0, zIndex: 10000, cursor: 'wait' }}>正在应用预览…</div>}
      <FlowCanvas
          showMiniMap={showMiniMap}
          toolMode={toolMode}
          extraNodes={uploadedNodes}
          textNodes={textNodes}
          mediaNodes={mediaNodes}
          productNodes={productNodes}
          assetNodes={assetNodes}
          showEdges={showEdges}
          edges={edges}
          onEdgesChange={guardEdgesChange}
          onConnect={handleConnect}
          viewport={focusViewport ?? doc?.viewport}
          onViewportChange={setViewport}
          registerSpawnPosition={registerSpawnPosition}
          hideZoomControl={showAgent}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleCanvasNodeClick}
          onPaneClick={handleCanvasPaneClick}
          onSelectionChange={handleSelectionChange}
          selectRequest={selectRequest}
          productPickResult={productPickResult}
          assetPickResult={assetPickResult}
          onDeleteNode={(id) => {
            setTextNodes((prev) => prev.filter((n) => n.id !== id));
            setMediaNodes((prev) => {
              const node = prev.find((n) => n.id === id);
              if (node?.data?.src) URL.revokeObjectURL(node.data.src as string);
              return prev.filter((n) => n.id !== id);
            });
            setProductNodes((prev) => prev.filter((n) => n.id !== id));
            setAssetNodes((prev) => prev.filter((n) => n.id !== id));
          }}
        />

        {/* 左侧工具栏 */}
        <CanvasToolbar
          mode={toolMode}
          onModeChange={setToolMode}
          onUploadFile={handleUploadFile}
          onOpenAssetsPicker={() => openAssetsPicker('toolbar')}
          onToggleVideoDialog={() => {
            // IKDMQS：侧栏视频入口不再开关空对话框，每次点击新建独立视频草稿卡并绑定面板
            setPickMode(null);
            setPickTarget(null);
            setPickRefRole(null);
            handleAddVideoDraft();
          }}
          onToggleImageDialog={() => {
            // IKDMQQ：侧栏图片入口不再开关空对话框，每次点击新建独立草稿卡并绑定面板
            setPickMode(null);
            setPickTarget(null);
            handleAddImageDraft();
          }}
          onToggleAudioDialog={() => {
            // IKDMQT：侧栏音频入口不再开关空对话框，每次点击新建独立音频草稿卡并绑定面板
            setPickMode(null);
            setPickTarget(null);
            handleAddAudioDraft();
          }}
          showVideoDialog={showBottomDialog}
          showImageDialog={showImageDialog}
          showAudioDialog={showAudioDialog}
          onAddTextNode={handleAddTextNode}
          onMenuSelect={handleToolMenuSelect}
        />

        {/* 左下角：返回首页 + 小地图切换 */}
        <div className={styles.bottomLeftActions}>
          <button
            className={styles.backHomeBtn}
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={14} strokeWidth={2} />
            <span>返回首页</span>
          </button>
          <button
            className={`${styles.mapBtn} ${showMiniMap ? styles.mapBtnActive : ''}`}
            onClick={() => setShowMiniMap(!showMiniMap)}
            title={showMiniMap ? '隐藏小地图' : '显示小地图'}
          >
            <MapIcon size={14} strokeWidth={2} />
          </button>
          <button
            className={`${styles.mapBtn} ${showEdges ? styles.mapBtnActive : ''}`}
            onClick={() => setShowEdges(!showEdges)}
            title={showEdges ? '隐藏连线' : '显示连线'}
            style={{ display: 'none' }}
          >
            {showEdges ? <Link size={14} strokeWidth={2} /> : <Link2Off size={14} strokeWidth={2} />}
          </button>
          {saveStatus !== 'idle' && (
            <span
              className={`${styles.saveStatus} ${saveStatus === 'error' ? styles.saveStatusError : ''}`}
            >
              {saveStatus === 'saving' && '保存中…'}
              {saveStatus === 'saved' && `已保存 ${savedAt}`}
              {saveStatus === 'error' && '保存失败，请重试'}
            </span>
          )}
        </div>

        {/* 底部视频对话框 */}
        {showBottomDialog && (
          <BottomDialog
            key={videoSeed?.ts ?? 0}
            initialRefs={videoSeed?.refs}
            initialText={videoSeed?.text}
            initialParams={videoSeed?.params}
            attachments={videoDraftId ? videoDraftAttachments : videoSeed?.attachments}
            onReorderAttachments={
              videoSeed?.targetNodeId
                ? (ids) => handleReorderAttachments(videoSeed.targetNodeId!, ids)
                : undefined
            }
            onClose={() => { setShowBottomDialog(false); setPickMode(null); setPickTarget(null); setPickRefRole(null); }}
            onSend={handleDialogSend}
            onPickFromCanvas={(kind, role) => { setPickMode(kind); setPickTarget('video'); setPickRefRole(role ?? null); }}
            onPickFromAssets={(kind) => openAssetsPicker(kind === 'image' ? 'bottomImage' : 'bottomVideo')}
            onOpenCharacterLibrary={() => { setCharacterLibraryTarget('video'); setShowCharacterLibrary(true); }}
            pickMode={pickTarget === 'video' && pickMode !== 'audio' && pickMode !== 'product' && pickMode !== 'asset' ? pickMode : null}
            externalPick={videoPickResult}
            externalImagePick={videoDlgImagePickResult}
            videoDraftBinding={
              videoDraftId
                ? {
                    status: (mediaNodes.find((n) => n.id === videoDraftId)?.data as Record<string, unknown> | undefined)
                      ?.genStatus as MediaGenStatus | undefined,
                    onParamsChange: (patch) => handleVideoDraftParamsChange(videoDraftId, patch),
                  }
                : undefined
            }
            videoMediaRefs={videoDraftId ? videoDraftMediaRefs : undefined}
            onRemoveVideoRef={
              videoDraftId ? (nodeId) => handleRemoveVideoRef(videoDraftId, nodeId) : undefined
            }
            onSetVideoRefRole={
              videoDraftId ? (nodeId, role) => handleSetVideoRefRole(videoDraftId, nodeId, role) : undefined
            }
            onToast={(type, msg) => showToast(type, msg)}
          />
        )}
        {/* 底部图片对话框 */}
        {showImageDialog && (
          <ImageDialog
            key={imageSeed?.ts ?? 0}
            initialText={imageSeed?.text}
            initialFiles={imageSeed?.files}
            initialParams={imageSeed?.params}
            attachments={imageDraftId ? imageDraftAttachments : imageSeed?.attachments}
            mediaRefs={imageDraftId ? imageDraftMediaRefs : undefined}
            onRemoveMediaRef={
              imageDraftId ? (nodeId) => handleRemoveImageMediaRef(imageDraftId, nodeId) : undefined
            }
            draftBinding={
              imageDraftId
                ? {
                    status: (mediaNodes.find((n) => n.id === imageDraftId)?.data as Record<string, unknown> | undefined)
                      ?.genStatus as MediaGenStatus | undefined,
                    onParamsChange: (patch) => handleImageDraftParamsChange(imageDraftId, patch),
                  }
                : undefined
            }
            onReorderAttachments={
              imageSeed?.targetNodeId
                ? (ids) => handleReorderAttachments(imageSeed.targetNodeId!, ids)
                : undefined
            }
            onClose={() => { setShowImageDialog(false); setImageDraftId(null); setPickMode(null); setPickTarget(null); }}
            onSend={handleImageDialogSend}
            onPickFromCanvas={() => { setPickMode('image'); setPickTarget('image'); }}
            onPickFromAssets={() => openAssetsPicker('imageDialog')}
            pickMode={pickMode === 'image'}
            externalPick={imagePickResult}
            onOpenCharacterLibrary={() => { setCharacterLibraryTarget('image'); setShowCharacterLibrary(true); }}
            onToast={(type, msg) => showToast(type, msg)}
          />
        )}

        {/* 节点选取模式提示条 */}
        {pickMode && pickTarget && (showImageDialog || showBottomDialog || showAudioDialog || pickMode === 'product' || pickMode === 'asset') && (
          <div className={styles.pickHint}>
            {pickMode === 'image' && '到节点选择：点击画布中的图片节点带入参考图，点击空白处取消'}
            {pickMode === 'video' && '到节点选择：点击画布中的视频节点带入参考视频，点击空白处取消'}
            {pickMode === 'product' && '到节点选择：点击画布中的图片节点带入商品图，点击空白处取消'}
            {pickMode === 'asset' && '到节点选择：点击画布中的图片节点带入参考图，点击空白处取消'}
          </div>
        )}

        {/* 底部音频对话框 */}
        {showAudioDialog && (
          <AudioDialog
            key={audioSeed?.ts ?? 0}
            initialText={audioSeed?.text}
            initialModelId={audioSeed?.modelId}
            draftBinding={
              audioDraftId
                ? {
                    status: (mediaNodes.find((n) => n.id === audioDraftId)?.data as Record<string, unknown> | undefined)
                      ?.genStatus as MediaGenStatus | undefined,
                    onParamsChange: (patch) => handleAudioDraftParamsChange(audioDraftId, patch),
                  }
                : undefined
            }
            onClose={() => { setShowAudioDialog(false); setAudioDraftId(null); setPickMode(null); setPickTarget(null); }}
            onSend={handleAudioDialogSend}
            onToast={(type, msg) => showToast(type, msg)}
            onSwitchToMusic={() => {
              // 切走即结束草稿绑定并重置 seed：切回音频面板是干净的非草稿状态
              setAudioSeed({ ts: Date.now() });
              setAudioDraftId(null);
              setShowAudioDialog(false);
              setShowMusicDialog(true);
            }}
          />
        )}

        {/* 底部 AI 音乐对话框 */}
        {showMusicDialog && (
          <MusicDialog
            onClose={() => setShowMusicDialog(false)}
            onSend={handleMusicDialogSend}
            canvasMedia={canvasMedia}
            onSwitchToAudio={() => {
              setShowMusicDialog(false);
              setShowAudioDialog(true);
            }}
          />
        )}
      </div>

      {/* Agent 对话框 */}
      {showAgent && (
        <AgentPanel
          onClose={() => setShowAgent(false)}
          initialInput={agentContext?.text ?? ''}
          initialCardLabel={agentContext?.label}
          inputVersion={agentContext?.ts ?? 0}
          projectId={currentId || undefined}
          onApplyPreview={handleAgentCardApply}
          appliedCardIds={appliedCardIds}
          initialSkillId={agentContext?.skillId ?? ''}
          initialSkillName={agentContext?.skillName ?? ''}
          mediaBlocks={agentContext?.mediaBlocks}
          onPlaceFileOnCanvas={placeFileOnCanvas}
          onPickFromAssets={() => openAssetsPicker('agentPanel')}
          externalAssetPicks={agentAssetPicks}
        />
      )}

      {/* 资产库选择弹框（按入口来源过滤类型：工具栏/Agent 面板/dock 对话框） */}
      {showAssetsPicker && (
        <AssetsPickerModal
          onClose={() => setShowAssetsPicker(false)}
          onSelect={handleAssetsPickerSelect}
          mediaTypes={
            assetsPickerTarget === 'bottomImage' || assetsPickerTarget === 'imageDialog'
              ? ['image']
              : assetsPickerTarget === 'bottomVideo'
                ? ['video']
                : assetsPickerTarget === 'agentPanel'
                  ? ['image', 'video']
                  : undefined
          }
          confirmText={assetsPickerTarget === 'toolbar' ? '插入画布' : '确定'}
        />
      )}

      {/* 共享资产弹框 */}
      {showAssetsModal && (
        <SharedAssetsModal
          onClose={() => setShowAssetsModal(false)}
          projectId={currentId}
          onAddItem={(item) => handleAddSharedAsset(item).then((ok) => {
            if (ok) setShowAssetsModal(false);
            return ok;
          })}
          onToast={showToast}
          defaultTab={assetsModalDefaultTab}
          defaultCardFilter={assetsModalDefaultFilter as any}
        />
      )}

      {/* 角色库弹框 */}
      {showCharacterLibrary && (
        <CharacterLibraryModal
          onClose={() => { setShowCharacterLibrary(false); setCharacterLibraryTarget(null); }}
          enableRealPersonTab={characterLibraryTarget === 'video'}
          onSelectAssets={(assets: MaterialAsset[]) => {
            // 虚拟/真人人像库统一多选确认后注入到对应对话框
            // 素材库 asset- 前缀 ID 在发送时走 referenceMaterials（后端转 asset:// URI 引用）
            const ts = Date.now();
            if (characterLibraryTarget === 'image') {
              // 图片对话框：批量注入参考图
              const images = assets
                .filter((a) => a.AssetType === 'Image')
                .map((a) => ({
                  id: `char-${ts}-${a.Id}`,
                  url: a.URL,
                  type: 'image' as const,
                  name: `角色-${a.Name}`,
                  assetId: a.Id,
                }));
              if (images.length > 0) setImagePickResult({ ts, files: images });
            } else if (characterLibraryTarget === 'video') {
              // 视频对话框：图片/视频分别注入参考素材
              const images = assets
                .filter((a) => a.AssetType === 'Image')
                .map((a) => ({ preview: a.URL, type: 'image' as const, assetId: a.Id }));
              const videos = assets
                .filter((a) => a.AssetType === 'Video')
                .map((a) => ({ preview: a.URL, type: 'video' as const, assetId: a.Id }));
              if (images.length > 0) setVideoDlgImagePickResult({ ts, items: images });
              if (videos.length > 0) setVideoPickResult({ ts, items: videos });
            } else if (characterLibraryTarget === 'asset') {
              // 资产卡添加参考图（单张注入）
              const image = assets.find((a) => a.AssetType === 'Image');
              if (image) {
                setAssetPickResult({
                  ts,
                  assetId: pickAssetId ?? '',
                  ref: {
                    id: `char-${ts}`,
                    src: image.URL,
                    type: 'image',
                    assetId: image.Id,
                  },
                });
              }
            }
          }}
        />
      )}

      {/* 旧生成卡迁移历史（IKDLQK，只读） */}
      <LegacyHistoryModal
        open={showLegacyHistory}
        items={legacyHistory ?? []}
        onClose={() => setShowLegacyHistory(false)}
      />

      {/* Toast 提示 */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 20px',
          borderRadius: '8px',
          background: toast.type === 'success' ? '#1a3a1a' : toast.type === 'error' ? '#3a1a1a' : '#3a3a1a',
          color: '#fff',
          fontSize: '14px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          border: `1px solid ${toast.type === 'success' ? '#2d7a2d' : toast.type === 'error' ? '#7a2d2d' : '#7a5a2d'}`,
          animation: 'toastIn 0.2s ease',
        }}>
          {toast.type === 'success' && <CheckCircle size={16} />}
          {toast.type === 'error' && <XCircle size={16} />}
          {toast.type === 'warn' && <AlertTriangle size={16} />}
          <span>{toast.msg}</span>
        </div>
      )}
      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}
