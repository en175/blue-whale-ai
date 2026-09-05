/* ============================================
 * MediaNode 媒体节点：图片/视频展示与操作手柄
 * 图片/视频：外部常驻标题 + 独立圆角内容主体（统一尺度）
 * 音频：保留现有卡片布局，后续子任务接入外部标题
 * ============================================ */
import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Image, Video, RefreshCcw, Sparkles, AudioLines, Info, Download, AtSign, ImageOff } from 'lucide-react';
import { isMediaExtractNodeId } from '../../mediaExtract';
import { mediaNodeFailHeadline } from './failHeadline';
import { mediaNodeGenerationOverlay } from './generationOverlay';
import { mediaNodeToolbarVisibility } from './toolbarVisibility';
import { mediaContentBox, type MediaDims } from './mediaContentSize';
import styles from './index.module.css';

/** 连接点统一样式（锚定内容区左右中点） */
const HANDLE_STYLE = { background: '#666', width: 10, height: 10, border: '2px solid #444' } as const;

interface MediaNodeData {
  src?: string;
  fileName?: string;
  mediaType?: 'image' | 'video' | 'audio';
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  /** 关联生成任务ID（生成中的占位节点）。后端返回字符串，兼容 number 历史形态。 */
  jobId?: number | string;
  /** 生成状态：generating 进度展示；failed/cancelled 错误展示；无值为普通媒体 */
  genStatus?: 'generating' | 'failed' | 'cancelled';
  /** 生成进度 0-100 */
  progress?: number;
  /** 失败原因 */
  errorText?: string;
  /** 生成时的提示词（「重新编辑」带回图片对话框） */
  prompt?: string;
  /** 资产 ID（上传完成后存储） */
  assetId?: string | number;
  /** 派生标记：资产在 snapshot 资产字典中查不到（素材已被删除），水合期计算 */
  assetMissing?: boolean;
  /** MIME 类型（上传完成后存储，如 "image/jpeg"） */
  mime?: string;
  /** 媒体宽度（图片/视频，像素） */
  width?: number;
  /** 媒体高度（图片/视频，像素） */
  height?: number;
  /** 时长秒（视频/音频） */
  duration?: number;
  /** 文件大小字节 */
  size?: number;
  /** 生成参数透传的目标比例（如 "16:9"），仅决定占位形状，不作原始分辨率展示 */
  targetRatio?: string;
  /** 浏览器量得真实媒体尺寸后回填（缺失或不一致时才回调） */
  onMediaDims?: (id: string, dims: MediaDims) => void;
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
  /** 视频整段提取音频；音频节点由后端注入画布。 */
  onExtractAudio?: (id: string) => Promise<void> | void;
  /** 下载媒体文件 */
  onDownload?: (id: string) => void;
  /** 查看媒体资产详情 */
  onShowDetails?: (id: string) => void;
}

export default function MediaNode({ id, data, selected }: NodeProps & { data: MediaNodeData; selected?: boolean }) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isExtractSubmitting, setIsExtractSubmitting] = useState(false);

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

  /** 保存到共享资产（共享资产下线，入口已隐藏） */
  // const handleSaveToAssets = useCallback(() => {
  //   setContextMenu(null);
  //   console.log('[MediaNode] 保存到共享资产', { nodeId: id, hasCallback: !!data.onSaveToAssets, assetId: data.assetId, mediaType: data.mediaType });
  //   data.onSaveToAssets?.(id);
  // }, [data, id]);

  /** 工具条操作（stopPropagation 避免触发节点拖拽/选中变化） */
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const handleReEdit = useCallback(() => data.onReEdit?.(id), [data, id]);
  const handleGenImage = useCallback(() => data.onGenImage?.(id), [data, id]);
  const handleGenVideo = useCallback(() => data.onGenVideo?.(id), [data, id]);
  const handleExtractAudio = useCallback(async () => {
    if (isExtractSubmitting || data.assetId == null || !data.onExtractAudio) return;
    setIsExtractSubmitting(true);
    try {
      await data.onExtractAudio(id);
    } finally {
      setIsExtractSubmitting(false);
    }
  }, [data, id, isExtractSubmitting]);
  const handleDownload = useCallback(() => data.onDownload?.(id), [data, id]);
  const handleShowDetails = useCallback(() => data.onShowDetails?.(id), [data, id]);
  const handleMention = useCallback(() => data.onAddToChat?.(id), [data, id]);

  /** 浏览器实测尺寸回填：仅在缺失或与既有数据不一致时上报，避免回填抖动 */
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    if (data.width === w && data.height === h) return;
    data.onMediaDims?.(id, { width: w, height: h });
  }, [data, id]);

  const handleVideoMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth: w, videoHeight: h, duration } = e.currentTarget;
    if (!w || !h) return;
    const dims: MediaDims = { width: w, height: h };
    if (Number.isFinite(duration) && duration > 0 && typeof data.duration !== 'number') {
      dims.duration = duration;
    }
    if (data.width === w && data.height === h && dims.duration === undefined) return;
    data.onMediaDims?.(id, dims);
  }, [data, id]);

  const Icon = data.mediaType === 'video' ? Video : data.mediaType === 'audio' ? AudioLines : Image;
  const label = data.mediaType === 'video' ? '视频' : data.mediaType === 'audio' ? '音频' : '图片';
  const toolbar = mediaNodeToolbarVisibility(data.mediaType);
  const isGenerating = data.genStatus === 'generating';
  const isGenDone = data.genStatus === 'failed' || data.genStatus === 'cancelled';
  const isMediaExtraction = isMediaExtractNodeId(id);
  const generationOverlay = mediaNodeGenerationOverlay(isMediaExtraction);
  const failHeadline = mediaNodeFailHeadline({
    genStatus: data.genStatus,
    errorText: data.errorText,
    isMediaExtraction,
  });

  const isAudio = data.mediaType === 'audio';
  const contentBox = mediaContentBox({ width: data.width, height: data.height, ratio: data.targetRatio });

  /** 标题右侧元信息：仅真实媒体数据（分辨率 + 视频时长），缺失项留空；目标比例/占位尺寸不展示，文件大小只在详情 */
  const titleMeta = [
    data.width && data.height ? `${data.width}×${data.height}` : '',
    data.mediaType === 'video' && typeof data.duration === 'number' && data.duration > 0
      ? `${Math.round(data.duration)}s`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  /** 生成中 / 失败 / 素材缺失占位（音频与图片/视频共用内部内容） */
  const renderPlaceholder = () => {
    if (isGenerating) {
      /* 生成中：转圈；音频提取展示真实进度；生图/生视频仅保留取消 */
      return (
        <div className={styles.genBox}>
          <div className={styles.genSpinner} />
          {generationOverlay.showProgress && (
            <>
              <span className={styles.genText}>
                {generationOverlay.progressLabel}
                {typeof data.progress === 'number' ? ` ${data.progress}%` : '…'}
              </span>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={typeof data.progress === 'number' ? data.progress : 0}
              >
                <div className={styles.progressFill} style={{ width: `${data.progress ?? 0}%` }} />
              </div>
            </>
          )}
          {generationOverlay.showCancel && (
            <button className={styles.genBtn} onClick={() => data.onCancelJob?.(id)}>
              取消生成
            </button>
          )}
        </div>
      );
    }
    if (isGenDone) {
      /* 失败/已取消：错误提示 + 重试 */
      return (
        <div className={styles.genBox}>
          <span className={styles.genFailText}>{failHeadline}</span>
          {data.genStatus === 'failed' && !isMediaExtraction && (
            <button className={styles.genBtn} onClick={() => data.onRetryJob?.(id)}>
              重试
            </button>
          )}
        </div>
      );
    }
    /* 素材已被删除：灰色占位（资产在 snapshot 字典中查不到） */
    return (
      <div className={styles.missingBox}>
        <ImageOff size={22} strokeWidth={1.8} color="#666" />
        <span className={styles.missingText}>素材已被删除</span>
      </div>
    );
  };

  return (
    <div className={`${styles.wrapper} ${selected ? styles.selected : ''}`} onContextMenu={handleContextMenu}>
      {/* 选中态悬浮工具条：重新编辑/生成图片/生成视频/生成音频 + 详情/下载/@（位于外部标题上方） */}
      {selected && !data.genStatus && !data.assetMissing && (
        <div className={`nodrag nopan ${styles.toolbar}`} onMouseDown={stop}>
          <button className={styles.toolBtn} onClick={handleReEdit} title="带入原提示词与图片，打开图片对话框">
            <RefreshCcw size={14} strokeWidth={2} />
            <span>重新编辑</span>
          </button>
          {toolbar.genImage && (
            <button className={styles.toolBtn} onClick={handleGenImage} title="带入图片，打开图片对话框">
              <Sparkles size={14} strokeWidth={2} />
              <span>生成图片</span>
            </button>
          )}
          {toolbar.genVideo && (
            <button className={styles.toolBtn} onClick={handleGenVideo} title="带入图片，打开视频对话框">
              <Video size={14} strokeWidth={2} />
              <span>生成视频</span>
            </button>
          )}
          {data.mediaType === 'video' && (
            <button
              className={styles.toolBtn}
              onClick={() => void handleExtractAudio()}
              disabled={data.assetId == null || isExtractSubmitting}
              title={data.assetId == null ? '当前视频尚未关联资产，无法提取音频' : '提取视频中的完整音轨'}
            >
              <AudioLines size={14} strokeWidth={2} />
              <span>{isExtractSubmitting ? '提交中…' : '提取音频'}</span>
            </button>
          )}
          <span className={styles.toolDivider} />
          <button className={styles.toolBtn} onClick={handleShowDetails} title="详情">
            <Info size={14} strokeWidth={2} />
          </button>
          <button className={styles.toolBtn} onClick={handleDownload} title="下载">
            <Download size={14} strokeWidth={2} />
          </button>
          {toolbar.mention && (
            <button className={styles.toolBtn} onClick={handleMention} title="添加到 Agent 聊天">
              <AtSign size={14} strokeWidth={2} />
            </button>
          )}
        </div>
      )}

      {isAudio ? (
        /* 音频：保留现有卡片布局（外部标题与新尺寸规则由后续子任务接入） */
        <>
          {!data.isFirst && (
            <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
          )}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.labelGroup}>
                <Icon size={13} strokeWidth={2} color="#888" />
                <span className={styles.label}>{label}</span>
              </div>
              <div className={styles.headerRight}>
                <span className={styles.fileName}>
                  {data.fileName || ''}
                </span>
                {!isGenerating && !isGenDone && (
                  <span className={styles.mediaMeta}>
                    {typeof data.duration === 'number' && data.duration > 0
                      ? ` ${Math.round(data.duration)}s`
                      : ''}
                    {typeof data.size === 'number'
                      ? ` ${(data.size / 1024 / 1024).toFixed(1)}MB`
                      : ''}
                  </span>
                )}
              </div>
            </div>
            <div className={styles.mediaContainer}>
              {isGenerating || isGenDone || data.assetMissing ? (
                renderPlaceholder()
              ) : (
                <div className={styles.audioBox}>
                  <audio
                    className={styles.mediaAudio}
                    src={data.src}
                    controls
                    preload="metadata"
                  />
                </div>
              )}
            </div>
          </div>
          <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
        </>
      ) : (
        /* 图片/视频：外部常驻标题 + 独立圆角内容主体 */
        <>
          <div className={styles.titleRow} data-testid="media-title">
            <div className={styles.titleLeft}>
              <Icon size={13} strokeWidth={2} color="#888" />
              <span className={styles.titleName} title={data.fileName || undefined}>{data.fileName || ''}</span>
            </div>
            <span className={styles.titleMeta}>{titleMeta}</span>
          </div>
          <div className={styles.contentCard} data-testid="media-content" style={{ width: contentBox.width, height: contentBox.height }}>
            {!data.isFirst && (
              <Handle type="target" position={Position.Left} className={styles.handle} style={HANDLE_STYLE} />
            )}
            {isGenerating || isGenDone || data.assetMissing ? (
              renderPlaceholder()
            ) : data.mediaType === 'video' ? (
              <video
                className={styles.mediaVideo}
                src={data.src}
                controls={isSelect}
                preload="metadata"
                onLoadedMetadata={handleVideoMetadata}
                style={isSelect ? undefined : { pointerEvents: 'none' }}
              />
            ) : (
              <img
                className={styles.mediaImage}
                src={data.src}
                alt={data.fileName || 'image'}
                draggable={false}
                onLoad={handleImageLoad}
                style={isSelect ? undefined : { pointerEvents: 'none' }}
              />
            )}
            <Handle type="source" position={Position.Right} className={styles.handle} style={HANDLE_STYLE} />
          </div>
        </>
      )}

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
          {/* 共享资产概念下线，隐藏入口 */}
          {/* <button className={styles.contextItem} onClick={handleSaveToAssets}>
            <span>保存到共享资产</span>
          </button> */}
          <button className={styles.contextItem} onClick={handleDuplicate}>
            <span>复制</span>
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
