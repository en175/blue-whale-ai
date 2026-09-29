package com.bluewhale.worker.application.claim;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;

import java.time.LocalDateTime;
import java.util.List;
import java.util.function.IntSupplier;
import java.util.function.LongFunction;

/**
 * 领取规格（ClaimSpec）—— 一个媒体家族「怎么领」的全部差异，IKIWP8 / ADR-0119。
 * <p>
 * <b>这是数据，不是策略类。</b>各家族在领取上的差异全是数据——候选查询、租约秒、CAS——
 * 没有行为差异，故用值对象 + 方法引用承载，不用策略类或枚举 switch。{@link com.bluewhale.worker.application.service.JobClaimService}
 * 只认识本类型，不认识任何具体家族。
 * <p>
 * <b>与本类同包实例在各处理器里构造</b>：候选查询与 CAS 都是 {@code JobClaimMapper} 的实例
 * 方法引用，静态常量承载不了。放在处理器里也是归属正确——处理器本就是「这个家族在 worker 侧
 * 的全部知识」的载体，「怎么领」与「怎么执行」是同一知识域的两半。
 * <p>
 * <b>「不套 source 白名单」由签名表达</b>：{@code candidateLookup} 是一个 {@code LongFunction}，
 * 套白名单的家族写 {@code jobId -> mapper.findCandidateByTypeAndSources(jobId, TAG, SOURCES)}，
 * 不套的写 {@code mapper::findCandidateByTypeOnly} 的偏应用形式。空列表这个值没有表达位置——
 * IKHPK9 的坏 SQL（MyBatis 对空集合连括号都不输出 → MySQL 1064 → 任务永久卡 queued）在类型上
 * 不再可能发生。
 * <p>
 * <b>没有「投影构造器」字段</b>：{@link com.bluewhale.worker.domain.dto.ClaimedJob} 是单一形态，
 * 投影对全部家族同构（同一个 candidate 行 → 同一组字段），差异只在处理器读不读某个字段。
 *
 * @param type            家族类型（generation_jobs.type 的合法值，同时是 JobTypeEnum 的取值）
 * @param lease           租约秒数。<b>必须是 {@code IntSupplier} 而非 {@code int}</b>——image 租约
 *                        可被 {@code IMAGE_JOB_LEASE_SECONDS} 环境变量覆盖，不为此砍路径
 * @param candidateLookup 候选查询（入参 jobId）；「不套 source 白名单」由实现是否携带 source 条件表达
 * @param cas             领取 CAS（两段式 CAS 的第二段；语义见迁移契约附录 C，不可变）
 */
public record ClaimSpec(
        String type,
        IntSupplier lease,
        LongFunction<GenerationJobEntity> candidateLookup,
        ClaimCas cas
) {

    /**
     * 领取 CAS 的函数面。
     * <p>
     * 与更新语句无关的媒体类型、source 白名单无关（WHERE 含 id / fencing_token / status
     * 与租约复核），故多数家族共用一个实现（claimImageCas），少数有专属实现
     * （claimMediaExtractCas / claimAudioCas / claimVideoCas）。
     *
     * @return 受影响行数；0 = 守卫失败（并发竞争 / 租约被续期 / 状态已变）
     */
    @FunctionalInterface
    public interface ClaimCas {
        int claim(Long jobId, String workerId, LocalDateTime leaseExpiresAt,
                  Long fencingToken, String candidateStatus);
    }

    /** 租约秒数（解析 {@code IntSupplier}；image 家族每次调用重新读 env）。 */
    public int leaseSeconds() {
        return lease.getAsInt();
    }

    /** 查候选（null = 无候选 / 不满足领取条件）。 */
    public GenerationJobEntity candidate(Long jobId) {
        return candidateLookup.apply(jobId);
    }

    /** 执行两段式 CAS 的第二段，返回受影响行数。 */
    public int claimCas(Long jobId, String workerId, LocalDateTime leaseExpiresAt,
                        Long fencingToken, String candidateStatus) {
        return cas.claim(jobId, workerId, leaseExpiresAt, fencingToken, candidateStatus);
    }

    // ========== 工厂：把「套不套 source 白名单」这一件事收敛成两个具名构造 ==========

    /**
     * **套 source 白名单**的家族（候选 = type + sources，CAS = claimImageCas）。
     * <p>
     * 白名单通常是单元素 {@code List.of(XxxContract.SOURCE)}（唯一创建入口 = 某个画布工具条），
     * 也有多元素的（image 生成）。
     *
     * @param sources **必须非空**——MyBatis 对空集合连括号都不输出，会渲染出坏 SQL（IKHPK9）。
     *                不套白名单请用 {@link #typeOnly}
     */
    public static ClaimSpec bySources(String type, int leaseSeconds, List<String> sources,
                                      GenerationJobMapper mapper) {
        return new ClaimSpec(type, () -> leaseSeconds,
                jobId -> mapper.findCandidateByTypeAndSources(jobId, type, sources),
                mapper::claimImageCas);
    }

    /**
     * **不套 source 白名单**的家族（候选 = 仅 type，CAS = claimImageCas）。
     * <p>
     * 「不套白名单」由「调用了没有 source 参数的方法」表达——空列表这个值没有表达位置，IKHPK9
     * 的坏 SQL 在类型上不可能发生。
     */
    public static ClaimSpec typeOnly(String type, int leaseSeconds, GenerationJobMapper mapper) {
        return new ClaimSpec(type, () -> leaseSeconds,
                jobId -> mapper.findCandidateByTypeOnly(jobId, type),
                mapper::claimImageCas);
    }

    /**
     * **不套白名单 + 专属 CAS** 的家族（媒体提取：候选仅 type，CAS = claimMediaExtractCas）。
     */
    public static ClaimSpec typeOnly(String type, int leaseSeconds, GenerationJobMapper mapper,
                                     ClaimCas cas) {
        return new ClaimSpec(type, () -> leaseSeconds,
                jobId -> mapper.findCandidateByTypeOnly(jobId, type),
                cas);
    }
}
