/* ============================================
 * AudioDialog 音频生成底部对话框：纯文本描述 + 真实模型（fetchGenerationModels('audio')）
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { X, AudioLines, ChevronDown, Music, ArrowUp, Maximize2, Minimize2 } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import type { MediaGenStatus } from '../MediaNode';
import styles from './index.module.css';

/** 输入框字数上限 */
const MAX_INPUT = 1000;

/** 参考素材类型（保留给 MusicDialog 共享类型） */
type RefKind = 'audio' | 'image';

/** 参考项（保留给 MusicDialog 共享类型） */
export interface AudioRefItem {
  id: string;
  kind: RefKind;
  name: string;
  src: string;
  source: 'local' | 'canvas';
  /** 画布节点选取带入的资产 ID（有则发送时直接复用，跳过上传） */
  assetId?: string | number;
  /** 本地上传保留原始 File（发送时走三步上传换取 assetId） */
  file?: File;
}

/** 画布可选媒体节点（保留给 MusicDialog 共享类型） */
export interface CanvasPickItem {
  id: string;
  src: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
}

interface AudioDialogProps {
  onClose: () => void;
  /** 发送：提示词 + 模型ID */
  onSend: (text: string, modelId: string, refs: AudioRefItem[]) => void | Promise<void>;
  /** 初始文字描述（草稿打开时带入已保存 prompt） */
  initialText?: string;
  /** 初始模型（节点打开时带入已保存 draftModelId） */
  initialModelId?: string;
  /** 草稿绑定（IKDMQT）：面板编辑实时写回草稿节点；status 为 generating 时参数只读 */
  draftBinding?: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    submitting?: boolean;
    saveFailed?: boolean;
    onParamsChange: (patch: { prompt?: string; modelId?: string }) => void;
  };
  /** Toast 提示（IKDMQU Q3：恢复的模型不可用时提示，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  /** 底部模式切换 → AI 音乐对话框 */
  onSwitchToMusic?: () => void;
}

export default function AudioDialog({ onClose, onSend, initialText, initialModelId, draftBinding, onToast }: AudioDialogProps) {
  const [text, setText] = useState(initialText ?? '');
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [modelId, setModelId] = useState(initialModelId ?? '');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  const modeWrapRef = useRef<HTMLDivElement>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: modeOpen, ref: modeWrapRef, dismiss: () => setModeOpen(false) },
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
  ]);

  useEffect(() => {
    let active = true;
    fetchGenerationModels('audio')
      .then((list) => {
        if (!active) return;
        setModels(list);
        setModelsLoaded(true);
        // 原卡编辑保留已保存模型；不可用时由用户显式调整，不自动回写默认值。
        if (draftBinding?.restoreExisting || draftBinding?.status === 'generating') return;
        if (list.length > 0) {
          // 草稿带入的模型优先（仍在可用列表中时），否则回退首个；选中即写回草稿
          // IKDMQU Q3：恢复的模型已不可用时明确提示（回退默认，不静默降级），用户调整后再发送
          const restoredAvailable =
            !!initialModelId && list.some((m) => m.model_id === initialModelId);
          if (initialModelId && !restoredAvailable) {
            onToast?.('warn', '原生成模型已不可用，已回退默认模型，请确认后发送');
          }
          const restored = restoredAvailable ? initialModelId! : list[0].model_id;
          setModelId(restored);
          draftBinding?.onParamsChange({ modelId: restored });
        }
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
        setModelsLoaded(true);
      });
    return () => { active = false; };
    // 挂载时按 seed 初始化一次，后续编辑经用户交互写回
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentModel = models.find((m) => m.model_id === modelId);
  const modelUnavailable = modelsLoaded && !currentModel;
  /** 草稿绑定生成中（IKDMQT）：描述/模型/发送只读，保留查看与画布上的取消入口 */
  const readOnly = draftBinding?.submitting || draftBinding?.status === 'generating';

  const handleTextChange = (value: string) => {
    setText(value);
    draftBinding?.onParamsChange({ prompt: value });
  };

  const handleModelSelect = (id: string) => {
    setModelId(id);
    setModelOpen(false);
    draftBinding?.onParamsChange({ modelId: id });
  };

  const handleSend = () => {
    if (!text.trim() || !currentModel || readOnly || draftBinding?.saveFailed) return;
    onSend(text.trim(), modelId, []);
    // 草稿绑定发送后保留输入（卡片原地转生成中，面板进入只读），非草稿保持清空
    if (!draftBinding) setText('');
  };

  return (
    <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {/* 右上角操作：放大/收起 + 关闭 */}
      <div className={styles.topActions}>
        <button
          className={styles.iconBtn}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? '收起' : '展开'}
        >
          {expanded ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
        </button>
        <button className={styles.iconBtn} onClick={onClose} title="关闭">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      {/* 输入框 */}
      <textarea
        className={styles.textarea}
        data-testid="audio-input"
        placeholder="描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型，最长 120 秒。"
        value={text}
        onChange={(e) => handleTextChange(e.target.value.slice(0, MAX_INPUT))}
        rows={2}
        maxLength={MAX_INPUT}
        disabled={readOnly}
      />

      {modelUnavailable && <div role="alert">模型不可用，请选择可用模型后发送</div>}

      {/* 字数统计 */}
      <div className={`${styles.charCount} ${text.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
        {text.length}/{MAX_INPUT}
      </div>

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {/* 模式（音频生成） */}
          <div className={styles.modeWrap} ref={modeWrapRef}>
            <button className={styles.modeBtn} onClick={() => setModeOpen((v) => !v)}>
              <AudioLines size={14} strokeWidth={2} />
              <span>音频生成</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modeOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modeOpen && (
              <div className={styles.modeDropdown}>
                <button className={`${styles.modeOption} ${styles.modeOptionActive}`} onClick={() => setModeOpen(false)}>
                  音频生成
                </button>
                {/* AI 音乐暂未上线：展示但禁用 */}
                <button className={styles.modeOption} disabled title="即将上线">
                  <span className={styles.modeOptionRow}>
                    <Music size={12} strokeWidth={2} />
                    AI 音乐
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* 模型（真实） */}
          <div className={styles.modeWrap} ref={modelWrapRef}>
            <button className={styles.modeBtn} onClick={() => setModelOpen((v) => !v)} disabled={readOnly}>
              <span>{currentModel?.model_label ?? '选择模型'}</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modelOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modelOpen && (
              <div className={styles.modeDropdown}>
                {models.map((opt) => (
                  <button
                    key={opt.model_id}
                    className={`${styles.modeOption} ${opt.model_id === modelId ? styles.modeOptionActive : ''}`}
                    onClick={() => handleModelSelect(opt.model_id)}
                  >
                    {opt.model_label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.barRight}>
          {readOnly && (
            <span className={styles.readOnlyHint}>生成中，参数只读；可在画布卡片上取消生成</span>
          )}
          <button
            className={`${styles.sendBtn} ${text.trim() && modelId ? styles.sendBtnActive : ''}`}
            data-testid="audio-send"
            disabled={!text.trim() || !currentModel || readOnly || draftBinding?.saveFailed}
            onClick={handleSend}
            title="发送"
          >
            <ArrowUp size={16} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
