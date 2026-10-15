import { useState, useMemo } from 'react';
import { Plus, BookText } from 'lucide-react';
import styles from './index.module.css';
import type { SessionContentBlock } from '@/custom/api/agentSessions';
import type { PartialCardPreview } from '../../hooks/partialCardPreview';
import { isProcessItem, itemsFromBlocks, itemsFromLive, type TimelineItem, type Turn } from '../../hooks/sessionTimeline';
import type { KnownAsset } from './assetMentions';
import { Markdown } from './Markdown';
import { AssetMentionChip } from './AssetMentionChip';
import { ProcessGroup } from './TurnTimeline';

function CardPreview({ preview }: { preview: PartialCardPreview | null }) {
  if (!preview) return null;
  return (
    <div className={styles.cardPreview} aria-live="off">
      <div className={styles.cardPreviewLabel}>
        <BookText size={12} strokeWidth={2} />
        <span>Prompt 撰写中…</span>
      </div>
      {preview.overview && <div className={styles.cardPreviewOverview}>{preview.overview}</div>}
      {preview.shots.map((shot, i) => (
        <div key={i} className={styles.cardPreviewShot}>
          {shot.title && <div className={styles.cardPreviewShotTitle}>{shot.title}</div>}
          {shot.promptText && (
            <div className={styles.cardPreviewShotPrompt}>
              {shot.promptText}
              <span className={styles.cardPreviewCaret} aria-hidden="true">▍</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GenerationCard({ card, onApply, disabled, applied, assets }: {
  card: NonNullable<SessionContentBlock['card']>;
  onApply: () => void;
  disabled: boolean;
  applied?: boolean;
  assets: readonly KnownAsset[];
}) {
  const [full, setFull] = useState(false);
  const refs = card.assetRefItems;
  const cardAssets = useMemo<KnownAsset[]>(() => {
    const known = new Set(assets.map((a) => a.assetId));
    const markers = (refs ?? []).flatMap((r) =>
      (r.markerTexts ?? []).map((text) => ({ assetId: r.assetId, label: text, display: r.marker, name: r.label, mediaType: r.mediaType })),
    );
    const named = (refs ?? []).filter((r) => !known.has(r.assetId)).map((r) => ({ assetId: r.assetId, label: r.label, mediaType: r.mediaType }));
    return [...markers, ...assets, ...named].sort((a, b) => b.label.length - a.label.length);
  }, [assets, refs]);
  const meta = [
    card.targetMedia === 'video' ? '视频' : card.targetMedia === 'image' ? '图片' : null,
    card.targetModel,
    card.aspectRatio,
    card.durationSeconds !== undefined ? `${card.durationSeconds} 秒` : card.timeRange,
  ].filter((one): one is string => Boolean(one));
  const prompt = card.prompt || '提示词正文缺失，请继续对话重新生成';
  const long = prompt.length > 140 || prompt.includes('\n');
  return (
    <div className={styles.generationCard}>
      <div className={styles.shotMeta}>
        <span className={styles.shotTitle}>
          <BookText size={13} strokeWidth={2} className={styles.shotTitleIcon} />
          {card.shotTitle}
        </span>
        {}
        {meta.length > 0 && <span className={styles.shotTargetModel}>{meta.join(' · ')}</span>}
        {}
        {card.taskLabel && <span className={styles.shotTaskLabel} title={card.taskLabel}>{card.taskLabel}</span>}
      </div>
      {refs && refs.length > 0 && (
        <div className={styles.shotRefs}>
          <span className={styles.shotRefsLabel}>参考</span>
          {refs.map((r) => (
            <AssetMentionChip key={r.assetId} assetId={r.assetId} label={r.marker ?? r.label} name={r.label} mediaType={r.mediaType} />
          ))}
        </div>
      )}
      <div className={`${styles.shotPrompt} ${long && !full ? styles.shotPromptClamp : ''}`}>
        <Markdown text={prompt} assets={cardAssets} className={styles.shotPromptMd} />
      </div>
      {long && (
        <button type="button" className={styles.shotMore} onClick={() => setFull((v) => !v)} aria-expanded={full}>
          {full ? '收起 ▴' : '展开全文 ▾'}
        </button>
      )}
      <div className={styles.shotActions}>
        <button type="button" className={`${styles.cardBtn} ${styles.cardBtnPrimary}`} disabled={disabled || !card.source} onClick={onApply}>
          <Plus size={13} />
          {applied ? '定位文本节点' : '应用到画布'}
        </button>
      </div>
    </div>
  );
}

export function AssistantTurnBody({
  turn,
  streamingText,
  onCardApply,
  disabled,
  appliedCardIds,
  knownAssets,
}: {
  turn: Turn;
  streamingText: string;
  knownAssets: readonly KnownAsset[];
  onCardApply: (card: NonNullable<SessionContentBlock['card']>) => void;
  disabled: boolean;
  appliedCardIds: ReadonlySet<string>;
}) {
  const items: TimelineItem[] = turn.assistant
    ? itemsFromBlocks(turn.assistant.blocks ?? [], turn.assistant.content)
    : turn.live
      ? itemsFromLive(turn.live, streamingText)
      : [];
  if (items.length === 0) return null;
  const live = turn.live !== null && !turn.live.ended;
  const process = items.filter(isProcessItem);
  const body = items.filter((item) => !isProcessItem(item));
  const ordinals: Record<string, number> = {};
  const keyOf = (item: TimelineItem): string => {
    if (item.kind === 'card') {
      const id = item.card.cardId ?? item.card.shotTitle;
      if (id) return `card:${id}`;
    }
    const n = (ordinals[item.kind] = (ordinals[item.kind] ?? 0) + 1);
    return `${item.kind}:${n}`;
  };
  return (
    <>
      <ProcessGroup items={process} live={live} totalMs={turn.account?.seconds != null ? turn.account.seconds * 1000 : null} />
      {body.map((item) => {
        const key = keyOf(item);
        switch (item.kind) {
          case 'text':
            return <Markdown key={key} text={item.text} assets={knownAssets} />;
          case 'card': {
            const cardId = item.card.cardId ?? item.card.shotTitle;
            return (
              <GenerationCard
                key={key}
                card={item.card}
                onApply={() => onCardApply(item.card)}
                disabled={disabled}
                applied={appliedCardIds.has(cardId)}
                assets={knownAssets}
              />
            );
          }
          case 'card_preview':
            return <CardPreview key={key} preview={item.preview} />;
          default:
            return null;
        }
      })}
    </>
  );
}
