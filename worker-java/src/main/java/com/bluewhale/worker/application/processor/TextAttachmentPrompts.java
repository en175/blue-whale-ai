package com.bluewhale.worker.application.processor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 文本附件快照解析与确定性组合（packages/core compose-text-attachment-prompt.ts 的 Java 对齐，
 * IKDLQF/IKDLQG 共享契约），图片/视频/音频处理器共用——原寄宿于 VideoJobProcessor，
 * IKFCXE 引入音频消费后抽为共享 helper，解除音频处理器对视频处理器的编译期依赖。
 * 契约口径见 docs/specs/2026-09-13-ikfcxe-audio-text-context-contract.md §4。
 */
final class TextAttachmentPrompts {

    private TextAttachmentPrompts() {
    }

    /**
     * 解析 text_attachments 快照（video-job-runner.ts:581-583 safeParse 的 Java 对齐）：
     * 形状为元素 { node_id(非空), title, text }；快照损坏（非数组/元素形状不合法）整体按无附件处理，
     * 不阻断提交（存量任务无该字段同样返回空列表）。与 TS schema 的差异：zod .strict() 对未知字段
     * 整体拒收，此处仅校验约定字段（快照由接纳侧唯一产生，不出现未知字段）。
     */
    static List<Map<String, Object>> textAttachments(Map<String, Object> input) {
        if (!(input.get("text_attachments") instanceof List<?> raw)) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object item : raw) {
            if (!(item instanceof Map<?, ?> m)
                    || !(m.get("node_id") instanceof String nodeId) || nodeId.isEmpty()
                    || !(m.get("title") instanceof String)
                    || !(m.get("text") instanceof String)) {
                return List.of();
            }
            out.add(castMap(m));
        }
        return out;
    }

    /**
     * 文本附件确定性组合：空白附件文本跳过、非空目标提示词追加末尾、直接拼接不加空行，不改写正文。
     * 已知差异：空白判定用 isBlank（Character.isWhitespace），JS trim() 额外移除 NBSP(\u00A0) 等
     * 不间断空白——纯 NBSP 正文 TS 过滤、此处保留；接纳侧冻结的正文不产生此类输入，行为不受影响。
     */
    static String composeTextAttachmentPrompt(List<Map<String, Object>> attachments, String prompt) {
        List<String> parts = new ArrayList<>();
        for (Map<String, Object> attachment : attachments) {
            String text = (String) attachment.get("text");
            if (text != null && !text.isBlank()) parts.add(text);
        }
        if (prompt != null && !prompt.isBlank()) parts.add(prompt);
        return String.join("", parts);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Map<?, ?> map) {
        return (Map<String, Object>) map;
    }
}
