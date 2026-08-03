/** 对话总结保存个人技能管道（IK60X1，资产契约 §15）。
 *  由 agent-worker 执行：claim 到 skill_summarize 标记的 Run → 总结模式；
 *  会话存在 pending 待确认记录 → 确认模式；确认模式判定「无关」→ pass_through
 *  回退正常 runtime。
 *
 *  受控 AI 接口同 §14：new-api /v1/chat/completions，baseUrl/token/model 全部
 *  服务端 env 注入，fetchImpl 注入即可控 AI 替身缝（单测不触网）。
 *
 *  LLM 输出协议：
 *  - 总结模式：信息不足 → 首行标记 [信息不足] 后跟补充说明；
 *    信息充分 → 只输出完整 SKILL.md 原文（容忍代码围栏包裹）；
 *  - 确认模式：首行标记 [确认]（可同行跟新名称）/ [取消] / [无关]；
 *  - 改名提议：只输出一个候选名称（单行）。
 *  解析一律宽松（容忍全角【】、首尾空白），解析失败按失败/保持 pending 处理，
 *  失败分支只产出失败说明文案，不创建技能，Run 正常 commitSuccess（§15.3）。 */

import { parseSkillMd, serializeSkillMd } from "@blue-whale/core";

// ---------- LLM 输出协议标记 ----------

const INSUFFICIENT_MARKER = /^\s*[【[]\s*信息不足\s*[】\]][^\S\n]*/;
const CONFIRM_REPLY_PATTERN = /^\s*[【[]\s*(确认|取消|无关)\s*[】\]][^\S\n]*(.*)$/;

// ---------- 固定规则（后台配置，env 覆盖；普通用户不可见不可改，§15.2） ----------

export const DEFAULT_SKILL_SUMMARIZE_RULES = `你是「对话总结保存个人技能」助手。用户希望把当前对话中沉淀的可复用做法提炼为一个 SKILL.md 个人技能。按以下固定规则处理，只输出协议约定的内容：
1. 通读对话历史（user/assistant 消息按时间序排列），判断其中是否包含足够具体、可复用的方法、流程或模板。
2. 信息不足时：第一行只输出 [信息不足]，随后用中文简要说明缺少哪些信息、请用户补充什么；不要输出 SKILL.md。
3. 信息充分时：只输出一个完整的 SKILL.md 原文，格式为：
   ---
   name: 技能名称
   description: 一句话简介
   ---

   正文（Markdown）
   name/description/正文均不能为空；不要输出代码围栏、解释或额外对话。
4. 技能内容必须来自对话本身，不编造对话中没有的能力；名称简洁通用，不含用户隐私信息。`;

export const DEFAULT_SKILL_SUMMARIZE_CONFIRM_RULES = `你是「技能名称确认」助手。此前对话总结生成了 SKILL.md 草稿，但保存时名称冲突，正在等待用户确认提议的新名称。判断用户回复的意图，第一行只输出以下标记之一：
[确认] —— 用户同意保存。若用户同时另给了新名称，把新名称接在标记后（同一行，空格分隔）；未另给名称则标记后不跟内容。
[取消] —— 用户明确放弃保存。
[无关] —— 用户回复与确认保存无关（在聊别的事）。
除标记行外不要输出任何内容。`;

/** 读取生效的总结规则：SKILL_SUMMARIZE_RULES（纯空白视为未配置）覆盖默认常量。 */
export function loadSkillSummarizeRules(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.SKILL_SUMMARIZE_RULES?.trim();
  return override || DEFAULT_SKILL_SUMMARIZE_RULES;
}

// ---------- 受控 chat 客户端（仿 format-ai-client.ts） ----------

export interface SkillSummarizeChatMessage {
  role: string;
  content: string;
}

export type SkillSummarizeChatClient = {
  complete(input: {
    rules: string;
    messages: SkillSummarizeChatMessage[];
  }): Promise<string>;
};

export function createSkillSummarizeChatClient(options: {
  baseUrl: string;
  token: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** 单次请求超时（默认 30s）；超时按失败处理（§15.3 失败分支）。 */
  timeoutMs?: number;
}): SkillSummarizeChatClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  return {
    async complete({ rules, messages }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${options.baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.token}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: [
              { role: "system", content: rules },
              ...messages.map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new Error(`chat completions HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("chat completions 返回空内容");
      }
      return content;
    },
  };
}

// ---------- 依赖端口（worker 接线时注入 persistence 实现） ----------

export interface SkillSummarizePendingDraft {
  draftContent: string;
  proposedName: string;
}

export interface SkillSummarizeStore {
  findPending(input: {
    conversationId: string;
    userId: string;
  }): Promise<SkillSummarizePendingDraft | null>;
  upsertPending(input: {
    conversationId: string;
    userId: string;
    draftContent: string;
    proposedName: string;
  }): Promise<void>;
  close(input: { conversationId: string; userId: string }): Promise<void>;
  listRecentMessages(input: {
    conversationId: string;
    limit: number;
  }): Promise<SkillSummarizeChatMessage[]>;
}

export interface PersonalSkillCreator {
  createPersonalSkill(
    userId: string,
    input: { name: string; description: string; body: string },
  ): Promise<{ creative_skill_id: string; name: string; description: string }>;
  checkPersonalNameAvailable(
    userId: string,
    name: string,
  ): Promise<"ok" | "conflict" | "reserved">;
}

/** 名称冲突/保留名（§15.3 冲突分支）：接线层把 SkillNameConflictError /
 *  SkillNameReservedError 映射为本错误，管道据此走提议名流程。 */
export class SkillNameTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillNameTakenError";
  }
}

// ---------- 管道 ----------

export interface SkillSummarizeWork {
  conversationId: string;
  userId: string;
  /** 本轮增量 user 消息（确认模式下即用户回复原文）。 */
  prompt: string;
}

export type SkillSummarizeOutcome =
  | { kind: "handled"; content: string }
  | { kind: "pass_through" };

export interface SkillSummarizePipeline {
  hasPending(work: {
    conversationId: string;
    userId: string;
  }): Promise<boolean>;
  run(work: SkillSummarizeWork): Promise<SkillSummarizeOutcome>;
}

const FAILURE_CONTENT =
  "对话总结失败：AI 服务暂不可用或输出不符合 SKILL.md 格式，本次未创建技能，请稍后重试。";
const DEFAULT_ASK_CONTENT =
  "当前对话信息还不足以提炼成可复用的技能，请补充更多具体做法或细节后再试。";

function handled(content: string): SkillSummarizeOutcome {
  return { kind: "handled", content };
}

/** 从 AI 输出中提取 SKILL.md 原文（容忍代码围栏包裹），非法 → null。 */
function extractSkillMd(output: string): string | null {
  const trimmed = output.trim();
  const fence = trimmed.match(/```(?:markdown|md|yaml)?\s*\n([\s\S]*?)```/);
  const candidate = (fence ? fence[1]! : trimmed).trim();
  return candidate.startsWith("---") ? candidate : null;
}

/** 总结模式输出判定：不足 → 补充说明文案；充分 → 校验后的三元组 + 原文；非法 → null。 */
function parseSummarizeOutput(output: string):
  | { kind: "insufficient"; content: string }
  | {
      kind: "sufficient";
      skill: { name: string; description: string; body: string };
      skillMd: string;
    }
  | null {
  if (INSUFFICIENT_MARKER.test(output)) {
    const rest = output.replace(INSUFFICIENT_MARKER, "").trim();
    return { kind: "insufficient", content: rest || DEFAULT_ASK_CONTENT };
  }
  const skillMd = extractSkillMd(output);
  if (!skillMd) return null;
  const skill = parseSkillMd(skillMd);
  if (!skill || !skill.name || !skill.description || !skill.body) return null;
  return { kind: "sufficient", skill, skillMd };
}

/** 确认模式回复判定：标记 + 可选同行新名称；无法解析 → null。 */
function parseConfirmReply(
  output: string,
): { decision: "确认" | "取消" | "无关"; newName: string | null } | null {
  const m = output.match(CONFIRM_REPLY_PATTERN);
  if (!m) return null;
  const rest = (m[2] ?? "").split("\n")[0]!.trim().replace(/^["'「]|["'」]$/g, "");
  return {
    decision: m[1] as "确认" | "取消" | "无关",
    newName: rest || null,
  };
}

export function createSkillSummarizePipeline(deps: {
  chat: SkillSummarizeChatClient;
  store: SkillSummarizeStore;
  skills: PersonalSkillCreator;
  rules?: string;
  confirmRules?: string;
  /** 会话历史截取条数（默认 50，§15.3）。 */
  historyLimit?: number;
}): SkillSummarizePipeline {
  const rules = deps.rules ?? DEFAULT_SKILL_SUMMARIZE_RULES;
  const confirmRules =
    deps.confirmRules ?? DEFAULT_SKILL_SUMMARIZE_CONFIRM_RULES;
  const historyLimit = deps.historyLimit ?? 50;

  /** 提议一个服务端验证可用的新名称：请 AI 基于占用名给替代名，不可用/失败重试一次；
   *  每个候选都经 checkPersonalNameAvailable 验证（§15.3）。
   *  不做本地序号兜底——CONTEXT.md Avoid：禁止名称冲突时自动追加后缀。
   *  返回 null 时由调用方挂 pending 并请用户直接提供新名称。 */
  async function proposeAvailableName(
    userId: string,
    takenName: string,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let suggestion: string;
      try {
        suggestion = await deps.chat.complete({
          rules: confirmRules,
          messages: [
            {
              role: "user",
              content: `技能名称「${takenName}」已被占用或为保留名。请只输出一个新的技能名称（单行，不要输出其他任何内容）。`,
            },
          ],
        });
      } catch {
        continue; // AI 提议失败：重试一次。
      }
      const name = suggestion
        .split("\n")[0]!
        .trim()
        .replace(/^["'「【\[]|["'」】\]]$/g, "");
      if (!name || name === takenName || name.length > 60) continue;
      if (
        (await deps.skills.checkPersonalNameAvailable(userId, name)) === "ok"
      ) {
        return name;
      }
    }
    return null;
  }

  async function summarizeMode(
    work: SkillSummarizeWork,
  ): Promise<SkillSummarizeOutcome> {
    const history = await deps.store.listRecentMessages({
      conversationId: work.conversationId,
      limit: historyLimit,
    });
    // 非法输出重试一次，重试仍非法按失败处理（§15.3）。
    let parsed: ReturnType<typeof parseSummarizeOutput> = null;
    for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
      let output: string;
      try {
        output = await deps.chat.complete({ rules, messages: history });
      } catch {
        return handled(FAILURE_CONTENT);
      }
      parsed = parseSummarizeOutput(output);
    }
    if (parsed === null) return handled(FAILURE_CONTENT);
    if (parsed.kind === "insufficient") return handled(parsed.content);

    try {
      const created = await deps.skills.createPersonalSkill(
        work.userId,
        parsed.skill,
      );
      return handled(
        `已总结当前对话并保存为个人技能「${created.name}」，可在「我的技能」中查看。`,
      );
    } catch (error) {
      if (!(error instanceof SkillNameTakenError)) {
        return handled(FAILURE_CONTENT);
      }
      // 名称冲突（§15.3）：禁止保存/禁止自动追加后缀落库；提议验证可用的新名，
      // 草稿与提议名挂入待确认会话（§15.4），等待用户确认。
      const proposed = await proposeAvailableName(
        work.userId,
        parsed.skill.name,
      );
      if (proposed !== null) {
        await deps.store.upsertPending({
          conversationId: work.conversationId,
          userId: work.userId,
          draftContent: parsed.skillMd,
          proposedName: proposed,
        });
        return handled(
          `技能名称「${parsed.skill.name}」与已有技能冲突或为保留名，本次未保存。草稿已备好，可改用名称「${proposed}」：回复"确认"保存、直接给出新名称改名保存，或回复"取消"放弃。`,
        );
      }
      // AI 提议名失败：仍挂 pending（proposedName 记占用名），请用户直接给新名。
      await deps.store.upsertPending({
        conversationId: work.conversationId,
        userId: work.userId,
        draftContent: parsed.skillMd,
        proposedName: parsed.skill.name,
      });
      return handled(
        `技能名称「${parsed.skill.name}」与已有技能冲突或为保留名，本次未保存。草稿已备好：请直接回复一个你想要的新名称保存，或回复"取消"放弃。`,
      );
    }
  }

  async function confirmMode(
    work: SkillSummarizeWork,
    pending: SkillSummarizePendingDraft,
  ): Promise<SkillSummarizeOutcome> {
    const draft = parseSkillMd(pending.draftContent);
    if (!draft || !draft.name || !draft.description || !draft.body) {
      // 草稿入库前已校验，此处为防御：草稿损坏则关闭会话按失败处理。
      await deps.store.close({
        conversationId: work.conversationId,
        userId: work.userId,
      });
      return handled(FAILURE_CONTENT);
    }

    let reply: string;
    try {
      reply = await deps.chat.complete({
        rules: confirmRules,
        messages: [
          {
            role: "user",
            content: `待确认的技能名称（提议名）：${pending.proposedName}\n草稿中的原始名称：${draft.name}\n用户回复：${work.prompt}`,
          },
        ],
      });
    } catch {
      // AI 失败：保持 pending，用户可继续回复确认/取消。
      return handled(FAILURE_CONTENT);
    }
    const decision = parseConfirmReply(reply);
    if (decision === null) {
      return handled(
        `没有理解你的回复。当前有待保存的技能草稿「${pending.proposedName}」：回复"确认"保存、直接给出新名称改名保存，或回复"取消"放弃。`,
      );
    }
    if (decision.decision === "无关") {
      await deps.store.close({
        conversationId: work.conversationId,
        userId: work.userId,
      });
      return { kind: "pass_through" };
    }
    if (decision.decision === "取消") {
      await deps.store.close({
        conversationId: work.conversationId,
        userId: work.userId,
      });
      return handled("已取消，未保存该技能。");
    }

    // 确认（可原样确认或另给新名）→ 用最终名称重试保存（§15.4）。
    const finalName = decision.newName ?? pending.proposedName;
    try {
      const created = await deps.skills.createPersonalSkill(work.userId, {
        name: finalName,
        description: draft.description,
        body: draft.body,
      });
      await deps.store.close({
        conversationId: work.conversationId,
        userId: work.userId,
      });
      return handled(
        `已保存为个人技能「${created.name}」，可在「我的技能」中查看。`,
      );
    } catch (error) {
      if (!(error instanceof SkillNameTakenError)) {
        return handled(FAILURE_CONTENT);
      }
      // 再次冲突：重新提议并继续保持 pending。
      const proposed = await proposeAvailableName(work.userId, finalName);
      if (proposed !== null) {
        await deps.store.upsertPending({
          conversationId: work.conversationId,
          userId: work.userId,
          draftContent: serializeSkillMd({
            name: finalName,
            description: draft.description,
            body: draft.body,
          }),
          proposedName: proposed,
        });
        return handled(
          `名称「${finalName}」仍与已有技能冲突或为保留名，未保存。可改用名称「${proposed}」：回复"确认"保存、直接给出新名称改名保存，或回复"取消"放弃。`,
        );
      }
      // AI 提议名失败：仍挂 pending（proposedName 记占用名），请用户直接给新名。
      await deps.store.upsertPending({
        conversationId: work.conversationId,
        userId: work.userId,
        draftContent: serializeSkillMd({
          name: finalName,
          description: draft.description,
          body: draft.body,
        }),
        proposedName: finalName,
      });
      return handled(
        `名称「${finalName}」仍与已有技能冲突或为保留名，未保存。请直接回复一个你想要的新名称保存，或回复"取消"放弃。`,
      );
    }
  }

  return {
    async hasPending(work) {
      return (await deps.store.findPending(work)) !== null;
    },
    async run(work) {
      // pending 待确认优先于总结意图（§15.4：无论是否带 skill_summarize 都进确认模式）。
      const pending = await deps.store.findPending(work);
      if (pending) return confirmMode(work, pending);
      return summarizeMode(work);
    },
  };
}

/** env 未配置时的兜底管道（§15.3 失败分支）：总结意图返回失败说明；
 *  确认模式关闭（hasPending 恒 false，不拦截普通消息走正常 runtime）。 */
export function createUnavailableSkillSummarizePipeline(): SkillSummarizePipeline {
  return {
    hasPending: async () => false,
    run: async () => handled(FAILURE_CONTENT),
  };
}
