import { type AudioVideoMuxSync, AUDIO_VIDEO_MUX_RESERVE_OPTIONS, AUDIO_VIDEO_MUX_SYNC_OPTIONS } from '@/custom/enums';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowUp, Film, Video, X } from 'lucide-react';
import { assetPageQueryOptions } from '@/custom/api/assets';
import type { MediaToolQuoteParams } from '@/custom/api/mediaToolQuote';
import { resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import { useDismissOnOutside } from '../../hooks/shared/useDismissOnOutside';
import { AUDIO_VIDEO_MUX_TITLE, type AudioVideoMuxBoundVideo, type AudioVideoMuxIdentity } from '../../tools/audio/audioVideoMux';
import Empty from '@/custom/components/Empty';
import MediaToolQuoteBadge from '../MediaToolQuoteBadge';
import styles from './index.module.css';

interface AudioVideoMuxPanelProps {
  identity: AudioVideoMuxIdentity;
  onClose: () => void;
  onReserveChange: (reserveAudio: boolean) => void;
  onSyncChange: (sync: AudioVideoMuxSync) => void;
  onBindLibraryVideo: (video: AudioVideoMuxBoundVideo) => void;
  onUnbind: () => void;
  wireBinding: boolean;
  onSend: () => void;
  quoteParams?: MediaToolQuoteParams | null;
  followAnchor: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

function durationText(duration: number | null | undefined): string {
  return typeof duration === 'number' && duration > 0 ? `${Math.round(duration)}s` : '';
}

function MuxVideoLibrary({ onPick }: { onPick: (video: AudioVideoMuxBoundVideo) => void }) {
  const library = useInfiniteQuery({ ...assetPageQueryOptions('video', 30), staleTime: 0 });
  const records = (library.data?.pages.flatMap((page) => page.records) ?? [])
    .filter((asset) => asset.type === 'video');
  return (
    <div className={styles.libraryPop} role="menu" data-testid="audio-video-mux-library">
      <div className={styles.libraryTitle}>素材库视频（选中即绑定）</div>
      <div className={styles.libraryList}>
        {library.isPending && <div className={styles.libraryHint}>载入视频素材…</div>}
        {library.isError && <div className={styles.libraryHint}>素材库加载失败，请重试</div>}
        {!library.isPending && !library.isError && records.length === 0 && (
          <Empty className={styles.libraryHint} title="素材库暂无视频，请先上传" />
        )}
        {records.map((asset) => {
          const name = asset.name?.trim() || `视频 #${asset.id}`;
          return (
            <button
              key={String(asset.id)}
              type="button"
              role="menuitem"
              className={styles.libraryRow}
              data-testid={`audio-video-mux-library-${asset.id}`}
              disabled={asset.status !== 'normal' || !asset.url}
              onClick={() => onPick({
                assetId: String(asset.id),
                name,
                duration: asset.duration,
                width: asset.width,
                height: asset.height,
                src: asset.url,
              })}
            >
              <span className={styles.libraryThumb} aria-hidden><Film size={12} strokeWidth={1.8} /></span>
              <span className={styles.libraryRowName}>{name}</span>
              <span className={styles.libraryRowDur}>{durationText(asset.duration)}</span>
            </button>
          );
        })}
        {library.hasNextPage && (
          <button
            type="button"
            className={styles.libraryRow}
            disabled={library.isFetchingNextPage}
            onClick={() => { void library.fetchNextPage(); }}
          >
            {library.isFetchingNextPage ? '载入中…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AudioVideoMuxPanel({
  identity,
  onClose,
  onReserveChange,
  onSyncChange,
  onBindLibraryVideo,
  onUnbind,
  wireBinding,
  onSend,
  quoteParams,
  followAnchor, dragHidden,
}: AudioVideoMuxPanelProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const slotWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([{ open: libraryOpen, ref: slotWrapRef, dismiss: () => setLibraryOpen(false) }]);

  useEffect(() => {
    if (!libraryOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      setLibraryOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [libraryOpen]);

  const bound = identity.video;
  const canSend = bound != null;
  const boundSourceLabel = bound?.nodeId ? '画布' : '素材库';

  const pickLibraryVideo = (video: AudioVideoMuxBoundVideo) => {
    setLibraryOpen(false);
    onBindLibraryVideo(video);
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor, dragHidden)}
      data-gen-panel-territory
      data-testid="audio-video-mux-panel"
    >
      <div className={styles.dialog}>
        <div className={styles.headerRow}>
          <span className={styles.title}>{AUDIO_VIDEO_MUX_TITLE}</span>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            title="退出合成"
            data-testid="audio-video-mux-close"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>视频</span>
          <div className={styles.slotWrap} ref={slotWrapRef}>
            {bound ? (
              <div className={styles.boundBar} data-testid="audio-video-mux-bound">
                {}
                <span className={styles.boundThumb} aria-hidden>
                  {bound.src
                    ? <video className={styles.boundThumbVideo} src={resolveMediaSrc(bound.src)} muted playsInline preload="metadata" />
                    : <Video size={14} strokeWidth={1.8} />}
                </span>
                <span className={styles.boundMeta}>
                  <span className={styles.boundName} title={bound.name}>{bound.name}</span>
                  <span className={styles.boundDur}>
                    {durationText(bound.duration)}
                    {durationText(bound.duration) ? ' · ' : ''}{boundSourceLabel}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.boundRemove}
                  data-testid="audio-video-mux-bound-remove"
                  title="移除重选"
                  onClick={onUnbind}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            ) : wireBinding ? (
              <div className={styles.slotBinding} data-testid="audio-video-mux-binding">
                绑定中：松手即绑定到本卡
              </div>
            ) : (
              <div className={styles.slotGuide} data-testid="audio-video-mux-slot">
                从视频卡右侧 ＋ 拖线到本卡
                <button
                  type="button"
                  className={styles.subLink}
                  data-testid="audio-video-mux-library-open"
                  onClick={() => setLibraryOpen(true)}
                >
                  或从素材库选择
                </button>
              </div>
            )}
            {libraryOpen && <MuxVideoLibrary onPick={pickLibraryVideo} />}
          </div>
        </div>

        {}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>原声处理</span>
          <div className={styles.segGroup}>
            {AUDIO_VIDEO_MUX_RESERVE_OPTIONS.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                className={`${styles.segBtn} ${identity.reserveAudio === option.value ? styles.segBtnActive : ''}`}
                data-testid={`audio-video-mux-reserve-${option.value}`}
                onClick={() => onReserveChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>时长对齐</span>
          <div className={styles.segGroup}>
            {AUDIO_VIDEO_MUX_SYNC_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.segBtn} ${identity.sync === option.value ? styles.segBtnActive : ''}`}
                data-testid={`audio-video-mux-sync-${option.value}`}
                onClick={() => onSyncChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.bottomBar}>
          <MediaToolQuoteBadge
            toolType="audio_video_mux"
            params={quoteParams}
            variant="hint"
            testId="audio-video-mux-quote"
          />
          {!canSend && <span className={styles.sendHint}>先选择视频</span>}
          <button
            type="button"
            className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
            data-testid="audio-video-mux-send"
            disabled={!canSend}
            title={canSend ? '生成合成视频' : '先选择视频'}
            onClick={() => { if (canSend) onSend(); }}
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
