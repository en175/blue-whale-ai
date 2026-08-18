/* ============================================
 * ProductNode 商品节点：商品图上传（拖入/点击，上限 8 张，点击缩略图切换启用）、
 * 商品详情编辑、从商品链接导入
 * ============================================ */
import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AtSign, Upload, X, ChevronDown, Link2, Box } from 'lucide-react';
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
}

const MAX_IMAGES = 8;

/** 链接导入支持的平台 */
const PLATFORMS = ['抖', '淘', '猫', '京', '亚'];

export default function ProductNode({ id, data, selected }: NodeProps & { data: ProductNodeData }) {
  const [images, setImages] = useState<ProductImage[]>(data.images ?? []);
  const [detail, setDetail] = useState(data.detail ?? '');
  const [linkOpen, setLinkOpen] = useState(true);
  const [link, setLink] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isSelect = data.toolMode === 'select';

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
  const enabledCount = images.filter((i) => i.enabled).length;

  /** 本地图片文件 → 缩略图（仅 image/*，上限 8） */
  const addFiles = (files: FileList | File[]) => {
    const imgs: ProductImage[] = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((f, i) => ({ id: `img-${Date.now()}-${i}`, src: URL.createObjectURL(f), enabled: true }));
    if (imgs.length === 0) return;
    setImages((prev) => [...prev, ...imgs].slice(0, MAX_IMAGES));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  /** 链接导入：将 URL 作为商品图加入（mock，未经后端抓取） */
  const handleImport = () => {
    const url = link.trim();
    if (!url) return;
    setImages((prev) => [...prev, { id: `link-${Date.now()}`, src: url, enabled: true }].slice(0, MAX_IMAGES));
    setLink('');
  };

  return (
    <div
      className={styles.wrapper}
      onContextMenu={handleContextMenu}
    >
      {!data.isFirst && (
        <Handle type="target" position={Position.Left} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />
      )}

      {/* 悬停/选中时顶部操作条：节点名 + 添加到对话 */}
      <div className={`${styles.topBar} ${selected ? styles.topBarVisible : ''}`}>
        <span className={styles.topLabel}>
          <Box size={14} strokeWidth={2} />
          <span>商品</span>
        </span>
        <button
          className={`${styles.addToChatBtn} nodrag`}
          onClick={() => data.onAddToChat?.(id)}
        >
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

        {/* 交互区：选择模式可操作，拖动模式整体可拖 */}
        <div
          className={isSelect ? 'nodrag nopan' : undefined}
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
                      setImages((prev) => prev.filter((p) => p.id !== img.id));
                    }}
                    title="移除"
                  >
                    <X size={10} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 拖入/点击上传 */}
          {images.length < MAX_IMAGES && (
            <div
              className={styles.dropzone}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <Upload size={18} strokeWidth={2} />
              <span>拖入或点击添加商品图</span>
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
            className={styles.detailArea}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="商品名称、品类、核心参数、卖点、目标人群..."
            rows={6}
          />

          <div className={styles.divider} />

          {/* 从商品链接导入 */}
          <button className={styles.linkToggle} onClick={() => setLinkOpen((v) => !v)}>
            <ChevronDown
              size={12}
              strokeWidth={2}
              className={`${styles.linkArrow} ${linkOpen ? '' : styles.linkArrowClosed}`}
            />
            <Link2 size={12} strokeWidth={2} />
            <span>从商品链接导入</span>
          </button>
          {linkOpen && (
            <div className={styles.linkRow}>
              <div className={styles.linkField}>
                {!link && (
                  <span className={styles.linkPlaceholder}>
                    <span>支持</span>
                    {PLATFORMS.map((p) => (
                      <i key={p}>{p}</i>
                    ))}
                  </span>
                )}
                <input
                  className={styles.linkInput}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleImport();
                  }}
                />
              </div>
              <button
                className={styles.importBtn}
                disabled={!link.trim()}
                onClick={handleImport}
              >
                导入
              </button>
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
            <button className={`${styles.contextItem} ${styles.contextDanger}`} onClick={handleDelete}>
              <span>删除</span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
