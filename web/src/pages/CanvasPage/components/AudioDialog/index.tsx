/* ============================================
 * AudioDialog 音频生成底部对话框：纯文本描述 + 真实模型（fetchGenerationModels('audio')）
 * ============================================ */
import { useEffect, useState } from 'react';
import { X, AudioLines, ChevronDown, Sparkles, Music, ArrowUp } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import styles from './index.module.css';

/** 参考素材类型（保留给 MusicDialog 共享类型） */
type RefKind = 'audio' | 'image';

/** 参考项（保留给 MusicDialog 共享类型） */
export interface AudioRefItem {
  id: string;
  kind: RefKind;
  name: string;
  src: string;
  source: 'local' | 'canvas';
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
  onSend: (text: string, modelId: string) => void;
  /** 底部模式切换 → AI 音乐对话框 */
  onSwitchToMusic?: () => void;
}

export default function AudioDialog({ onClose, onSend }: AudioDialogProps) {
  const [text, setText] = useState('');
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [modelId, setModelId] = useState<string>('');
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  useEffect(() => {
    fetchGenerationModels('audio')
      .then((list) => {
        setModels(list);
        if (list.length > 0) setModelId(list[0].model_id);
      })
      .catch(() => setModels([]));
  }, []);

  const currentModel = models.find((m) => m.model_id === modelId);

  const handleSend = () => {
    if (!text.trim() || !modelId) return;
    onSend(text.trim(), modelId);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.dialog}>
      {/* 关闭按钮 */}
      <button className={styles.closeBtn} onClick={onClose} title="关闭">
        <X size={16} strokeWidth={2} />
      </button>

      {/* 输入框 */}
      <textarea
        className={styles.textarea}
        placeholder="描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型。最长 120 秒。"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        maxLength={3000}
      />

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {/* 模式（音频生成） */}
          <div className={styles.modeWrap}>
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
          <div className={styles.modeWrap}>
            <button className={styles.modeBtn} onClick={() => setModelOpen((v) => !v)}>
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
                    onClick={() => {
                      setModelId(opt.model_id);
                      setModelOpen(false);
                    }}
                  >
                    {opt.model_label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.barRight}>
          <span className={styles.costText}>
            <Sparkles size={14} strokeWidth={2} />
            <span>生成</span>
          </span>
          <button
            className={`${styles.sendBtn} ${text.trim() && modelId ? styles.sendBtnActive : ''}`}
            disabled={!text.trim() || !modelId}
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
