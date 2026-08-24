/* ============================================
 * ProductNode 商品节点：商品图上传（拖入/点击，上限 8 张，点击缩略图切换启用）、
 * 商品详情编辑、从商品链接导入
 * ============================================ */
import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AtSign, Upload, X, Box, Image } from 'lucide-react';
import { uploadAssetFile } from '@/utils/upload';
import styles from './index.module.css';

/** 商品图项 */
export interface ProductImage {
  id: string;
  src: string;
  /** 是否启用（计入 已启用 n/8） */
  enabled: boolean;
}

interface ProductNodeData {
  name?: string;
  detail?: string;
  images?: ProductImage[];
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  onDelete?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  /** 保存到共享资产 */
  onSaveToAssets?: (id: string) => void;
  /** 商品内容变更同步回父组件（图片/详情），保证右键保存时能读到最新值 */
  onProductChange?: (id: string, patch: { images?: ProductImage[]; detail?: string }) => void;
  /** 触发画布节点选取模式（父级实现） */
  onPickFromCanvas?: (id: string) => void;
}

const MAX_IMAGES = 8;

export default function ProductNode({ id, data, selected }: NodeProps & { data: ProductNodeData }) {
  const [images, setImages] = useState<ProductImage[]>(data.images ?? []);
  const [detail, setDetail] = useState(data.detail ?? '');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  /** 添加菜单弹窗：null 关闭, 'menu' 选项菜单 */
  const [addMenu, setAddMenu] = useState<null | 'menu'>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 待上传映射：imageId → { file, cancelled }，用于异步上传完成后替换 src，删除时取消 */
  const pendingUploadsRef = useRef<Map<string, { file: File; cancelled: boolean }>>(new Map());

  const isSelect = data.toolMode === 'select';

  /** 商品内容变更同步回父组件 node.data（右键保存到共享资产时读取最新值） */
  useEffect(() => {
    data.onProductChange?.(id, { images, detail });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, detail, id]);

  /** ts 驱动注入：响应画布「到节点选择」结果，将选中的图片带入 */
  useEffect(() => {
    const pickResult = (data as { productPickResult?: { ts: number; productId: string; image: ProductImage } }).productPickResult;
    if (!pickResult || pickResult.productId !== id) return;
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) return prev;
      // 避免重复注入（同一 image.id 只注入一次）
      if (prev.some((img) => img.id === pickResult.image.id)) return prev;
      return [...prev, pickResult.image];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(data as { productPickResult?: { ts: number } }).productPickResult?.ts]);

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

  // 卸载时取消所有待上传任务、释放 blob URL
  useEffect(() => {
    return () => {
      pendingUploadsRef.current.forEach((p) => { p.cancelled = true; });
      pendingUploadsRef.current.clear();
      images.forEach((img) => {
        if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点击弹窗外部关闭添加菜单 */
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

  const enabledCount = images.filter((i) => i.enabled).length;

  /** 添加商品图（点击选择或拖入，仅 image/*，上限 8 张）
   * 先创建本地 blob 预览立即上画布，再异步调用 uploadAssetFile() 三步上传，
   * 成功后替换为永久 URL（与左侧工具栏加号上传逻辑一致） */
  const addFiles = (files: FileList | File[]) => {
    const newImgs: { id: string; src: string; file: File }[] = [];
    Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .forEach((f, i) => {
        const imgId = `img-${Date.now()}-${i}`;
        newImgs.push({ id: imgId, src: URL.createObjectURL(f), file: f });
      });
    if (newImgs.length === 0) return;

    setImages((prev) => {
      const combined = [...prev, ...newImgs.map(({ id, src }) => ({ id, src, enabled: true }))];
      const trimmed = combined.slice(0, MAX_IMAGES);
      // 为被截断的文件释放 blob URL（用户看不到）
      if (combined.length > MAX_IMAGES) {
        combined.slice(MAX_IMAGES).forEach((i) => {
          if (i.src.startsWith('blob:')) URL.revokeObjectURL(i.src);
        });
        // 同时取消被截断文件的待上传
        newImgs.slice(MAX_IMAGES - prev.length).forEach(({ id }) => {
          const entry = pendingUploadsRef.current.get(id);
          if (entry) { entry.cancelled = true; pendingUploadsRef.current.delete(id); }
        });
      }
      return trimmed;
    });

    // 异步上传每个文件并替换永久 URL
    newImgs.forEach(({ id: imgId, file }) => {
      pendingUploadsRef.current.set(imgId, { file, cancelled: false });

      uploadAssetFile(file)
        .then((done) => {
          const entry = pendingUploadsRef.current.get(imgId);
          if (!entry || entry.cancelled) return;
          pendingUploadsRef.current.delete(imgId);

          setImages((prev) =>
            prev.map((img) => {
              if (img.id !== imgId) return img;
              if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
              return { ...img, src: done.url || img.src };
            }),
          );
        })
        .catch((err) => {
          const entry = pendingUploadsRef.current.get(imgId);
          if (!entry || entry.cancelled) return;
          pendingUploadsRef.current.delete(imgId);
          console.warn(`[商品] 图片上传失败（${file.name}），保留本地预览:`, err);
        });
    });
  };

  /** 从画布节点选择 — 触发父级画布选取模式 */
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
        <Handle type="target" position={Position.Left} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />
      )}

      {/* 悬停/选中时顶部操作条 */}
      <div className={`${styles.topBar} ${selected ? styles.topBarVisible : ''}`}>
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
        {/* 标题 */}
        <div className={styles.head}>
          <span className={styles.atIcon}>
            <AtSign size={14} strokeWidth={2} />
          </span>
          <span className={styles.name}>{data.name || '商品'}</span>
        </div>

        {/* 交互区：整体可拖（与图片节点一致），文本控件单独 nodrag */}
        <div
          style={isSelect ? undefined : { pointerEvents: 'none' }}
        >
          <div className={styles.imgHead}>
            <span className={styles.sectionLabel}>商品图片</span>
            <span className={styles.enabledCount}>已启用 {enabledCount}/{MAX_IMAGES}</span>
          </div>

          {/* 缩略图（点击切换启用） */}
          {images.length > 0 && (
            <div className={styles.thumbGrid}>
              {images.map((img) => (
                <div
                  key={img.id}
                  className={`${styles.thumb} ${img.enabled ? '' : styles.thumbDisabled}`}
                  onClick={() =>
                    setImages((prev) => prev.map((p) => (p.id === img.id ? { ...p, enabled: !p.enabled } : p)))
                  }
                  title={img.enabled ? '点击停用' : '点击启用'}
                >
                  <img src={img.src} alt="" draggable={false} />
                  <button
                    className={styles.thumbRemove}
                    onClick={(e) => {
                      e.stopPropagation();
                      // 取消未完成的上传、释放 blob URL
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

          {/* 拖入/点击上传区 */}
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

          {/* 添加菜单：上传 / 到节点选择 */}
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
                <Image size={16} strokeWidth={2} />
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

          {/* 商品详情 */}
          <div className={styles.detailLabel}>商品详情</div>
          <textarea
            className={`${styles.detailArea} nodrag`}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="商品名称、品类、核心参数、卖点、目标人群..."
            rows={6}
          />
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
