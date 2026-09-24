package com.bluewhale.worker.application.processor;

import java.util.function.BiFunction;
import java.util.function.Function;

import com.bluewhale.worker.domain.dto.ParentReuseClaim;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 重试收割（parent-reuse）共享骨架（IKI8GN 收敛；视频 IKEA26 先例推广、IKI89P 定型形态
 * 的 8 份同形实现收敛为单一实现，家族差异以参数表达，对外行为零变化）。
 * <p>
 * 超窗判失败后上游任务仍在跑；用户手动重试时先查父任务的上游任务：已成功且结果齐全
 * （齐全口径由家族参数给定，对齐各家族轮询相成功判据，不新立标准）→ 不重新提交，直接
 * 以父任务 observation 走各家族既有 publishResult 发布（资产入库、槽位回填、项目事件与
 * 正常完成同型，不新建 cost 记录）。父任务失败 / 不存在 / 查询异常 / 收割发布失败四种
 * 形态一律返回 false，回退 submit 相正常重新提交，无第三种行为分支。
 * <p>
 * 家族参数：{@code tag}（日志前缀，传各家族契约 TAG 常量）、{@code poll}（查父任务上游，
 * 8 家族 client 签名同构）、{@code resultIncomplete}（结果齐全判定，返回 null=齐全、
 * 非空=未齐原因短句，嵌进「未命中(父任务{})」日志）、{@code publish}（发布入口，各家族
 * 既有 publishResult 方法引用，签名不改）。
 * <p>
 * 语义边界（IKI8GN 留痕，不随收敛改变）：
 * <ul>
 *   <li>发布守卫未命中（stale worker 或已终态）返回 false 回退重新提交，与「租约丢失
 *       （publishResult 内部续租未命中 / 转存中止）返回 true 静默终局」的不对称是定型票
 *       既定口径——后者已被接管或已终态，回退提交只会白付一次上游费用。两者行为边界在
 *       各家族 publishResult 内部，不在本骨架；统一口径属行为变更，另立专项票。</li>
 *   <li>不存在与查询异常同路处理（视频先例 D6 同款：当不存在，重新 submit）。</li>
 *   <li>结果 URL 24h 失效不加探测层：取回 / 转存失败表现为发布异常，走回退分支兜底。</li>
 * </ul>
 */
public final class ParentResultReuse {

    private static final Logger log = LoggerFactory.getLogger(ParentResultReuse.class);

    private ParentResultReuse() {
    }

    /**
     * 重试收割共享骨架：命中（已发布）返回 true，调用方跳过重新提交；四种回退形态
     * 返回 false，调用方继续正常提交。
     */
    public static <C extends ParentReuseClaim, O extends ParentTaskObservation> boolean tryReuseParentResult(
            String tag,
            C claim,
            String providerToken,
            BiFunction<String, String, O> poll,
            BiFunction<C, O, String> resultIncomplete,
            BiFunction<C, O, Boolean> publish) {

        O observation;
        try {
            observation = poll.apply(providerToken, claim.parentProviderTaskId());
        } catch (Exception error) {
            // 不存在与查询异常同路处理（视频先例 D6 同款：当不存在，重新 submit）
            log.warn("[{}] 重试收割查父任务失败 jobId={} parentTask={} err={}，按不存在处理重新提交",
                    tag, claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }

        if (!ParentTaskObservation.STATUS_SUCCEEDED.equals(observation.status())) {
            log.info("[{}] 重试收割未命中(父任务未成功) jobId={} parentTask={} status={}，回退重新提交",
                    tag, claim.id(), claim.parentProviderTaskId(), observation.status());
            return false;
        }
        String incompleteReason = resultIncomplete.apply(claim, observation);
        if (incompleteReason != null) {
            log.info("[{}] 重试收割未命中(父任务{}) jobId={} parentTask={}，回退重新提交",
                    tag, incompleteReason, claim.id(), claim.parentProviderTaskId());
            return false;
        }

        log.info("[{}] 重试收割命中 jobId={} parentTask={}，复用旧结果发布（不重新提交）",
                tag, claim.id(), claim.parentProviderTaskId());
        try {
            boolean published = publish.apply(claim, observation);
            if (!published) {
                log.warn("[{}] 重试收割发布未命中守卫 jobId={}（stale worker 或已终态），回退重新提交",
                        tag, claim.id());
            }
            return published;
        } catch (Exception error) {
            // 结果取回/发布失败（如结果 URL 已超 24h 失效下载 404）→ 回退重新提交兜底
            log.warn("[{}] 重试收割发布失败 jobId={} parentTask={} err={}，回退重新提交",
                    tag, claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }
    }

    /**
     * 单输出家族（结果 = 单个 URL）的齐全判定工厂：URL 非空即齐全。
     * 覆盖 media_extract / audio_trim（audioUrl）与 video_enhance / video_subtitle_erase /
     * video_frame_interpolation（videoUrl）。
     */
    public static <C extends ParentReuseClaim, O extends ParentTaskObservation> BiFunction<C, O, String> singleUrlIncomplete(
            Function<O, String> urlGetter) {
        return (claim, observation) -> {
            String url = urlGetter.apply(observation);
            return url == null || url.isEmpty() ? "结果不齐全" : null;
        };
    }
}
