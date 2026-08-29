/* ============================================
 * CanvasPage 画布编辑页：节点/连线/工具栏编排
 * ============================================ */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Map as MapIcon, Link, Link2Off, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { newNodeId } from './nodeId';
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
import type { ChipRef } from './components/ChipTextEditor';
import ImageDialog, { type UploadedFile, type ImageGenSeedParams } from './components/ImageDialog';
import AudioDialog, { type CanvasPickItem, type AudioRefItem } from './components/AudioDialog';
import MusicDialog, { type MusicGenOptions } from './components/MusicDialog';
import SharedAssetsModal from './components/SharedAssetsModal';
import CharacterLibraryModal from './components/CharacterLibraryModal';
import type { MaterialAsset } from '@/api/material';
import type { AssetCardKind } from './components/AssetCardNode';
import type { CanvasProject } from './components/ProjectSelector';
import FlowCanvas from './components/Canvas';
import type { Node, Viewport } from '@xyflow/react';
import { useAuthStore } from '@/stores/auth';
import { fetchMe, fetchQuota, toSessionUser } from '@/api/auth';
import { fetchProjects, createProject, renameProject, deleteProject,  } from '@/api/projects';
import { UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, fetchAllAssets, fetchAssetDetail, type AssetRecord, type AssetType, type UploadCompleteData } from '@/api/assets';
import AssetDetailModal from '@/pages/Assets/components/AssetDetailModal';
import { rememberAssetUrl } from './components/AgentPanel/MessageAssetPreview';
import { saveCanvasDoc, serializeNodes } from '@/api/canvas';
import { isApiError } from '@/api/http';
import { blockIfQuotaInsufficient, openRechargeForQuotaError } from '@/utils/quotaGate';
import type { GenerationCardBlock, SessionContentBlock } from '@/api/agentSessions';
import {
  createGenerationJob,
  cancelGenerationJob,
  retryGenerationJob,
  fetchJobStatus,
  createMediaExtraction,
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
import { useCanvasDoc } from './hooks/useCanvasDoc';
import { collectMediaBlocks, type CanvasGalleryRef } from './collectMediaBlocks';
import {
  canvasLocationSearch,
  pickCanvasIdAfterLoad,
  readCanvasIdFromSearch,
} from './canvasQuery';
import styles from './index.module.css';

type ToolMode = 'drag' | 'select';

export default function CanvasPage() {
  const navigate = useNavigate();
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
  /** 商品卡选取目标节点ID（选中的图片注入哪个商品卡） */
  const [pickProductId, setPickProductId] = useState<string | null>(null);
  /** 资产卡选取目标节点ID（选中的图片注入哪个资产卡） */
  const [pickAssetId, setPickAssetId] = useState<string | null>(null);
  /** 画布节点选取结果（ts 驱动注入图片对话框） */
  const [imagePickResult, setImagePickResult] = useState<{ ts: number; file: UploadedFile } | null>(null);
  /** 画布节点选取结果（ts 驱动注入视频对话框参考） */
  const [videoPickResult, setVideoPickResult] = useState<{ ts: number; item: BottomRefItem } | null>(null);
  /** 画布节点选取结果（ts 驱动注入视频对话框参考图片） */
  const [videoDlgImagePickResult, setVideoDlgImagePickResult] = useState<{ ts: number; item: BottomRefItem } | null>(null);
  /** 画布节点选取结果（ts 驱动注入音频对话框参考） */
  const [audioPickResult, setAudioPickResult] = useState<{ ts: number; item: { id: string; src: string; name: string; assetId?: string | number } } | null>(null);
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
  const [showEdges, setShowEdges] = useState(false);
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
   *  params 是首页 AI图片 带入的生成参数（选中首页所选模型/清晰度/宽高比） */
  const [imageSeed, setImageSeed] = useState<{ ts: number; text: string; files: UploadedFile[]; params?: ImageGenSeedParams } | null>(null);
  /** 节点工具条带入视频对话框的初始参考；cards 是「引用到 dock」累计的生成卡胶囊，不因再次点击覆盖；
   *  params 是首页 AI视频 带入的生成参数（选中首页所选模型/比例/清晰度/时长/模式） */
  const [videoSeed, setVideoSeed] = useState<{ ts: number; refs: BottomRefItem[]; cards?: ChipRef[]; text?: string; params?: VideoGenSeedParams } | null>(null);
  /** 节点工具条打开音频对话框的重挂载 key */
  const [audioSeed, setAudioSeed] = useState<{ ts: number } | null>(null);
  /** 首页 AI视频/AI图片 生成交接：消费后置入此 ref，待项目就绪触发创建任务 */
  const pendingGenRef = useRef<GenHandoff | null>(null);
  /** 首页 AI视频/AI图片 发送带入：唤起对应底部对话框并填充内容，同时立即尝试触发生成（等于带入后直接发送） */
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
      setVideoSeed({
        ts: Date.now(),
        refs: handoff.refs,
        text: handoff.text,
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
        text: handoff.text,
        files: handoff.files,
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
  /** FlowCanvas 注册的出生点取数函数（视口中心 flow 坐标），注册前回退原点附近 */
  const spawnPosRef = useRef<() => { x: number; y: number }>(() => ({ x: 300, y: 200 }));
  const registerSpawnPosition = useCallback(
    (fn: () => { x: number; y: number }) => {
      spawnPosRef.current = fn;
    },
    [],
  );
  /** 新节点出生序号——用于围绕视口中心的黄金角螺旋散布 */
  const spawnSeqRef = useRef(0);

  /** 新节点出生位：以视口中心为原点按黄金角螺旋向外散布。
   *  黄金角（≈137.5°）保证相邻节点方向错开、不会累积往某个方向漂移，
   *  半径随序号缓慢增大，连续添加的节点围绕中心自然错落。 */
  const spawnPosition = () => {
    const center = spawnPosRef.current();
    const seq = spawnSeqRef.current;
    spawnSeqRef.current += 1;
    const GOLDEN_ANGLE = 2.399963; // 弧度 ≈ 137.508°
    const angle = seq * GOLDEN_ANGLE + Math.random() * 0.6;
    const radius = seq === 0 ? 0 : 90 + seq * 42 + Math.random() * 30;
    return {
      x: Math.round(center.x + Math.cos(angle) * radius),
      y: Math.round(center.y + Math.sin(angle) * radius),
    };
  };
  /** 画布保存状态：idle 未保存 / saving 保存中 / saved 已保存 / error 保存失败 */
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

  /** 加载当前项目快照（画布水合：节点 + 视口 + 版本号），失败静默降级为空画布 */
  const { doc, assets: snapshotAssets, refetch } = useCanvasDoc(currentId);

  /** 为服务端加载的节点注入交互回调（JSON 不含函数） */
  const attachCallbacks = (node: Node): Node => {
    const base: Node = { ...node, position: node.position ?? { x: 0, y: 0 }, data: { ...node.data, toolMode } };
    switch (node.type) {
      case 'textNode':
        base.data = {
          ...base.data,
          onDelete: (id: string) => setTextNodes((prev) => prev.filter((n) => n.id !== id)),
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
        };
        break;
      case 'productNode':
        base.data = {
          ...base.data,
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
          onOpenCharacterLibrary: (id: string) => {
            setPickAssetId(id);
            setCharacterLibraryTarget('asset');
            setShowCharacterLibrary(true);
          },
          // 生成卡节点水合后补动作回调（引用到 dock / 给 Agent）
          generationCard: base.data?.generationCard
            ? {
                ...base.data.generationCard as object,
                onApplyToDock: (apply: GenerationCardBlock) => {
                  // ts 沿用已有值（不重挂载 BottomDialog），否则清空对话框里用户已输入的自由文字
                  setVideoSeed((prev) => ({
                    ts: prev?.ts ?? Date.now(),
                    refs: prev?.refs ?? [],
                    cards: [
                      ...(prev?.cards ?? []),
                      { id: `${apply.cardId ?? apply.shotTitle ?? 'card'}-${Date.now()}`, label: apply.shotTitle ?? '生成卡', prompt: apply.prompt },
                    ],
                  }));
                  setShowBottomDialog(true);
                  setShowImageDialog(false);
                  setShowAudioDialog(false);
                  setShowMusicDialog(false);
                  void apply;
                },
                onSendToAgent: () => {
                  // 给 Agent：走与节点工具栏同一条 @ 链路（collectMediaBlocks → 胶囊）。
                  // 旧写法只塞 label 不采块，chip 上屏了、消息里却没有胶囊，agent 只收到
                  // 光杆文字（IKBBKP 的根因）。
                  actionsRef.current.addToChat(node.id);
                },
                onUpdate: (patch: Partial<Pick<GenerationCardBlock, 'shotTitle' | 'visual' | 'prompt'>>) => {
                  setAssetNodes((prev) =>
                    prev.map((n) =>
                      n.id === node.id
                        ? { ...n, data: { ...n.data, generationCard: { ...(n.data as { generationCard?: object }).generationCard, ...patch } } }
                        : n,
                    ),
                  );
                },
              }
            : base.data?.generationCard,
        };
        break;
      default:
        break;
    }
    return base;
  };

  /** 解析后端节点引用的资产（data/顶层的 asset_id、reference_asset_ids 或直接内嵌 url） */
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
      if (c == null) continue;
      const asset = snapshotAssets[String(c)];
      if (asset?.access_url) return { url: asset.access_url, type: asset.type, assetId: String(c) };
    }
    const direct = (data.src ?? data.url ?? raw.url ?? raw.src) as unknown;
    if (typeof direct === 'string' && direct) return { url: direct, type: '' };
    return null;
  };

  /** 解析 references 数组元素 → 参考图 URL（兼容 assetId 数字/字符串与内嵌 url 对象） */
  const resolveRefSrc = (r: unknown): string | null => {
    if (r == null) return null;
    if (typeof r === 'number' || typeof r === 'string') {
      return snapshotAssets[String(r)]?.access_url || null;
    }
    if (typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const aid = o.asset_id ?? o.assetId ?? o.id;
      if (aid != null) {
        const url = snapshotAssets[String(aid)]?.access_url;
        if (url) return url;
      }
      if (typeof o.access_url === 'string' && o.access_url) return o.access_url;
      if (typeof o.url === 'string' && o.url) return o.url;
    }
    return null;
  };

  /** 解析 references 数组元素 → 资产库身份（有则 @ 提及可走 asset_ref） */
  const readReferenceAssetId = (r: unknown): string | undefined => {
    if (typeof r === 'number' || typeof r === 'string') return String(r);
    if (r != null && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      const aid = o.asset_id ?? o.assetId;
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
      const initialRefs = refsRaw
        .map((r, i) => {
          const src = resolveRefSrc(r);
          if (!src) return null;
          const type = resolveRefType(r);
          const assetId = readReferenceAssetId(r);
          return { id: `ref-hydra-${node.id}-${i}`, src, type, ...(assetId ? { assetId } : {}) };
        })
        .filter((x): x is CanvasGalleryRef & { type: 'image' | 'video' } => x !== null);
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

    // 其余未知类型：按资产引用尽力还原为媒体节点
    const ref = resolveAssetRef(node);
    if (!ref) return null;
    const prompt = (data.prompt ?? raw.prompt) as unknown;
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

  /** 画布文档加载完成：按类型分发节点并注入回调；切换项目时先清空 */
  useEffect(() => {
    if (!doc) {
      setTextNodes([]);
      setMediaNodes([]);
      setProductNodes([]);
      setAssetNodes([]);
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
      else if (node.type === 'mediaNode') m.push(attachCallbacks(node));
      else if (node.type === 'productNode') p.push(attachCallbacks(node));
      else if (node.type === 'assetNode') a.push(attachCallbacks(node));
      else {
        // 后端节点类型（reference 参考卡 / text 等）：映射为本地节点后归类
        const mapped = mapBackendNode(node);
        if (mapped) {
          const attached = attachCallbacks(mapped);
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
    // 同步乐观锁版本/视口，并记录内容签名避免加载后立即重复保存
    versionRef.current = doc.version;
    setViewport(doc.viewport);
    lastSavedRef.current = JSON.stringify(doc.viewport) + serializeNodes([...t, ...m, ...p, ...a]);
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

  /** 画布变更后 800ms 防抖自动保存：PUT /api/canvases/:projectId（If-Match 乐观锁） */
  useEffect(() => {
    if (!currentId || !doc) return;
    const timer = window.setTimeout(() => {
      const nodes = [...textNodes, ...mediaNodes, ...productNodes, ...assetNodes];
      const sig = JSON.stringify(viewport) + serializeNodes(nodes);
      if (sig === lastSavedRef.current) return;
      if (import.meta.env.DEV) {
        console.info(`[canvas] 自动保存：${nodes.length} 个节点（version=${versionRef.current}）`);
      }
      lastSavedRef.current = sig;
      setSaveStatus('saving');
      // 快照本次请求覆盖的未保存新增节点；飞行中再新增的留给下一轮保存
      const pendingSnapshot = new Set(pendingNodeIdsRef.current);
      saveCanvasDoc(currentId, { viewport, nodes }, versionRef.current)
        .then((saved) => {
          versionRef.current = saved.version;
          pendingSnapshot.forEach((id) => pendingNodeIdsRef.current.delete(id));
          setSaveStatus('saved');
          setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
        })
        .catch((e) => {
          // 释放签名，允许下次变更时重试
          lastSavedRef.current = '';
          // 本次请求里有未保存的新增节点 → 添加失败：回滚节点（画布上不保留添加失败的节点）
          const hadPendingAdds = pendingSnapshot.size > 0;
          if (isApiError(e) && e.status === 412) {
            // 版本冲突：回滚未保存节点 + toast，然后重新加载最新画布数据
            if (hadPendingAdds) rollbackPendingNodes(pendingSnapshot);
            showToast('warn', hadPendingAdds ? '添加失败，请重试' : '版本冲突，正在同步最新数据');
            console.warn('画布保存版本冲突，重新加载最新数据');
            refetch();
          } else {
            // 网络/服务端错误：新增节点回滚，已有节点的编辑保留、左下角提示保存失败
            if (hadPendingAdds) rollbackPendingNodes(pendingSnapshot);
            setSaveStatus('error');
            showToast('error', hadPendingAdds ? '添加失败，请重试' : '保存失败，请重试');
            console.warn('画布自动保存失败:', e);
          }
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [textNodes, mediaNodes, productNodes, assetNodes, viewport, currentId, doc, refetch]);

  /** 创建文本节点 */
  const handleAddTextNode = () => {
    const newNode: Node = {
      id: newNodeId('text'),
      type: 'textNode',
      position: spawnPosition(),
      data: {
        html: '',
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
      const text = ((t.data?.html as string) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const label = text || '文本节点';
      setAgentContext({ text: label, label, ts });
      setShowAgent(true);
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
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
      const gc = a.data?.generationCard as { shotTitle?: string } | undefined;
      const kindTitle: Record<string, string> = {
        style: '风格卡',
        character: '角色卡',
        object: '物体卡',
        environment: '环境卡',
        custom: '自定义卡',
        generation: '生成卡',
      };
      const name = gc?.shotTitle || kindTitle[(a.data?.kind as string) ?? 'custom'] || '资产卡';
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

  /** 画布节点单击：选取模式下点击对应类型节点带入对话框，其他节点取消选取 */
  const handleCanvasNodeClick = (node: Node) => {
    if (!pickMode || !pickTarget) return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const isReadyMedia =
      node.type === 'mediaNode' &&
      typeof data.src === 'string' &&
      !data.genStatus;
    if (pickMode === 'image' && isReadyMedia && data.mediaType !== 'video') {
      if (pickTarget === 'video') {
        // 视频对话框发起的图片节点选取 → 注入其参考图片
        setVideoDlgImagePickResult({
          ts: Date.now(),
          item: {
            preview: data.src as string,
            type: 'image',
            assetId: data.assetId as string | number | undefined,
          },
        });
      } else {
        setImagePickResult({
          ts: Date.now(),
          file: {
            id: `node-${node.id}`,
            url: data.src as string,
            type: 'image',
            name: (data.fileName as string) || node.id,
            assetId: data.assetId as string | number | undefined,
          },
        });
      }
    } else if (pickMode === 'video' && isReadyMedia && data.mediaType === 'video') {
      setVideoPickResult({
        ts: Date.now(),
        item: {
          preview: data.src as string,
          type: 'video',
          assetId: data.assetId as string | number | undefined,
        },
      });
    } else if (pickMode === 'audio' && isReadyMedia && data.mediaType === 'audio') {
      setAudioPickResult({
        ts: Date.now(),
        item: {
          id: `node-${node.id}`,
          src: data.src as string,
          name: (data.fileName as string) || node.id,
          assetId: data.assetId as string | number | undefined,
        },
      });
    } else if (pickMode === 'product' && isReadyMedia && data.mediaType !== 'audio') {
      // 商品卡发起的图片/视频节点选取 → ts 驱动注入目标商品卡
      const targetId = pickProductId;
      if (targetId) {
        const mediaType: 'image' | 'video' = data.mediaType === 'video' ? 'video' : 'image';
        const newImage = {
          id: `node-${node.id}-${Date.now()}`,
          src: data.src as string,
          enabled: true,
          type: mediaType,
          ...(data.assetId ? { assetId: String(data.assetId) } : {}),
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
          ...(data.assetId ? { assetId: String(data.assetId) } : {}),
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
  };

  /** 节点拖拽结束：同步新坐标到父组件 state，触发自动保存 */
  const handleNodeDragStop = (node: Node) => {
    const { id, type, position } = node;
    if (type === 'textNode') {
      setTextNodes((prev) => prev.map((n) => (n.id === id ? { ...n, position } : n)));
    } else if (type === 'mediaNode') {
      setMediaNodes((prev) => prev.map((n) => (n.id === id ? { ...n, position } : n)));
    } else if (type === 'productNode') {
      setProductNodes((prev) => prev.map((n) => (n.id === id ? { ...n, position } : n)));
    } else if (type === 'assetNode') {
      setAssetNodes((prev) => prev.map((n) => (n.id === id ? { ...n, position } : n)));
    }
  };

  // 资产卡等非节点入口：清空旧 seed，保证打开的是空白对话框
  actionsRef.current.openImageDialog = () => {
    setImageSeed(null);
    handleOpenImageDialog();
  };

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

  /** 选择项目 */
  const handleSelect = (id: string) => {
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

  /** 删除项目：DELETE /api/projects/:id；删除当前项目后自动跳回首页 */
  const handleDelete = (id: string) => {
    deleteProject(id)
      .then(() => {
        if (currentId === id) {
          navigate('/');
          return;
        }
        setProjects((prev) => prev.filter((p) => p.id !== id));
      })
      .catch(() => undefined);
  };

  /** 新建项目名：当前年月日时分（如 2026-08-18 02:58） */
  const newProjectName = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /** 新建项目：POST /api/projects 并切换选中（撞名由后端自动追加 (2)(3)） */
  const handleNewProject = async () => {
    try {
      const created = await createProject(newProjectName());
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

  // 卸载时清理全部轮询
  useEffect(() => {
    const timers = jobTimersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, []);

  /** 更新媒体节点 data 局部字段 */
  const patchMediaNode = (nodeId: string, patch: Record<string, unknown>) => {
    setMediaNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  };

  /** 轮询函数引用（供水合恢复调用，避免声明顺序依赖） */
  const pollJobRef = useRef<(nodeId: string, jobId: number | string) => void>(() => {});

  /** 轮询任务状态直至终态：succeeded 挂载产物 / failed 展示错误 / cancelled 收敛 */
  const pollJob = (nodeId: string, jobId: number | string) => {
    const existing = jobTimersRef.current.get(nodeId);
    if (existing) window.clearTimeout(existing);
    const tick = () => {
      fetchJobStatus(jobId)
        .then((detail) => {
          if (!mediaNodesRef.current.some((n) => n.id === nodeId)) return; // 节点已删除
          if (locallyRemovedGenerationNodesRef.current.has(nodeId)) {
            jobTimersRef.current.delete(nodeId);
            return;
          }
          if (isMediaExtractNodeId(nodeId)) {
            const node = mediaNodesRef.current.find((n) => n.id === nodeId);
            const extractPatch = mediaExtractTerminalPatch(
              detail,
              typeof node?.data?.fileName === 'string' ? node.data.fileName : undefined,
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
            const node = mediaNodesRef.current.find((n) => n.id === nodeId);
            const originalType = node?.data?.mediaType;
            const assetType = detail.asset?.type;
            patchMediaNode(nodeId, {
              genStatus: undefined,
              progress: 100,
              src: detail.asset?.url ?? '',
              mediaType: (assetType === 'audio' || assetType === 'video' || assetType === 'image')
                ? assetType
                : (originalType ?? 'image'),
              fileName: `生成-${jobId}`,
              assetId: detail.asset?.id,
              width: detail.asset?.width ?? undefined,
              height: detail.asset?.height ?? undefined,
            });
            return;
          }
          if (detail.status === 'failed') {
            jobTimersRef.current.delete(nodeId);
            patchMediaNode(nodeId, {
              genStatus: 'failed',
              errorText: detail.error?.message ?? '',
            });
            return;
          }
          if (detail.status === 'cancelled') {
            jobTimersRef.current.delete(nodeId);
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
   *  素材库引用（Asset- 前缀）走 *_material_id / reference_materials；同一帧位 asset 与 material 互斥 */
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
  ) => {
    if (!currentId) {
      console.warn('未选中项目，无法创建生成任务');
      return;
    }
    if (blockIfQuotaInsufficient()) return;
    const nodeId = newNodeId('media-gen');
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
      },
    };
    setMediaNodes((prev) => [...prev, node]);
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
      })
        .then((created) => {
          patchMediaNode(nodeId, { jobId: created.generation_job_id });
          pollJob(nodeId, created.generation_job_id);
        })
        .catch((e) => {
          if (openRechargeForQuotaError(e)) {
            setMediaNodes((prev) => prev.filter((n) => n.id !== nodeId));
            return;
          }
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

  /** 重试失败任务：retry 接口创建新任务，节点回到生成中 */
  const handleRetryJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | string | undefined;
    if (!currentId || !jobId) return;
    if (blockIfQuotaInsufficient()) return;
    patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '' });
    try {
      retryGenerationJob(currentId, jobId)
        .then((created) => {
          patchMediaNode(nodeId, { jobId: created.generation_job_id });
          pollJob(nodeId, created.generation_job_id);
        })
        .catch((e) => {
          if (openRechargeForQuotaError(e)) {
            patchMediaNode(nodeId, {
              genStatus: 'failed',
              errorText: isApiError(e) ? e.message : '余额不足',
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

  /** 被点节点 → 对话框参考素材描述 */
  const nodeRefOf = (id: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === id);
    const src = node?.data?.src as string | undefined;
    if (!src) return null;
    const type: 'image' | 'video' = node?.data?.mediaType === 'video' ? 'video' : 'image';
    const name = (node?.data?.fileName as string) || id;
    const prompt = typeof node?.data?.prompt === 'string' ? (node.data.prompt as string) : '';
    const assetId = node?.data?.assetId as string | number | undefined;
    return { src, type, name, prompt, assetId };
  };

  /** 重新编辑：视频节点 → 视频对话框；图片节点 → 图片对话框 */
  const handleNodeReEdit = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;

    if (ref.type === 'video') {
      // 视频节点：打开视频对话框（底部窗口）
      setVideoSeed({
        ts: Date.now(),
        refs: [{ preview: ref.src, type: ref.type, assetId: ref.assetId }],
        text: ref.prompt,
      });
      setShowBottomDialog(true);
      setShowImageDialog(false);
      setShowAudioDialog(false);
      setShowMusicDialog(false);
    } else {
      // 图片节点：打开图片对话框（原有逻辑）
      setImageSeed({
        ts: Date.now(),
        text: ref.prompt,
        files: [{ id: `node-${id}`, url: ref.src, type: ref.type, name: ref.name, assetId: ref.assetId }],
      });
      handleOpenImageDialog();
    }
  };

  /** 生成图片：图片对话框 + 图片 */
  const handleNodeGenImage = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    setImageSeed({
      ts: Date.now(),
      text: '',
      files: [{ id: `node-${id}`, url: ref.src, type: ref.type, name: ref.name, assetId: ref.assetId }],
    });
    handleOpenImageDialog();
  };

  /** 生成视频：视频对话框 + 图片 */
  const handleNodeGenVideo = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    setVideoSeed({ ts: Date.now(), refs: [{ preview: ref.src, type: ref.type }] });
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
      showToast('error', isApiError(error) ? error.message : '音频提取任务创建失败');
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

  /** Agent 生成卡手动应用 → 落画布节点（B2：先落画布再选引用 dock/Agent） */
  /**
   * 画布上现存的生成卡节点对应的 cardId 集合（IKAFSQ）。
   *
   * 「这张卡应用过没有」不再是侧边栏自己维护的一份状态，而是从画布查出来的事实。侧边栏那份
   * 内存 `useState` 刷新即清空（绿勾全掉），而且画布上把节点删了它也不知道——两处必然对不上。
   * 改成派生之后，删节点自动退回「＋ 手动应用」、刷新自动恢复，都不需要额外的同步代码。
   *
   * cardId 随 payload 一起铺进了 `data.generationCard`，而 `serializeNodes` 会把节点存进画布
   * 文档，所以这个事实本来就是持久化的，只是过去没人读。
   */
  const appliedCardIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of assetNodes) {
      const card = (node.data as { generationCard?: { cardId?: unknown } } | undefined)?.generationCard;
      if (typeof card?.cardId === 'string' && card.cardId) ids.add(card.cardId);
    }
    return ids;
  }, [assetNodes]);

  const handleAgentCardApply = (payload: GenerationCardBlock) => {
    const node: Node = {
      id: newNodeId('gencard'),
      type: 'assetNode',
      position: spawnPosition(),
      data: {
        kind: 'generation',
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        generationCard: {
          ...payload,
          onApplyToDock: (apply: GenerationCardBlock) => {
            // 引用到 dock：累计追加胶囊（不覆盖已有引用），ts 沿用已有值以免重挂载清空用户已输入的自由文字
            setVideoSeed((prev) => ({
              ts: prev?.ts ?? Date.now(),
              refs: prev?.refs ?? [],
              cards: [
                ...(prev?.cards ?? []),
                { id: `${apply.cardId ?? apply.shotTitle ?? 'card'}-${Date.now()}`, label: apply.shotTitle ?? '生成卡', prompt: apply.prompt },
              ],
            }));
            setShowBottomDialog(true);
            setShowImageDialog(false);
            setShowAudioDialog(false);
            setShowMusicDialog(false);
            void apply;
          },
          onSendToAgent: () => {
            // 给 Agent：走与节点工具栏同一条 @ 链路（collectMediaBlocks → 胶囊）。
            // 旧写法只塞 label 不采块，chip 上屏了、消息里却没有胶囊，agent 只收到
            // 光杆文字（IKBBKP 的根因）。
            actionsRef.current.addToChat(node.id);
          },
          onUpdate: (patch: Record<string, unknown>) => {
            setAssetNodes((prev) =>
              prev.map((n) =>
                n.id === node.id
                  ? { ...n, data: { ...n.data, generationCard: { ...(n.data as { generationCard?: object }).generationCard, ...patch } } }
                  : n,
              ),
            );
          },
        },
        onDelete: (id: string) => {
          setAssetNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onGenerateImage: () => actionsRef.current.openImageDialog(),
      },
    };
    pendingNodeIdsRef.current.add(node.id);
    setAssetNodes((prev) => [...prev, node]);
  };

  /** 底部对话框发送 */
  /** 视频对话发送：参考素材上传取 assetId → 创建视频生成任务。
   *  首尾帧模式传 first/last_frame_asset_id（对话框已校验恰好 2 张图，第 1 张首帧、第 2 张尾帧）；
   *  其余模式图片/视频混合走 reference_asset_ids */
  const handleDialogSend = async (text: string, opts: VideoGenOptions, refs: BottomRefItem[]) => {
    const parameters: VideoJobParameters = {
      prompt: text,
      model_id: opts.modelId,
      aspect_ratio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: opts.duration,
    };
    if (!refs.length) {
      startGenerationJob('video', parameters);
      return;
    }
    // 解析引用：Asset- 前缀 = 素材库素材（走 *_material_id/reference_materials）；
    // 其余（本地 Asset id / 本地上传）走 asset 字段。两类不可混用于同一帧位（后端 400）。
    const resolved: Array<{ assetId: string | null; materialId: string | null; type: 'image' | 'video' }> = [];
    for (const r of refs) {
      // 素材库 ID 实测为小写 asset- 前缀（如 asset-20260820153209-6c9z8），大小写不敏感判定；
      // 本地 Asset id 为纯数字（BigInt），不冲突。
      if (typeof r.assetId === 'string' && /^asset-/i.test(r.assetId)) {
        resolved.push({ assetId: null, materialId: r.assetId, type: r.type });
        continue;
      }
      const id = await resolveRefAssetId({ file: r.file, url: r.preview, name: `ref-${r.type}`, type: r.type, assetId: r.assetId });
      resolved.push({ assetId: id, materialId: null, type: r.type });
    }
    if (opts.mode === 'keyframe') {
      const [first, last] = resolved;
      if (!first || !last || (!first.assetId && !first.materialId) || (!last.assetId && !last.materialId)) {
        console.warn('首尾帧素材上传失败，任务未创建');
        return;
      }
      startGenerationJob('video', parameters, undefined, {
        firstFrameAssetId: first.assetId ?? undefined,
        lastFrameAssetId: last.assetId ?? undefined,
        firstFrameMaterialId: first.materialId ?? undefined,
        lastFrameMaterialId: last.materialId ?? undefined,
      });
      return;
    }
    const referenceAssetIds = resolved
      .filter((r): r is { assetId: string; materialId: null; type: 'image' | 'video' } => r.assetId !== null)
      .map((r) => r.assetId);
    const referenceMaterials = resolved
      .filter((r): r is { assetId: null; materialId: string; type: 'image' | 'video' } => r.materialId !== null)
      .map((r) => ({ id: r.materialId, type: r.type }));
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
        onOpenCharacterLibrary: (id: string) => {
          setPickAssetId(id);
          setCharacterLibraryTarget('asset');
          setShowCharacterLibrary(true);
        },
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
      showToast('success', successMsg);
      return result;
    } catch (e) {
      console.warn('[SaveAssets] 保存失败', e);
      if (isApiError(e)) {
        // 100408: 卡片无参考图且无描述
        if (e.code === 100408) {
          showToast('error', '请先为卡片补充参考图或描述');
        } else {
          showToast('error', e.message || '保存失败');
        }
      } else {
        showToast('error', '保存失败，请重试');
      }
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
              onOpenCharacterLibrary: (id: string) => {
                setPickAssetId(id);
                setCharacterLibraryTarget('asset');
                setShowCharacterLibrary(true);
              },
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

  /** 音频对话发送：创建音频生成任务 */
  const handleAudioDialogSend = (text: string, modelId: string) => {
    startGenerationJob('audio', { prompt: text, model_id: modelId });
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
  const uploadFileToAsset = async (file: File, type: 'image' | 'video'): Promise<UploadCompleteData | null> => {
    try {
      const assetType: AssetType = type === 'image' ? 'image' : 'video';
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

  /** 图片对话发送：上传参考图 → 创建图片生成任务 */
  const handleImageDialogSend = async (
    text: string,
    modelId: string,
    size: string,
    ratio: string,
    files: UploadedFile[],
  ) => {
    // 收集参考图片的 assetId
    const inputAssetIds: string[] = [];
    const imageFiles = files.filter((f) => f.type === 'image');

    for (const f of imageFiles) {
      // 已有 assetId 直接使用
      if (f.assetId) {
        inputAssetIds.push(String(f.assetId));
        continue;
      }
      // 有原始 File 对象，直接上传
      let fileToUpload: File | null = f.file ?? null;
      // 没有原始 File，从 URL 获取（如画布选取的节点）
      if (!fileToUpload && f.url.startsWith('http')) {
        fileToUpload = await fetchUrlAsFile(f.url, f.name, 'image/*');
      }
      if (fileToUpload) {
        const uploaded = await uploadFileToAsset(fileToUpload, 'image');
        if (uploaded) inputAssetIds.push(uploaded.asset_id);
      }
    }

    startGenerationJob('image', {
      prompt: text,
      model_id: modelId,
      aspect_ratio: ratio,
      size,
    }, inputAssetIds.length > 0 ? inputAssetIds : undefined);
  };

  /** 触发首页生成交接：创建生成任务落节点（等于底部对话框按下发送），幂等——触发后即清 pending */
  const firePendingGen = () => {
    const handoff = pendingGenRef.current;
    if (!handoff) return;
    if (!currentId) return; // 项目未就绪：等 currentId 变化后由 effect 重试
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
            file: first.file, url: first.preview, name: 'ref-image', type: first.type,
          }) : null;
          const lastAssetId = last ? await resolveRefAssetId({
            file: last.file, url: last.preview, name: 'ref-image', type: last.type,
          }) : null;
          // preview 的释放由 seed 进的底部对话框在卸载时负责（提前 revoke 会让缩略图失效）
          if (!firstAssetId || !lastAssetId) {
            console.warn('首尾帧素材上传失败，任务未创建');
            return;
          }
          startGenerationJob('video', parameters, undefined, {
            firstFrameAssetId: firstAssetId,
            lastFrameAssetId: lastAssetId,
          });
          return;
        }
        const referenceAssetIds: string[] = [];
        for (const r of handoff.refs) {
          const assetId = await resolveRefAssetId({
            file: r.file,
            url: r.preview,
            name: `ref-${r.type}`,
            type: r.type,
          });
          if (assetId) referenceAssetIds.push(assetId);
        }
        // preview 的释放由 seed 进的底部对话框在卸载时负责（提前 revoke 会让缩略图失效）
        startGenerationJob(
          'video',
          parameters,
          undefined,
          referenceAssetIds.length > 0 ? { referenceAssetIds } : undefined,
        );
      })();
    } else {
      // 图片：参考图先上传取 assetId，再创建任务（同 handleImageDialogSend）
      (async () => {
        const inputAssetIds: string[] = [];
        for (const f of handoff.files) {
          const uploaded = await uploadFileToAsset(f.file, 'image');
          if (uploaded) inputAssetIds.push(uploaded.asset_id);
        }
        // url 的释放由 seed 进的图片对话框在卸载时负责（提前 revoke 会让缩略图失效）
        startGenerationJob('image', {
          prompt: handoff.text,
          model_id: handoff.modelId,
          aspect_ratio: handoff.ratio,
          size: handoff.size,
        }, inputAssetIds.length > 0 ? inputAssetIds : undefined);
      })();
    }
    // 触发后清导航状态（消费时不提前清，避免 location 变化重跑消费 effect 重复注入对话框）
    navigate(location.pathname + location.search, { replace: true, state: null });
  };
  actionsRef.current.firePendingGen = firePendingGen;

  /** 项目就绪后触发首页生成交接（消费时 currentId 已有值则已被消费 effect 立即触发，此处幂等重试） */
  useEffect(() => {
    actionsRef.current.firePendingGen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

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
      />

      <AssetDetailModal
        asset={assetDetailTarget}
        loading={assetDetailLoading}
        onClose={handleCloseAssetDetail}
      />

      {/* 画布区域 */}
      <div className={styles.canvasWrapper}>
        <FlowCanvas
          showMiniMap={showMiniMap}
          toolMode={toolMode}
          extraNodes={uploadedNodes}
          textNodes={textNodes}
          mediaNodes={mediaNodes}
          productNodes={productNodes}
          assetNodes={assetNodes}
          showEdges={showEdges}
          viewport={doc?.viewport}
          onViewportChange={setViewport}
          registerSpawnPosition={registerSpawnPosition}
          hideZoomControl={showAgent}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleCanvasNodeClick}
          onPaneClick={handleCanvasPaneClick}
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
          onToggleVideoDialog={() => {
            setVideoSeed(null);
            setPickMode(null);
            setPickTarget(null);
            setShowBottomDialog((prev) => !prev);
            setShowImageDialog(false);
            setShowAudioDialog(false);
            setShowMusicDialog(false);
          }}
          onToggleImageDialog={() => {
            setImageSeed(null);
            setPickMode(null);
            setPickTarget(null);
            setShowImageDialog((prev) => !prev);
            setShowBottomDialog(false);
            setShowAudioDialog(false);
            setShowMusicDialog(false);
          }}
          onToggleAudioDialog={() => {
            setAudioSeed(null);
            setPickMode(null);
            setPickTarget(null);
            setShowAudioDialog((prev) => !prev);
            setShowBottomDialog(false);
            setShowImageDialog(false);
            setShowMusicDialog(false);
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
            initialCards={videoSeed?.cards}
            initialText={videoSeed?.text}
            initialParams={videoSeed?.params}
            onClose={() => { setShowBottomDialog(false); setPickMode(null); setPickTarget(null); }}
            onSend={handleDialogSend}
            onPickFromCanvas={(kind) => { setPickMode(kind); setPickTarget('video'); }}
            pickMode={pickTarget === 'video' && pickMode !== 'audio' && pickMode !== 'product' && pickMode !== 'asset' ? pickMode : null}
            externalPick={videoPickResult}
            externalImagePick={videoDlgImagePickResult}
            onOpenCharacterLibrary={() => { setCharacterLibraryTarget('video'); setShowCharacterLibrary(true); }}
          />
        )}
        {/* 底部图片对话框 */}
        {showImageDialog && (
          <ImageDialog
            key={imageSeed?.ts ?? 0}
            initialText={imageSeed?.text}
            initialFiles={imageSeed?.files}
            initialParams={imageSeed?.params}
            onClose={() => { setShowImageDialog(false); setPickMode(null); setPickTarget(null); }}
            onSend={handleImageDialogSend}
            onPickFromCanvas={() => { setPickMode('image'); setPickTarget('image'); }}
            pickMode={pickMode === 'image'}
            externalPick={imagePickResult}
            onOpenCharacterLibrary={() => { setCharacterLibraryTarget('image'); setShowCharacterLibrary(true); }}
          />
        )}

        {/* 节点选取模式提示条 */}
        {pickMode && pickTarget && (showImageDialog || showBottomDialog || showAudioDialog || pickMode === 'product' || pickMode === 'asset') && (
          <div className={styles.pickHint}>
            {pickMode === 'image' && '到节点选择：点击画布中的图片节点带入参考图，点击空白处取消'}
            {pickMode === 'video' && '到节点选择：点击画布中的视频节点带入参考视频，点击空白处取消'}
            {pickMode === 'audio' && '到节点选择：点击画布中的音频节点带入参考音频，点击空白处取消'}
            {pickMode === 'product' && '到节点选择：点击画布中的图片节点带入商品图，点击空白处取消'}
            {pickMode === 'asset' && '到节点选择：点击画布中的图片节点带入参考图，点击空白处取消'}
          </div>
        )}

        {/* 底部音频对话框 */}
        {showAudioDialog && (
          <AudioDialog
            key={audioSeed?.ts ?? 0}
            onClose={() => { setShowAudioDialog(false); setPickMode(null); setPickTarget(null); }}
            onSend={handleAudioDialogSend}
            onSwitchToMusic={() => {
              setShowAudioDialog(false);
              setShowMusicDialog(true);
            }}
            onPickFromCanvas={() => { setPickMode('audio'); setPickTarget('audio'); }}
            pickMode={pickMode === 'audio'}
            externalPick={audioPickResult}
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
          onApplyToDock={handleAgentCardApply}
          appliedCardIds={appliedCardIds}
          initialSkillId={agentContext?.skillId ?? ''}
          initialSkillName={agentContext?.skillName ?? ''}
          mediaBlocks={agentContext?.mediaBlocks}
          onPlaceFileOnCanvas={placeFileOnCanvas}
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
          onSelect={(asset: MaterialAsset) => {
            // 选中后注入到对应对话框
            const ts = Date.now();
            if (characterLibraryTarget === 'image') {
              setImagePickResult({
                ts,
                file: {
                  id: `char-${ts}`,
                  url: asset.URL,
                  type: 'image',
                  name: `角色-${asset.Name}`,
                },
              });
            } else if (characterLibraryTarget === 'video') {
              // 视频对话框注入图片参考
              setVideoDlgImagePickResult({
                ts,
                item: {
                  preview: asset.URL,
                  type: 'image',
                  assetId: asset.Id,
                },
              });
            } else if (characterLibraryTarget === 'asset') {
              // 角色卡添加参考图
              setAssetPickResult({
                ts,
                assetId: pickAssetId ?? '',
                ref: {
                  id: `char-${ts}`,
                  src: asset.URL,
                  type: 'image',
                  assetId: asset.Id,
                },
              });
            }
          }}
        />
      )}

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
