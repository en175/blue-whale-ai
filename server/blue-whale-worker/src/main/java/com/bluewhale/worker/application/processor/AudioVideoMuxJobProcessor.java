package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.application.claim.ClaimSpec;
import com.bluewhale.worker.application.service.JobClaimService;
import com.bluewhale.worker.application.service.JobStateMachineService;
import com.bluewhale.worker.application.service.WorkerClock;
import com.bluewhale.worker.domain.contract.AudioVideoMuxContract;
import com.bluewhale.worker.domain.dto.ClaimedJob;
import com.bluewhale.worker.domain.dto.FailMediaExtractDto;
import com.bluewhale.worker.domain.dto.PublishAudioVideoMuxDto;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.MediaExtractError;
import com.bluewhale.worker.infrastructure.credential.GenerationCredentialService;
import com.bluewhale.worker.infrastructure.gateway.NewApiErrorClassifier;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient;
import com.bluewhale.worker.infrastructure.gateway.NewApiMediaKitMuxAudioVideoClient.MuxAudioVideoTaskObservation;
import com.bluewhale.worker.infrastructure.gateway.NewApiVideoClient;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;
import com.bluewhale.worker.infrastructure.mq.GenerationMessageProducer;
import com.bluewhale.worker.infrastructure.storage.TosVideoMediaRelay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** audio_video_mux 独立 MQ 步进：提交（sync 档映射 + client_token 幂等键）、持久化 task_id、
 * 查询、视频转存（10 GiB 上限）、发布长期视频 Asset（迁移契约 §21）。 */
@Component
public class AudioVideoMuxJobProcessor implements JobProcessor {
    private static final Logger log = LoggerFactory.getLogger(AudioVideoMuxJobProcessor.class);
    private static final long POLL_INTERVAL_MS = 5_000;
    private static final ScheduledExecutorService LEASE_HEARTBEAT_SCHEDULER =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread thread = new Thread(r, "amux-lease-heartbeat");
                thread.setDaemon(true);
                return thread;
            });
    private static final java.util.Set<String> PRESERVED_CODES = java.util.Set.of(
            GenerationError.ERROR_QUOTA_EXHAUSTED,
            GenerationError.ERROR_CONTENT_REJECTED,
            GenerationError.ERROR_CONTENT_REJECTED_REFERENCE);

    /** 领取规格（IKIWP8 / ADR-0119）：候选 = type + 单源白名单；租约 420s。 */
    private static final int LEASE_SECONDS = 420;
    private static final List<String> CLAIM_SOURCES = List.of(AudioVideoMuxContract.SOURCE);

    private final JobStateMachineService stateMachine;
    private final JobClaimService claimService;
    private final ClaimSpec claimSpec;
    private final GenerationCredentialService credentials;
    private final NewApiMediaKitMuxAudioVideoClient gateway;
    private final TosVideoMediaRelay relay;
    private final GenerationMessageProducer producer;
    private final String workerId;
    long leaseRenewIntervalMs = 60_000;
    /** 发布结果不明时的有界核实参数（IKIN8Z）：总探测轮数（含首次）与轮间延时。 */
    int publishSettleProbeAttempts = 3;
    long publishSettleProbeDelayMs = 500;

    public AudioVideoMuxJobProcessor(JobStateMachineService stateMachine,
                                     JobClaimService claimService,
                                     GenerationJobMapper jobMapper,
                                     GenerationCredentialService credentials,
                                     NewApiMediaKitMuxAudioVideoClient gateway,
                                     TosVideoMediaRelay relay,
                                     @Qualifier("audioVideoMuxMessageProducer") GenerationMessageProducer producer) {
        this.stateMachine = stateMachine;
        this.claimService = claimService;
        this.claimSpec = ClaimSpec.bySources(
                AudioVideoMuxContract.TAG, LEASE_SECONDS, CLAIM_SOURCES, jobMapper);
        this.credentials = credentials;
        this.gateway = gateway;
        this.relay = relay;
        this.producer = producer;
        this.workerId = "amux-" + ProcessHandle.current().pid();
    }

    @Override public String tag() { return AudioVideoMuxContract.TAG; }

    /**
     * 本家族的领取规格：供「一个处理器 ↔ 一份规格」一致性断言枚举（IKIWP8 / ADR-0119）。
     */
    @Override
    public Optional<ClaimSpec> claimSpec() {
        return Optional.of(claimSpec);
    }

    @Override
    public void handle(String jobId) {
        Optional<ClaimedJob> claimed = claimService.claim(claimSpec, jobId, workerId);
        if (claimed.isEmpty()) return;
        ClaimedJob job = claimed.get();
        try {
            runStep(job);
        } catch (Exception error) {
            String code = error instanceof MediaExtractError domain && PRESERVED_CODES.contains(domain.getCode())
                    ? domain.getCode() : AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED;
            try {
                if (!fail(job, code, error.getMessage() != null ? error.getMessage() : "音视频合成失败")) {
                    // 守卫未命中表示租约已释放或被其他执行者接管；由到点恢复扫描接续。
                    log.info("[audio_video_mux] 失败守卫未命中，交由恢复扫描 jobId={} token={}", job.id(), job.fencingToken());
                }
            } catch (Exception failError) {
                // fail 落库自身失败（DB 持续不可用）：不声称已写入终态——对象清理已在放弃路径
                // 尽力完成，任务收口交既有恢复扫描与消息重投；留可定位的未完成事实（IKIN91）。
                log.warn("[audio_video_mux] 失败终态落库未完成，任务收口交由恢复扫描/重投 jobId={} token={} reason={}",
                        job.id(), job.fencingToken(), failError.getMessage());
                throw error;
            }
        }
    }

    private void runStep(ClaimedJob job) {
        if (cancelIfRequested(job)) return;
        Object credential = job.input().get("provider_credential");
        if (!(credential instanceof String frozen) || frozen.isBlank()) {
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "音视频合成任务缺少供应商凭证");
            return;
        }
        String token;
        try {
            token = credentials.open(frozen);
        } catch (Exception error) {
            fail(job, GenerationError.ERROR_PROVIDER_CREDENTIAL_MISSING, "音视频合成任务凭证无效");
            return;
        }
        if (job.providerTaskId() == null) submit(job, token);
        else poll(job, token);
    }

    private void submit(ClaimedJob job, String token) {
        FrozenSnapshot snapshot = frozenSnapshot(job.input());
        if (snapshot == null) {
            fail(job, GenerationError.ERROR_INVALID_INPUT, "音视频合成输入快照非法");
            return;
        }
        String clientToken = AudioVideoMuxContract.clientToken(job.id(), snapshot.submitAttempt());
        String taskId = gateway.submit(token, snapshot.videoUrl(), snapshot.audioUrl(),
                snapshot.isAudioReserve(), snapshot.sync(), clientToken);
        if (cancelIfRequested(job)) return;
        if (stateMachine.markProviderSubmitted(job.id(), job.workerId(), job.fencingToken(), taskId)) {
            producer.enqueue(job.id(), POLL_INTERVAL_MS);
        }
    }

    /** 冻结快照防御校验（迁移契约 §21.2）：audio/video 恒有 assetId+url、audio 必有 nodeId、
     *  is_audio_reserve/sync/submit_attempt 恒显式；sync 三档之外视为脏快照。 */
    private static FrozenSnapshot frozenSnapshot(Map<String, Object> input) {
        Object audioRaw = input.get(AudioVideoMuxContract.INPUT_KEY_AUDIO);
        Object videoRaw = input.get(AudioVideoMuxContract.INPUT_KEY_VIDEO);
        if (!(audioRaw instanceof Map<?, ?> audio) || !(videoRaw instanceof Map<?, ?> video)) return null;
        Object audioAsset = audio.get(AudioVideoMuxContract.INPUT_FIELD_ASSET_ID);
        Object audioNode = audio.get(AudioVideoMuxContract.INPUT_FIELD_NODE_ID);
        Object audioUrl = audio.get(AudioVideoMuxContract.INPUT_FIELD_URL);
        Object videoAsset = video.get(AudioVideoMuxContract.INPUT_FIELD_ASSET_ID);
        Object videoUrl = video.get(AudioVideoMuxContract.INPUT_FIELD_URL);
        Object reserveRaw = input.get(AudioVideoMuxContract.INPUT_KEY_IS_AUDIO_RESERVE);
        Object syncRaw = input.get(AudioVideoMuxContract.INPUT_KEY_SYNC);
        Object attemptRaw = input.get(AudioVideoMuxContract.INPUT_KEY_SUBMIT_ATTEMPT);
        if (!(audioAsset instanceof String audioId) || !audioId.matches("[1-9][0-9]*")
                || !(audioNode instanceof String audioNodeId) || audioNodeId.isBlank()
                || !(audioUrl instanceof String audioUrlValue) || audioUrlValue.isBlank()
                || !(videoAsset instanceof String videoId) || !videoId.matches("[1-9][0-9]*")
                || !(videoUrl instanceof String videoUrlValue) || videoUrlValue.isBlank()
                || !(reserveRaw instanceof Boolean reserve)
                || !(syncRaw instanceof String sync) || !AudioVideoMuxContract.SYNC_VALUES.contains(sync)
                || !(attemptRaw instanceof Number attempt) || attempt.longValue() < 1) {
            return null;
        }
        return new FrozenSnapshot(audioUrlValue, videoUrlValue, videoId, reserve, sync, attempt.longValue());
    }

    private record FrozenSnapshot(String audioUrl, String videoUrl, String videoAssetId,
                                  boolean isAudioReserve, String sync, long submitAttempt) {}

    private void poll(ClaimedJob job, String token) {
        MuxAudioVideoTaskObservation observed;
        try {
            observed = gateway.poll(token, job.providerTaskId());
        } catch (MediaExtractError error) {
            if (cancelIfRequested(job)) return;
            if (transientPollError(error) && !timedOut(job)) {
                scheduleNext(job);
                return;
            }
            throw error;
        }
        if (cancelIfRequested(job)) return;
        if ("processing".equals(observed.status())) {
            if (timedOut(job)) {
                fail(job, AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED, "音视频合成查询超时");
            } else scheduleNext(job);
            return;
        }
        if ("failed".equals(observed.status())) {
            String message = observed.upstreamMessage() != null && !observed.upstreamMessage().isBlank()
                    ? observed.upstreamMessage() : "音视频合成任务失败";
            if (observed.requestId() != null && !message.contains("request_id=")) {
                message += " request_id=" + observed.requestId();
            }
            fail(job, classifyFailure(observed.upstreamCode(), message), message);
            return;
        }
        if (observed.videoUrl() == null || observed.videoUrl().isBlank()) {
            // 无有效视频结果不假成功；时长/分辨率缺失不失败，回落源资产（迁移契约 §21.4）。
            fail(job, AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED, "音视频合成任务缺少有效视频结果"
                    + (observed.requestId() != null ? " request_id=" + observed.requestId() : ""));
            return;
        }
        if (relay == null) {
            fail(job, AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED, "视频转存存储未配置");
            return;
        }
        FrozenSnapshot snapshot = frozenSnapshot(job.input());
        if (snapshot == null) {
            fail(job, GenerationError.ERROR_INVALID_INPUT, "音视频合成输入快照非法");
            return;
        }
        if (cancelIfRequested(job) || !renewLease(job)) return;
        // 转存全程心跳续租 + 失租/取消中止（IKILVH，VideoMatting 同款接线）：下载 + 上传可
        // 远超单次租约窗，心跳保持所有权；取消、续租未命中（已被接管/终态）或续租异常即经
        // 中止句柄停下正在进行的传输——取消与失租共用 abort 通道，原因串区分（取消已落
        // cancelled 终态，失租由接管方/recovery 兜底，本执行者都不再落普通失败终态）。
        TosVideoMediaRelay.TransferAbortHandle abortHandle = new TosVideoMediaRelay.TransferAbortHandle();
        ScheduledFuture<?> heartbeat = LEASE_HEARTBEAT_SCHEDULER.scheduleAtFixedRate(() -> {
            try {
                if (cancelIfRequested(job)) {
                    abortHandle.abort("音视频合成任务已被用户取消");
                } else if (!renewLease(job)) {
                    abortHandle.abort("音视频合成结果转存期租约未命中（已被接管/终态）");
                }
            } catch (Exception error) {
                abortHandle.abort("音视频合成结果转存续租异常: " + error.getMessage());
                log.warn("[audio_video_mux] 结果转存续租异常 jobId={}", job.id(), error);
            }
        }, leaseRenewIntervalMs, leaseRenewIntervalMs, TimeUnit.MILLISECONDS);
        TosVideoMediaRelay.StoredVideo stored;
        try {
            // 10 GiB 上限保留；时限模型（IKILVH）：停流超时（无进度才计时）+ 任务截止时间
            // （execution_deadline_at 到点中止）+ 容量上限，不再有固定总时限——受控慢流
            // 只要持续有进度且未过截止时间即可完成，供应商临时链接不充当最终产物。
            stored = relay.persistStreaming(observed.videoUrl(), job.userId(),
                    AudioVideoMuxContract.MAX_RESULT_BYTES, abortHandle,
                    job.executionDeadlineAt() == null ? null
                            : job.executionDeadlineAt().toInstant(WorkerClock.BEIJING));
        } catch (TosVideoMediaRelay.TransferAbortedException e) {
            // 中止（取消/失租/续租异常）≠ 普通失败：取消路径已落 cancelled 终态；失租路径
            // failMediaExtractJob 的旧 fencing token 也会被守卫拒绝，任务由新执行者/recovery
            // 继续——均静默退出，不把失租误写成失败终态。
            log.warn("[audio_video_mux] 结果转存被中止，本执行者静默退出 jobId={}: {}", job.id(), e.getMessage());
            return;
        } catch (MediaExtractError error) {
            String requestId = observed.requestId();
            if (requestId == null || requestId.isBlank()) throw error;
            throw new MediaExtractError(error.getCode(), error.getMessage() + " request_id=" + requestId, error);
        } finally {
            heartbeat.cancel(false);
        }
        // 转存成功返回后的每一步放弃路径（取消 / 失租 / 续租异常）都要清理该次上传的未发布
        // 对象（IKIN03）：storageKey 含每次执行独有的随机 uuid，删除不会波及接管者或重试的
        // 新产物；清理前先核实权威状态（见 discardUnpublishedTransfer）。
        boolean cancelRequested;
        try {
            cancelRequested = abortHandle.aborted() || cancelIfRequested(job);
        } catch (Exception error) {
            // 取消状态查询异常（DB 断连等）≠ 主动取消：发布尚未尝试（本判定先于发布调用，
            // 与发布已开始的保守规则严格区分），该次上传对象已成无引用孤儿——核实未引用即
            // 安全收口，原异常继续上抛按既有 fail/重试语义收口；不吞异常、不伪装成取消的
            // 静默退出（IKIN91，与转存返回后续租异常路径对等）。
            discardUnpublishedTransfer(job, stored);
            throw error;
        }
        if (cancelRequested) {
            discardUnpublishedTransfer(job, stored);
            return;
        }
        try {
            if (!renewLease(job)) {
                discardUnpublishedTransfer(job, stored);
                return;
            }
        } catch (Exception error) {
            // 转存成功返回后续租异常：该次上传已成无引用孤儿，核实未发布后清理再上抛。
            discardUnpublishedTransfer(job, stored);
            throw error;
        }
        boolean published;
        try {
            published = stateMachine.publishAudioVideoMuxResult(new PublishAudioVideoMuxDto(
                    job.id(), job.projectId(), job.userId(), job.workerId(), job.fencingToken(),
                    stored.url(), stored.storageKey(), stored.mime(), stored.size(), stored.md5(),
                    observed.durationSec(), observed.resolution(), snapshot.videoAssetId()));
        } catch (Exception error) {
            // 发布异常 ≠ 未发布（发布事务可能已提交后才断网，也可能仍在服务端提交中）：
            // 删除前必须先确认「可能发布该键的事务」已结束并核实无 Asset 引用（IKIN8Z
            // 有界核实，见 discardUnpublishedTransfer）；异常继续上抛走既有 fail 终态路径
            // （守卫仍 fencing，语义不变）。
            discardUnpublishedTransfer(job, stored, true);
            throw error;
        }
        if (!published) {
            log.warn("[audio_video_mux] 结果发布守卫未命中 jobId={}", job.id());
            // 守卫拒绝无法区分「被拒」与「新执行者已发布」：同样先核实权威状态再清理。
            discardUnpublishedTransfer(job, stored);
        }
    }

    /** 转存已成功返回但本次执行不再发布（取消 / 失租 / 续租异常 / 守卫拒绝）时的清理入口：
     *  发布事务从未开始或已同步结束，单次权威核实未被 Asset 引用即删（IKIN03 口径保持）。 */
    private void discardUnpublishedTransfer(ClaimedJob job,
                                            TosVideoMediaRelay.StoredVideo stored) {
        discardUnpublishedTransfer(job, stored, false);
    }

    /**
     * 清理该次上传的未发布对象（IKIN03；IKIN8Z 扩发布结果不明路径）。删除是需要证据的动作：
     * <ul>
     *   <li>{@code publishOutcomeUncertain=false}（取消 / 失租 / 续租异常 / 守卫拒绝）：发布
     *       事务从未开始或已同步结束（守卫拒绝 = 发布方法已返回），单次
     *       {@code hasPublishedAsset} 核实——assets 已有 generation_job_id + storage_key 匹配
     *       行即已被引用（如接管者已发布同 key），保留不删；查无即删。</li>
     *   <li>{@code publishOutcomeUncertain=true}（发布调用抛异常，结果不明）：发布事务可能
     *       已提交后才断网，也可能仍在服务端提交中——单次查无 Asset 不能证明后续提交不会
     *       引用该键（REPEATABLE READ 下进行中的事务对并发查询不可见）。走
     *       {@link #awaitPublishSettledAndUnreferenced}：确认事务已结束且无引用才删；事务
     *       未落定或权威状态暂不可确认一律保守保留。</li>
     * </ul>
     * 核实或删除自身异常只留结构化待处理记录（含对象身份），不改变主语义、不落额外终态。
     */
    private void discardUnpublishedTransfer(ClaimedJob job,
                                            TosVideoMediaRelay.StoredVideo stored,
                                            boolean publishOutcomeUncertain) {
        try {
            if (publishOutcomeUncertain) {
                switch (awaitPublishSettledAndUnreferenced(job.id(), stored.storageKey())) {
                    case REFERENCED -> {
                        log.warn("[audio_video_mux] 发布结果不明但对象已被 Asset 引用，保留不清理 jobId={} storageKey={}",
                                job.id(), stored.storageKey());
                        return;
                    }
                    case UNCONFIRMED -> {
                        logPendingTransferCleanup(job.id(), stored.storageKey(),
                                "发布结果不明：有界重查内可能发布该键的事务仍未结束");
                        return;
                    }
                    case SETTLED_UNREFERENCED -> { /* 事务已结束且无引用，向下删除 */ }
                }
            } else if (stateMachine.hasPublishedAsset(job.id(), stored.storageKey())) {
                log.warn("[audio_video_mux] 转存对象已被 Asset 引用，保留不清理 jobId={} storageKey={}",
                        job.id(), stored.storageKey());
                return;
            }
            relay.deleteUnpublishedObject(stored.storageKey());
        } catch (Exception error) {
            // 权威状态暂不可确认（核实查询异常）或删除链路异常：保留对象（删除失败不得记为
            // 成功），留可定位的待处理清理记录；清理失败不转成任务失败（IKIN03 语义保持）。
            logPendingTransferCleanup(job.id(), stored.storageKey(),
                    "权威状态核实或删除异常: " + error.getMessage());
        }
    }

    /** 发布结果不明路径的核实结论。 */
    private enum UnpublishedTransferCheck {
        /** 权威数据确认对象已被 Asset 引用（发布事务已提交）→ 保留成品。 */
        REFERENCED,
        /** 可能发布该键的事务已结束且无 Asset 引用 → 可安全删除（该键含本次执行独有 uuid，不会再有新事务引用）。 */
        SETTLED_UNREFERENCED,
        /** 有界重查内事务仍未结束，或权威状态暂不可确认 → 保守保留并留待处理记录。 */
        UNCONFIRMED
    }

    /**
     * 发布结果不明时的删除前核实（IKIN8Z）：每轮先探测 generation_jobs 行写锁（守卫写事务
     * 的第一条语句即 CAS UPDATE，行锁持有至提交/回滚——锁被占 = 仍有事务可能提交该键），
     * 占用则短延时后重查（有界，防未决事务久拖阻塞 worker 线程）；锁空闲即「可能发布该键
     * 的事务已结束」，此时查 Asset 引用即权威结论：命中 = 已发布（保留），查无 = 已回滚/
     * 未插入（删除）。窗口耗尽仍被占 → UNCONFIRMED 保守保留（待处理记录可定位，交由
     * 状态恢复后的下一次决策或人工核账收口）。
     */
    private UnpublishedTransferCheck awaitPublishSettledAndUnreferenced(String jobId, String storageKey) {
        for (int attempt = 1; ; attempt++) {
            if (stateMachine.hasInFlightJobWriteTransaction(jobId)) {
                if (attempt >= publishSettleProbeAttempts) return UnpublishedTransferCheck.UNCONFIRMED;
                try {
                    Thread.sleep(publishSettleProbeDelayMs);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("发布落定核实等待被中断", interrupted);
                }
                continue;
            }
            return stateMachine.hasPublishedAsset(jobId, storageKey)
                    ? UnpublishedTransferCheck.REFERENCED
                    : UnpublishedTransferCheck.SETTLED_UNREFERENCED;
        }
    }

    /**
     * 结构化待处理清理记录（IKIN8Z；父规格明确不新增数据库表，以可检索日志形态承载）：
     * 固定 tag + jobId / storageKey / reason / resolution 字段，供日志检索定位遗留对象的
     * 清理责任，状态恢复后可据权威结果完成保留或安全清理。
     */
    private static void logPendingTransferCleanup(String jobId, String storageKey, String reason) {
        log.warn("[audio_video_mux][pending-cleanup] 未发布对象保守保留待处理 jobId={} storageKey={} reason={} resolution=retain-pending",
                jobId, storageKey, reason);
    }

    private boolean renewLease(ClaimedJob job) {
        return stateMachine.renewAudioVideoMuxLease(job.id(), job.workerId(), job.fencingToken());
    }

    private void scheduleNext(ClaimedJob job) {
        if (cancelIfRequested(job)) return;
        long delayMs = pollDelayMs(job.pollCount());
        if (stateMachine.rescheduleProviderPoll(job.id(), job.workerId(), job.fencingToken(), job.progress(), delayMs)) {
            producer.enqueue(job.id(), delayMs);
        }
    }

    private boolean cancelIfRequested(ClaimedJob job) {
        return stateMachine.cancelAudioVideoMuxIfRequested(job.id(), job.workerId(), job.fencingToken());
    }

    private static long pollDelayMs(int pollCount) {
        return Math.min(60_000L, POLL_INTERVAL_MS << Math.min(4, Math.max(0, pollCount / 3)));
    }

    /** 超时预算（迁移契约 §21.1）：execution_deadline_at 优先；否则 max(1d, 4×估算+6h)、未知 7d、
     *  上限 365d（本家族把 365d 上限补齐到 worker fallback，消除与 backend 的不对称）。 */
    private static boolean timedOut(ClaimedJob job) {
        if (job.executionDeadlineAt() != null) {
            return !WorkerClock.now().isBefore(job.executionDeadlineAt());
        }
        if (job.createdAt() == null) return false;
        Object estimated = job.input().get("estimated_duration_ms");
        Duration budget = estimated instanceof Number number && number.longValue() > 0
                ? Duration.ofHours(6).plus(Duration.ofMillis(number.longValue()).multipliedBy(4))
                : Duration.ofDays(7);
        if (budget.compareTo(Duration.ofDays(1)) < 0) budget = Duration.ofDays(1);
        if (budget.compareTo(Duration.ofDays(365)) > 0) budget = Duration.ofDays(365);
        return Duration.between(job.createdAt(), WorkerClock.now()).compareTo(budget) >= 0;
    }

    private static boolean transientPollError(MediaExtractError error) {
        if (GenerationError.ERROR_PROVIDER_TIMEOUT.equals(error.getCode())) return true;
        if (!GenerationError.ERROR_PROVIDER_FAILED.equals(error.getCode())) return false;
        Throwable cause = error.getCause();
        if (cause instanceof ConnectException || cause instanceof UnknownHostException) return true;
        return cause instanceof NewApiVideoClient.HttpStatusException http
                && (http.getStatus() == 429 || http.getStatus() >= 500);
    }

    private static String classifyFailure(String code, String message) {
        String signal = (code == null ? "" : code) + " " + message;
        if (NewApiErrorClassifier.isCopyrightSignal(signal)) return GenerationError.ERROR_CONTENT_REJECTED_REFERENCE;
        if (NewApiErrorClassifier.isContentPolicySignal(signal)) return GenerationError.ERROR_CONTENT_REJECTED;
        if (NewApiErrorClassifier.isQuotaSignal(signal)) return GenerationError.ERROR_QUOTA_EXHAUSTED;
        return AudioVideoMuxContract.ERROR_AUDIO_VIDEO_MUX_FAILED;
    }

    private boolean fail(ClaimedJob job, String code, String message) {
        Map<String, Object> details = new HashMap<>();
        details.put("raw", message);
        log.warn("[audio_video_mux] job 失败 jobId={} code={} message={}", job.id(), code, message);
        return stateMachine.failMediaExtractJob(new FailMediaExtractDto(
                job.id(), job.workerId(), job.fencingToken(), code, message, details));
    }
}
