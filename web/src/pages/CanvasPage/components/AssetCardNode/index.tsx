/* ============================================
 * AssetCardNode 资产卡节点：风格/角色/物体/环境/自定义
 * 从画布拖入/添加图片参考、生成图片唤起底部图片对话框、角色卡音色设置
 * ============================================ */
import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AtSign, Upload, WandSparkles, Info, Music, X, User, MousePointerClick } from 'lucide-react';
import type { GenerationCardBlock } from '@/api/agentSessions';
import { uploadAssetFile } from '@/utils/upload';
import type { UploadCompleteData } from '@/api/assets';
import type { CanvasGalleryRef } from '../../collectMediaBlocks';
import styles from './index.module.css';

/** 资产卡类型（generation 为 Agent 生成卡落画布形态） */
export type AssetCardKind = 'style' | 'character' | 'object' | 'environment' | 'custom' | 'generation';

/** 各类型标题与描述占位文案（对应设计稿） */
const KIND_META: Record<AssetCardKind, { title: string; placeholder: string }> = {
  style: { title: '风格卡', placeholder: '描述视觉风格、配色与艺术方向...' },
  character: { title: '角色卡', placeholder: '描述外观、性格、角色弧光、语音风格...' },
  object: { title: '物体卡', placeholder: '描述形状、材质与颜色...' },
  environment: { title: '环境卡', placeholder: '描述布局、氛围、光照与情绪...' },
  custom: { title: '自定义卡', placeholder: '添加此资产的备注或细节...' },
  generation: { title: '生成卡', placeholder: '分镜提示词生成卡' },
};

/** 临时隐藏：资产卡（风格/角色/物体/环境/自定义）顶部 @ 操作条，会后恢复（改回 false） */
const HIDE_ASSET_TOP_BAR = false;

/** React Flow 约定：节点内滚动容器加此类，滚轮只滚内容、不触发画布缩放 */
const NOWHEEL = 'nowheel';

/** Agent 生成卡数据（kind=generation 时承载，落画布后从节点选引用）
 * 字段复用会话层的 GenerationCardBlock（唯一形状定义），此处只加节点专属的回调；
 * 各字段仍是 Partial——节点可能由旧数据/后端水合出不完整的卡 */
export interface GenerationCardNodeData extends Partial<GenerationCardBlock> {
  /** 引用到 Canvas dock：完整卡片数据一起带走，不再手挑字段（曾丢过 visual/timeRange） */
  onApplyToDock?: (payload: GenerationCardBlock) => void;
  /** 给 Agent 继续修改（shotTitle 用于侧边栏输入框的引用胶囊标签） */
  onSendToAgent?: (prompt: string, shotTitle?: string) => void;
  /** 双击编辑：提交标题/画面/提示词的修改 */
  onUpdate?: (patch: Partial<Pick<GenerationCardBlock, 'shotTitle' | 'visual' | 'prompt'>>) => void;
}

interface AssetCardNodeData {
  kind?: AssetCardKind;
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  /** 水合初始参考图（后端 reference 节点的 references 解析而来） */
  initialRefs?: CanvasGalleryRef[];
  /** 水合初始描述文本 */
  initialDesc?: string;
  /** 水合初始音色（角色卡，共享资产加回画布时注入） */
  voice?: { name: string; src: string; type?: 'audio' };
  onDelete?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  /** 保存到共享资产 */
  onSaveToAssets?: (id: string) => void;
  /** 卡片内容变更同步回父组件（参考图/描述/音色），保证右键保存时能读到最新值 */
  onCardChange?: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => void;
  /** 生成图片：唤起底部图片对话框 */
  onGenerateImage?: () => void;
  /** 触发画布节点选取模式（父级实现） */
  onPickFromCanvas?: (id: string) => void;
  /** 打开角色库弹窗 */
  onOpenCharacterLibrary?: (id: string) => void;
  /** Agent 生成卡数据（kind=generation） */
  generationCard?: GenerationCardNodeData;
}

/** 资产卡图片/音频限制常量 */
const MAX_IMAGE_REFS = 9;
const MAX_VOICE_FILES = 3;
const MAX_VOICE_DURATION = 15; // 秒

export default function AssetCardNode({ id, data, selected }: NodeProps & { data: AssetCardNodeData; selected?: boolean }) {
  // 水合容错：持久化的 kind 可能不在五种枚举内（旧数据/脏数据），降级为 custom 避免 KIND_META 落空
  const kind: AssetCardKind = data.kind && data.kind in KIND_META ? data.kind : 'custom';
  const meta = KIND_META[kind];
  const [refs, setRefs] = useState<CanvasGalleryRef[]>(data.initialRefs ?? []);
  const [desc, setDesc] = useState(data.initialDesc ?? '');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [voiceRefs, setVoiceRefs] = useState<{ id: string; src: string; name: string; duration: number }[]>(
    data.voice ? [{ id: `voice-hydrated-${id}`, src: data.voice.src, name: data.voice.name, duration: 0 }] : [],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  /** 待上传映射：refId → { file, cancelled }，用于异步上传完成后替换 src，删除时取消 */
  const pendingUploadsRef = useRef<Map<string, { file: File; cancelled: boolean }>>(new Map());
  /** 生成卡双击编辑：当前编辑中的字段 + 草稿值 */
  const [editingField, setEditingField] = useState<'shotTitle' | 'visual' | 'prompt' | null>(null);
  const [draftValue, setDraftValue] = useState('');

  const isSelect = data.toolMode === 'select';
  const isGeneration = (data.kind ?? 'custom') === 'generation';

  // 卡片内容变更同步回父组件 node.data（右键保存到共享资产时读取最新值）
  // 注意：voiceRefs 为空时不发送 voice 字段，避免覆盖后端水合的音色数据
  useEffect(() => {
    data.onCardChange?.(id, {
      refs,
      desc,
      ...(voiceRefs.length > 0 ? { voice: { name: voiceRefs[0].name, src: voiceRefs[0].src } } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, desc, voiceRefs, id]);

  /** ts 驱动注入：响应画布「到节点选择」结果，将选中的图片带入 */
  useEffect(() => {
    const pickResult = (data as { assetPickResult?: { ts: number; assetId: string; ref: CanvasGalleryRef } }).assetPickResult;
    if (!pickResult || pickResult.assetId !== id) return;
    setRefs((prev) => {
      if (prev.length >= MAX_IMAGE_REFS) return prev;
      if (prev.some((r) => r.id === pickResult.ref.id)) return prev;
      return [...prev, pickResult.ref];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(data as { assetPickResult?: { ts: number } }).assetPickResult?.ts]);

  // 点击其他区域关闭右键菜单（捕获阶段监听，确保右键其他节点时先关闭本菜单）
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close, true);
    };
  }, [contextMenu]);

  // 点击其他区域关闭添加菜单
  useEffect(() => {
    if (!addMenu) return;
    const close = () => setAddMenu(false);
    document.addEventListener('click', close);
    return () => {
      document.removeEventListener('click', close);
    };
  }, [addMenu]);

  // 卸载时取消所有待上传任务、释放 blob URL
  useEffect(() => {
    return () => {
      pendingUploadsRef.current.forEach((p) => { p.cancelled = true; });
      pendingUploadsRef.current.clear();
      refs.forEach((r) => {
        if (r.src.startsWith('blob:')) URL.revokeObjectURL(r.src);
      });
      voiceRefs.forEach((v) => {
        if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 右键菜单（与 MediaNode 一致，无右上角 ×） */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (data.toolMode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [data.toolMode]);

  const handleDelete = useCallback(() => {
    setContextMenu(null);
    data.onDelete?.(id);
  }, [data, id]);

  /** 添加到 Agent 聊天 */
  const handleAddToChat = useCallback(() => {
    setContextMenu(null);
    data.onAddToChat?.(id);
  }, [data, id]);

  /** 保存到共享资产 */
  const handleSaveToAssets = useCallback(() => {
    setContextMenu(null);
    data.onSaveToAssets?.(id);
  }, [data, id]);

  /** 添加参考图/视频（点击选择或拖入，支持 image/* 和 video/*，最多 MAX_IMAGE_REFS 张）
   * 先创建本地 blob 预览立即上画布，再异步调用 uploadAssetFile() 三步上传，
   * 成功后替换为永久 URL（与左侧工具栏加号上传逻辑一致） */
  const addFiles = (files: FileList | File[]) => {
    const imgs: { id: string; src: string; file: File; type: 'image' | 'video' }[] = [];
    Array.from(files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
      .forEach((f, i) => {
        const refId = `ref-${Date.now()}-${i}`;
        const mediaType: 'image' | 'video' = f.type.startsWith('video/') ? 'video' : 'image';
        imgs.push({ id: refId, src: URL.createObjectURL(f), file: f, type: mediaType });
      });
    if (imgs.length === 0) return;

    // 先创建本地预览引用（不含 file 字段）
    const newRefs = imgs.map(({ id, src, type }) => ({ id, src, type }));
    setRefs((prev) => {
      const remaining = MAX_IMAGE_REFS - prev.length;
      if (remaining <= 0) return prev;
      const toAdd = newRefs.slice(0, remaining);
      // 为被截断的文件释放 blob URL（用户看不到）
      imgs.slice(remaining).forEach(({ src }) => URL.revokeObjectURL(src));
      return [...prev, ...toAdd];
    });

    // 立即上画布后，异步上传每个文件并替换永久 URL
    imgs.slice(0, MAX_IMAGE_REFS).forEach(({ id: refId, file }) => {
      // 记录待上传状态，便于删除时取消
      pendingUploadsRef.current.set(refId, { file, cancelled: false });

      uploadAssetFile(file)
        .then((done: UploadCompleteData) => {
          const entry = pendingUploadsRef.current.get(refId);
          if (!entry || entry.cancelled) return;
          pendingUploadsRef.current.delete(refId);

          setRefs((prev) =>
            prev.map((r) => {
              if (r.id !== refId) return r;
              // 释放本地 blob，替换为永久 URL
              if (r.src.startsWith('blob:')) URL.revokeObjectURL(r.src);
              const mediaType: 'image' | 'video' = done.type === 'video' ? 'video' : 'image';
              return { ...r, src: done.url || r.src, type: mediaType, assetId: done.asset_id };
            }),
          );
        })
        .catch((err) => {
          const entry = pendingUploadsRef.current.get(refId);
          if (!entry || entry.cancelled) return;
          pendingUploadsRef.current.delete(refId);
          console.warn(`[资产卡] 参考图上传失败（${file.name}），保留本地预览:`, err);
        });
    });
  };

  /** 删除单张参考图（同时取消未完成的上传、释放 blob URL） */
  const removeRef = (refId: string) => {
    // 标记取消：若正在上传，完成时会跳过更新
    const pending = pendingUploadsRef.current.get(refId);
    if (pending) {
      pending.cancelled = true;
      pendingUploadsRef.current.delete(refId);
    }
    setRefs((prev) => {
      const target = prev.find((r) => r.id === refId);
      if (target?.src.startsWith('blob:')) URL.revokeObjectURL(target.src);
      return prev.filter((r) => r.id !== refId);
    });
  };

  /** 添加音色音频（最多 MAX_VOICE_FILES 段，每段不超过 MAX_VOICE_DURATION 秒） */
  const addVoiceFiles = async (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/'));
    if (audioFiles.length === 0) return;
    const remaining = MAX_VOICE_FILES - voiceRefs.length;
    if (remaining <= 0) return;
    const toProcess = audioFiles.slice(0, remaining);

    const results: { id: string; src: string; name: string; duration: number }[] = [];
    for (const f of toProcess) {
      const src = URL.createObjectURL(f);
      const duration = await new Promise<number>((resolve) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
          resolve(audio.duration);
          audio.src = '';
        };
        audio.onerror = () => {
          resolve(0);
          audio.src = '';
        };
        audio.src = src;
      });
      if (duration <= MAX_VOICE_DURATION) {
        results.push({ id: `voice-${Date.now()}-${results.length}`, src, name: f.name, duration });
      } else {
        URL.revokeObjectURL(src);
      }
    }
    if (results.length > 0) setVoiceRefs((prev) => [...prev, ...results]);
  };

  /** 删除单段音色 */
  const removeVoiceRef = (voiceId: string) => {
    setVoiceRefs((prev) => {
      const target = prev.find((r) => r.id === voiceId);
      if (target?.src.startsWith('blob:')) URL.revokeObjectURL(target.src);
      return prev.filter((r) => r.id !== voiceId);
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  /** 编辑框自适应高度：撑满实际内容，不用固定行数截断/滚动（保持与双击前的展示一致） */
  const autoResizeTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  /** 双击生成卡字段进入编辑态 */
  const startEditField = (field: 'shotTitle' | 'visual' | 'prompt', current?: string) => {
    setEditingField(field);
    setDraftValue(current ?? '');
  };

  /** 提交编辑：回调 CanvasPage 落地节点数据（画布自动保存生效） */
  const commitEditField = () => {
    if (!editingField) return;
    data.generationCard?.onUpdate?.({ [editingField]: draftValue });
    setEditingField(null);
  };

  const cancelEditField = () => setEditingField(null);

  return (
    <div className={styles.wrapper} onContextMenu={handleContextMenu}>
      {!data.isFirst && (
        <Handle type="target" position={Position.Left} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />
      )}

      {/* 悬停/选中时顶部操作条：添加到对话（与商品节点一致）
          资产卡临时隐藏（HIDE_ASSET_TOP_BAR，会后恢复），生成卡不受影响 */}
      {(isGeneration || !HIDE_ASSET_TOP_BAR) && (
        <div className={`${styles.topBar} ${selected ? styles.topBarVisible : ''}`}>
          <span className={styles.topLabel}>
            <AtSign size={14} strokeWidth={2} />
            <span>{meta.title}</span>
          </span>
          <button className={`${styles.addToChatBtn} nodrag`} onClick={handleAddToChat}>
            <AtSign size={14} strokeWidth={2} />
            <span>添加到对话</span>
          </button>
        </div>
      )}

      <div
        className={styles.card}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* 标题 */}
        <div className={styles.head}>
          <span className={styles.atIcon}>
            <AtSign size={14} strokeWidth={2} />
          </span>
          <span className={styles.name}>{meta.title}</span>
        </div>

        {/* 交互区：整体可拖（与图片节点一致），文本控件单独 nodrag */}
        <div
          style={isSelect || isGeneration ? undefined : { pointerEvents: 'none' }}
        >
          {isGeneration && data.generationCard ? (
            /* Agent 生成卡落画布形态：展示卡内容 + 引用到 dock / 给 Agent。
               nowheel：卡内滚轮不交给 React Flow 做画布缩放（IKBAAH） */
            <div className={`${styles.body} ${NOWHEEL}`} onWheel={(e) => e.stopPropagation()}>
              <div className={styles.gcHeader}>
                {editingField === 'shotTitle' ? (
                  <input
                    className={`${styles.gcEditInput} nodrag`}
                    value={draftValue}
                    autoFocus
                    onChange={(e) => setDraftValue(e.target.value)}
                    onBlur={commitEditField}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEditField();
                      else if (e.key === 'Escape') cancelEditField();
                    }}
                  />
                ) : (
                  <span
                    className={styles.gcTitle}
                    title="双击编辑"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEditField('shotTitle', data.generationCard?.shotTitle);
                    }}
                  >
                    {data.generationCard.shotTitle ?? '生成卡'}
                  </span>
                )}
                {data.generationCard.timeRange && (
                  <span className={styles.gcTime}>{data.generationCard.timeRange}</span>
                )}
              </div>
              {editingField === 'visual' ? (
                <div className={styles.gcField}>
                  <span className={styles.gcLabel}>画面</span>
                  <textarea
                    ref={autoResizeTextarea}
                    className={`${styles.gcEditTextarea} nodrag ${NOWHEEL}`}
                    value={draftValue}
                    autoFocus
                    rows={1}
                    onChange={(e) => {
                      setDraftValue(e.target.value);
                      autoResizeTextarea(e.target);
                    }}
                    onBlur={commitEditField}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        commitEditField();
                      } else if (e.key === 'Escape') cancelEditField();
                    }}
                  />
                </div>
              ) : (
                data.generationCard.visual && (
                  <div className={styles.gcField}>
                    <span className={styles.gcLabel}>画面</span>
                    <span
                      className={`${styles.gcValue} ${NOWHEEL}`}
                      title="双击编辑"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditField('visual', data.generationCard?.visual);
                      }}
                    >
                      {data.generationCard.visual}
                    </span>
                  </div>
                )
              )}
              {editingField === 'prompt' ? (
                <div className={styles.gcField}>
                  <span className={styles.gcLabel}>提示词</span>
                  <textarea
                    ref={autoResizeTextarea}
                    className={`${styles.gcEditTextarea} nodrag ${NOWHEEL}`}
                    value={draftValue}
                    autoFocus
                    rows={1}
                    onChange={(e) => {
                      setDraftValue(e.target.value);
                      autoResizeTextarea(e.target);
                    }}
                    onBlur={commitEditField}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        commitEditField();
                      } else if (e.key === 'Escape') cancelEditField();
                    }}
                  />
                </div>
              ) : (
                data.generationCard.prompt && (
                  <div className={styles.gcField}>
                    <span className={styles.gcLabel}>提示词</span>
                    <span
                      className={`${styles.gcValue} ${NOWHEEL}`}
                      title="双击编辑"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditField('prompt', data.generationCard?.prompt);
                      }}
                    >
                      {data.generationCard.prompt}
                    </span>
                  </div>
                )
              )}
              {data.generationCard.assetRefs && data.generationCard.assetRefs.length > 0 && (
                <div className={styles.gcRefs}>
                  {data.generationCard.assetRefs.map((r) => (
                    <span key={r} className={styles.gcRef}>{r}</span>
                  ))}
                </div>
              )}
              <div className={styles.btnRow}>
                <button
                  className={styles.actionBtn}
                  onClick={() =>
                    data.generationCard?.onApplyToDock?.({
                      cardId: data.generationCard?.cardId,
                      shotTitle: data.generationCard?.shotTitle ?? '生成卡',
                      timeRange: data.generationCard?.timeRange,
                      visual: data.generationCard?.visual ?? '',
                      prompt: data.generationCard?.prompt ?? '',
                      assetRefs: data.generationCard?.assetRefs ?? [],
                    })
                  }
                >
                  <WandSparkles size={15} strokeWidth={2} />
                  <span>引用到 dock</span>
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() =>
                    data.generationCard?.onSendToAgent?.(
                      data.generationCard?.prompt ?? '',
                      data.generationCard?.shotTitle,
                    )
                  }
                >
                  <AtSign size={15} strokeWidth={2} />
                  <span>给 Agent</span>
                </button>
              </div>
            </div>
          ) : (
          <div className={styles.body}>
            <textarea
              className={`${styles.descInput} nodrag`}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={meta.placeholder}
              rows={1}
            />
            {refs.length > 0 && (
              <div className={styles.refGrid}>
                {refs.map((ref) => (
                  <div key={ref.id} className={styles.refThumb}>
                    {ref.type === 'video' ? (
                      <video src={ref.src} className={styles.refThumbImg} muted playsInline />
                    ) : (
                      <img src={ref.src} alt="参考图" className={styles.refThumbImg} />
                    )}
                    <button
                      className={styles.refRemove}
                      onClick={() => removeRef(ref.id)}
                      title="移除"
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={styles.btnRow}>
              {refs.length < MAX_IMAGE_REFS && (
                <div style={{ position: 'relative' }}>
                  <button
                    className={styles.actionBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddMenu(!addMenu);
                    }}
                  >
                    <Upload size={15} strokeWidth={2} />
                    <span>添加图片</span>
                  </button>
                  {addMenu && (
                    <div
                      className={styles.addMenu}
                      style={{
                        position: 'absolute',
                        bottom: 'calc(100% + 6px)',
                        left: 0,
                        backgroundColor: '#2a2a2a',
                        border: '1px solid var(--color-border-primary)',
                        borderRadius: '10px',
                        padding: '6px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        zIndex: 100,
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                        minWidth: '120px',
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          fileRef.current?.click();
                          setAddMenu(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 10px',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '6px',
                          color: 'var(--color-text-primary)',
                          fontSize: 'var(--font-size-sm)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <Upload size={16} strokeWidth={2} />
                        <span>图片上传</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          data.onPickFromCanvas?.(id);
                          setAddMenu(false);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 10px',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '6px',
                          color: 'var(--color-text-primary)',
                          fontSize: 'var(--font-size-sm)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          width: '100%',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <MousePointerClick size={16} strokeWidth={2} />
                        <span>到节点选择</span>
                      </button>
                      {kind === 'character' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            data.onOpenCharacterLibrary?.(id);
                            setAddMenu(false);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 10px',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: '6px',
                            color: 'var(--color-text-primary)',
                            fontSize: 'var(--font-size-sm)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            width: '100%',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <User size={16} strokeWidth={2} />
                          <span>角色库</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button className={styles.actionBtn} onClick={() => data.onGenerateImage?.()}>
                <WandSparkles size={15} strokeWidth={2} />
                <span>生成图片</span>
              </button>
            </div>
            <span className={styles.refRow}>
              <Info size={13} strokeWidth={2} />
              <span>{refs.length}/{MAX_IMAGE_REFS} 张参考图</span>
            </span>
          </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className={styles.hiddenInput}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* 角色卡：音色上传（鼠标悬停卡片时展示） */}
          {kind === 'character' && (
            <div className={styles.voiceSection}>
              <div className={styles.voiceLabel}>
                <Music size={14} strokeWidth={2} />
                <span>音色</span>
              </div>
              {voiceRefs.length > 0 && (
                <div className={styles.voiceList}>
                  {voiceRefs.map((v) => (
                    <div key={v.id} className={styles.voicePlayer}>
                      <audio
                        className={styles.voiceAudio}
                        src={v.src}
                        controls
                        preload="metadata"
                      />
                      <button
                        className={styles.voiceRemove}
                        onClick={() => removeVoiceRef(v.id)}
                        title="移除音色"
                      >
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.voiceDrop}>
                <span className={styles.voiceHint}>
                  {voiceRefs.length > 0 ? `已上传 ${voiceRefs.length} 段` : '从画布拖入音频'}
                </span>
                {voiceRefs.length < MAX_VOICE_FILES && (
                  <button className={styles.actionBtn} onClick={() => audioRef.current?.click()}>
                    <Upload size={15} strokeWidth={2} />
                    <span>上传音色音频</span>
                  </button>
                )}
                <span className={styles.voiceTip}>
                  {voiceRefs.length}/{MAX_VOICE_FILES} 段 · 每段 ≤ {MAX_VOICE_DURATION} 秒
                </span>
              </div>
              <input
                ref={audioRef}
                type="file"
                accept="audio/*"
                multiple
                className={styles.hiddenInput}
                onChange={(e) => {
                  if (e.target.files) addVoiceFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />

      {/* 右键菜单（portal 到 body，避免节点 transform 影响 fixed 定位） */}
      {contextMenu &&
        createPortal(
          <div
            className={styles.contextMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className={styles.contextItem} onClick={handleAddToChat}>
              <span>添加到聊天</span>
            </button>
            <button className={styles.contextItem} onClick={handleSaveToAssets}>
              <span>保存到共享资产</span>
            </button>
            <button className={`${styles.contextItem} ${styles.contextDanger}`} onClick={handleDelete}>
              <span>删除</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
