package com.bluewhale.worker.application.processor;

import java.util.function.BiFunction;
import java.util.function.Function;

import com.bluewhale.worker.domain.dto.ParentReuseClaim;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 重试收割（parent-reuse）共享骨架（IKI8GN 收敛；视频 IKEA26 先例推广、IKI89P 定型形态
 * 的 8 份同形实现收敛为单一实现，家族差异以参数表达；收敛当期对外行为零变化，后续
 * IKICD0 调整失租边界如下）。
 * <p>
 * 超窗判失败后上游任务仍在跑；用户手动重试时先查父任务的上游任务：已成功且结果齐全
 * （齐全口径由家族参数给定，对齐各家族轮询相成功判据，不新立标准）→ 不重新提交，直接
 * 以父任务 observation 走各家族既有 publishResult 发布（资产入库、槽位回填、项目事件与
 * 正常完成同型，不新建 cost 记录）。
 * <p>
 * 返回值两态（IKICD0）：true = 终局，调用方跳过重新提交并停止本次执行——含「已发布」
 * 与「收割发布期间失租或守卫未命中」两种形态（后者当前 worker 已被接管或任务已终态，
 * 回退提交只会在守卫丢弃前白付一次上游 submit，产生无人轮询的孤儿上游任务；任务保持
 * processing，新 worker 重新领取后重新检查父任务继续收割）。false = 回退，调用方继续
 * 正常提交——父任务失败 / 不存在 / 查询异常 / 仍持有执行权时的收割发布失败（下载转存
 * 异常，如结果 URL 已超 24h 失效下载 404）。
 * <p>
 * 家族参数：{@code tag}（日志前缀，传各家族契约 TAG 常量）、{@code poll}（查父任务上游，
 * 8 家族 client 签名同构）、{@code resultIncomplete}（结果齐全判定，返回 null=齐全、
 * 非空=未齐原因短句，嵌进「未命中(父任务{})」日志）、{@code publish}（发布入口，各家族
 * 既有 publishResult 方法引用，签名不改）。
 * <p>
 * 语义边界：
 * <ul>
 *   <li>失租与守卫未命中归入停止执行（IKICD0 统一）：publish 返回 false（终态守卫未命中，
 *       或场景切分逐段转存续租未命中 / 续租状态无法确认）与 publishResult 内部失租终局
 *       （智能抠像续租未命中 / 心跳失租中止转存返回 true）同一停止语义，均不得回退提交。</li>
 *   <li>不存在与查询异常同路处理（视频先例 D6 同款：当不存在，重新 submit）。</li>
 *   <li>结果 URL 24h 失效不加探测层：取回 / 转存失败表现为发布异常，走回退分支兜底。</li>
 * </ul>
 */
public final class ParentResultReuse {

    private static final Logger log = LoggerFactory.getLogger(ParentResultReuse.class);

    private ParentResultReuse() {
    }

    /**
     * 重试收割共享骨架：true = 终局（已发布，或收割发布失租 / 守卫未命中停止执行），
     * 调用方跳过重新提交；false = 回退形态（父任务失败 / 不存在 / 查询异常 / 仍持有
     * 执行权的发布失败），调用方继续正常提交。
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
                // 失租或终态守卫未命中（含场景切分逐段转存续租未命中 / 续租状态无法确认）
                // = 停止终局（IKICD0）：不回退提交、不写 Finalize、不续排——当前 worker 已
                // 无执行权，回退只会在 markProviderSubmitted 守卫丢弃前白付一次上游 submit；
                // 任务保持 processing，新 worker 重新领取后重新检查父任务继续收割
                log.warn("[{}] 重试收割发布守卫未命中或续租中止 jobId={}（stale worker 或已终态），停止本次执行（不回退提交）",
                        tag, claim.id());
            }
            return true;
        } catch (Exception error) {
            // 结果取回/发布失败（如结果 URL 已超 24h 失效下载 404）→ 当前 worker 仍持有
            // 执行权，回退重新提交兜底
            log.warn("[{}] 重试收割发布失败(仍持有执行权) jobId={} parentTask={} err={}，回退重新提交",
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
