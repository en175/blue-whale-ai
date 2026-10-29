

import { type AssetCardKind, KIND_META } from '@/custom/enums';
import { useRef, useState, useCallback, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AtSign, Upload, WandSparkles, Info, Music, X, MousePointerClick, ImageOff, Plus } from 'lucide-react';
import type { GenerationCardBlock } from '@/custom/api/agentSessions';
import { toast } from '@/custom/components/Toast';
import { uploadAssetFile } from '@/custom/utils/upload';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { isFileRejected } from '@/custom/utils/fileSignature';
import type { UploadCompleteData } from '@/custom/api/assets';
import type { CanvasGalleryRef } from '../../media/collectMediaBlocks';
import { useAssetImageRefLimit } from '../../generation/modelCaps';
import { assetCardKindOf } from './toolbarVisibility';
import styles from './index.module.css';

const HANDLE_STYLE = { background: 'transparent', border: 'none', width: 24, height: 24 } as const;

function HandlePlus() {
  return (
    <span className="nodrag nopan" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 24,
      height: 24,
      borderRadius: '50%',
      background: '#2a2a2a',
      border: '1px solid #555',
      color: '#ccc',
      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
    }}>
      <Plus size={14} strokeWidth={2.5} />
    </span>
  );
}

export type { AssetCardKind } from '@/custom/enums';

const NOWHEEL = 'nowheel';

export type GenerationCardNodeData = Partial<GenerationCardBlock>;

export interface AssetCardNodeData {
  kind?: AssetCardKind;
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;

  projectId?: string;

  initialRefs?: CanvasGalleryRef[];

  initialDesc?: string;

  voice?: { name: string; src: string; type?: 'audio' };

  onHoverChange?: (id: string, hovered: boolean) => void;
  onDelete?: (id: string) => void;
  onAddToChat?: (id: string) => void;

  onCardChange?: (id: string, patch: { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null }) => void;

  onGenerateImage?: () => void;

  onPickFromCanvas?: (id: string) => void;

  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;

  generationCard?: GenerationCardNodeData;
}

const MAX_VOICE_FILES = 3;
const MAX_VOICE_DURATION = 15;

export default function AssetCardNode({ id, data }: NodeProps & { data: AssetCardNodeData; selected?: boolean }) {

  const kind: AssetCardKind = assetCardKindOf(data.kind);
  const meta = KIND_META[kind];

  const MAX_IMAGE_REFS = useAssetImageRefLimit();
  const [refs, setRefs] = useState<CanvasGalleryRef[]>(data.initialRefs ?? []);
  const [desc, setDesc] = useState(data.initialDesc ?? '');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [voiceRefs, setVoiceRefs] = useState<{ id: string; src: string; name: string; duration: number }[]>(
    data.voice ? [{ id: `voice-hydrated-${id}`, src: data.voice.src, name: data.voice.name, duration: 0 }] : [],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  const pendingUploadsRef = useRef<Map<string, { file: File; cancelled: boolean }>>(new Map());

  const isSelect = data.toolMode === 'select';
  const isGeneration = (data.kind ?? 'custom') === 'generation';

  useEffect(() => {
    data.onCardChange?.(id, {
      refs,
      desc,
      ...(voiceRefs.length > 0 ? { voice: { name: voiceRefs[0].name, src: voiceRefs[0].src } } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs, desc, voiceRefs, id]);

  useEffect(() => {
    const pickResult = (data as { assetPickResult?: { ts: number; assetId: string; ref: CanvasGalleryRef } }).assetPickResult;
    if (!pickResult || pickResult.assetId !== id) return;
    setRefs((prev) => {
      if (prev.length >= MAX_IMAGE_REFS) {
        data.onToast?.('warn', `参考图最多 ${MAX_IMAGE_REFS} 张，已满`);
        return prev;
      }
      if (prev.some((r) => r.id === pickResult.ref.id)) return prev;
      return [...prev, pickResult.ref];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(data as { assetPickResult?: { ts: number } }).assetPickResult?.ts]);

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

  useEffect(() => {
    if (!addMenu) return;
    const close = () => setAddMenu(false);
    document.addEventListener('click', close);
    return () => {
      document.removeEventListener('click', close);
    };
  }, [addMenu]);

  useEffect(() => {
    const pendingUploads = pendingUploadsRef.current;
    return () => {
      data.onHoverChange?.(id, false);
      pendingUploads.forEach((p) => { p.cancelled = true; });
      pendingUploads.clear();
      refs.forEach((r) => {
        if (r.src.startsWith('blob:')) URL.revokeObjectURL(r.src);
      });
      voiceRefs.forEach((v) => {
        if (v.src.startsWith('blob:')) URL.revokeObjectURL(v.src);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (data.toolMode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
  }, [data.toolMode]);

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

    const newRefs = imgs.map(({ id, src, type }) => ({ id, src, type }));
    setRefs((prev) => {
      const remaining = MAX_IMAGE_REFS - prev.length;
      if (remaining <= 0) {
        data.onToast?.('warn', `参考图最多 ${MAX_IMAGE_REFS} 张，已超出 ${imgs.length} 张`);
        return prev;
      }
      if (imgs.length > remaining) {
        data.onToast?.('warn', `参考图最多 ${MAX_IMAGE_REFS} 张，已超出 ${imgs.length - remaining} 张`);
      }
      const toAdd = newRefs.slice(0, remaining);

      imgs.slice(remaining).forEach(({ src }) => URL.revokeObjectURL(src));
      return [...prev, ...toAdd];
    });

    imgs.slice(0, MAX_IMAGE_REFS).forEach(({ id: refId, file }) => {

      pendingUploadsRef.current.set(refId, { file, cancelled: false });

      uploadAssetFile(file, { projectId: data.projectId })
        .then((done: UploadCompleteData) => {
          const entry = pendingUploadsRef.current.get(refId);
          if (!entry || entry.cancelled) return;
          pendingUploadsRef.current.delete(refId);

          setRefs((prev) =>
            prev.map((r) => {
              if (r.id !== refId) return r;

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

          if (isFileRejected(err)) toast.error(err.message);
        });
    });
  };

  const removeRef = (refId: string) => {

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

  const addVoiceFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const isMp3 = (f: File) =>
      f.name.toLowerCase().endsWith('.mp3') || f.type === 'audio/mpeg';
    const audioFiles = list.filter(isMp3);
    const rejected = list.length - audioFiles.length;
    if (rejected > 0) {
      data.onToast?.('warn', `音色仅支持 MP3 格式，已跳过 ${rejected} 个非 MP3 文件`);
    }
    if (audioFiles.length === 0) return;
    const remaining = MAX_VOICE_FILES - voiceRefs.length;
    if (remaining <= 0) {
      data.onToast?.('warn', `音色最多 ${MAX_VOICE_FILES} 段，已超出 ${audioFiles.length} 段`);
      return;
    }
    if (audioFiles.length > remaining) {
      data.onToast?.('warn', `音色最多 ${MAX_VOICE_FILES} 段，已超出 ${audioFiles.length - remaining} 段`);
    }
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
        audio.src = resolveMediaSrc(src);
      });
      if (duration <= MAX_VOICE_DURATION) {
        results.push({ id: `voice-${Date.now()}-${results.length}`, src, name: f.name, duration });
      } else {
        data.onToast?.('warn', `「${f.name}」超过 ${MAX_VOICE_DURATION} 秒，已跳过`);
        URL.revokeObjectURL(src);
      }
    }
    if (results.length > 0) setVoiceRefs((prev) => [...prev, ...results]);
  };

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

  return (
    <div
      className={styles.wrapper}
      onContextMenu={handleContextMenu}
      onPointerEnter={() => data.onHoverChange?.(id, true)}
      onPointerLeave={() => data.onHoverChange?.(id, false)}
    >
      {!data.isFirst && (
        <Handle type="target" position={Position.Left} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus />
        </Handle>
      )}

      {
}

      <div
        className={styles.card}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        { }
        <div className={styles.head}>
          <span className={styles.atIcon}>
            <AtSign size={14} strokeWidth={2} />
          </span>
          <span className={styles.name}>{meta.title}</span>
        </div>

        { }
        <div
          style={isSelect || isGeneration ? undefined : { pointerEvents: 'none' }}
        >
          {isGeneration && data.generationCard ? (

            <div className={`${styles.body} ${NOWHEEL}`} onWheel={(e) => e.stopPropagation()}>
              <div className={styles.gcHeader}>
                <span className={styles.gcTitle}>{data.generationCard.shotTitle ?? '生成卡'}</span>
                {data.generationCard.timeRange && (
                  <span className={styles.gcTime}>{data.generationCard.timeRange}</span>
                )}
              </div>
              {data.generationCard.visual && (
                <div className={styles.gcField}>
                  <span className={styles.gcLabel}>画面</span>
                  <span className={styles.gcValue}>{data.generationCard.visual}</span>
                </div>
              )}
              {data.generationCard.prompt && (
                <div className={styles.gcField}>
                  <span className={styles.gcLabel}>提示词</span>
                  <span className={styles.gcValue}>{data.generationCard.prompt}</span>
                </div>
              )}
              {data.generationCard.assetRefs && data.generationCard.assetRefs.length > 0 && (
                <div className={styles.gcRefs}>
                  {data.generationCard.assetRefs.map((r) => (
                    <span key={r} className={styles.gcRef}>{r}</span>
                  ))}
                </div>
              )}
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
                  <div key={ref.id} className={styles.refThumb} title={ref.missing ? '素材已被删除' : undefined}>
                    {ref.missing ? (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: '#161616',
                        }}
                      >
                        <ImageOff size={16} strokeWidth={1.8} color="#666" />
                      </div>
                    ) : ref.type === 'video' ? (
                      <video src={resolveMediaSrc(ref.src)} className={styles.refThumbImg} muted playsInline />
                    ) : (
                      <img src={resolveMediaSrc(ref.src)} crossOrigin={remoteImageCrossOrigin(ref.src)} alt="参考图" className={styles.refThumbImg} />
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

          { }
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
                        src={resolveMediaSrc(v.src)}
                        crossOrigin={remoteImageCrossOrigin(v.src)}
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
                accept=".mp3,audio/mpeg"
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

      <Handle type="source" position={Position.Right} style={{ ...HANDLE_STYLE, right: '-16px' }}>
        <HandlePlus />
      </Handle>

    </div>
  );
}
