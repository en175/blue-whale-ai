import { useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Plus, X, Zap } from 'lucide-react';
import type { Node } from '@xyflow/react';
import type { FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { AUDIO_MIX_FORMATS, type AudioMixFormat } from '../../audioMix';
import { cardNameOfNode } from '../../mediaRefs';
import bar from '../AudioTrimBar/index.module.css';
import styles from './index.module.css';

interface AudioMixBarProps {
  source: Node;
  candidates: Node[];
  selectedNodeId: string | null;
  onSelect: (nodeId: string | null) => void;
  format: AudioMixFormat;
  onFormatChange: (format: AudioMixFormat) => void;
  onSend: () => void;
  onClose: () => void;
  submitting: boolean;
  anchor: FollowDialogAnchor | null;
}

export default function AudioMixBar({
  source, candidates, selectedNodeId, onSelect, format, onFormatChange,
  onSend, onClose, submitting, anchor,
}: AudioMixBarProps) {
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const sourceWrapRef = useRef<HTMLDivElement>(null);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([
    { open: sourceMenuOpen, ref: sourceWrapRef, dismiss: () => setSourceMenuOpen(false) },
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);
  const selected = candidates.find((node) => node.id === selectedNodeId);
  const durations = [source, ...(selected ? [selected] : [])]
    .map((node) => node.data?.duration);
  const duration = durations.every((value) => typeof value === 'number' && value > 0)
    ? `${Math.round(Math.max(...durations as number[]))}s`
    : '待确定';
  const disabled = submitting || !selected;

  return (
    <div
      className={`${bar.sendBar} ${anchor ? bar.sendBarFollow : ''} ${styles.sendBar}`}
      style={anchor ? { left: anchor.left, top: anchor.top } : undefined}
      data-gen-panel-territory
      data-testid="audio-mix-send-bar"
    >
      <button type="button" className={bar.closeBtn} data-testid="audio-mix-close"
        title="退出混合" onClick={onClose} disabled={submitting}>
        <X size={14} strokeWidth={2} />
      </button>
      <span className={bar.title}>混合</span>
      <div className={bar.formatWrap} ref={sourceWrapRef}>
        <button type="button" className={bar.formatTrigger} data-testid="audio-mix-add"
          aria-haspopup="menu" aria-expanded={sourceMenuOpen || undefined}
          disabled={submitting} onClick={() => setSourceMenuOpen((open) => !open)}>
          <Plus size={13} strokeWidth={2} /> 音频 {selected ? 2 : 1}/100
        </button>
        {sourceMenuOpen && (
          <div className={`${bar.formatMenu} ${styles.sourceMenu}`} role="menu" data-testid="audio-mix-source-menu">
            <div className={styles.sourceRow}>{cardNameOfNode(source)} <span>固定</span></div>
            {selected && (
              <button type="button" role="menuitem" className={bar.formatMenuItem}
                data-testid="audio-mix-remove" onClick={() => onSelect(null)}>
                {cardNameOfNode(selected)} <X size={12} />
              </button>
            )}
            <div className={styles.menuLabel}>画布</div>
            {candidates.map((node) => (
              <button key={node.id} type="button" role="menuitem" className={bar.formatMenuItem}
                data-testid={`audio-mix-candidate-${node.id}`}
                disabled={node.id === selectedNodeId || submitting}
                onClick={() => { onSelect(node.id); setSourceMenuOpen(false); }}>
                {cardNameOfNode(node)}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className={bar.range} data-testid="audio-mix-duration">预计 {duration}</span>
      <div className={bar.formatWrap} ref={formatWrapRef}>
        <button type="button" className={bar.formatTrigger} data-testid="audio-mix-format-trigger"
          aria-haspopup="menu" aria-expanded={formatMenuOpen || undefined}
          disabled={submitting} onClick={() => setFormatMenuOpen((open) => !open)}>
          {format} <ChevronDown size={12} strokeWidth={2} />
        </button>
        {formatMenuOpen && (
          <div className={bar.formatMenu} role="menu" data-testid="audio-mix-format-menu">
            {AUDIO_MIX_FORMATS.map((item) => (
              <button key={item} type="button" role="menuitemradio" aria-checked={item === format}
                className={`${bar.formatMenuItem} ${item === format ? bar.formatMenuItemActive : ''}`}
                data-testid={`audio-mix-format-${item}`}
                onClick={() => { onFormatChange(item); setFormatMenuOpen(false); }}>
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className={bar.free} title="本期免费" data-testid="audio-mix-free">
        <Zap size={11} fill="currentColor" strokeWidth={0} />0 本期免费
      </span>
      <button type="button" className={`${bar.sendBtn} ${!disabled ? bar.sendBtnActive : ''}`}
        data-testid="audio-mix-send" disabled={disabled} title={selected ? '生成混合音频' : '请添加另一段音频'}
        onClick={onSend}>
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
