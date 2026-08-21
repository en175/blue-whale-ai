/* ============================================
 * ImageDialog 图片对话窗口：参考图上传/模型/清晰度/比例配置
 * ============================================ */
import { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  ChevronDown,
  Sparkles,
  Maximize2,
  SlidersHorizontal,
  ArrowUp,
  Upload,
  MousePointerClick,
  Image as ImageIcon,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import styles from './index.module.css';

/** 接口失败时参考图上限回退值（IKA715：与后端/网关缺省 10 对齐） */
const FALLBACK_MAX_IMAGES = 10;

/** 视频最大上传数量（接口未下发该字段，前端统一 3） */
const MAX_INPUT = 500;

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

/** 模型选项（接口失败回退） */
const FALLBACK_MODELS = [
  { key: 'seedream5lite', label: 'Seedream 5.0 Lite' },
  { key: 'seedream5pro', label: 'Seedream 5.0 Pro' },
  { key: 'seedream45', label: 'Seedream 4.5' },
  { key: 'gptimage2', label: 'gpt-image-2' },
];

/** 清晰度选项（接口失败回退） */
const FALLBACK_RESOLUTIONS = [
  { key: '2K', label: '2K' },
  { key: '3K', label: '3K' },
  { key: '4K', label: '4K' },
];

/** 宽高比选项（接口失败回退） */
const FALLBACK_RATIOS = [
  '9:16', '3:4', '1:1', '4:3', '16:9', '2:3', '3:2', '21:9',
];

interface ImageDialogProps {
  onClose: () => void;
  /** 发送：提示词 + 模型ID + 分辨率档位 id（如 2k） + 宽高比 + 参考素材列表（异步：上传完成后 resolve） */
  onSend: (text: string, modelId: string, size: string, ratio: string, files: UploadedFile[]) => Promise<void> | void;
  /** 初始提示词（节点「重新编辑」带入原生成提示词） */
  initialText?: string;
  /** 初始参考素材（节点操作带入被点节点图片） */
  initialFiles?: UploadedFile[];
  /** 到节点选择：进入画布图片节点选取模式 */
  onPickFromCanvas?: () => void;
  /** 画布选取模式进行中（左上角图标高亮提示） */
  pickMode?: boolean;
  /** 画布节点选取结果（ts 驱动注入参考素材） */
  externalPick?: { ts: number; file: UploadedFile } | null;
}

/** 宽高比图标：按比例绘制小矩形 */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const max = 16;
  const width = w >= h ? max : Math.round((w / h) * max);
  const height = h >= w ? max : Math.round((h / w) * max);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}

export default function ImageDialog({ onClose, onSend, initialText, initialFiles, onPickFromCanvas, pickMode, externalPick }: ImageDialogProps) {
  const [inputValue, setInputValue] = useState(initialText ?? '');
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(FALLBACK_MODELS[0].key);
  const [selectedResolution, setSelectedResolution] = useState(FALLBACK_RESOLUTIONS[0].key);
  const [selectedRatio, setSelectedRatio] = useState('16:9');
  const [showConfig, setShowConfig] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>(initialFiles ?? []);
  /** 左上角图标弹菜单：图片上传 / 到节点选择 */
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  /** 上传中状态：禁用发送按钮和输入框 */
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 画布节点选取结果注入参考素材（去重 + 上限保护） */
  useEffect(() => {
    if (!externalPick) return;
    setFiles((prev) => {
      const imgCount = prev.filter((f) => f.type === 'image').length;
      const vidCount = prev.filter((f) => f.type === 'video').length;
      const full =
        externalPick.file.type === 'image' ? imgCount >= maxImages : vidCount >= MAX_VIDEOS;
      if (prev.some((f) => f.id === externalPick.file.id) || full) return prev;
      return [...prev, externalPick.file];
    });
  }, [externalPick]);

  /** 接口数据优先，失败回退本地选项 */
  const modelOptions = modelList.length
    ? modelList.map((m) => ({ key: m.model_id, label: m.model_label }))
    : FALLBACK_MODELS;
  const currentGen = modelList.find((m) => m.model_id === selectedModel);
  const resolutionOptions = currentGen?.supported_sizes?.length
    ? currentGen.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : FALLBACK_RESOLUTIONS;
  const ratioOptions = currentGen?.supported_aspect_ratios?.length
    ? currentGen.supported_aspect_ratios
    : FALLBACK_RATIOS;
  const currentModel = modelOptions.find((m) => m.key === selectedModel);
  const currentResolutionLabel =
    resolutionOptions.find((r) => r.key === selectedResolution)?.label ?? selectedResolution;
  const imageCount = files.filter((f) => f.type === 'image').length;
  const videoCount = files.filter((f) => f.type === 'video').length;
  /** 参考图上限采用接口定义的 max_reference_images（失败回退本地值） */
  const maxImages = currentGen?.features?.max_reference_images ?? FALLBACK_MAX_IMAGES;
  const imagesFull = imageCount >= maxImages;
  const videosFull = videoCount >= MAX_VIDEOS;

  /** 选中模型后应用其默认清晰度/宽高比 */
  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    if (m.supported_aspect_ratios.length) {
      setSelectedRatio(
        m.default_aspect_ratio && m.supported_aspect_ratios.includes(m.default_aspect_ratio)
          ? m.default_aspect_ratio
          : m.supported_aspect_ratios[0],
      );
    }
    if (m.supported_sizes.length) {
      setSelectedResolution(
        m.default_size && m.supported_sizes.some((s) => s.id === m.default_size)
          ? (m.default_size as string)
          : m.supported_sizes[0].id,
      );
    }
  };

  // 加载图片模型能力列表
  useEffect(() => {
    fetchGenerationModels('image')
      .then((list) => {
        setModelList(list);
        if (list.length) applyModelDefaults(list[0]);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点击加号触发文件选择 */
  const handleAddClick = () => fileInputRef.current?.click();

  /** 选择文件（按类型剩余名额截断：图片走接口上限，视频最多 3） */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    if (list.length === 0) return;
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

  /** 发送（清晰度传分辨率档位 id，对应生成接口 parameters.size） */
  const handleSend = async () => {
    if (!inputValue.trim() || uploading) return;
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
    <div className={styles.dialog}>
      {/* 配置面板（可展开/收起） */}
      {showConfig && (
        <div className={styles.configPanel}>
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
              <div className={styles.selectWrap}>
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

              <div className={styles.selectWrap}>
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
                        onClick={() => { setSelectedResolution(r.key); setResOpen(false); }}
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
            <div className={styles.sourceWrap}>
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
            <button className={styles.iconBtn} title="展开">
              <Maximize2 size={14} strokeWidth={2} />
            </button>
            <button className={styles.iconBtn} onClick={onClose} title="关闭">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 输入框 */}
        <textarea
          className={styles.textarea}
          placeholder={uploading ? '正在上传参考图...' : '描述你希望如何编辑这张图片...'}
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
            {!(imagesFull && videosFull) && (
              <button
                className={styles.addBtn}
                onClick={handleAddClick}
                title={`上传图片（最多 ${maxImages} 张）/ 视频（最多 ${MAX_VIDEOS} 个）`}
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={imagesFull ? 'video/*' : videosFull ? 'image/*' : 'image/*,video/*'}
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

          {/* 右侧：消耗展示 + 发送按钮 */}
          <div className={styles.barRight}>
            <span className={styles.costText}>
              <Sparkles size={14} strokeWidth={2} />
              <span>0.2 生成</span>
            </span>
            <button
              className={`${styles.sendBtn} ${inputValue.trim() && !uploading ? styles.sendBtnActive : ''}`}
              onClick={handleSend}
              disabled={!inputValue.trim() || uploading}
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
