package com.blue.whale.agent.service.generation;

import java.util.Base64;
import java.util.List;
import java.util.Map;

/**
 * 本地非生产确定性 Fake 图片 Provider：与真实图片 Provider 共用
 * {@link GenerationProvider} 产品中性请求/结果契约，不需要任何真实供应商凭据。
 * 仅供 {@code blue-whale.generation.mode=fake} 装配，生产环境禁止启用。
 *
 * <p>确定性指令（经 input.prompt 驱动，用于本地演练与集成测试的失败分支）：
 * {@code fake:failure} 显式失败、{@code fake:no-result} 无结果。
 *
 * <p>关联重试区分：{@code GenerationJobCommandService.retryMissingOutputs} 在重试 Job 的
 * input 中写入 {@code retry_slot_indexes}（原 Job 没有）。本 Provider 据此稳定区分原始失败
 * 尝试与其关联重试——原始 {@code fake:failure} 失败，关联重试成功，使"首次失败、重试成功"
 * 可重复验收（IK1NS1）。不修改 prompt（重试仅重新执行既有失败 Job）。仅 {@code fake:failure}
 * 参与重试区分，其他确定性指令（如 {@code fake:no-result}）在重试 Job 中保持原语义。
 */
public class LocalFakeImageGenerationProvider implements GenerationProvider {

    private static final byte[] ONE_PIXEL_PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    @Override
    public GenerationProviderResult generate(GenerationProviderRequest request) {
        String prompt = request.input() == null ? null : String.valueOf(request.input().get("prompt"));
        if ("fake:failure".equals(prompt)) {
            // 仅 fake:failure 的关联重试（input 含非空 retry_slot_indexes）走成功分支；
            // 其余确定性指令在重试中保持原语义
            if (isLinkedRetry(request.input())) {
                return GenerationProviderResult.success(ONE_PIXEL_PNG.clone(), "image/png", 1, 1);
            }
            return GenerationProviderResult.failure("provider_failed", "Fake Provider 显式失败");
        }
        if ("fake:no-result".equals(prompt)) {
            return GenerationProviderResult.noResult();
        }
        return GenerationProviderResult.success(ONE_PIXEL_PNG.clone(), "image/png", 1, 1);
    }

    /** 关联重试判定：input 含非空 retry_slot_indexes 列表（retryMissingOutputs 写入的失败槽索引）。 */
    private static boolean isLinkedRetry(Map<String, Object> input) {
        if (input == null) {
            return false;
        }
        Object slotIndexes = input.get("retry_slot_indexes");
        return slotIndexes instanceof List<?> list && !list.isEmpty();
    }
}
