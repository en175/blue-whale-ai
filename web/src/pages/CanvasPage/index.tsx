/* ============================================
 * CanvasPage 画布编辑页：节点/连线/工具栏编排
 * ============================================ */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, Map as MapIcon, Link, Link2Off } from 'lucide-react';
import CanvasHeader from './components/CanvasHeader';
import AgentPanel from './components/AgentPanel';
import CanvasToolbar from './components/CanvasToolbar';
import BottomDialog, { type VideoGenOptions, type BottomRefItem } from './components/BottomDialog';
import type { ChipRef } from './components/ChipTextEditor';
import ImageDialog, { type UploadedFile } from './components/ImageDialog';
import AudioDialog, { type CanvasPickItem, type AudioRefItem } from './components/AudioDialog';
import MusicDialog, { type MusicGenOptions } from './components/MusicDialog';
import SharedAssetsModal, { type SharedProduct } from './components/SharedAssetsModal';
import type { AssetCardKind } from './components/AssetCardNode';
import type { CanvasProject } from './components/ProjectSelector';
import FlowCanvas from './components/Canvas';
import type { Node, Viewport } from '@xyflow/react';
import { useAuthStore } from '@/stores/auth';
import { quotaToPoints, fetchMe, toSessionUser } from '@/api/auth';
import { fetchProjects, createProject, renameProject, deleteProject, copyAssetToProject } from '@/api/projects';
import { UPLOAD_SIZE_LIMIT } from '@/api/assets';
import { saveCanvasDoc, serializeNodes } from '@/api/canvas';
import { isApiError } from '@/api/http';
import type { GenerationCardBlock } from '@/api/agentSessions';
import {
  createGenerationJob,
  cancelGenerationJob,
  retryGenerationJob,
  fetchJobStatus,
  type ImageJobParameters,
  type VideoJobParameters,
  type AudioJobParameters,
} from '@/api/jobs';
import { uploadAssetFile } from '@/utils/upload';
import { useCanvasDoc } from './hooks/useCanvasDoc';
import styles from './index.module.css';

type ToolMode = 'drag' | 'select';

export default function CanvasPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  // 优先选中 ?project= 指定的项目（顶部展示该项目名）
  const [currentId, setCurrentId] = useState(searchParams.get('project') ?? '');
  const [showAgent, setShowAgent] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [showBottomDialog, setShowBottomDialog] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  /** 图片对话框「到节点选择」：画布图片节点选取模式 */
  const [imagePickMode, setImagePickMode] = useState(false);
  /** 画布节点选取结果（ts 驱动注入图片对话框） */
  const [imagePickResult, setImagePickResult] = useState<{ ts: number; file: UploadedFile } | null>(null);
  const [showAudioDialog, setShowAudioDialog] = useState(false);
  const [showMusicDialog, setShowMusicDialog] = useState(false);
  const [showEdges, setShowEdges] = useState(true);
  const [uploadedNodes] = useState<Node[]>([]);
  const [textNodes, setTextNodes] = useState<Node[]>([]);
  const [mediaNodes, setMediaNodes] = useState<Node[]>([]);
  const [productNodes, setProductNodes] = useState<Node[]>([]);
  const [assetNodes, setAssetNodes] = useState<Node[]>([]);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  /** label 有值时是生成卡引用（侧边栏渲染成胶囊）；无 label 是普通 @ 文本预填 */
  const [agentContext, setAgentContext] = useState<{ text: string; label?: string; ts: number } | null>(null);

  /** 首页发送框携带草稿跳转：打开 Agent 弹框并注入输入框，随后清除导航状态避免刷新重复注入 */
  useEffect(() => {
    const state = location.state as { agentText?: string } | null;
    if (!state?.agentText) return;
    setAgentContext({ text: state.agentText, ts: Date.now() });
    setShowAgent(true);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, navigate]);
  /** 节点工具条带入图片对话框的初始值（ts 作为 key 强制重挂载以注入初始值） */
  const [imageSeed, setImageSeed] = useState<{ ts: number; text: string; files: UploadedFile[] } | null>(null);
  /** 节点工具条带入视频对话框的初始参考；cards 是「引用到 dock」累计的生成卡胶囊，不因再次点击覆盖 */
  const [videoSeed, setVideoSeed] = useState<{ ts: number; refs: BottomRefItem[]; cards?: ChipRef[] } | null>(null);
  /** 节点工具条打开音频对话框的重挂载 key */
  const [audioSeed, setAudioSeed] = useState<{ ts: number } | null>(null);
  /** 当前视口（拖拽/缩放结束更新），自动保存时序列化提交 */
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1.1 });
  /** 画布保存状态：idle 未保存 / saving 保存中 / saved 已保存 / error 保存失败 */
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  /** 最近一次保存成功时间（HH:mm） */
  const [savedAt, setSavedAt] = useState('');
  /** 画布乐观锁版本号（来自快照；null 表示从未保存，If-Match 传 missing） */
  const versionRef = useRef<number | null>(null);
  /** 最近一次加载/保存成功的内容签名，避免重复保存 */
  const lastSavedRef = useRef('');
  const quota = useAuthStore((s) => s.quota);
  const updateUser = useAuthStore((s) => s.updateUser);
  /** 新建商品节点序号（商品 1、商品 2…） */
  const productSeq = useRef(0);

  // 画布页面加载时获取当前登录用户信息（鉴权判断 + 身份展示，失败静默降级）
  useEffect(() => {
    fetchMe()
      .then((me) => updateUser(toSessionUser(me)))
      .catch(() => undefined);
  }, [updateUser]);

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
        setCurrentId((prev) =>
          prev && mapped.some((m) => m.id === prev) ? prev : (mapped[0]?.id ?? '')
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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
          onDownload: (id: string) => actionsRef.current.download(id),
        };
        break;
      case 'productNode':
        base.data = {
          ...base.data,
          onDelete: (id: string) => {
            setProductNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        };
        break;
      case 'assetNode':
        base.data = {
          ...base.data,
          onDelete: (id: string) => {
            setAssetNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onGenerateImage: () => actionsRef.current.openImageDialog(),
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
                onSendToAgent: (prompt: string, shotTitle?: string) => {
                  setAgentContext({ text: prompt, label: shotTitle, ts: Date.now() });
                  setShowAgent(true);
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
  const resolveAssetRef = (node: Node): { url: string; type: string } | null => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const raw = node as unknown as Record<string, unknown>;
    const candidates: unknown[] = [
      data.asset_id,
      raw.asset_id,
      data.assetId,
      raw.assetId,
      Array.isArray(data.reference_asset_ids) ? data.reference_asset_ids[0] : undefined,
      Array.isArray(raw.reference_asset_ids) ? raw.reference_asset_ids[0] : undefined,
    ];
    for (const c of candidates) {
      if (c == null) continue;
      const asset = snapshotAssets[String(c)];
      if (asset?.access_url) return { url: asset.access_url, type: asset.type };
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
          return src ? { id: `ref-hydra-${node.id}-${i}`, src } : null;
        })
        .filter((x): x is { id: string; src: string } => x !== null);
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
    // 水合恢复：「生成中」媒体节点恢复任务轮询
    m
      .filter((n) => n.data.genStatus === 'generating' && typeof n.data.jobId === 'number')
      .forEach((n) => pollJobRef.current(n.id, n.data.jobId as number));
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
      saveCanvasDoc(currentId, { viewport, nodes }, versionRef.current)
        .then((saved) => {
          versionRef.current = saved.version;
          setSaveStatus('saved');
          setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
        })
        .catch((e) => {
          // 释放签名，允许下次变更时重试
          lastSavedRef.current = '';
          if (isApiError(e) && e.status === 412) {
            // 版本冲突：重新加载最新画布数据（加载后自动重试保存，保持 saving）
            console.warn('画布保存版本冲突，重新加载最新数据');
            refetch();
          } else {
            setSaveStatus('error');
            console.warn('画布自动保存失败:', e);
          }
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [textNodes, mediaNodes, productNodes, assetNodes, viewport, currentId, doc, refetch]);

  /** 创建文本节点 */
  const handleAddTextNode = () => {
    const newNode: Node = {
      id: `text-${Date.now()}`,
      type: 'textNode',
      position: { x: 250 + Math.random() * 200, y: 150 + Math.random() * 200 },
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
      },
    };
    setTextNodes((prev) => [...prev, newNode]);
  };

  /** 复制节点到旁边 */
  const handleDuplicateNode = (id: string) => {
    const t = textNodes.find((n) => n.id === id);
    if (t) {
      const copy: Node = { ...t, id: `text-${Date.now()}`, position: { x: t.position.x + 40, y: t.position.y + 40 }, data: { ...t.data } };
      setTextNodes((prev) => [...prev, copy]);
      return;
    }
    const m = mediaNodes.find((n) => n.id === id);
    if (m) {
      const copy: Node = { ...m, id: `media-${Date.now()}`, position: { x: m.position.x + 40, y: m.position.y + 40 }, data: { ...m.data } };
      setMediaNodes((prev) => [...prev, copy]);
    }
  };

  /** 添加节点内容到 Agent 聊天 */
  const handleAddToChatNode = (id: string) => {
    const p = productNodes.find((n) => n.id === id);
    if (p) {
      setAgentContext({ text: `@${(p.data?.name as string) || '商品'} `, ts: Date.now() });
      setShowAgent(true);
      return;
    }
    const t = textNodes.find((n) => n.id === id);
    if (t) {
      const text = ((t.data?.html as string) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      setAgentContext({ text: text || '文本节点', ts: Date.now() });
      setShowAgent(true);
      return;
    }
    const m = mediaNodes.find((n) => n.id === id);
    if (m) {
      const type = m.data?.mediaType === 'video' ? '视频' : '图片';
      setAgentContext({ text: `[${type}] ${m.data?.fileName || ''}`, ts: Date.now() });
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
    download: (_id: string) => {},
  });
  actionsRef.current = { ...actionsRef.current, duplicate: handleDuplicateNode, addToChat: handleAddToChatNode };

  /** 唤起底部图片对话框（工具栏图片图标 / 资产卡「生成图片」共用） */
  const handleOpenImageDialog = () => {
    setShowImageDialog(true);
    setShowBottomDialog(false);
    setShowAudioDialog(false);
    setShowMusicDialog(false);
  };

  /** 画布节点单击：选取模式下点击图片节点带入图片对话框，其他节点取消选取 */
  const handleCanvasNodeClick = (node: Node) => {
    if (!imagePickMode) return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const pickable =
      node.type === 'mediaNode' &&
      data.mediaType !== 'video' &&
      typeof data.src === 'string' &&
      !data.genStatus;
    if (pickable) {
      setImagePickResult({
        ts: Date.now(),
        file: {
          id: `node-${node.id}`,
          url: data.src as string,
          type: 'image',
          name: (data.fileName as string) || node.id,
        },
      });
    }
    setImagePickMode(false);
  };

  /** 画布空白处单击：取消节点选取模式 */
  const handleCanvasPaneClick = () => setImagePickMode(false);
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

  /** 上传文件生成媒体节点：本地预览立即上画布，后台三步上传登记，成功后换永久 URL */
  const handleUploadFile = (files: File[]) => {
    const newNodes: Node[] = [];
    files.forEach((file, i) => {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isImage && !isVideo) return;
      const limit = UPLOAD_SIZE_LIMIT[isImage ? 'image' : 'video'];
      if (file.size > limit) {
        console.warn(`[${file.name}] 超过 ${Math.round(limit / 1024 / 1024)}MB 上限，已跳过`);
        return;
      }
      const nodeId = `media-${Date.now()}-${i}`;
      const localSrc = URL.createObjectURL(file);

      newNodes.push({
        id: nodeId,
        type: 'mediaNode',
        position: { x: 200 + i * 280, y: 100 + Math.random() * 100 },
        data: {
          src: localSrc,
          fileName: file.name,
          mediaType: isVideo ? 'video' : 'image',
          toolMode,
          onDelete: (id: string) => {
            setMediaNodes((prev) => {
              const node = prev.find((n) => n.id === id);
              if (node?.data?.src) URL.revokeObjectURL(node.data.src as string);
              return prev.filter((n) => n.id !== id);
            });
          },
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        },
      });

      // 后台上传登记：成功换永久 URL，失败保留本地预览
      uploadAssetFile(file, { projectId: currentId || undefined })
        .then((done) => {
          setMediaNodes((prev) =>
            prev.map((n) => {
              if (n.id !== nodeId) return n;
              URL.revokeObjectURL(localSrc);
              return { ...n, data: { ...n.data, src: done.url || localSrc, assetId: done.asset_id } };
            }),
          );
        })
        .catch((err) => {
          console.warn(`画布上传登记失败（${file.name}），保留本地预览:`, err);
        });
    });

    if (newNodes.length > 0) setMediaNodes((prev) => [...prev, ...newNodes]);
  };

  /* ============ 生成任务编排：创建 → 占位节点 → 轮询 → 产物挂载 ============ */

  /** 媒体节点最新列表（轮询中判断节点是否仍存在） */
  const mediaNodesRef = useRef<Node[]>([]);
  mediaNodesRef.current = mediaNodes;
  /** 生成节点轮询定时器（节点 id → timer） */
  const jobTimersRef = useRef<Map<string, number>>(new Map<string, number>());

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
  const pollJobRef = useRef<(nodeId: string, jobId: number) => void>(() => {});

  /** 轮询任务状态直至终态：succeeded 挂载产物 / failed 展示错误 / cancelled 收敛 */
  const pollJob = (nodeId: string, jobId: number) => {
    const tick = () => {
      fetchJobStatus(jobId)
        .then((detail) => {
          if (!mediaNodesRef.current.some((n) => n.id === nodeId)) return; // 节点已删除
          if (detail.status === 'succeeded') {
            patchMediaNode(nodeId, {
              genStatus: undefined,
              progress: 100,
              src: detail.asset?.url ?? '',
              mediaType: detail.asset?.type ?? 'image',
              fileName: `生成-${jobId}`,
              assetId: detail.asset?.id,
            });
            return;
          }
          if (detail.status === 'failed') {
            patchMediaNode(nodeId, {
              genStatus: 'failed',
              errorText: detail.error?.message ?? '',
            });
            return;
          }
          if (detail.status === 'cancelled') {
            patchMediaNode(nodeId, { genStatus: 'cancelled' });
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

  /** 创建生成任务：立即上画布「生成中」占位节点，创建成功后启动轮询 */
  const startGenerationJob = (
    type: 'image' | 'video' | 'audio',
    parameters: ImageJobParameters | VideoJobParameters | AudioJobParameters,
  ) => {
    if (!currentId) {
      console.warn('未选中项目，无法创建生成任务');
      return;
    }
    const nodeId = `media-gen-${Date.now()}`;
    const node: Node = {
      id: nodeId,
      type: 'mediaNode',
      position: { x: 220 + Math.random() * 200, y: 120 + Math.random() * 160 },
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
      },
    };
    setMediaNodes((prev) => [...prev, node]);
    createGenerationJob(currentId, { type, expected_output_count: 1, parameters })
      .then((created) => {
        patchMediaNode(nodeId, { jobId: created.generation_job_id });
        pollJob(nodeId, created.generation_job_id);
      })
      .catch((e) => {
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          errorText: isApiError(e) ? e.message : '创建任务失败',
        });
      });
  };

  /** 取消生成：POST cancel（状态由轮询收敛为 cancelled） */
  const handleCancelJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | undefined;
    if (!currentId || !jobId) return;
    cancelGenerationJob(currentId, jobId).catch((e) => {
      console.warn('取消生成失败:', e);
    });
  };

  /** 重试失败任务：retry 接口创建新任务，节点回到生成中 */
  const handleRetryJob = (nodeId: string) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    const jobId = node?.data?.jobId as number | undefined;
    if (!currentId || !jobId) return;
    patchMediaNode(nodeId, { genStatus: 'generating', progress: 0, errorText: '' });
    retryGenerationJob(currentId, jobId)
      .then((created) => {
        patchMediaNode(nodeId, { jobId: created.generation_job_id });
        pollJob(nodeId, created.generation_job_id);
      })
      .catch((e) => {
        patchMediaNode(nodeId, {
          genStatus: 'failed',
          errorText: isApiError(e) ? e.message : '重试失败',
        });
      });
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
    return { src, type, name, prompt };
  };

  /** 重新编辑：图片对话框 + 原提示词 + 图片 */
  const handleNodeReEdit = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    setImageSeed({
      ts: Date.now(),
      text: ref.prompt,
      files: [{ id: `node-${id}`, url: ref.src, type: ref.type, name: ref.name }],
    });
    handleOpenImageDialog();
  };

  /** 生成图片：图片对话框 + 图片 */
  const handleNodeGenImage = (id: string) => {
    const ref = nodeRefOf(id);
    if (!ref) return;
    setImageSeed({
      ts: Date.now(),
      text: '',
      files: [{ id: `node-${id}`, url: ref.src, type: ref.type, name: ref.name }],
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

  actionsRef.current.reEdit = handleNodeReEdit;
  actionsRef.current.genImage = handleNodeGenImage;
  actionsRef.current.genVideo = handleNodeGenVideo;
  actionsRef.current.genAudio = handleNodeGenAudio;
  actionsRef.current.download = handleNodeDownload;

  /** Agent 生成卡手动应用 → 落画布节点（B2：先落画布再选引用 dock/Agent） */
  const handleAgentCardApply = (payload: GenerationCardBlock) => {
    const node: Node = {
      id: `gencard-${Date.now()}`,
      type: 'assetNode',
      position: { x: 320 + Math.random() * 120, y: 160 + Math.random() * 100 },
      data: {
        kind: 'generation',
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
          onSendToAgent: (prompt: string, shotTitle?: string) => {
            // 给 Agent：以引用胶囊形式注入侧边栏输入框
            setAgentContext({ text: prompt, label: shotTitle, ts: Date.now() });
            setShowAgent(true);
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
    setAssetNodes((prev) => [...prev, node]);
  };

  /** 底部对话框发送 */
  /** 视频对话发送：创建视频生成任务 */
  const handleDialogSend = (text: string, opts: VideoGenOptions) => {
    startGenerationJob('video', {
      prompt: text,
      model_id: opts.modelId,
      aspect_ratio: opts.aspectRatio,
      resolution: opts.resolution,
      duration: opts.duration,
    });
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
      setShowAssetsModal(true);
      return;
    }
    console.log('Tool menu select:', menu, item);
  };

  /** 新建商品节点（工具栏 商品 → 新建商品） */
  const handleCreateProduct = () => {
    productSeq.current += 1;
    const node: Node = {
      id: `product-${Date.now()}`,
      type: 'productNode',
      position: { x: 260 + Math.random() * 200, y: 120 + Math.random() * 160 },
      data: {
        name: `商品 ${productSeq.current}`,
        detail: '',
        images: [],
        toolMode,
        onDelete: (id: string) => {
          setProductNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
      },
    };
    setProductNodes((prev) => [...prev, node]);
  };

  /** 新建资产卡节点（工具栏 资产库 → 风格卡/角色卡/物体卡/环境卡/自定义卡） */
  const handleCreateAssetCard = (kind: AssetCardKind) => {
    const node: Node = {
      id: `asset-${kind}-${Date.now()}`,
      type: 'assetNode',
      position: { x: 260 + Math.random() * 200, y: 120 + Math.random() * 160 },
      data: {
        kind,
        toolMode,
        onDelete: (id: string) => {
          setAssetNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onGenerateImage: () => actionsRef.current.openImageDialog(),
      },
    };
    setAssetNodes((prev) => [...prev, node]);
  };

  /** 共享资产→真实资产添加到项目：复制到当前项目并生成媒体节点（返回是否成功） */
  const handleAddSharedAsset = async (assetId: number): Promise<boolean> => {
    if (!currentId) return false;
    try {
      const copied = await copyAssetToProject(currentId, assetId);
      const node: Node = {
        id: `media-${Date.now()}`,
        type: 'mediaNode',
        position: { x: 220 + Math.random() * 200, y: 120 + Math.random() * 160 },
        data: {
          src: copied.url,
          fileName: copied.url.split('/').filter(Boolean).pop() ?? `资产 ${copied.id}`,
          mediaType: copied.type === 'video' ? 'video' : 'image',
          assetId: copied.id,
          toolMode,
        },
      };
      setMediaNodes((prev) => [...prev, node]);
      return true;
    } catch (e) {
      console.warn('复制资产到项目失败:', e);
      return false;
    }
  };

  /** 共享资产→商品添加到画布：生成商品节点 */
  const handleAddProduct = (p: SharedProduct) => {
    const node: Node = {
      id: `product-${Date.now()}`,
      type: 'productNode',
      position: { x: 260 + Math.random() * 200, y: 120 + Math.random() * 160 },
      data: {
        name: p.title,
        detail: p.detail,
        images: [],
        toolMode,
        onDelete: (id: string) => {
          setProductNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
      },
    };
    setProductNodes((prev) => [...prev, node]);
    setShowAssetsModal(false);
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

  /** 图片对话发送：创建图片生成任务 */
  const handleImageDialogSend = (
    text: string,
    modelId: string,
    size: string,
    ratio: string,
  ) => {
    startGenerationJob('image', {
      prompt: text,
      model_id: modelId,
      aspect_ratio: ratio,
      size,
    });
  };

  return (
    <div className={styles.canvasPage}>
      {/* 顶部工具栏 */}
      <CanvasHeader
        projects={projects}
        currentProjectId={currentId}
        balance={quota === null ? '--' : quotaToPoints(quota)}
        onSelectProject={handleSelect}
        onRenameProject={handleRename}
        onDeleteProject={handleDelete}
        onNewProject={handleNewProject}
        onToggleAgent={() => setShowAgent(!showAgent)}
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
          onNodeClick={handleCanvasNodeClick}
          onPaneClick={handleCanvasPaneClick}
          onDeleteNode={(id) => {
            setTextNodes((prev) => prev.filter((n) => n.id !== id));
            setMediaNodes((prev) => {
              const node = prev.find((n) => n.id === id);
              if (node?.data?.src) URL.revokeObjectURL(node.data.src as string);
              return prev.filter((n) => n.id !== id);
            });
          }}
        />

        {/* 左侧工具栏 */}
        <CanvasToolbar
          mode={toolMode}
          onModeChange={setToolMode}
          onUploadFile={handleUploadFile}
          onToggleVideoDialog={() => {
            setVideoSeed(null);
            setShowBottomDialog((prev) => !prev);
            setShowImageDialog(false);
            setShowAudioDialog(false);
            setShowMusicDialog(false);
          }}
          onToggleImageDialog={() => {
            setImageSeed(null);
            setImagePickMode(false);
            setShowImageDialog((prev) => !prev);
            setShowBottomDialog(false);
            setShowAudioDialog(false);
            setShowMusicDialog(false);
          }}
          onToggleAudioDialog={() => {
            setAudioSeed(null);
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
          >
            {showEdges ? <Link size={14} strokeWidth={2} /> : <Link2Off size={14} strokeWidth={2} />}
          </button>
          {saveStatus !== 'idle' && (
            <span
              className={`${styles.saveStatus} ${saveStatus === 'error' ? styles.saveStatusError : ''}`}
            >
              {saveStatus === 'saving' && '保存中…'}
              {saveStatus === 'saved' && `已保存 ${savedAt}`}
              {saveStatus === 'error' && '保存失败'}
            </span>
          )}
        </div>

        {/* 底部视频对话框 */}
        {showBottomDialog && (
          <BottomDialog
            key={videoSeed?.ts ?? 0}
            initialRefs={videoSeed?.refs}
            initialCards={videoSeed?.cards}
            onClose={() => setShowBottomDialog(false)}
            onSend={handleDialogSend}
          />
        )}
        {/* 底部图片对话框 */}
        {showImageDialog && (
          <ImageDialog
            key={imageSeed?.ts ?? 0}
            initialText={imageSeed?.text}
            initialFiles={imageSeed?.files}
            onClose={() => { setShowImageDialog(false); setImagePickMode(false); }}
            onSend={handleImageDialogSend}
            onPickFromCanvas={() => setImagePickMode(true)}
            pickMode={imagePickMode}
            externalPick={imagePickResult}
          />
        )}

        {/* 节点选取模式提示条 */}
        {imagePickMode && showImageDialog && (
          <div className={styles.pickHint}>
            到节点选择：点击画布中的图片节点带入参考图，点击空白处取消
          </div>
        )}

        {/* 底部音频对话框 */}
        {showAudioDialog && (
          <AudioDialog
            key={audioSeed?.ts ?? 0}
            onClose={() => setShowAudioDialog(false)}
            onSend={handleAudioDialogSend}
            onSwitchToMusic={() => {
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
          onApplyToDock={handleAgentCardApply}
        />
      )}

      {/* 共享资产弹框 */}
      {showAssetsModal && (
        <SharedAssetsModal
          onClose={() => setShowAssetsModal(false)}
          onAddProduct={handleAddProduct}
          onAddAsset={handleAddSharedAsset}
        />
      )}
    </div>
  );
}
