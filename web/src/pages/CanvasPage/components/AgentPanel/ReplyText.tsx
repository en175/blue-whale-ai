/**
 * 助手的一段正文：题按「排版一」画，其余照旧 Markdown（IKFLB9 定稿）。
 *
 * 排版一长什么样：题头「Q1 视角与构图 从什么角度看这个镇？」，选项一行一个——字母做小方块、名字加粗、
 * 说明变灰——推荐单独一条带左色条的框。
 *
 * 题从哪来（2026-09-15）：服务端出的题随正文块带 `questions`，按数据画，题号字母都是服务端编的；
 * 老记录的题只有文字，退回认开头（questionBlocks）——字一个不动，只是长得像一道题。
 */
import styles from './index.module.css';
import { Markdown } from './Markdown';
import { splitReplySegments, type ReplySegment } from './questionBlocks';
import type { KnownAsset } from './assetMentions';
import type { AskedQuestion } from '@/api/agentSessions';

type QuestionView = Extract<ReplySegment, { kind: 'question' }>;

/** 服务端出的题 → 和认开头认出来的同一个形状；推荐那一行照服务端 markdown 的措辞写。 */
function viewOfAsked(q: AskedQuestion): QuestionView {
  const labelOf = (key: string) => q.options.find((o) => o.key === key)?.label ?? key;
  const rec = q.recommended.map((key) => `${key}（${labelOf(key)}）`).join('、');
  return {
    kind: 'question',
    no: q.no,
    title: q.title,
    ask: `${q.ask}${q.multiple ? '（可多选）' : ''}`,
    body: '',
    options: q.options.map((o) => ({ key: o.key, label: o.label, desc: o.note ?? '' })),
    recommendation: `推荐 **${rec}**：${q.why}`,
  };
}

function QuestionBlock({ q, assets }: { q: QuestionView; assets: readonly KnownAsset[] }) {
  return (
    <div className={styles.question}>
      <div className={styles.questionHead}>
        {q.no && <span className={styles.questionNo}>{q.no}</span>}
        <span className={styles.questionTitle}>{q.title}</span>
        {q.ask && <span className={styles.questionAsk}>{q.ask}</span>}
      </div>
      {q.body && <Markdown text={q.body} assets={assets} className={styles.questionBody} />}
      {q.options.length > 0 && (
        <div className={styles.questionOptions}>
          {q.options.map((o, i) => (
            <div key={i} className={styles.questionOption}>
              <span className={styles.questionKey}>{o.key}</span>
              <span className={styles.questionOptionText}>
                <span className={styles.questionLabel}>{o.label}</span>
                {o.desc && <span className={styles.questionDesc}>：{o.desc}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {q.recommendation && (
        <div className={styles.questionRec}>
          <Markdown text={q.recommendation} assets={assets} className={styles.questionRecBody} />
        </div>
      )}
    </div>
  );
}

export function ReplyText({ text, assets, questions }: { text: string; assets: readonly KnownAsset[]; questions?: readonly AskedQuestion[] }) {
  if (questions?.length) {
    return (
      <>
        {questions.map((q) => (
          <QuestionBlock key={q.no} q={viewOfAsked(q)} assets={assets} />
        ))}
      </>
    );
  }
  const segments = splitReplySegments(text);
  if (segments.length === 1 && segments[0].kind === 'markdown') return <Markdown text={text} assets={assets} />;
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'markdown' ? <Markdown key={i} text={seg.text} assets={assets} /> : <QuestionBlock key={i} q={seg} assets={assets} />,
      )}
    </>
  );
}
