import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { ArrowUp, ChevronDown, Plus, X, Zap } from 'lucide-react';
import type { Node } from '@xyflow/react';
import { assetPageQueryOptions } from '@/custom/api/assets';
import { isApiError } from '@/shared/api/http';
import { uploadAssetFile } from '@/custom/utils/upload';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { AUDIO_MIX_FORMATS, audioMixSourceError, type AudioMixFormat, type AudioMixInputSelection } from '../../audioMix';
import { cardNameOfNode, readAssetId } from '../../mediaRefs';
import Tabs from '@/custom/components/Tabs';
import bar from '../AudioTrimBar/index.module.css';
import styles from './index.module.css';

interface AudioMixBarProps {
  source: Node;
  candidates: Node[];
  selected: AudioMixInputSelection[];
  onAdd: (input: AudioMixInputSelection) => void;
  onRemove: (assetId: string) => void;
  projectId: string;
  format: AudioMixFormat;
  onFormatChange: (format: AudioMixFormat) => void;
  onSend: () => void;
  onClose: () => void;
  submitting: boolean;
  anchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

type SourceTab = 'canvas' | 'library' | 'upload';

function AudioMixLibrary({ selectedIds, full, submitting, onAdd }: {
  selectedIds: Set<string>;
  full: boolean;
  submitting: boolean;
  onAdd: (input: AudioMixInputSelection) => void;
}) {
  const library = useInfiniteQuery({ ...assetPageQueryOptions('audio', 30), staleTime: 0 });
  return <>
    {library.isPending && <div className={styles.hint}>载入音频素材…</div>}
    {library.isError && <div className={styles.hint}>素材库加载失败，请重试</div>}
    {library.data?.pages.flatMap((page) => page.records).filter((asset) => asset.type === 'audio').map((asset) => {
      const name = asset.name?.trim() || `音频 #${asset.id}`;
      return (
        <button key={String(asset.id)} type="button" role="menuitem" className={bar.formatMenuItem}
          data-testid={`audio-mix-library-${asset.id}`}
          disabled={asset.status !== 'normal' || !asset.url || selectedIds.has(String(asset.id)) || full || submitting}
          onClick={() => onAdd({ assetId: String(asset.id), name, duration: asset.duration })}>
          {name}
        </button>
      );
    })}
    {library.hasNextPage && <button type="button" className={bar.formatMenuItem}
      disabled={library.isFetchingNextPage} onClick={() => { void library.fetchNextPage(); }}>
      {library.isFetchingNextPage ? '载入中…' : '加载更多'}
    </button>}
  </>;
}

export default function AudioMixBar({
  source, candidates, selected, onAdd, onRemove, projectId, format, onFormatChange,
  onSend, onClose, submitting, anchor, dragHidden,
}: AudioMixBarProps) {
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [tab, setTab] = useState<SourceTab>('canvas');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const sourceWrapRef = useRef<HTMLDivElement>(null);
  const formatWrapRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useDismissOnOutside([
    { open: sourceMenuOpen, ref: sourceWrapRef, dismiss: () => setSourceMenuOpen(false) },
    { open: formatMenuOpen, ref: formatWrapRef, dismiss: () => setFormatMenuOpen(false) },
  ]);

  const sourceAssetId = readAssetId(source.data);
  const selectedIds = new Set<string>([...(sourceAssetId ? [sourceAssetId] : []), ...selected.map((item) => item.assetId)]);
  const full = selected.length >= 99;
  const hasCanvasCandidate = candidates.some((node) => {
    const assetId = readAssetId(node.data);
    return !audioMixSourceError(node) && !!assetId && !selectedIds.has(assetId);
  });
  const durations = [source.data?.duration, ...selected.map((item) => item.duration)];
  const duration = durations.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    ? String(Math.round(Math.max(...durations as number[]))) + 's'
    : '待确定';
  const upload = useMutation({
    mutationFn: (file: File) => uploadAssetFile(file, { projectId }),
  });
  const disabled = submitting || upload.isPending || selected.length === 0;

  const uploadFile = (file: File) => {
    if (submitting || upload.isPending || full) return;
    setUploadError(null);
    void upload.mutateAsync(file).then((asset) => {
      if (!mountedRef.current) return;
      if (asset.type !== 'audio' || asset.status !== 'ready' || !asset.asset_id || !asset.url) {
        setUploadError('上传音频尚未入库，请重试');
        return;
      }
      if (selectedIds.has(String(asset.asset_id))) {
        setUploadError('此音频已在清单中');
        return;
      }
      onAdd({ assetId: String(asset.asset_id), name: file.name, duration: asset.duration });
    }).catch((error: unknown) => {
      if (!mountedRef.current) return;
      if (!isApiError(error)) setUploadError(error instanceof Error ? error.message : '上传失败，请重试');
    });
  };

  return (
    <div
      className={`${bar.sendBar} ${anchor ? bar.sendBarFollow : ''} ${styles.sendBar}`}
      style={anchoredOverlayStyle(anchor, dragHidden)}
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
          <Plus size={13} strokeWidth={2} /> 音频 {selected.length + 1}/100
        </button>
        {sourceMenuOpen && (
          <div className={`${bar.formatMenu} ${styles.sourceMenu}`} role="menu" data-testid="audio-mix-source-menu">
            <div className={styles.selectedList} data-testid="audio-mix-selected-list">
              <div className={styles.sourceRow}>{cardNameOfNode(source)} <span>固定</span></div>
              {selected.map((item) => (
                <div key={item.assetId} className={styles.sourceRow}>
                  <span title={item.name}>{item.name}</span>
                  <button type="button" className={styles.removeBtn} data-testid={`audio-mix-remove-${item.assetId}`}
                    aria-label={`移除 ${item.name}`} disabled={submitting} onClick={() => onRemove(item.assetId)}><X size={12} /></button>
                </div>
              ))}
            </div>
            <Tabs
              className={styles.tabs}
              triggerClassName={styles.tab}
              activeTriggerClassName={styles.activeTab}
              ariaLabel="音频来源"
              value={tab}
              onChange={setTab}
              items={[
                { key: 'canvas', label: '画布', testId: 'audio-mix-tab-canvas' },
                { key: 'library', label: '素材库', testId: 'audio-mix-tab-library' },
                { key: 'upload', label: '上传', testId: 'audio-mix-tab-upload' },
              ]}
            />
            <div className={styles.candidateList} role="tabpanel">
              {tab === 'canvas' && !full && !hasCanvasCandidate &&
                <div className={styles.hint}>画布暂无其它音频，可从素材库或上传添加</div>}
              {tab === 'canvas' && candidates.map((node) => {
                const assetId = readAssetId(node.data);
                return (
                  <button key={node.id} type="button" role="menuitem" className={bar.formatMenuItem}
                    data-testid={`audio-mix-candidate-${node.id}`}
                    disabled={!!audioMixSourceError(node) || !assetId || selectedIds.has(assetId) || full || submitting}
                    onClick={() => {
                      if (!assetId) return;
                      onAdd({ assetId: assetId!, nodeId: node.id, name: cardNameOfNode(node) || '未命名音频',
                        duration: typeof node.data?.duration === 'number' ? node.data.duration : null });
                    }}>
                    {cardNameOfNode(node)}
                  </button>
                );
              })}
              {tab === 'library' && <AudioMixLibrary
                selectedIds={selectedIds} full={full} submitting={submitting} onAdd={onAdd}
              />}
              {tab === 'upload' && <>
                <label className={styles.uploadLabel}>
                  {upload.isPending ? '正在上传…' : '选择本地音频'}
                  <input type="file" accept="audio/*" data-testid="audio-mix-upload-input"
                    disabled={submitting || upload.isPending || full}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) uploadFile(file);
                    }} />
                </label>
                {uploadError && <div className={styles.hint} role="alert">{uploadError}</div>}
              </>}
            </div>
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
        data-testid="audio-mix-send" disabled={disabled} title={disabled ? '请添加另一段音频' : '生成混合音频'}
        onClick={onSend}>
        <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
      </button>
    </div>
  );
}
