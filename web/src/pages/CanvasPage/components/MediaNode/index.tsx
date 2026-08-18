/* ============================================
 * MediaNode 媒体节点：图片/视频展示与操作手柄
 * ============================================ */
import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Image, Video, RefreshCcw, Sparkles, AudioLines, Info, Download, AtSign } from 'lucide-react';
import styles from './index.module.css';

interface MediaNodeData {
  src?: string;
  fileName?: string;
  mediaType?: 'image' | 'video';
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  /** 关联生成任务ID（生成中的占位节点） */
  jobId?: number;
  /** 生成状态：generating 进度展示；failed/cancelled 错误展示；无值为普通媒体 */
  genStatus?: 'generating' | 'failed' | 'cancelled';
  /** 生成进度 0-100 */
  progress?: number;
  /** 失败原因 */
  errorText?: string;
  /** 生成时的提示词（「重新编辑」带回图片对话框） */
  prompt?: string;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onAddToChat?: (id: string) => void;
  onSaveToAssets?: (id: string) => void;
  /** 取消生成（生成中节点） */
  onCancelJob?: (id: string) => void;
  /** 重试（失败节点） */
  onRetryJob?: (id: string) => void;
  /** 重新编辑：打开图片对话框并带入提示词与图片 */
  onReEdit?: (id: string) => void;
  /** 生成图片：打开图片对话框并带入图片 */
  onGenImage?: (id: string) => void;
  /** 生成视频：打开视频对话框并带入图片 */
  onGenVideo?: (id: string) => void;
  /** 生成音频：打开音频对话框并带入图片 */
  onGenAudio?: (id: string) => void;
  /** 下载媒体文件 */
  onDownload?: (id: string) => void;
}

export default function MediaNode({ id, data, selected }: NodeProps & { data: MediaNodeData; selected?: boolean }) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

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

  /** 右键菜单 */
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

  /** 拷贝文件信息到剪贴板 */
  const handleCopy = useCallback(async () => {
    setContextMenu(null);
    try {
      await navigator.clipboard.writeText(data.fileName || '');
    } catch {
      // 忽略剪贴板异常
    }
  }, [data.fileName]);

  /** 在旁边复制一个相同节点 */
  const handleDuplicate = useCallback(() => {
    setContextMenu(null);
    data.onDuplicate?.(id);
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

  /** 工具条操作（stopPropagation 避免触发节点拖拽/选中变化） */
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const handleReEdit = useCallback(() => data.onReEdit?.(id), [data, id]);
  const handleGenImage = useCallback(() => data.onGenImage?.(id), [data, id]);
  const handleGenVideo = useCallback(() => data.onGenVideo?.(id), [data, id]);
  const handleGenAudio = useCallback(() => data.onGenAudio?.(id), [data, id]);
  const handleDownload = useCallback(() => data.onDownload?.(id), [data, id]);
  const handleMention = useCallback(() => data.onAddToChat?.(id), [data, id]);

  const Icon = data.mediaType === 'video' ? Video : Image;
  const label = data.mediaType === 'video' ? '视频' : '图片';
  const isGenerating = data.genStatus === 'generating';
  const isGenDone = data.genStatus === 'failed' || data.genStatus === 'cancelled';

  return (
    <div className={styles.wrapper} onContextMenu={handleContextMenu}>
      {!data.isFirst && (
        <Handle type="target" position={Position.Left} style={{ background: '#666', width: 10, height: 10, border: '2px solid #444' }} />
      )}

      {/* 选中态悬浮工具条：重新编辑/生成图片/生成视频/生成音频 + 详情/下载/@ */}
      {selected && !data.genStatus && (
        <div className={`nodrag nopan ${styles.toolbar}`} onMouseDown={stop}>
          <button className={styles.toolBtn} onClick={handleReEdit} title="带入原提示词与图片，打开图片对话框">
            <RefreshCcw size={14} strokeWidth={2} />
            <span>重新编辑</span>
          </button>
          <button className={styles.toolBtn} onClick={handleGenImage} title="带入图片，打开图片对话框">
            <Sparkles size={14} strokeWidth={2} />
            <span>生成图片</span>
          </button>
          <button className={styles.toolBtn} onClick={handleGenVideo} title="带入图片，打开视频对话框">
            <Video size={14} strokeWidth={2} />
            <span>生成视频</span>
          </button>
          <button className={styles.toolBtn} onClick={handleGenAudio} title="带入图片，打开音频对话框">
            <AudioLines size={14} strokeWidth={2} />
            <span>生成音频</span>
          </button>
          <span className={styles.toolDivider} />
          <button className={styles.toolBtn} title="详情（预留）">
            <Info size={14} strokeWidth={2} />
          </button>
          <button className={styles.toolBtn} onClick={handleDownload} title="下载">
            <Download size={14} strokeWidth={2} />
          </button>
          <button className={styles.toolBtn} onClick={handleMention} title="添加到 Agent 聊天">
            <AtSign size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.labelGroup}>
            <Icon size={13} strokeWidth={2} color="#888" />
            <span className={styles.label}>{label}</span>
          </div>
          <span className={styles.fileName}>
            {data.fileName || ''}
          </span>
        </div>

        {/* 选择模式下仅视频保留 nodrag（控件需点击交互）；图片节点任意位置按下均可拖动 */}
        <div className={`${styles.mediaContainer} ${isSelect && data.mediaType === 'video' ? 'nodrag nopan' : ''}`}>
          {isGenerating ? (
            /* 生成中：进度条 + 取消生成 */
            <div className={styles.genBox}>
              <div className={styles.genSpinner} />
              <span className={styles.genText}>
                正在生成{typeof data.progress === 'number' ? ` ${data.progress}%` : '…'}
              </span>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${data.progress ?? 0}%` }} />
              </div>
              <button className={styles.genBtn} onClick={() => data.onCancelJob?.(id)}>
                取消生成
              </button>
            </div>
          ) : isGenDone ? (
            /* 失败/已取消：错误提示 + 重试 */
            <div className={styles.genBox}>
              <span className={styles.genFailText}>
                {data.genStatus === 'cancelled' ? '已取消生成' : '生成失败'}
              </span>
              {data.errorText && <span className={styles.genError}>{data.errorText}</span>}
              {data.genStatus === 'failed' && (
                <button className={styles.genBtn} onClick={() => data.onRetryJob?.(id)}>
                  重试
                </button>
              )}
            </div>
          ) : data.mediaType === 'video' ? (
            <video
              className={styles.mediaVideo}
              src={data.src}
              controls={isSelect}
              preload="metadata"
              style={isSelect ? undefined : { pointerEvents: 'none' }}
            />
          ) : (
            <img
              className={styles.mediaImage}
              src={data.src}
              alt={data.fileName || 'image'}
              draggable={false}
              style={isSelect ? undefined : { pointerEvents: 'none' }}
            />
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
          <button className={styles.contextItem} onClick={handleCopy}>
            <span>拷贝</span>
            <span className={styles.contextShortcut}>⌘C</span>
          </button>
          <button className={styles.contextItem} onClick={handleDuplicate}>
            <span>复制</span>
            <span className={styles.contextShortcut}>⌘D</span>
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
