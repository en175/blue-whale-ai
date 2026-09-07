/* ============================================
 * ImageDialog 图片对话窗口：参考图上传/模型/清晰度/比例配置
 * ============================================ */
import { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  ArrowUp,
  Upload,
  MousePointerClick,
  FolderOpen,
  Image as ImageIcon,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { pickRatioForSize, ratiosForSelectedSize } from '@/lib/image-size-ratios';
import { REF_LIMITS, refOverflowToast } from '@/utils/ref-overflow';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import styles from './index.module.css';

/** 输入框字数上限 */
const MAX_INPUT = 1000;

/** 视频最大上传数量（接口未下发该字段，前端统一 3） */
const MAX_VIDEOS = 3;

export interface UploadedFile {
  id: string;
  url: string;
  type: 'image' | 'video';
  name: string;
  /** 原始 File 对象（用户本地选择时携带，用于上传获取 assetId） */
  file?: File;
  /** 已有资产 ID（画布节点选取时携带，直接作为 input_asset_ids） */
  assetId?: string | number;
}

/** 连线文本附件（IKDLQF）：目标图片节点经连线带入的 textNode 正文快照，面板只读展示 */
export interface ImageTextAttachment {
  /** 来源文本节点 id */
  nodeId: string;
  /** 来源节点标题 */
  title: string;
  /** 当次正文 */
  text: string;
}

/** 附件正文超过该长度默认折叠（可展开读全） */
const ATTACHMENT_COLLAPSE_LENGTH = 120;

interface ImageDialogProps {
  onClose: () => void;
  /** 发送：提示词 + 模型ID + 分辨率档位 id（如 2k） + 宽高比 + 参考素材列表（异步：上传完成后 resolve） */
  onSend: (text: string, modelId: string, size: string, ratio: string, files: UploadedFile[]) => Promise<void> | void;
  /** 初始提示词（节点「重新编辑」带入原生成提示词） */
  initialText?: string;
  /** 初始参考素材（节点操作带入被点节点图片） */
  initialFiles?: UploadedFile[];
  /** 初始生成参数（首页 AI图片 带入：选中首页所选的模型/清晰度/宽高比） */
  initialParams?: ImageGenSeedParams;
  /** 连线文本附件（IKDLQF）：仅图片媒体节点面板发起时携带，打开当下快照，只读展示 */
  attachments?: ImageTextAttachment[];
  /** 调整文本附件顺序（IKDLQH）：回调携带重排后来源 nodeId 序列；仅多附件时展示控件，缺省不渲染排序入口 */
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
  /** 到节点选择：进入画布图片节点选取模式 */
  onPickFromCanvas?: () => void;
  /** 从资产中选择：打开资产库选择弹窗（仅图片） */
  onPickFromAssets?: () => void;
  /** 画布选取模式进行中（左上角图标高亮提示） */
  pickMode?: boolean;
  /** 外部注入参考素材（ts 驱动；画布节点单选 / 角色库多选，files 为一批） */
  externalPick?: { ts: number; files: UploadedFile[] } | null;
  /** 打开角色库弹窗 */
  onOpenCharacterLibrary?: () => void;
  /** Toast 提示（上传超限等场景，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

/** 首页带入的初始生成参数（各字段经模型能力校验后应用，不在能力内的项回退模型默认值） */
export interface ImageGenSeedParams {
  /** 模型ID */
  modelId?: string;
  /** 宽高比（如 16:9） */
  ratio?: string;
  /** 分辨率档位 id（如 2k） */
  size?: string;
}

/** 宽高比图标：按比例绘制小矩形 */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const max = 16;
  const width = w >= h ? max : Math.round((w / h) * max);
  const height = h >= w ? max : Math.round((h / w) * max);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}

/** 连线文本附件项：标题 + 正文预览，长文默认折叠可展开；多附件且父级提供重排回调时展示上移/下移（IKDLQH） */
function AttachmentItem({ attachment, move }: {
  attachment: ImageTextAttachment;
  move?: { isFirst: boolean; isLast: boolean; onMove: (delta: -1 | 1) => void };
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = attachment.text.length > ATTACHMENT_COLLAPSE_LENGTH;
  return (
    <div className={styles.attachmentItem}>
      <div className={styles.attachmentHead}>
        <span className={styles.attachmentTitle}>{attachment.title}</span>
        {move && (
          <span className={styles.attachmentMoves}>
            <button
              type="button"
              title="上移"
              className={styles.attachmentMove}
              disabled={move.isFirst}
              onClick={() => move.onMove(-1)}
            >
              <ChevronUp size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              title="下移"
              className={styles.attachmentMove}
              disabled={move.isLast}
              onClick={() => move.onMove(1)}
            >
              <ChevronDown size={12} strokeWidth={2} />
            </button>
          </span>
        )}
      </div>
      <span
        className={`${styles.attachmentText} ${collapsible && !expanded ? styles.attachmentTextCollapsed : ''}`}
      >
        {attachment.text}
      </span>
      {collapsible && (
        <button
          type="button"
          className={styles.attachmentToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  );
}

export default function ImageDialog({ onClose, onSend, initialText, initialFiles, initialParams, attachments, onReorderAttachments, onPickFromCanvas, onPickFromAssets, pickMode, externalPick, onToast }: ImageDialogProps) {
  const [inputValue, setInputValue] = useState(initialText ?? '');
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedResolution, setSelectedResolution] = useState('');
  const [selectedRatio, setSelectedRatio] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>(initialFiles ?? []);
  /** 左上角图标弹菜单：图片上传 / 到节点选择 */
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  /** 上传中状态：禁用发送按钮和输入框 */
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const resWrapRef = useRef<HTMLDivElement>(null);
  const sourceWrapRef = useRef<HTMLDivElement>(null);
  const configPanelRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: resOpen, ref: resWrapRef, dismiss: () => setResOpen(false) },
    { open: sourceMenuOpen, ref: sourceWrapRef, dismiss: () => setSourceMenuOpen(false) },
    { open: showConfig, ref: configPanelRef, dismiss: () => setShowConfig(false) },
  ]);

  /** 外部注入参考素材（画布节点选取/角色库多选；去重 + 上限保护） */
  useEffect(() => {
    if (!externalPick) return;
    setFiles((prev) => {
      let next = prev;
      for (const file of externalPick.files) {
        const imgCount = next.filter((f) => f.type === 'image').length;
        const vidCount = next.filter((f) => f.type === 'video').length;
        const full = file.type === 'image' ? imgCount >= maxImages : vidCount >= MAX_VIDEOS;
        if (full) {
          onToast?.('warn', refOverflowToast([file.type], { image: maxImages, video: MAX_VIDEOS }));
          break;
        }
        if (next.some((f) => f.id === file.id)) continue;
        next = [...next, file];
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPick]);

  /** 能力选项全部取自接口（无本地写死兜底）：模型列表未加载完时为空 */
  const modelOptions = modelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  const currentGen = modelList.find((m) => m.model_id === selectedModel);
  const resolutionOptions = currentGen?.supported_sizes?.length
    ? currentGen.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : [];
  const ratioOptions = currentGen ? ratiosForSelectedSize(currentGen, selectedResolution) : [];
  const currentModel = modelOptions.find((m) => m.key === selectedModel);
  const currentResolutionLabel =
    resolutionOptions.find((r) => r.key === selectedResolution)?.label ?? selectedResolution;
  const imageCount = files.filter((f) => f.type === 'image').length;
  /** 参考图上限固定 9 张（产品约定），不随模型能力接口的 max_reference_images 波动 */
  const maxImages = REF_LIMITS.image;
  const imagesFull = imageCount >= maxImages;
  /** 附件正文有效（去空白非空）时允许空提示词提交（IKDLQF 契约：附件可单独驱动生成）；
   *  全部有效文本为空时沿用「提示词必填」 */
  const hasAttachmentText = (attachments ?? []).some((a) => a.text.trim().length > 0);
  const canSend = !uploading && (inputValue.trim().length > 0 || hasAttachmentText);

  /** 选中模型后应用其默认清晰度/宽高比 */
  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    const nextSize =
      m.default_size && m.supported_sizes.some((s) => s.id === m.default_size)
        ? m.default_size
        : (m.supported_sizes[0]?.id ?? '');
    if (m.supported_sizes.length) setSelectedResolution(nextSize);
    setSelectedRatio(pickRatioForSize(m, nextSize, m.default_aspect_ratio));
  };

  // 加载图片模型能力列表：优先选中首页带入的模型，参数逐项按模型能力校验后应用
  useEffect(() => {
    fetchGenerationModels('image')
      .then((list) => {
        setModelList(list);
        if (!list.length) return;
        const target =
          (initialParams?.modelId && list.find((m) => m.model_id === initialParams.modelId)) ||
          list[0];
        applyModelDefaults(target);
        // 首页带入参数覆盖默认值（逐项经模型能力校验，不合法项保持该模型默认值）
        if (initialParams) {
          const nextSize =
            initialParams.size && target.supported_sizes.some((s) => s.id === initialParams.size)
              ? initialParams.size
              : target.default_size && target.supported_sizes.some((s) => s.id === target.default_size)
                ? target.default_size
                : target.supported_sizes[0]?.id;
          if (nextSize) setSelectedResolution(nextSize);
          const allowed = ratiosForSelectedSize(target, nextSize ?? '');
          if (initialParams.ratio && allowed.includes(initialParams.ratio)) {
            setSelectedRatio(initialParams.ratio);
          }
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时释放本地 objectURL（首页 seed 与本地上传；画布节点带入无 file 不释放）。
  // 首页交接的 url 由这里负责：firePendingGen 提交任务后不再提前 revoke，
  // 否则对话框里还在显示的缩略图当场失效。
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(
    () => () => {
      filesRef.current.forEach((f) => {
        if (f.file) URL.revokeObjectURL(f.url);
      });
    },
    [],
  );

  /** 点击加号触发文件选择 */
  const handleAddClick = () => fileInputRef.current?.click();

  /** 选择文件（按类型剩余名额截断：图片走接口上限，视频最多 3；超限 toast 提示） */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    if (list.length === 0) return;
    const selImages = list.filter((f) => f.type.startsWith('image/')).length;
    const selVideos = list.filter((f) => f.type.startsWith('video/')).length;
    setFiles((prev) => {
      let imgRoom = maxImages - prev.filter((f) => f.type === 'image').length;
      let vidRoom = MAX_VIDEOS - prev.filter((f) => f.type === 'video').length;
      const added: UploadedFile[] = [];
      for (const f of list) {
        const isVideo = f.type.startsWith('video/');
        if (isVideo ? vidRoom <= 0 : imgRoom <= 0) continue;
        if (isVideo) vidRoom -= 1;
        else imgRoom -= 1;
        added.push({
          id: `${Date.now()}-${added.length}`,
          url: URL.createObjectURL(f),
          type: isVideo ? 'video' : 'image',
          name: f.name,
          file: f,
        });
      }
      // 选中了但没被接受 = 超限丢弃，toast 提示（与 BottomDialog/卡片同措辞）
      const accImages = added.filter((f) => f.type === 'image').length;
      const accVideos = added.filter((f) => f.type === 'video').length;
      if (selImages - accImages > 0 || selVideos - accVideos > 0) {
        onToast?.('warn', refOverflowToast(
          selImages - accImages > 0 ? ['image'] : [],
          { image: maxImages },
        ) + (selVideos - accVideos > 0 ? `（仅支持图片）` : ''));
      }
      return [...prev, ...added];
    });
    e.target.value = '';
  };

  /** 移除已上传素材 */
  const handleRemoveFile = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((f) => f.id !== id);
    });
  };

  /** 附件排序（IKDLQH）：与相邻项交换后把新 nodeId 序列交给父级；列表仍渲染自 props（父级同步同序快照） */
  const handleAttachmentMove = (index: number, delta: -1 | 1) => {
    if (!attachments || !onReorderAttachments) return;
    const ids = attachments.map((a) => a.nodeId);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    onReorderAttachments(ids);
  };

  /** 发送（清晰度传分辨率档位 id，对应生成接口 parameters.size） */
  const handleSend = async () => {
    if (!canSend) return;
    if (!currentGen) {
      console.warn('图片模型能力加载中，请稍后重试');
      return;
    }
    setUploading(true);
    try {
      await onSend(inputValue, selectedModel, selectedResolution, selectedRatio, files);
      setInputValue('');
    } finally {
      setUploading(false);
    }
  };

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {/* 配置面板（可展开/收起） */}
      {showConfig && (
        <div className={styles.configPanel} ref={configPanelRef}>
          {/* 关闭按钮 */}
          <button
            className={styles.configCloseBtn}
            onClick={() => setShowConfig(false)}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </button>
          {/* 模型与质量：两个选择器同一行 */}
          <div className={styles.configSection}>
            <span className={styles.configLabel}>模型与质量</span>
            <div className={styles.configRow}>
              <div className={styles.selectWrap} ref={modelWrapRef}>
                <button
                  className={styles.selectBtn}
                  onClick={() => { setModelOpen(!modelOpen); setResOpen(false); }}
                >
                  <span>{currentModel?.label ?? '选择模型'}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={`${styles.configArrow} ${modelOpen ? styles.configArrowUp : ''}`}
                  />
                </button>
                {modelOpen && (
                  <div className={styles.selectDropdown}>
                    {modelOptions.map((m) => (
                      <button
                        key={m.key}
                        className={`${styles.selectOption} ${m.key === selectedModel ? styles.selectOptionActive : ''}`}
                        onClick={() => {
                          const gen = modelList.find((x) => x.model_id === m.key);
                          if (gen) applyModelDefaults(gen);
                          else setSelectedModel(m.key);
                          setModelOpen(false);
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.selectWrap} ref={resWrapRef}>
                <button
                  className={styles.selectBtn}
                  onClick={() => { setResOpen(!resOpen); setModelOpen(false); }}
                >
                  <span>{currentResolutionLabel}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={`${styles.configArrow} ${resOpen ? styles.configArrowUp : ''}`}
                  />
                </button>
                {resOpen && (
                  <div className={styles.selectDropdown}>
                    {resolutionOptions.map((r) => (
                      <button
                        key={r.key}
                        className={`${styles.selectOption} ${r.key === selectedResolution ? styles.selectOptionActive : ''}`}
                        onClick={() => {
                          setSelectedResolution(r.key);
                          if (currentGen) setSelectedRatio(pickRatioForSize(currentGen, r.key, selectedRatio));
                          setResOpen(false);
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 宽高比 */}
          <div className={styles.configSection}>
            <span className={styles.configLabel}>宽高比</span>
            <div className={styles.ratioGroup}>
              {ratioOptions.map((r) => (
                <button
                  key={r}
                  className={`${styles.ratioBtn} ${r === selectedRatio ? styles.ratioBtnActive : ''}`}
                  onClick={() => setSelectedRatio(r)}
                >
                  <RatioIcon ratio={r} />
                  <span>{r}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 输入卡片 */}
      <div className={styles.inputBox}>
        {/* 顶部：素材预览 + 右上角操作 */}
        <div className={styles.topRow}>
          <div className={styles.previewRow}>
            {/* 左上角图标：点击弹出「图片上传 / 到节点选择」（图片达上限隐藏） */}
            {!imagesFull && (
            <div className={styles.sourceWrap} ref={sourceWrapRef}>
              <button
                className={`${styles.previewItem} ${styles.previewPlaceholder} ${pickMode ? styles.previewPicking : ''}`}
                onClick={() => setSourceMenuOpen((v) => !v)}
                title="图片上传 / 到节点选择"
              >
                <ImageIcon size={18} strokeWidth={2} />
              </button>
              {sourceMenuOpen && (
                <>
                  <div className={styles.menuOverlay} onClick={() => setSourceMenuOpen(false)} />
                  <div className={styles.sourceMenu}>
                    <button
                      className={styles.sourceMenuItem}
                      onClick={() => { setSourceMenuOpen(false); fileInputRef.current?.click(); }}
                    >
                      <Upload size={14} strokeWidth={2} />
                      <span>图片上传</span>
                    </button>
                    <button
                      className={styles.sourceMenuItem}
                      onClick={() => { setSourceMenuOpen(false); onPickFromAssets?.(); }}
                    >
                      <FolderOpen size={14} strokeWidth={2} />
                      <span>从资产中选择</span>
                    </button>
                    <button
                      className={styles.sourceMenuItem}
                      onClick={() => { setSourceMenuOpen(false); onPickFromCanvas?.(); }}
                    >
                      <MousePointerClick size={14} strokeWidth={2} />
                      <span>到节点选择</span>
                    </button>
                  </div>
                </>
              )}
            </div>
            )}
            {files.map((f) => (
              <div key={f.id} className={styles.previewItem} title={f.name}>
                {f.type === 'video' ? (
                  <video src={f.url} muted preload="metadata" />
                ) : (
                  <img src={f.url} alt={f.name} />
                )}
                <button
                  className={styles.previewRemove}
                  onClick={() => handleRemoveFile(f.id)}
                  title="移除"
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>

          <div className={styles.topActions}>
            <button
              className={styles.iconBtn}
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起' : '展开'}
            >
              {expanded ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
            </button>
            <button className={styles.iconBtn} onClick={onClose} title="关闭">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 连线文本附件（IKDLQF）：只读展示，增删通过画布连线建立/断开进行；多附件可上移/下移排序（IKDLQH） */}
        {attachments && attachments.length > 0 && (
          <div className={styles.attachments}>
            <span className={styles.configLabel}>文本附件（{attachments.length}）</span>
            {attachments.map((a, i) => (
              <AttachmentItem
                key={a.nodeId}
                attachment={a}
                move={
                  onReorderAttachments && attachments.length > 1
                    ? {
                        isFirst: i === 0,
                        isLast: i === attachments.length - 1,
                        onMove: (delta) => handleAttachmentMove(i, delta),
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* 输入框 */}
        <textarea
          className={styles.textarea}
          placeholder={uploading ? '正在上传参考图...' : `描述你希望如何编辑这张图片。图片最多 ${maxImages} 张。`}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.slice(0, MAX_INPUT))}
          onKeyDown={handleKeyDown}
          rows={3}
          maxLength={MAX_INPUT}
          disabled={uploading}
        />

        {/* 字数统计 */}
        <div className={`${styles.charCount} ${inputValue.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
          {inputValue.length}/{MAX_INPUT}
        </div>

        {/* 底部状态栏 */}
        <div className={styles.bottomBar}>
          {/* 左侧 */}
          <div className={styles.barLeft}>
            {!imagesFull && (
              <button
                className={styles.addBtn}
                onClick={handleAddClick}
                title={`上传图片（最多 ${maxImages} 张）`}
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className={styles.hiddenInput}
              onChange={handleFileSelect}
            />

            <button
              className={styles.configBtn}
              onClick={() => setShowConfig(!showConfig)}
            >
              <SlidersHorizontal size={14} strokeWidth={2} />
              <span>{currentModel?.label ?? '选择模型'}</span>
              <span className={styles.barDivider} />
              <span>{selectedRatio}</span>
              <span className={styles.barDivider} />
              <span>{currentResolutionLabel}</span>
            </button>
          </div>

          {/* 右侧：发送按钮 */}
          <div className={styles.barRight}>
            <button
              className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
              onClick={handleSend}
              disabled={!canSend}
              title={uploading ? '上传中...' : '发送'}
            >
              <ArrowUp size={16} fill="currentColor" strokeWidth={0} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
