package com.bluewhale.worker.application.processor;

import java.util.function.BiFunction;
import java.util.function.Function;

import com.bluewhale.worker.domain.dto.ParentReuseClaim;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class ParentResultReuse {

    private static final Logger log = LoggerFactory.getLogger(ParentResultReuse.class);

    private ParentResultReuse() {
    }

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
                log.warn("[{}] 重试收割发布守卫未命中或续租中止 jobId={}（stale worker 或已终态），停止本次执行（不回退提交）",
                        tag, claim.id());
            }
            return true;
        } catch (Exception error) {
            log.warn("[{}] 重试收割发布失败 jobId={} parentTask={} err={}，准备复核租约后回退提交",
                    tag, claim.id(), claim.parentProviderTaskId(), error.getMessage(), error);
            return false;
        }
    }

    public static <C extends ParentReuseClaim, O extends ParentTaskObservation> BiFunction<C, O, String> singleUrlIncomplete(
            Function<O, String> urlGetter) {
        return (claim, observation) -> {
            String url = urlGetter.apply(observation);
            return url == null || url.isEmpty() ? "结果不齐全" : null;
        };
    }
}
