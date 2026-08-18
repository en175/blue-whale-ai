/* ============================================
 * AssetCardNode 资产卡节点：风格/角色/物体/环境/自定义
 * 从画布拖入/添加图片参考、生成图片唤起底部图片对话框、角色卡音色设置
 * ============================================ */
import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AtSign, Upload, WandSparkles, Info, Music } from 'lucide-react';
import styles from './index.module.css';

/** 资产卡类型 */
export type AssetCardKind = 'style' | 'character' | 'object' | 'environment' | 'custom';

/** 各类型标题与描述占位文案（对应设计稿） */
const KIND_META: Record<AssetCardKind, { title: string; placeholder: string }> = {
  style: { title: 'Style', placeholder: '描述视觉风格、配色与艺术方向...' },
  character: { title: 'Character', placeholder: '描述外观、性格、角色弧光、语音风格...' },
  object: { title: 'Object', placeholder: '描述形状、材质与颜色...' },
  environment: { title: 'Environment', placeholder: '描述布局、氛围、光照与情绪...' },
  custom: { title: 'Custom', placeholder: '添加此资产的备注或细节...' },
};

interface AssetCardNodeData {
  kind?: AssetCardKind;
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  /** 水合初始参考图（后端 reference 节点的 references 解析而来） */
  initialRefs?: { id: string; src: string }[];
  /** 水合初始描述文本 */
  initialDesc?: string;
  onDelete?: (id: string) => void;
  /** 生成图片：唤起底部图片对话框 */
  onGenerateImage?: () => void;
}

export default function AssetCardNode({ id, data }: NodeProps & { data: AssetCardNodeData }) {
  const meta = KIND_META[data.kind ?? 'custom'];
  const [refs, setRefs] = useState<{ id: string; src: string }[]>(data.initialRefs ?? []);
  const [desc, setDesc] = useState(data.initialDesc ?? '');
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

  /** 添加参考图（点击选择或拖入，仅 image/*） */
  const addFiles = (files: FileList | File[]) => {
    const imgs = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((f, i) => ({ id: `ref-${Date.now()}-${i}`, src: URL.createObjectURL(f) }));
    if (imgs.length > 0) setRefs((prev) => [...prev, ...imgs]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div className={styles.wrapper} onContextMenu={handleContextMenu}>
      {!data.isFirst && (
        <Handle type="target" position={Position.Left} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />
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

        {/* 交互区：选择模式可操作，拖动模式整体可拖 */}
        <div
          className={isSelect ? 'nodrag nopan' : undefined}
          style={isSelect ? undefined : { pointerEvents: 'none' }}
        >
          <div className={styles.body}>
            <span className={styles.dropHint}>从画布拖入</span>
            <textarea
              className={styles.descInput}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={meta.placeholder}
              rows={1}
            />
            <div className={styles.btnRow}>
              <button className={styles.actionBtn} onClick={() => fileRef.current?.click()}>
                <Upload size={15} strokeWidth={2} />
                <span>添加图片</span>
              </button>
              <button className={styles.actionBtn} onClick={() => data.onGenerateImage?.()}>
                <WandSparkles size={15} strokeWidth={2} />
                <span>生成图片</span>
              </button>
            </div>
            <span className={styles.refRow}>
              <Info size={13} strokeWidth={2} />
              <span>{refs.length} 张参考图</span>
            </span>
          </div>
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

          {/* 角色卡：音色设置 */}
          {(data.kind ?? 'custom') === 'character' && (
            <div className={styles.voiceSection}>
              <div className={styles.voiceLabel}>
                <Music size={14} strokeWidth={2} />
                <span>音色</span>
              </div>
              <button className={styles.voiceBtn}>
                <Music size={14} strokeWidth={2} />
                <span>设置角色音色</span>
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
