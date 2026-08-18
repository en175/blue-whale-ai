/* ============================================
 * AgentPanel Agent 智能体对话面板：消息流与任务执行
 * ============================================ */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import {
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  Square,
  RotateCw,
  PictureInPicture2,
  BookText,
  Coins,
} from 'lucide-react';
import styles from './index.module.css';
import { isApiError } from '@/api/http';
import { fetchRunSkillRecommendations, type RunSkillRecommendation } from '@/api/skills';
import { useAgentSession, type ChatMessage, type AgentPhase } from '../../hooks/useAgentSession';
import type { SessionContentBlock } from '@/api/agentSessions';
import SkillModal from '@/pages/Home/components/SkillModal';

/** 内联 markdown：**bold** 与 `code` */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-c${i}`}>{token.slice(1, -1)}</code>);
    }
    last = m.index + token.length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** 极简 markdown 块级渲染（标题/列表/引用/段落） */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  text.split('\n').forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={idx} className={styles.mdH}>{renderInline(h[2], `h${idx}`)}</div>);
      return;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      blocks.push(<div key={idx} className={styles.mdLi}>- {renderInline(li[1], `l${idx}`)}</div>);
      return;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      blocks.push(<div key={idx} className={styles.mdQuote}>&gt; {renderInline(q[1], `q${idx}`)}</div>);
      return;
    }
    blocks.push(<p key={idx} className={styles.mdP}>{renderInline(line, `p${idx}`)}</p>);
  });
  return <>{blocks}</>;
}

/** 可折叠思考过程：小字展示当前步骤，默认收起 */
function ThinkingBlock({ steps, defaultOpen = false }: { steps: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;
  return (
    <div className={styles.thinkingBlock}>
      <button
        type="button"
        className={styles.thinkingToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>思考过程</span>
        {open ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
      </button>
      {open && (
        <div className={styles.thinkingBody}>
          {steps.map((s, i) => (
            <div key={i} className={styles.thinkingStep}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 需求理解确认门：结构化总结 + 确认/继续补充/修改 */
function UnderstandingCard({
  data,
  onConfirm,
  onSupplement,
  onModify,
  disabled,
}: {
  data: NonNullable<SessionContentBlock['understanding']>;
  onConfirm: () => void;
  onSupplement: () => void;
  onModify: () => void;
  disabled: boolean;
}) {
  const tags = data.specs ?? [];
  return (
    <div className={styles.understandingCard}>
      <div className={styles.cardTitle}>需求理解总结</div>
      {data.goal && <p className={styles.cardGoal}>{data.goal}</p>}
      {data.assets && data.assets.length > 0 && (
        <div className={styles.cardLine}>
          <span className={styles.cardLabel}>使用素材</span>
          <span>{data.assets.join('、')}</span>
        </div>
      )}
      {data.direction && (
        <div className={styles.cardLine}>
          <span className={styles.cardLabel}>内容方向</span>
          <span>{data.direction}</span>
        </div>
      )}
      {tags.length > 0 && (
        <div className={styles.tagList}>
          {tags.map((t) => <span key={t} className={styles.tag}>{t}</span>)}
        </div>
      )}
      {data.uncertainties && data.uncertainties.length > 0 && (
        <div className={styles.cardLine}>
          <span className={styles.cardLabel}>不确定点</span>
          <span>{data.uncertainties.join('；')}</span>
        </div>
      )}
      <div className={styles.cardActions}>
        <button type="button" className={styles.cardBtn} onClick={onSupplement} disabled={disabled}>
          继续补充
        </button>
        <button type="button" className={styles.cardBtn} onClick={onModify} disabled={disabled}>
          修改方向
        </button>
        <button type="button" className={`${styles.cardBtn} ${styles.cardBtnPrimary}`} onClick={onConfirm} disabled={disabled}>
          确认需求理解
        </button>
      </div>
    </div>
  );
}

/** 追问卡：待补充的关键问题 */
function ClarifyCard({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <div className={styles.clarifyCard}>
      <div className={styles.cardTitle}>需要补充</div>
      <ul className={styles.clarifyList}>
        {questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
    </div>
  );
}

/** 分镜提示词生成卡：单镜头卡（画面/提示词/素材引用 + 自然语言修改/手动应用） */
function GenerationCard({
  card,
  onModify,
  onApply,
  disabled,
  applied,
}: {
  card: NonNullable<SessionContentBlock['card']>;
  onModify: () => void;
  onApply: () => void;
  disabled: boolean;
  applied?: boolean;
}) {
  return (
    <div className={styles.generationCard}>
      <div className={styles.shotHeader}>
        <span className={styles.shotTitle}>{card.shotTitle}</span>
        {applied && <span className={styles.shotApplied}>已进入 dock</span>}
        {!applied && card.timeRange && <span className={styles.shotTime}>{card.timeRange}</span>}
      </div>
      {card.visual && (
        <div className={styles.shotField}>
          <span className={styles.shotFieldLabel}>画面</span>
          <span className={styles.shotFieldValue}>{card.visual}</span>
        </div>
      )}
      {card.prompt && (
        <div className={styles.shotField}>
          <span className={styles.shotFieldLabel}>提示词</span>
          <span className={styles.shotFieldValue}>{card.prompt}</span>
        </div>
      )}
      {card.assetRefs && card.assetRefs.length > 0 && (
        <div className={styles.shotRefs}>
          {card.assetRefs.map((r) => (
            <span key={r} className={styles.shotRef}>{r}</span>
          ))}
        </div>
      )}
      {applied ? (
        <div className={styles.appliedHint}>生成卡内容已进入 Canvas dock</div>
      ) : (
        <div className={styles.cardActions}>
          <button type="button" className={styles.cardBtn} onClick={onModify} disabled={disabled}>
            自然语言修改
          </button>
          <button type="button" className={`${styles.cardBtn} ${styles.cardBtnPrimary}`} onClick={onApply} disabled={disabled}>
            手动应用到 Canvas dock
          </button>
        </div>
      )}
    </div>
  );
}

/** 助手消息：按结构化块渲染（text/thinking/understanding/clarify/card），无块时回退纯文本 */
function AssistantMessageBody({
  message,
  onConfirm,
  onSupplement,
  onModify,
  onCardModify,
  onCardApply,
  disabled,
  appliedCardIds,
}: {
  message: ChatMessage;
  onConfirm: () => void;
  onSupplement: () => void;
  onModify: () => void;
  onCardModify: (card: NonNullable<SessionContentBlock['card']>) => void;
  onCardApply: (card: NonNullable<SessionContentBlock['card']>) => void;
  disabled: boolean;
  appliedCardIds: Set<string>;
}) {
  const blocks = message.blocks ?? [];
  const structured = blocks.filter((b) => b.type !== 'text');
  // 有结构化块 → 按块渲染；无 → 纯文本 markdown
  if (structured.length === 0) return <Markdown text={message.content} />;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'thinking' && b.thinking?.steps) {
          return <ThinkingBlock key={i} steps={b.thinking.steps} />;
        }
        if (b.type === 'understanding' && b.understanding) {
          return (
            <UnderstandingCard
              key={i}
              data={b.understanding}
              onConfirm={onConfirm}
              onSupplement={onSupplement}
              onModify={onModify}
              disabled={disabled}
            />
          );
        }
        if (b.type === 'clarify' && b.clarify?.questions) {
          return <ClarifyCard key={i} questions={b.clarify.questions} />;
        }
        if (b.type === 'card' && b.card) {
          const cardId = b.card.cardId ?? b.card.shotTitle;
          return (
            <GenerationCard
              key={i}
              card={b.card}
              onModify={() => onCardModify(b.card!)}
              onApply={() => onCardApply(b.card!)}
              disabled={disabled}
              applied={appliedCardIds.has(cardId)}
            />
          );
        }
        if (b.text) return <Markdown key={i} text={b.text} />;
        return null;
      })}
    </>
  );
}

/** 可选模型列表 */
const models = [
  { key: 'minimax-m3', label: 'MiniMax-M3', cost: '1x' },
  { key: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', cost: '1x' },
  { key: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash', cost: '1x' },
  { key: 'qwen3.8-max', label: 'Qwen3.8-Max', cost: '1x' },
];

/** 快捷问题 */
const quickQuestions = [
  {
    title: '生成一张插画',
    prompt: '帮我生成一张插画，主题是夏日海边的小镇，色调温暖明亮。',
  },
  {
    title: '构思一个短视频',
    prompt: '帮我构思一个 15 秒的短视频，用于展示一款环保水杯。',
  },
  {
    title: '头脑风暴创意方向',
    prompt: '我想做一个品牌视觉方案，先帮我头脑风暴几个创意方向。',
  },
];

/** 侧边栏状态文案（对齐 04-侧边栏规范 §7 用户感知） */
const phaseLabels: Record<AgentPhase, string> = {
  idle: '等待输入',
  processing: 'Agent 处理中',
  awaiting_input: '等待你补充',
  awaiting_confirm: '等待你确认需求理解',
  generating_cards: '正在整理分镜提示词',
  cards_ready: '生成卡已就绪',
  applying: '正在应用到 Canvas dock',
  applied: '已进入 Canvas dock',
  failed: '处理失败',
};

/** 默认位置（页面中间偏右） */
const DEFAULT_POSITION = { x: 0, y: 0 };

interface AgentPanelProps {
  onClose: () => void;
  initialInput?: string;
  /** 外部注入版本号：变化时覆盖输入框（节点「添加到对话」） */
  inputVersion?: number;
  /** 当前项目ID：发送消息走 POST /api/projects/:id/conversation/messages */
  projectId?: string;
  /** 生成卡手动应用 → Canvas dock（S3 通道：CanvasPage 打开 BottomDialog 承接） */
  onApplyToDock?: (payload: { prompt: string; assetRefs: string[]; cardId?: string }) => void;
}

export default function AgentPanel({ onClose, initialInput, inputVersion, projectId, onApplyToDock }: AgentPanelProps) {
  const [inputValue, setInputValue] = useState(initialInput ?? '');
  const [selectedModel, setSelectedModel] = useState(models[0].key);
  const [modelOpen, setModelOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [floating, setFloating] = useState(false);
  /* ---- 对话状态机：消息流/运行态/流式文本由 session 维度事件流驱动（快照水合 + assistant.delta 流式） ---- */
  const {
    messages,
    streamingText,
    streaming,
    runningRunId,
    failedRunId,
    thinkingSteps,
    agentPhase,
    sendMessage,
    stopRun,
    retryRun,
    resetChat,
  } = useAgentSession(projectId ?? '');
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 当前 Run 的技能推荐列表（推荐区域展示） */
  const [recs, setRecs] = useState<RunSkillRecommendation[]>([]);
  /** 已点 Use 的推荐技能ID（仅用户点 Use 可激活） */
  const [usedSkillIds, setUsedSkillIds] = useState<Set<string>>(new Set());
  /** 已手动应用到 Canvas dock 的生成卡ID（标记「已应用」） */
  const [appliedCardIds, setAppliedCardIds] = useState<Set<string>>(new Set());

  /* ---- 拖动状态 ---- */
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [initialized, setInitialized] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const currentModel = models.find((m) => m.key === selectedModel);

  /** 外部注入 @ 引用：仅在版本变化时覆盖，避免打字时被打断 */
  useEffect(() => {
    if (inputVersion) setInputValue(initialInput ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputVersion]);

  /** 运行开始后拉取 Run 级技能推荐（GET /api/agent/runs/:runId/creative-skill-recommendations）
   * 后端未部署该接口（404）时静默隐藏推荐区域 */
  useEffect(() => {
    if (runningRunId === null) return;
    let alive = true;
    fetchRunSkillRecommendations(runningRunId)
      .then((list) => {
        if (alive) setRecs(Array.isArray(list) ? list : []);
      })
      .catch((e) => {
        if (isApiError(e) && e.status === 404) {
          if (alive) setRecs([]);
          return;
        }
        console.warn('获取技能推荐失败:', e);
      });
    return () => {
      alive = false;
    };
  }, [runningRunId]);

  /** 新消息/流式文本自动滚动到底部 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, runningRunId]);

  /** 初始化位置：屏幕右侧，间距按页面尺寸百分比计算（右 1.5%、上 1%、下 7%） */
  useEffect(() => {
    if (!initialized && panelRef.current) {
      const el = panelRef.current;
      const page = el.parentElement;
      if (page) {
        const rect = el.getBoundingClientRect();
        const header = page.querySelector('header');
        const headerH = header?.getBoundingClientRect().height ?? 0;
        setPosition({
          x: page.clientWidth * (1 - 0.015) - rect.width,
          y: headerH + page.clientHeight * 0.01,
        });
        setPanelHeight(page.clientHeight - headerH - page.clientHeight * 0.08);
      }
      setInitialized(true);
    }
  }, [initialized]);

  /** 鼠标按下头部开始拖动（仅浮动模式下可拖） */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!floating) return;
      // 只在 header 区域按下时触发拖动（排除按钮点击）
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      const header = target.closest(`.${styles.panelHeader}`);
      if (!header) return;

      e.preventDefault();
      dragState.current = {
        dragging: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: position.x,
        origY: position.y,
      };
    },
    [position, floating],
  );

  /** 鼠标移动 */
  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.dragging) return;
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      setPosition({ x: ds.origX + dx, y: ds.origY + dy });
    },
    [],
  );

  /** 鼠标释放 */
  const handleDragEnd = useCallback(() => {
    dragState.current.dragging = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  /** 点击快捷问题 */
  const handleQuickQuestion = (prompt: string) => {
    setInputValue(prompt);
  };

  /** 开启新对话：清空当前输入、消息流与技能推荐 */
  const handleNewChat = () => {
    setInputValue('');
    resetChat();
    setRecs([]);
    setUsedSkillIds(new Set());
  };

  /** 使用推荐技能：标记已激活，并把技能意图追加为一条消息提交给 Agent */
  const handleUseSkill = (r: RunSkillRecommendation) => {
    if (usedSkillIds.has(r.creative_skill_id) || runningRunId !== null || streaming) return;
    setUsedSkillIds((prev) => new Set(prev).add(r.creative_skill_id));
    sendMessage(`使用「${r.name}」技能继续创作`, r.creative_skill_id);
  };

  /** 发送消息：提交到 Agent 会话接口（回复经事件流 assistant.delta 流式上屏） */
  const handleSend = () => {
    const content = inputValue.trim();
    if (!content || runningRunId !== null || streaming) return;
    setInputValue('');
    sendMessage(content);
  };

  /** 确认需求理解：向会话提交确认动作（进入生成卡生产） */
  const handleConfirm = () => {
    if (runningRunId !== null || streaming) return;
    sendMessage('确认需求理解，生成分镜提示词卡');
  };

  /** 继续补充 / 修改方向：把输入框预填为补充引导，等待用户输入 */
  const handleSupplement = () => {
    setInputValue('补充信息：');
  };

  const handleModify = () => {
    setInputValue('修改方向：');
  };

  /** 自然语言修改某张生成卡：预填修改指令到输入框，进入新的 AgentRun */
  const handleCardModify = (card: NonNullable<SessionContentBlock['card']>) => {
    setInputValue(`修改「${card.shotTitle}」：`);
  };

  /** 手动应用生成卡到 Canvas dock：标记已应用 + 回调 CanvasPage 打开 dock 承接 */
  const handleCardApply = (card: NonNullable<SessionContentBlock['card']>) => {
    if (runningRunId !== null || streaming) return;
    const cardId = card.cardId ?? card.shotTitle;
    setAppliedCardIds((prev) => new Set(prev).add(cardId));
    onApplyToDock?.({
      prompt: card.prompt,
      assetRefs: card.assetRefs ?? [],
      cardId,
    });
  };

  /** 上传文件 */
  const handleUploadClick = () => {
    setShowUpload(!showUpload);
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
    setShowUpload(false);
  };

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={initialized ? { left: position.x, top: position.y, height: panelHeight, transform: 'none' } : undefined}
      onMouseDown={handleDragStart}
    >
      {/* 头部标题栏（拖动区域） */}
      <div className={`${styles.panelHeader} ${floating ? styles.panelHeaderFloating : ''}`}>
        <div className={styles.headerLeft}>
          <button className={styles.newChatBtn} onClick={handleNewChat} title="开启新对话">
            <Plus size={18} strokeWidth={2.5} />
            <span>新对话</span>
          </button>
        </div>
        <div className={styles.headerRight}>
          <button
            className={`${styles.iconBtn} ${floating ? styles.iconBtnActive : ''}`}
            onClick={() => setFloating((f) => !f)}
            title={floating ? '固定窗口' : '浮动窗口（可拖动）'}
          >
            <PictureInPicture2 size={14} strokeWidth={2} />
          </button>
          <button className={styles.iconBtn} onClick={onClose} title="关闭">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {messages.length === 0 && !streamingText ? (
        <>
          {/* 提示文案 */}
          <div className={styles.hintArea}>
            <h3 className={styles.hintTitle}>让 Agent 帮你创作</h3>
            <p className={styles.hintDesc}>
              描述你想生成的图片或视频，发送第一条消息即可开始。未发送的草稿会自动保留。
            </p>
          </div>

          {/* 快捷问题卡片 */}
          <div className={styles.quickCards}>
            {quickQuestions.map((q, i) => (
              <button
                key={i}
                className={styles.quickCard}
                onClick={() => handleQuickQuestion(q.prompt)}
              >
                <span className={styles.quickTitle}>{q.title}</span>
                <span className={styles.quickDesc}>{q.prompt}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        /* 对话消息流 */
        <div className={styles.messageList} ref={listRef}>
          {/* 侧边栏状态条（S5：状态机用户可见反馈） */}
          {messages.length > 0 && agentPhase !== 'idle' && (
            <div className={`${styles.phaseBar} ${styles[`phase_${agentPhase}`] ?? ''}`}>
              <span className={styles.phaseDot} />
              {phaseLabels[agentPhase]}
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className={styles.userBubble}>{m.content}</div>
            ) : (
              <div key={m.id} className={styles.assistantBlock}>
                <AssistantMessageBody
                  message={m}
                  onConfirm={handleConfirm}
                  onSupplement={handleSupplement}
                  onModify={handleModify}
                  onCardModify={handleCardModify}
                  onCardApply={handleCardApply}
                  disabled={runningRunId !== null || streaming}
                  appliedCardIds={appliedCardIds}
                />
              </div>
            ),
          )}
          {/* Agent 运行中的实时思考过程（reasoning_trace.updated.v1 流式） */}
          {streaming && thinkingSteps.length > 0 && (
            <div className={styles.assistantBlock}>
              <ThinkingBlock steps={thinkingSteps} />
            </div>
          )}
          {/* Agent 运行中的实时流式文本（assistant.delta 累积投影） */}
          {streamingText && (
            <div className={styles.assistantBlock}>
              <Markdown text={streamingText} />
            </div>
          )}
          {(runningRunId !== null || streaming) && (
            <div className={styles.cancelRow}>
              <button className={styles.cancelBtn} onClick={stopRun}>取消运行</button>
            </div>
          )}
        </div>
      )}

      {/* Run 级技能推荐区域 */}
      {recs.length > 0 && (
        <div className={styles.recommendArea}>
          <div className={styles.recommendTitle}>推荐技能</div>
          <div className={styles.recommendList}>
            {recs.map((r) => {
              const used = usedSkillIds.has(r.creative_skill_id);
              return (
                <div key={r.creative_skill_id} className={styles.recommendItem}>
                  <div className={styles.recommendInfo}>
                    <span className={styles.recommendName}>{r.name}</span>
                    <span className={styles.recommendDesc} title={r.description}>{r.description}</span>
                  </div>
                  <button
                    className={`${styles.recommendUseBtn} ${used ? styles.recommendUsed : ''}`}
                    onClick={() => handleUseSkill(r)}
                    disabled={used || runningRunId !== null || streaming}
                  >
                    {used ? '已使用' : 'Use'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <div className={styles.inputArea}>
        <div className={styles.inputBox}>
          <textarea
            className={styles.textarea}
            placeholder="描述你的想法，使用 @ 引用素材"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
          />

          {/* 底部工具栏 */}
          <div className={styles.inputToolbar}>
          {/* 左侧 */}
          <div className={styles.toolbarLeft}>
            <div className={styles.uploadWrap}>
              <button
                className={styles.toolBtn}
                onClick={handleUploadClick}
                title="上传素材"
              >
                <Plus size={18} strokeWidth={2} />
              </button>
              {showUpload && (
                <div className={styles.uploadPopup}>
                  <button onClick={handleFileSelect}>上传图片</button>
                  <button onClick={handleFileSelect}>上传视频</button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className={styles.hiddenInput}
              />
            </div>

            <button
              className={styles.skillBtn}
              onClick={() => setShowSkillModal(!showSkillModal)}
            >
              <BookText size={14} strokeWidth={2} />
              <span>技能</span>
            </button>
          </div>

          {/* 右侧 */}
          <div className={styles.toolbarRight}>
            <div className={styles.modelWrap}>
              <button
                className={styles.modelBtn}
                onClick={() => setModelOpen(!modelOpen)}
              >
                <span className={styles.modelLabel}>
                  {currentModel?.label ?? '选择模型'}
                </span>
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`${styles.modelArrow} ${modelOpen ? styles.modelArrowUp : ''}`}
                />
              </button>
              {modelOpen && (
                <div className={styles.modelDropdown}>
                  <div className={styles.modelDropdownHeader}>
                    <span className={styles.modelDropdownTitle}>Agent 模型</span>
                    <span className={styles.modelDropdownDesc}>选择驱动 Agent 的模型。</span>
                  </div>
                  {models.map((m) => (
                    <button
                      key={m.key}
                      className={`${styles.modelOption} ${m.key === selectedModel ? styles.modelOptionActive : ''}`}
                      onClick={() => {
                        setSelectedModel(m.key);
                        setModelOpen(false);
                      }}
                    >
                      <span>{m.label}</span>
                      <span className={styles.modelCost}>
                        <Coins size={14} strokeWidth={2} />
                        消耗 {m.cost}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {failedRunId !== null && (
              <button
                className={styles.retryBtn}
                onClick={retryRun}
                title="重试失败的运行"
              >
                <RotateCw size={16} strokeWidth={2} />
              </button>
            )}
            {runningRunId !== null || streaming ? (
              <button
                className={`${styles.sendBtn} ${styles.stopBtnActive}`}
                onClick={stopRun}
                title="停止运行"
              >
                <Square size={14} fill="#fff" strokeWidth={0} />
              </button>
            ) : (
              <button
                className={`${styles.sendBtn} ${inputValue.trim() ? styles.sendBtnActive : ''}`}
                onClick={handleSend}
                disabled={!inputValue.trim()}
                title="发送"
              >
                <ArrowUp size={18} fill="#fff" strokeWidth={0} />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Skill 技能库弹窗（与首页对话框共用） */}
      <SkillModal open={showSkillModal} onClose={() => setShowSkillModal(false)} />
    </div>
  );
}
