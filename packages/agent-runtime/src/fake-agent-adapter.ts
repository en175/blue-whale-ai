import type {
  AgentAction,
  AgentAdapter,
  AgentHistoryMessage,
  AgentRequest,
  AgentResult,
  PlanCardCandidateCore,
} from "@blue-whale/core";
import { createHash } from "node:crypto";

const FAILURE_MARKER = "fake:failure";
const FAILURE_ONCE_MARKER = "fake:failure-once";
const DELAY_MARKER = /fake:delay:(\d+)/;
// failure-once 进程级记忆（契约 §8.5）：同一 prompt 首次调用确定性失败，重试成功。
const failureOnceSeen = new Set<string>();

// PlanPhase 验收标记约定（Node Agent Runtime Contract §7）
const CREATE_MARKER = "创作：";
const MODIFY_MARKER = "修改：";
const YOU_DECIDE_MARKER = "你决定";
const UNSUPPORTED_MARKER = "不支持：";
const STOP_MARKERS = ["停止", "不要创建计划"];
const CONTINUE_MARKER = "继续讨论";
const AGREE_MARKER = "同意";
// T09（IK67H6）提交标记约定（契约 §7）：控制 RunCommit completed_with_plan 的候选形状。
const IMMEDIATE_PLAN_MARKER = "立即出计划"; // 跳过最终确认，必需项齐备即提交
const TWO_CARDS_MARKER = "出两张"; // 2 卡混合：image_generate + scene_card_create
const REPLACE_SCENE_CARD_MARKER = "覆盖场景卡"; // 1 卡 scene_card_replace，独占
const SEQUENCE_LABEL_NOUN = "分镜";
const CONFIRM_QUESTION = "确认以上需求并正式提交计划吗？";
export const CANCEL_ACK = "好的，已按你的要求停止，不会创建计划。";

interface AlignmentItem {
  key: "subject" | "outcome" | "target" | "change";
  label: string;
  marker: string;
  question: string;
  fallback: string;
}

const CREATION_ITEMS: readonly AlignmentItem[] = [
  {
    key: "subject",
    label: "主体",
    marker: "主体：",
    question: "请告诉我这次创作的主体是什么？",
    fallback: "由系统选择的默认主体",
  },
  {
    key: "outcome",
    label: "预期结果",
    marker: "预期：",
    question: "请告诉我你期望的结果是什么？",
    fallback: "由系统选择的默认结果",
  },
];

const MODIFICATION_ITEMS: readonly AlignmentItem[] = [
  {
    key: "target",
    label: "目标",
    marker: "目标：",
    question: "请告诉我这次修改的目标是什么？",
    fallback: "由系统选择的默认目标",
  },
  {
    key: "change",
    label: "变化",
    marker: "变化：",
    question: "请告诉我你期望的变化是什么？",
    fallback: "由系统选择的默认变化",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ALL_MARKERS = [
  "主体：",
  "预期：",
  "目标：",
  "变化：",
  UNSUPPORTED_MARKER,
  IMMEDIATE_PLAN_MARKER,
  TWO_CARDS_MARKER,
  REPLACE_SCENE_CARD_MARKER,
];

function extractMarkerValue(text: string, marker: string): string | null {
  const index = text.lastIndexOf(marker);
  if (index < 0) return null;
  let value = text.slice(index + marker.length).split("\n")[0]?.trim() ?? "";
  const nextMarkerIndex = Math.min(
    ...ALL_MARKERS.filter((candidate) => candidate !== marker)
      .map((candidate) => {
        const position = value.indexOf(candidate);
        return position < 0 ? Number.POSITIVE_INFINITY : position;
      })
      .concat(Number.POSITIVE_INFINITY),
  );
  if (Number.isFinite(nextMarkerIndex)) {
    value = value.slice(0, nextMarkerIndex).replace(/[，,、\s]+$/, "").trim();
  }
  return value.length > 0 ? value : null;
}

function alignmentResult(
  action: AgentAction,
  content: string,
  reasoningSummary: string,
): AgentResult {
  return {
    provider: "fake",
    content,
    reasoningSummary,
    action,
  };
}

function isAlignmentAssistant(content: string): boolean {
  return (
    [...CREATION_ITEMS, ...MODIFICATION_ITEMS].some(
      (item) => content === item.question,
    ) ||
    content.includes("需求复述：") ||
    content.includes("目前不受支持") ||
    content.includes("你想补充或调整哪部分需求")
  );
}

/** 按提交标记（§7）确定性派生计划卡候选。
 *  - 覆盖场景卡：1 张 scene_card_replace，target = 本轮 available SceneCardMention；无可覆盖目标返回空 → 调用方回退澄清。
 *  - 出两张：2 卡混合 image_generate + scene_card_create，sequence_label_noun=分镜。
 *  - 默认：1 张 image_generate。
 *  未指定参数不填（由 RunCommit 用能力默认补齐，AC#6）；asset:// 内联本轮首个 available asset。 */
function deriveFakeCards(
  request: AgentRequest,
  values: Map<string, string>,
  segmentUserText: string,
): readonly PlanCardCandidateCore[] {
  const firstAsset = request.mentionProjections.find(
    (mention) => mention.type === "asset" && mention.availability === "available",
  );
  const assetInline = firstAsset
    ? ` 参考素材 asset://${firstAsset.mention_id}`
    : "";
  const subject = values.get("subject") ?? values.get("target") ?? "主体";
  const outcome = values.get("outcome") ?? values.get("change") ?? "预期结果";

  if (segmentUserText.includes(REPLACE_SCENE_CARD_MARKER)) {
    const target = request.mentionProjections.find(
      (mention) =>
        mention.type === "scene_card" && mention.availability === "available",
    );
    if (!target) return [];
    return [
      {
        applicationKind: "scene_card_replace",
        title: `覆盖场景卡：${subject}`,
        contentMarkdown: `覆盖场景卡「${subject}」的变化：${outcome}。${assetInline}`.trim(),
        targetSceneCardMentionId: target.mention_id,
      },
    ];
  }

  if (segmentUserText.includes(TWO_CARDS_MARKER)) {
    return [
      {
        applicationKind: "image_generate",
        title: `${SEQUENCE_LABEL_NOUN} 1：${subject}`,
        contentMarkdown: `${SEQUENCE_LABEL_NOUN} 1——主体「${subject}」。${assetInline}`.trim(),
        sequenceLabelNoun: SEQUENCE_LABEL_NOUN,
      },
      {
        applicationKind: "scene_card_create",
        title: `${SEQUENCE_LABEL_NOUN} 2：${outcome}`,
        contentMarkdown: `${SEQUENCE_LABEL_NOUN} 2——预期「${outcome}」。${assetInline}`.trim(),
        sequenceLabelNoun: SEQUENCE_LABEL_NOUN,
      },
    ];
  }

  return [
    {
      applicationKind: "image_generate",
      title: subject,
      contentMarkdown: `主体「${subject}」，预期「${outcome}」。${assetInline}`.trim(),
    },
  ];
}

/** 产 submit_plan 候选；候选为空（如无可覆盖场景卡）时回退自然语言澄清。 */
function submitPlanResult(
  request: AgentRequest,
  intent: "create" | "modify",
  values: Map<string, string>,
  segmentUserText: string,
): AgentResult {
  const cards = deriveFakeCards(request, values, segmentUserText);
  if (cards.length === 0) {
    return alignmentResult(
      {
        kind: "clarify",
        question: "请先引用要覆盖的场景卡后再告诉我。",
        stage: "alignment",
      },
      "请先引用要覆盖的场景卡后再告诉我。",
      "缺少可覆盖的场景卡引用，继续澄清。",
    );
  }
  const summary =
    intent === "create"
      ? `主体「${values.get("subject")}」，预期「${values.get("outcome")}」`
      : `目标「${values.get("target")}」，变化「${values.get("change")}」`;
  return {
    provider: "fake",
    content: `已完成需求对齐：${summary}；正式提交 ${cards.length} 张计划卡。`,
    reasoningSummary: "需求已确认，正式提交计划卡。",
    action: { kind: "submit_plan", cards },
  };
}

/** 按契约 §7 的标记约定确定性推进 PlanPhase 对齐流程。
 *  意图只由当前输入的创作/修改标记决定；仅当历史尾部仍是未回答的对齐提问时，
 *  才把当前输入视为同一创作目标的续答。已对齐事实只从当前创作目标段提取，
 *  不继承此前已完成或已取消 Run 的取值。 */
function evaluatePlanPhase(request: AgentRequest): AgentResult | null {
  const history: readonly AgentHistoryMessage[] =
    request.historyMessages ?? [];
  const lastAssistant = [...history]
    .reverse()
    .find((message) => message.role === "assistant");
  const inOngoingAlignment =
    lastAssistant !== undefined &&
    isAlignmentAssistant(lastAssistant.content);
  if (
    !request.prompt.includes(CREATE_MARKER) &&
    !request.prompt.includes(MODIFY_MARKER) &&
    !inOngoingAlignment
  ) {
    return null;
  }

  const allMessages = [
    ...history,
    { role: "user" as const, content: request.prompt },
  ];
  let goalStart = allMessages.length - 1;
  for (let index = allMessages.length - 1; index >= 0; index -= 1) {
    const message = allMessages[index];
    if (
      message !== undefined &&
      message.role === "user" &&
      (message.content.includes(CREATE_MARKER) ||
        message.content.includes(MODIFY_MARKER))
    ) {
      goalStart = index;
      break;
    }
  }
  const segment = allMessages.slice(goalStart);
  const intent = segment.some(
    (message) =>
      message.role === "user" && message.content.includes(CREATE_MARKER),
  )
    ? "create"
    : segment.some(
          (message) =>
            message.role === "user" &&
            message.content.includes(MODIFY_MARKER),
        )
      ? "modify"
      : null;
  if (!intent) return null;
  // 提交模式（§7 标记）从整个创作目标段检测，跨多轮对齐稳定保留。
  const segmentUserText = segment
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");

  const items = intent === "create" ? CREATION_ITEMS : MODIFICATION_ITEMS;
  const values = new Map<string, string>();
  let pendingQuestion: string | null = null;
  let unsupported: string | null = null;

  for (const message of segment) {
    if (message.role === "assistant") {
      pendingQuestion = message.content;
      continue;
    }
    let restatedWithSupportedRequirement = false;
    for (const item of items) {
      const value = extractMarkerValue(message.content, item.marker);
      if (value) {
        values.set(item.key, value);
        restatedWithSupportedRequirement = true;
      }
    }
    const declaredUnsupported = extractMarkerValue(
      message.content,
      UNSUPPORTED_MARKER,
    );
    if (declaredUnsupported) {
      unsupported = declaredUnsupported;
    } else if (unsupported !== null && restatedWithSupportedRequirement) {
      unsupported = null;
    }
    if (
      message.content.includes(YOU_DECIDE_MARKER) &&
      unsupported === null &&
      pendingQuestion
    ) {
      const pendingItem = items.find(
        (item) => pendingQuestion === item.question,
      );
      if (pendingItem && !values.has(pendingItem.key)) {
        values.set(pendingItem.key, pendingItem.fallback);
      }
    }
  }

  const clarify = (
    question: string,
    reasoningSummary: string,
    stage: "alignment" | "awaiting_final_confirmation" = "alignment",
    content: string = question,
  ): AgentResult =>
    alignmentResult(
      { kind: "clarify", question, stage },
      content,
      reasoningSummary,
    );

  const lastUserText = request.prompt;
  if (STOP_MARKERS.some((marker) => lastUserText.includes(marker))) {
    return alignmentResult(
      { kind: "cancel" },
      CANCEL_ACK,
      "按 User 要求停止。",
    );
  }
  if (unsupported !== null) {
    const question = `「${unsupported}」目前不受支持，请改为受支持的要求后重新告诉我。`;
    return clarify(question, "存在不受支持的明确要求，继续澄清。");
  }
  const missing = items.find((item) => !values.has(item.key));
  if (missing) {
    return clarify(
      missing.question,
      `需求缺少${missing.label}，先澄清最关键的一项。`,
    );
  }
  if (lastUserText.includes(CONTINUE_MARKER)) {
    const hints = items.map((item) => `${item.marker.replace("：", "")}：`).join("或 ");
    return clarify(
      `你想补充或调整哪部分需求？（可直接用 ${hints} 给出）`,
      "按 User 要求继续讨论需求。",
    );
  }
  // 立即出计划（§7 标记）：必需项齐备即提交，跳过最终确认。
  if (lastUserText.includes(IMMEDIATE_PLAN_MARKER)) {
    return submitPlanResult(request, intent, values, segmentUserText);
  }
  const restated =
    intent === "create"
      ? `需求复述：主体「${values.get("subject")}」，预期「${values.get("outcome")}」。确认无误后我将正式提交计划。`
      : `需求复述：目标「${values.get("target")}」，变化「${values.get("change")}」。确认无误后我将正式提交计划。`;
  if (
    lastUserText.includes(AGREE_MARKER) &&
    pendingQuestion !== null &&
    pendingQuestion.includes("需求复述：")
  ) {
    // 最终确认通过：提交计划卡候选（RunCommit completed_with_plan 原子接纳）。
    return submitPlanResult(request, intent, values, segmentUserText);
  }
  return clarify(
    CONFIRM_QUESTION,
    "需求已对齐，等待最终确认。",
    "awaiting_final_confirmation",
    restated,
  );
}

export function createFakeAgentAdapter(): AgentAdapter {
  return {
    name: "fake-agent-runtime",
    async ready() {
      return true;
    },
    async invoke(request) {
      if (request.prompt.includes(FAILURE_ONCE_MARKER)) {
        if (!failureOnceSeen.has(request.prompt)) {
          failureOnceSeen.add(request.prompt);
          throw new Error("fake agent transient failure");
        }
      } else if (request.prompt.includes(FAILURE_MARKER)) {
        throw new Error("fake agent explicit failure");
      }
      const delayMatch = DELAY_MARKER.exec(request.prompt);
      if (delayMatch) await sleep(Number(delayMatch[1]));

      const planPhase = evaluatePlanPhase(request);
      if (planPhase) return planPhase;

      const skillFingerprint = request.creativeSkill
        ? `\ncreative-skill:${request.creativeSkill.resourceDigest}`
        : "";
      const fingerprint = createHash("sha256")
        .update(`blue-whale-agent-fake-v1\n${request.prompt}${skillFingerprint}`)
        .digest("hex");

      return {
        provider: "fake",
        content: `fake-agent-response:${fingerprint}`,
        reasoningSummary: request.creativeSkill
          ? `已使用「${request.creativeSkill.name}」完成回答。`
          : "已完成回答。",
        action: { kind: "respond" },
      };
    },
  };
}
