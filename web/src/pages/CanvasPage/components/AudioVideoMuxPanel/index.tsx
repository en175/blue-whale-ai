/* ============================================
 * AudioVideoMuxPanel 音视频合成参数面板（IKIHPK，父规格 IKIHMX / ADR-0115）
 * 跟随草稿卡下方：标题行（「音视频合成」+ X 退出）、视频槽三态（未绑定引导 + 素材库次级
 * 入口 / 绑定中跟手 / 已绑定信息条：缩略图、文件名、时长、来源标注「· 画布」「· 素材库」、
 * × 移除重绑）、原声处理两档分段（保留原声默认）、时长对齐三档分段（保持原长默认）、
 * ⚡0 本期免费与圆形发送钮（统一 Dock 主发送钮样式；未绑定置灰并提示「先选择视频」）。
 * 素材库浮层：单列表视频资产（无页签、无上传），选中即绑定不拉线，点浮层外部或 Esc 关闭
 * （AudioMixBar outside-dismiss 口径；Esc 在捕获阶段拦下，只关浮层不退会话）。
 * 参数切换经 onReserveChange/onSyncChange 即时写卡（随草稿卡持久化，重开/刷新恢复）。
 * 发送真实提交与占位回填归 IKIHP M：本票 onSend 由页面传入空实现，点击不建任务、不改卡态。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowUp, Film, Video, X, Zap } from 'lucide-react';
import { assetPageQueryOptions } from '@/api/assets';
import type { FollowDialogAnchor } from '../../followDialog';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import {
  AUDIO_VIDEO_MUX_RESERVE_OPTIONS,
  AUDIO_VIDEO_MUX_SYNC_OPTIONS,
  AUDIO_VIDEO_MUX_TITLE,
  type AudioVideoMuxBoundVideo,
  type AudioVideoMuxIdentity,
  type AudioVideoMuxSync,
} from '../../audioVideoMux';
import styles from './index.module.css';

interface AudioVideoMuxPanelProps {
  /** 草稿卡上的合成身份（固定源 + 参数 + 绑定视频）：面板渲染与切换写卡同源 */
  identity: AudioVideoMuxIdentity;
  /** X 退出（四退出之一）：未发送退出不建任务不建卡由父级承担 */
  onClose: () => void;
  /** 原声处理切档（两档）：父级写卡持久化 */
  onReserveChange: (reserveAudio: boolean) => void;
  /** 时长对齐切档（三档）：父级写卡持久化 */
  onSyncChange: (sync: AudioVideoMuxSync) => void;
  /** 素材库选中即绑定（不拉线）：父级只写卡上视频身份，不建边 */
  onBindLibraryVideo: (video: AudioVideoMuxBoundVideo) => void;
  /** × 移除绑定：父级清卡上视频身份并删绑定线（可拖线或素材库重选） */
  onUnbind: () => void;
  /** 拖线手势进行中（视频槽「绑定中跟手」态） */
  wireBinding: boolean;
  /** 发送：真实提交归 IKIHP M（本票页面传空实现） */
  onSend: () => void;
  /** 绑定草稿卡时跟随其下方；缺省锚定底部 */
  followAnchor: FollowDialogAnchor | null;
}

/** 时长文案（秒取整，与卡面元信息同口径；未知不展示） */
function durationText(duration: number | null | undefined): string {
  return typeof duration === 'number' && duration > 0 ? `${Math.round(duration)}s` : '';
}

/** 素材库浮层（单列表视频资产，无页签无上传；选中即绑定不拉线） */
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
          <div className={styles.libraryHint}>素材库暂无视频，请先上传</div>
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
  followAnchor,
}: AudioVideoMuxPanelProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const slotWrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside([{ open: libraryOpen, ref: slotWrapRef, dismiss: () => setLibraryOpen(false) }]);

  /** 浮层 Esc：捕获阶段拦下并阻断传播——只关浮层，不落入公共 Esc 链退出会话
   *  （真实按键事件经 window 捕获阶段先于公共链的冒泡监听）。 */
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
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
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

        {/* 视频槽三态：已绑定信息条 / 绑定中跟手 / 未绑定引导 + 素材库次级入口 */}
        <div className={styles.fieldWrap}>
          <span className={styles.fieldLabel}>视频</span>
          <div className={styles.slotWrap} ref={slotWrapRef}>
            {bound ? (
              <div className={styles.boundBar} data-testid="audio-video-mux-bound">
                <span className={styles.boundThumb} aria-hidden><Video size={14} strokeWidth={1.8} /></span>
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

        {/* 原声处理两档（保留原声默认；替换原声映射 is_audio_reserve=false） */}
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

        {/* 时长对齐三档（保持原长默认；裁到视频长/音频长映射 sync=video/audio） */}
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
          <span className={styles.freeHint} title="本期免费" data-testid="audio-video-mux-free">
            <Zap size={11} fill="currentColor" strokeWidth={0} />0 本期免费
          </span>
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
