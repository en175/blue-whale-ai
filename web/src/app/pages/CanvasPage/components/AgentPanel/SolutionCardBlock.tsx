import { useState } from 'react';
import { BookText } from 'lucide-react';
import styles from './index.module.css';
import type { RequirementUnderstanding } from '@/app/api/agentSessions';
import { Markdown } from './Markdown';

const SOLUTION_FIELD_LABELS = {
  goal: '这次要做什么',
  target_media: '做图还是视频',
  direction: '创意方向',
  constraints: '必须守住的',
  asset_roles: '你给的素材各起什么作用',
  assumptions: '我替你定的几项',
  execution_route: '用哪个模型出片',
  delivery_spec: '出片参数',
  scope: '这张卡管的范围',
  derived_from: '承接上一张',
  change: '这次改什么',
  segments: '分几段拍',
} as const;

function withSeconds(content: string, seconds?: number): string {
  return seconds !== undefined ? `${content}（${seconds} 秒）` : content;
}

function SolutionField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.solutionField}>
      <div className={styles.solutionFieldLabel}>{label}</div>
      {children}
    </div>
  );
}

export function SolutionCardBlock({
  understanding,
  disabled,
  onConfirm,
  onVoid,
}: {
  understanding: RequirementUnderstanding;
  disabled: boolean;
  onConfirm: () => void;
  onVoid: (note?: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const card = understanding.solution_card ?? null;
  const pending = understanding.status === 'awaiting_confirmation';
  const route = card?.execution_route;
  const spec = card?.delivery_spec;
  const segments = card?.segments ?? [];
  const changing = card?.scope?.kind === 'change';
  const specParts = [
    spec?.aspect_ratio,
    spec?.duration_seconds !== undefined ? `${spec.duration_seconds} 秒` : undefined,
    spec?.resolution,
  ].filter((one): one is string => Boolean(one));

  const act = (run: () => void) => {
    setBusy(true);
    run();
  };

  return (
    <>
      <div className={`${styles.solutionCard} ${pending ? '' : styles.solutionCardSettled}`}>
        <div className={styles.solutionCardHead}>
          <BookText size={12} strokeWidth={2} />
          <span>方案卡</span>
        </div>

        {}
        {!card && <div className={styles.solutionFieldValue}>{understanding.proposed_summary}</div>}

        {card && (
          <>
            <SolutionField label={SOLUTION_FIELD_LABELS.goal}>
              <div className={styles.solutionFieldValue}>{card.goal}</div>
            </SolutionField>
            <SolutionField label={SOLUTION_FIELD_LABELS.target_media}>
              <div className={styles.solutionFieldValue}>{card.target_media === 'video' ? '视频' : '图片'}</div>
            </SolutionField>
            {}
            {(card.scope?.kind === 'continuation' || card.scope?.kind === 'new_task') && (
              <SolutionField label={SOLUTION_FIELD_LABELS.scope}>
                <div className={styles.solutionFieldValue}>{card.scope.label}</div>
              </SolutionField>
            )}
            {changing && (
              <SolutionField label={SOLUTION_FIELD_LABELS.change}>
                <div className={styles.solutionFieldValue}>{card.scope?.effect ?? card.scope?.label}</div>
                {segments.length > 0 && (
                  <ul className={styles.solutionList}>
                    {segments.map((one, i) => (
                      <li key={one.segment_id ?? i}>{withSeconds(one.content, one.seconds)}</li>
                    ))}
                  </ul>
                )}
              </SolutionField>
            )}
            {!changing && segments.length > 1 && (
              <SolutionField label={SOLUTION_FIELD_LABELS.segments}>
                <ol className={styles.solutionSegments}>
                  {segments.map((one, i) => (
                    <li key={one.segment_id ?? i}>{`第 ${i + 1} 段：${withSeconds(one.content, one.seconds)}`}</li>
                  ))}
                </ol>
              </SolutionField>
            )}
            {}
            {card.scope?.derived_from && (
              <SolutionField label={SOLUTION_FIELD_LABELS.derived_from}>
                <div className={styles.solutionFieldValue}>{`〈${card.scope.derived_from}〉`}</div>
              </SolutionField>
            )}
            {card.direction && (
              <SolutionField label={SOLUTION_FIELD_LABELS.direction}>
                <div className={styles.solutionFieldValue}>{card.direction}</div>
              </SolutionField>
            )}
            {card.constraints && card.constraints.length > 0 && (
              <SolutionField label={SOLUTION_FIELD_LABELS.constraints}>
                <ul className={styles.solutionList}>
                  {card.constraints.map((one, i) => (
                    <li key={i}>{one}</li>
                  ))}
                </ul>
              </SolutionField>
            )}
            {card.asset_roles && card.asset_roles.length > 0 && (
              <SolutionField label={SOLUTION_FIELD_LABELS.asset_roles}>
                <ul className={styles.solutionList}>
                  {card.asset_roles.map((one) => (
                    <li key={one.asset_ref_id}>{one.role}</li>
                  ))}
                </ul>
              </SolutionField>
            )}
            {}
            <SolutionField label={SOLUTION_FIELD_LABELS.assumptions}>
              <ul className={styles.solutionList}>
                {card.assumptions.map((one, i) => (
                  <li key={i}>{one}</li>
                ))}
              </ul>
            </SolutionField>
            {}
            {route && (
              <SolutionField label={SOLUTION_FIELD_LABELS.execution_route}>
                <div className={styles.solutionFieldValue}>
                  {route.model_family}
                  {route.model_version ? ` ${route.model_version}` : ''}
                </div>
              </SolutionField>
            )}
            {}
            {specParts.length > 0 && (
              <SolutionField label={SOLUTION_FIELD_LABELS.delivery_spec}>
                <div className={styles.solutionFieldValue}>{specParts.join(' · ')}</div>
              </SolutionField>
            )}
          </>
        )}

        {pending && !noteOpen && (
          <div className={styles.solutionActions}>
            <button
              type="button"
              className={styles.solutionPrimaryBtn}
              disabled={disabled || busy}
              onClick={() => act(onConfirm)}
            >
              确认
            </button>
            <button
              type="button"
              className={styles.solutionGhostBtn}
              disabled={disabled || busy}
              onClick={() => act(() => onVoid())}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.solutionGhostBtn}
              disabled={disabled || busy}
              onClick={() => setNoteOpen(true)}
            >
              补充
            </button>
          </div>
        )}

        {pending && noteOpen && (
          <>
            <textarea
              className={styles.solutionNote}
              value={note}
              autoFocus
              placeholder="想补充或改哪里？写下来，我按这个重提一版。"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className={styles.solutionActions}>
              <button
                type="button"
                className={styles.solutionPrimaryBtn}
                disabled={disabled || busy || !note.trim()}
                onClick={() => act(() => onVoid(note.trim()))}
              >
                发给它
              </button>
              <button type="button" className={styles.solutionGhostBtn} disabled={busy} onClick={() => setNoteOpen(false)}>
                返回
              </button>
            </div>
          </>
        )}

        {!pending && (
          <div className={styles.solutionSettledNote}>
            {understanding.status === 'accepted' ? '已确认，生成卡按这个方案写' : '这一版已作废'}
          </div>
        )}
      </div>
      {}
      {card?.next_steps && <Markdown text={card.next_steps} />}
    </>
  );
}
