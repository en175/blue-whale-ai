/* ============================================
 * MediaNode 媒体节点：图片/视频/音频展示与操作手柄
 * 统一外部常驻标题 + 独立圆角内容主体
 * 内容区尺度：图片/视频按真实比例（短边 280、长边 ≤840），音频恒 280×280 方形
 * ============================================ */
import { useState, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { Image, Video, RefreshCcw, Sparkles, AudioLines, Info, Download, AtSign, ImageOff, Plus, Check, Expand, Eraser } from 'lucide-react';
import { isMediaExtractNodeId } from '../../mediaExtract';
import type { ImageEnhanceIdentity } from '../../imageEnhance';
import { imageEraseGateReason } from '../../imageErase';
import { commitCardName } from '../cardName';
import { mediaNodeFailHeadline } from './failHeadline';
import { mediaNodeGenerationOverlay } from './generationOverlay';
import { mediaNodeToolbarVisibility } from './toolbarVisibility';
import { mediaContentBox, type MediaDims } from './mediaContentSize';
import ImageQualityMenu, { type ImageQualityMenuItem } from './ImageQualityMenu';
import { useSoloNodeSelected } from '../../useSoloNodeSelected';
import AudioPlayer from './AudioPlayer';
import { nodeTitleSizing } from '../nodeTitleSizing';
import CanvasContextMenu from '../CanvasContextMenu';
import styles from './index.module.css';

/** 连接点统一样式：透明背景（加号图标由 children 渲染） */
const HANDLE_STYLE = { background: 'transparent', border: 'none', width: 24, height: 24 } as const;

/** 加号连接点图标（ReactFlow Handle 的 children，替代默认圆点） */
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

/** 真实时长文案（秒取整）；未知或非正返回空串，标题右侧据此留空 */
const durationLabel = (duration?: number) =>
  typeof duration === 'number' && duration > 0 ? `${Math.round(duration)}s` : '';

/** 生成状态（IKDMQQ 起含 draft）：draft 待生成草稿；generating 进度展示；failed/cancelled 错误展示；无值为普通媒体 */
export type MediaGenStatus = 'draft' | 'generating' | 'failed' | 'cancelled';

interface MediaNodeData {
  src?: string;
  fileName?: string;
  mediaType?: 'image' | 'video' | 'audio';
  toolMode?: 'drag' | 'select';
  isFirst?: boolean;
  /** 关联生成任务ID（生成中的占位节点）。后端返回字符串，兼容 number 历史形态。 */
  jobId?: number | string;
  /** 生成状态：见 MediaGenStatus */
  genStatus?: MediaGenStatus;
  /** 草稿身份标记（IKDMQQ）：待生成/生成中/失败的草稿卡均为 true；成功后清除转为普通成品卡 */
  draft?: boolean;
  /** 草稿持久化参数（IKDMQQ）：面板编辑实时写回，随画布保存恢复 */
  draftModelId?: string;
  draftSize?: string;
  draftRatio?: string;
  /** 高清身份标记（IKGM9F）：本卡由「高清放大」入口创建；「重新编辑」据此分流高清面板（IKGM9O） */
  imageEnhance?: ImageEnhanceIdentity;
  /** 生成进度 0-100 */
  progress?: number;
  /** 失败原因 */
  errorText?: string;
  /** 生成时的提示词（「重新编辑」带回图片对话框） */
  prompt?: string;
  /** 资产 ID（上传完成后存储） */
  assetId?: string | number;
  /** 已绑定的素材库 id（asset- 前缀），用于入库去重 */
  materialId?: string;
  /** 空壳占位：待用户上传，不连线不成组无右键 */
  emptyShell?: boolean;
  /** 合规校验进行中 */
  complianceBusy?: boolean;
  /** 合规校验已通过（展示成功角标，随画布持久化） */
  compliancePassed?: boolean;
  /** 合规校验未通过（展示失败角标，随画布持久化） */
  complianceFailed?: boolean;
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
  /** IKFM3S §4：「输入已更新」派生标记（渲染期注入，不持久化）：来源文本输入变化未被成功使用 */
  inputStale?: boolean;
  /** IKFM3S §4：第一条文本入边的来源文本卡 id（徽标定位入口） */
  inputSourceNodeId?: string | null;
  /** IKFM3S §6：定位来源文本卡（平移居中 + 选中高亮） */
  onLocateInputSource?: (sourceNodeId: string) => void;
  /** IKFR4X 持续选取会话勾选标记（渲染期派生注入，不持久化）：已并入当前选取目标的来源 */
  pickMarked?: boolean;
  /** 视频选取会话中能力失效（如合规未通过）置灰 */
  pickBlocked?: boolean;
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
  /** 卡片改名（IKFA8X）：提交归一化后的新名称；自定义状态由父级置 data.customName */
  onTitleChange?: (id: string, name: string) => void;
  /** 重新编辑：打开图片对话框并带入提示词与图片 */
  onReEdit?: (id: string) => void;
  /** 生成图片：打开图片对话框并带入图片 */
  onGenImage?: (id: string) => void;
  /** 生成视频：打开视频对话框并带入图片 */
  onGenVideo?: (id: string) => void;
  /** 高清放大（IKGM9F）：在源卡右侧建「高清」草稿卡并连来源线（「高清 ▾」下拉「高清」项派发） */
  onEnhanceImage?: (id: string) => void;
  /** 擦除（IKGOT7）：把本卡置为擦除编辑态（「高清 ▾」下拉「擦除」项派发；门槛见 imageErase.ts） */
  onEraseImage?: (id: string) => void;
  /** 生成音频：打开音频对话框并带入图片 */
  onGenAudio?: (id: string) => void;
  /** 视频整段提取音频；音频节点由后端注入画布。 */
  onExtractAudio?: (id: string) => Promise<void> | void;
  /** 下载媒体文件 */
  onDownload?: (id: string) => void;
  /** 查看媒体资产详情 */
  onShowDetails?: (id: string) => void;
  onPaste?: (id: string) => void;
  onCopyImage?: (id: string) => void;
  onComplianceCheck?: (id: string) => void;
  onFillEmptyShell?: (id: string, file: File) => void;
  /** 图片生成节点：图生图上传本地素材 */
  onImg2Img?: (id: string, file: File) => void;
}

export default function MediaNode({ id, data, selected }: NodeProps & { data: MediaNodeData; selected?: boolean }) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isExtractSubmitting, setIsExtractSubmitting] = useState(false);
  const shellFileRef = useRef<HTMLInputElement>(null);
  /** 名称原位编辑（IKFA8X）：draft 为输入框内容；error 仅展示，不阻断画布保存 */
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');

  const zoom = useStore((state) => state.transform[2]);
  const isSelect = data.toolMode === 'select';
  const showSoloToolbar = useSoloNodeSelected(selected);

  /** 提交名称：去空格/空回退/超长拒绝/未变更跳过，细则见 cardName */
  const commitName = useCallback(() => {
    const result = commitCardName(nameDraft, data.fileName ?? '');
    if (result.kind === 'invalid') {
      setNameError(result.message);
      return;
    }
    setNameError('');
    setNameEditing(false);
    if (result.kind === 'save') data.onTitleChange?.(id, result.value);
  }, [data, id, nameDraft]);

  /** Esc 取消：恢复编辑前名称；输入框随即卸载，不会再有失焦提交 */
  const cancelName = useCallback(() => {
    setNameDraft(data.fileName ?? '');
    setNameError('');
    setNameEditing(false);
  }, [data.fileName]);

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

  const isEmptyShell = data.emptyShell === true;
  const isGenHost =
    data.draft === true
    || data.genStatus === 'draft'
    || data.genStatus === 'generating'
    || data.genStatus === 'failed'
    || data.genStatus === 'cancelled'
    || data.jobId != null;
  /** 上传素材只作出源，左侧不加号；生成节点（含图片草稿）一律接收入边。
   *  不按 isFirst 隐藏——首卡与其余卡同口径，否则草稿当画布第一张时无法被图片素材连入。 */
  const showTargetHandle = !isEmptyShell && isGenHost;
  const blockNodeMenu =
    isEmptyShell || data.genStatus === 'generating';

  /** 右键菜单：空壳 / 生成中不弹；草稿可弹（仅创建副本 / 删除） */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (data.toolMode !== 'select') return;
    e.preventDefault();
    e.stopPropagation();
    if (blockNodeMenu) return;
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [data.toolMode, blockNodeMenu]);

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

  const acceptShellFile = useCallback((file: File | undefined) => {
    if (!file) return;
    data.onFillEmptyShell?.(id, file);
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
  const handleEnhanceImage = useCallback(() => data.onEnhanceImage?.(id), [data, id]);
  const handleEraseImage = useCallback(() => data.onEraseImage?.(id), [data, id]);
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

  const isAudio = data.mediaType === 'audio';
  const Icon = data.mediaType === 'video' ? Video : isAudio ? AudioLines : Image;
  const toolbar = mediaNodeToolbarVisibility(data.mediaType);
  /** 「高清 ▾」下拉菜单项（IKGOT7，数组配置驱动）：「高清」行为与原「高清放大」单按钮完全一致；
   *  「擦除」按 imageErase 门槛预检置灰（title 悬停原因，尺寸 null 不拦）；
   *  扩图（IKGOQ0）后续在「高清」与「擦除」之间插入中间位——只改本数组 */
  const qualityMenuItems: ImageQualityMenuItem[] = [
    {
      id: 'enhance',
      label: '高清',
      icon: Expand,
      hint: '在右侧新建高清放大草稿卡',
      disabledReason: null,
      onSelect: handleEnhanceImage,
    },
    {
      id: 'erase',
      label: '擦除',
      icon: Eraser,
      hint: '涂抹或框选抹掉图中不要的内容',
      disabledReason: imageEraseGateReason(data),
      onSelect: handleEraseImage,
    },
  ];
  const isDraft = data.genStatus === 'draft';
  const isGenerating = data.genStatus === 'generating';
  const isGenDone = data.genStatus === 'failed' || data.genStatus === 'cancelled';
  /** IKDMQU Q5：有旧素材（有效 http 素材 src）的生成中卡片继续显示素材，仅叠加状态角标；
   *  blob 预览（上传中/占位 fixture）不算旧素材，走占位 genBox */
  const hasMediaSrc =
    typeof data.src === 'string' && data.src !== '' && !data.src.startsWith('blob:');
  const isMediaExtraction = isMediaExtractNodeId(id);
  const generationOverlay = mediaNodeGenerationOverlay(isMediaExtraction);
  const failHeadline = mediaNodeFailHeadline({
    genStatus: data.genStatus,
    errorText: data.errorText,
    isMediaExtraction,
  });

  const contentBox = mediaContentBox({
    mediaType: data.mediaType,
    width: data.width,
    height: data.height,
    ratio: data.targetRatio,
  });

  /** 标题右侧元信息：仅真实媒体数据，缺失项留空；目标比例/占位尺寸不展示，文件大小只在详情。
   *  音频无可视分辨率，只显真实时长；图片/视频显分辨率，视频另加时长。 */
  const titleMeta = isAudio
    ? durationLabel(data.duration)
    : [
        data.width && data.height ? `${data.width}×${data.height}` : '',
        data.mediaType === 'video' ? durationLabel(data.duration) : '',
      ]
        .filter(Boolean)
        .join(' ');

  /** 生成中 / 失败 / 素材缺失占位（音频与图片/视频共用内部内容） */
  const renderPlaceholder = () => {
    if (isDraft) {
      const isImageDraft = data.mediaType === 'image';
      const isVideoDraft = data.mediaType === 'video';
      // 高清草稿（IKGM9F）专属占位文案；参数面板由 IKGM9O 接入
      const draftHint = isImageDraft && data.imageEnhance
        ? '配置参数生成高清图像'
        : isVideoDraft ? '视频生成' : isImageDraft ? '图片生成' : '待生成';
      return (
        <div className={styles.genBox}>
          {isVideoDraft ? <Video size={22} strokeWidth={1.8} color="#666" /> : <Image size={22} strokeWidth={1.8} color="#666" />}
          <span className={styles.missingText}>{draftHint}</span>
        </div>
      );
    }
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
    <div
      className={`${styles.wrapper} ${selected ? styles.selected : ''} ${data.pickBlocked ? styles.pickBlocked : ''}`}
      data-media-type={data.mediaType ?? 'image'}
      onContextMenu={handleContextMenu}
      style={{ ...nodeTitleSizing(zoom), width: contentBox.width }}
    >
      {/* 选中态悬浮工具条：重新编辑/生成图片/生成视频/生成音频 + 详情/下载/@（位于外部标题上方） */}
      {showSoloToolbar && !data.genStatus && !data.assetMissing && !isEmptyShell && (
        <div className={`nodrag nopan ${styles.toolbar}`} onMouseDown={stop}>
          <button className={styles.toolBtn} onClick={handleReEdit} title="带入原提示词与图片，打开图片对话框">
            <RefreshCcw size={14} strokeWidth={2} />
            <span>重新编辑</span>
          </button>
          {toolbar.genImage && (
            <button className={styles.toolBtn} onClick={handleGenImage} title="新建图片草稿并以本图为参考">
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
          {toolbar.imageQuality && (
            <ImageQualityMenu items={qualityMenuItems} />
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

      {/* 外部常驻标题 + 独立圆角内容主体（三类媒体共用；音频内容区恒方形） */}
      <div className={styles.titleRow} data-testid="media-title">
        <div className={styles.titleLeft}>
          <Icon className={styles.titleIcon} strokeWidth={2} color="#888" />
          {nameEditing ? (
            <input
              className="nodrag nopan"
              aria-label="卡片名称"
              value={nameDraft}
              autoFocus
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => {
                // 名称输入期间隔离画布快捷键；输入法组合中的回车只确认候选词，不提交名称
                event.stopPropagation();
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commitName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelName();
                }
              }}
            />
          ) : (
            <span
              className={styles.titleName}
              title={data.fileName || undefined}
              onDoubleClick={(event) => {
                // 原位编辑，不触发节点双击居中放大
                event.stopPropagation();
                if (!data.onTitleChange) return;
                setNameDraft(data.fileName ?? '');
                setNameError('');
                setNameEditing(true);
              }}
            >
              {data.fileName || (isEmptyShell ? (data.mediaType === 'video' ? '视频节点' : data.mediaType === 'audio' ? '音频节点' : '图片节点') : '')}
            </span>
          )}
          {data.complianceBusy ? (
            <span className={`nodrag nopan ${styles.complianceBadge}`} title="校验中">
              <span className={styles.complianceSpinner} />
            </span>
          ) : data.compliancePassed ? (
            <span className={`nodrag nopan ${styles.complianceBadge}`} title="校验通过，可用于seedance2.0视频生成">
              <img src="/success.png" alt="" />
            </span>
          ) : data.complianceFailed ? (
            <span className={`nodrag nopan ${styles.complianceFailedText}`} title="seedance2.0合规校验失败，不可用于视频生成">
              审核失败
            </span>
          ) : null}
        </div>
        <span className={styles.titleMeta} title={titleMeta || undefined}>{titleMeta}</span>
      </div>
      {/* IKFM3S §4：文本输入更新徽标（卡片右上角显眼提示；点击定位来源文本卡）。
          放标题行外层避免 titleRow overflow 裁剪。 */}
      {data.inputStale === true && (
        <button
          type="button"
          className={`nodrag nopan ${styles.inputStaleBadge}`}
          data-testid="input-stale-badge"
          title="输入已更新：来源文本已修改，重新生成以使用最新输入"
          onClick={(event) => {
            event.stopPropagation();
            if (data.inputSourceNodeId) data.onLocateInputSource?.(data.inputSourceNodeId);
          }}
        >
          输入已更新
        </button>
      )}
      {/* IKFR4X 持续选取会话勾选标识：已并入当前目标的来源节点，卡片右上角绿底白勾（纯展示不挡点击） */}
      {data.pickMarked === true && (
        <span
          className={`nodrag nopan ${styles.pickMarkedBadge}`}
          data-testid="pick-mark-badge"
          title="已加入当前参考"
        >
          <Check size={12} strokeWidth={3} />
        </span>
      )}
      {nameError && <div role="alert" className="nodrag nopan">{nameError}</div>}
      <div className={`${styles.contentCard} ${isAudio ? styles.audioCard : ''}`} data-testid="media-content" style={{ width: contentBox.width, height: contentBox.height }}>
        {showTargetHandle && (
          <Handle type="target" position={Position.Left} className={styles.handle} style={{ ...HANDLE_STYLE, left: '-16px' }}>
          <HandlePlus />
        </Handle>
        )}
        {isEmptyShell ? (
          <button
            type="button"
            className={`${styles.emptyShell} nodrag nopan`}
            onClick={() => shellFileRef.current?.click()}
          >
            <Icon size={22} strokeWidth={1.8} color="#888" />
            <span className={styles.emptyShellHint}>点击上传素材</span>
            <input
              ref={shellFileRef}
              type="file"
              hidden
              accept={
                data.mediaType === 'video'
                  ? 'video/*'
                  : data.mediaType === 'audio'
                    ? 'audio/*'
                    : 'image/*'
              }
              onChange={(e) => {
                acceptShellFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </button>
        ) : isDraft || (isGenDone && !hasMediaSrc) || data.assetMissing || (isGenerating && !hasMediaSrc) ? (
          renderPlaceholder()
        ) : isAudio ? (
          <AudioPlayer src={data.src || ''} fileName={data.fileName} onDownload={() => data.onDownload?.(id)} />
        ) : data.mediaType === 'video' ? (
          <video
            className={styles.mediaVideo}
            src={data.src}
            controls={isSelect}
            preload="metadata"
            disablePictureInPicture
            disableRemotePlayback
            controlsList="nodownload noplaybackrate noremoteplayback nopictureinpicture"
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
        {isGenerating && hasMediaSrc && (
          <div className={`nodrag nopan ${styles.regenOverlay}`} data-testid="regen-overlay">
            <span className={styles.regenSpinner} />
            <span className={styles.regenText}>
              重新生成中{typeof data.progress === 'number' ? ` ${data.progress}%` : ''}
            </span>
            <button className={styles.regenCancel} onClick={() => data.onCancelJob?.(id)}>
              取消
            </button>
          </div>
        )}
        {/* IKDMQV：重新生成失败/取消的成品卡——旧素材继续显示，底部角标呈现原因与重试。
            重试沿用失败任务冻结快照（retry 接口）；修改参数或引用后新生成走面板「生成」（新任务新快照）。 */}
        {isGenDone && hasMediaSrc && (
          <div className={`nodrag nopan ${styles.regenOverlay}`} data-testid="fail-overlay">
            <span className={styles.failOverlayText} title={failHeadline}>{failHeadline}</span>
            {data.genStatus === 'failed' && !isMediaExtraction && (
              <button className={styles.regenCancel} onClick={() => data.onRetryJob?.(id)}>
                重试
              </button>
            )}
          </div>
        )}
        {!isEmptyShell && !isDraft && (
        <Handle type="source" position={Position.Right} className={styles.handle} style={{ ...HANDLE_STYLE, right: '-16px' }}>
        <HandlePlus />
      </Handle>
        )}
      </div>

      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={isDraft
            ? [
                { key: 'duplicate', label: '创建副本' },
                { key: 'delete', label: '删除', danger: true },
              ]
            : [
                { key: 'chat', label: '添加到聊天' },
                ...(isAudio
                  ? []
                  : [{
                      key: 'compliance',
                      label: 'Seedance合规校验',
                      loading: data.complianceBusy,
                      disabled: data.assetMissing === true,
                    }]),
                { key: 'duplicate', label: '创建副本' },
                { key: 'delete', label: '删除', danger: true },
              ]}
          onClose={() => setContextMenu(null)}
          onSelect={(key) => {
            setContextMenu(null);
            if (key === 'chat') handleAddToChat();
            else if (key === 'compliance') data.onComplianceCheck?.(id);
            else if (key === 'duplicate') handleDuplicate();
            else if (key === 'delete') handleDelete();
          }}
        />
      )}
    </div>
  );
}
