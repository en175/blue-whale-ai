import { useRef, useState, useCallback, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useSoloNodeSelected } from '../../hooks/chrome/useSoloNodeSelected';
import { AtSign, Upload, X, Box, MousePointerClick, ImageOff, Plus } from 'lucide-react';
import { toast } from '@/custom/components/Toast';
import { uploadAssetFile } from '@/custom/utils/upload';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { isFileRejected } from '@/custom/utils/fileSignature';
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

export interface ProductImage {
  id: string;
  src: string;
  enabled: boolean;
  type?: 'image' | 'video';
  assetId?: string;
  missing?: boolean;
}

interface ProductNodeData {
  name?: string;
  detail?: string;
  images?: ProductImage[];
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  projectId?: string;
  onDelete?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onProductChange?: (id: string, patch: { images?: ProductImage[]; detail?: string }) => void;
  onPickFromCanvas?: (id: string) => void;
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

const MAX_IMAGES = 8;
const MAX_DETAIL_LENGTH = 2000;

export default function ProductNode({ id, data, selected }: NodeProps & { data: ProductNodeData }) {
  const showSoloToolbar = useSoloNodeSelected(selected);
  const [images, setImages] = useState<ProductImage[]>(data.images ?? []);
  const [detail, setDetail] = useState(data.detail ?? '');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<null | 'menu'>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingUploadsRef = useRef<Map<string, { file: File; cancelled: boolean }>>(new Map());

  const isSelect = data.toolMode === 'select';

  useEffect(() => {
    data.onProductChange?.(id, { images, detail });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, detail, id]);

  useEffect(() => {
    const pickResult = (data as { productPickResult?: { ts: number; productId: string; image: ProductImage } }).productPickResult;
    if (!pickResult || pickResult.productId !== id) return;
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) return prev;
      if (prev.some((img) => img.id === pickResult.image.id)) return prev;
      return [...prev, pickResult.image];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(data as { productPickResult?: { ts: number } }).productPickResult?.ts]);

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
    const pendingUploads = pendingUploadsRef.current;
    return () => {
      pendingUploads.forEach((p) => { p.cancelled = true; });
      pendingUploads.clear();
      images.forEach((img) => {
        if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!addMenu) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.addMenu}`) && !target.closest(`.${styles.dropzone}`)) {
        setAddMenu(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [addMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (data.toolMode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
  }, [data.toolMode]);

  const handleAddToChat = useCallback(() => {
    setContextMenu(null);
    data.onAddToChat?.(id);
  }, [data, id]);


  const enabledCount = images.filter((i) => i.enabled).length;

  const addFiles = (files: FileList | File[]) => {
    const all = Array.from(files);
    const invalid = all.filter((f) => !f.type.startsWith('image/'));
    if (invalid.length > 0) {
      data.onToast?.('warn', invalid.length === 1
        ? `「${invalid[0].name}」不是图片格式，无法添加`
        : `${invalid.length} 个文件不是图片格式，无法添加`);
    }
    const newImgs: { id: string; src: string; file: File; type: 'image' | 'video' }[] = [];
    all
      .filter((f) => f.type.startsWith('image/'))
      .forEach((f, i) => {
        const imgId = `img-${Date.now()}-${i}`;
        newImgs.push({ id: imgId, src: URL.createObjectURL(f), file: f, type: 'image' });
      });
    if (newImgs.length === 0) return;

    setImages((prev) => {
      const combined = [...prev, ...newImgs.map(({ id, src, type }) => ({ id, src, enabled: true, type }))];
      const trimmed = combined.slice(0, MAX_IMAGES);
      if (combined.length > MAX_IMAGES) {
        data.onToast?.('warn', `商品图最多 ${MAX_IMAGES} 张，已超出 ${combined.length - MAX_IMAGES} 张`);
        combined.slice(MAX_IMAGES).forEach((i) => {
          if (i.src.startsWith('blob:')) URL.revokeObjectURL(i.src);
        });
        newImgs.slice(MAX_IMAGES - prev.length).forEach(({ id }) => {
          const entry = pendingUploadsRef.current.get(id);
          if (entry) { entry.cancelled = true; pendingUploadsRef.current.delete(id); }
        });
      }
      return trimmed;
    });

    newImgs.forEach(({ id: imgId, file }) => {
      pendingUploadsRef.current.set(imgId, { file, cancelled: false });

      uploadAssetFile(file, { projectId: data.projectId })
        .then((done) => {
          const entry = pendingUploadsRef.current.get(imgId);
          if (!entry || entry.cancelled) return;
          pendingUploadsRef.current.delete(imgId);

          setImages((prev) =>
            prev.map((img) => {
              if (img.id !== imgId) return img;
              if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
              const mediaType: 'image' | 'video' = done.type === 'video' ? 'video' : 'image';
              return { ...img, src: done.url || img.src, type: mediaType, assetId: done.asset_id };
            }),
          );
        })
        .catch((err) => {
          const entry = pendingUploadsRef.current.get(imgId);
          if (!entry || entry.cancelled) return;
          pendingUploadsRef.current.delete(imgId);
          console.warn(`[商品] 图片上传失败（${file.name}），保留本地预览:`, err);
          if (isFileRejected(err)) toast.error(err.message);
        });
    });
  };

  const enterPickMode = () => {
    data.onPickFromCanvas?.(id);
    setAddMenu(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={styles.wrapper}
      onContextMenu={handleContextMenu}
    >
      {!data.isFirst && (
        <Handle type="target" position={Position.Left} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus />
        </Handle>
      )}

      {}
      <div className={`${styles.topBar} ${showSoloToolbar ? styles.topBarVisible : ''}`}>
        <span className={styles.topLabel}>
          <Box size={14} strokeWidth={2} />
          <span>商品</span>
        </span>
        <button className={`${styles.addToChatBtn} nodrag`} onClick={handleAddToChat}>
          <AtSign size={14} strokeWidth={2} />
          <span>添加到对话</span>
        </button>
      </div>

      <div className={styles.card}>
        {}
        <div className={styles.head}>
          <span className={styles.atIcon}>
            <AtSign size={14} strokeWidth={2} />
          </span>
          <span className={styles.name}>{data.name || '商品'}</span>
        </div>

        {}
        <div
          style={isSelect ? undefined : { pointerEvents: 'none' }}
        >
          <div className={styles.imgHead}>
            <span className={styles.sectionLabel}>商品图片</span>
            <span className={styles.enabledCount}>已启用 {enabledCount}/{MAX_IMAGES}</span>
          </div>

          {}
          {images.length > 0 && (
            <div className={styles.thumbGrid}>
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`${styles.thumb} ${img.enabled ? '' : styles.thumbDisabled}`}
                  onClick={() =>
                    setImages((prev) => prev.map((p) => (p.id === img.id ? { ...p, enabled: !p.enabled } : p)))
                  }
                  title={img.missing ? '素材已被删除' : img.enabled ? '点击停用' : '点击启用'}
                >
                  {img.missing ? (
                    <div className={styles.thumbMissing}>
                      <ImageOff size={16} strokeWidth={1.8} color="#666" />
                    </div>
                  ) : img.type === 'video' ? (
                    <video src={resolveMediaSrc(img.src)} draggable={false} muted playsInline />
                  ) : (
                    <img src={resolveMediaSrc(img.src)} crossOrigin={remoteImageCrossOrigin(img.src)} alt="" draggable={false} />
                  )}
                  <button
                    className={styles.thumbRemove}
                    onClick={(e) => {
                      e.stopPropagation();
                      const pending = pendingUploadsRef.current.get(img.id);
                      if (pending) { pending.cancelled = true; pendingUploadsRef.current.delete(img.id); }
                      setImages((prev) => {
                        const target = prev.find((p) => p.id === img.id);
                        if (target?.src.startsWith('blob:')) URL.revokeObjectURL(target.src);
                        return prev.filter((p) => p.id !== img.id);
                      });
                    }}
                    title="移除"
                  >
                    <X size={10} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {}
          {images.length < MAX_IMAGES && (
            <div
              className={styles.dropzone}
              onClick={(e) => {
                e.stopPropagation();
                setAddMenu(addMenu === 'menu' ? null : 'menu');
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload size={18} strokeWidth={2} />
              <span>点击添加商品图或从节点中选择</span>
            </div>
          )}

          {}
          {addMenu === 'menu' && images.length < MAX_IMAGES && (
            <div className={styles.addMenu}>
              <button
                className={styles.addMenuItem}
                onClick={(e) => {
                  e.stopPropagation();
                  fileRef.current?.click();
                  setAddMenu(null);
                }}
              >
                <Upload size={16} strokeWidth={2} />
                <span>图片上传</span>
              </button>
              <button
                className={styles.addMenuItem}
                onClick={(e) => {
                  e.stopPropagation();
                  enterPickMode();
                }}
              >
                <MousePointerClick size={16} strokeWidth={2} />
                <span>到节点选择</span>
              </button>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className={styles.hiddenInput}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {}
          <div className={styles.detailLabel}>商品详情</div>
          <textarea
            className={`${styles.detailArea} nodrag`}
            value={detail}
            maxLength={MAX_DETAIL_LENGTH}
            onChange={(e) => {
              const val = e.target.value;
              if (val.length > MAX_DETAIL_LENGTH) {
                const trimmed = val.slice(0, MAX_DETAIL_LENGTH);
                setDetail(trimmed);
                data.onToast?.('warn', `商品详情最多 ${MAX_DETAIL_LENGTH} 字，已截断`);
                return;
              }
              setDetail(val);
            }}
            placeholder="商品名称、品类、核心参数、卖点、目标人群..."
            rows={6}
          />
        </div>
      </div>

      <Handle type="source" position={Position.Right} style={{ ...HANDLE_STYLE, right: '-16px' }}>
        <HandlePlus />
      </Handle>

    </div>
  );
}
