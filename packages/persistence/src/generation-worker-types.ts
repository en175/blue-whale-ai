// IK74V8：generation worker 仓储的行投影类型与接口（从 generation-worker-repo.ts 拆出）。

export interface ClaimedJob {
  id: string;
  project_id: string;
  user_id: string;
  type: string;
  input: Record<string, unknown> | null;
  expected_output_count: number;
  /** 已重试次数（瞬时失败回 queued 时自增）；恢复/重试据此决定是否再放行。 */
  retry_count: number;
  /** 本次领取发放的围栏令牌（IK7GRO）。领取/重放/重排时递增；写路径守卫据此拒绝迟到写入。 */
  fencingToken: number;
}

export interface ImageCapabilitySnapshot {
  model_id: string;
  api_size: string | null;
  width: number | null;
  height: number | null;
  /** 参考图数量上限（features.max_reference_images 归一化；缺省与网关/ARK 一致的 10，IKA72G）。 */
  max_reference_images: number;
}

export interface WorkerInputAsset {
  id: string;
  type: string;
  url: string;
  mime: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface ClaimedVideoJob {
  id: string;
  projectId: string;
  userId: string;
  input: Record<string, unknown>;
  providerTaskId: string | null;
  cancelRequested: boolean;
  workerId: string;
  fencingToken: number;
  /** 已轮询次数（rescheduleVideoPoll 累计）。IKBBXH：轮询上限判定用。 */
  pollCount: number;
  /** IK9VZ0：视频实扣二次校验的基准（预留金额，fen；无预留/查询失败为 null）。 */
  reservedAmountFen: bigint | null;
}

/** 媒体提取（视频→音频）短步骤认领行投影（IKARDY）。免费工具：无 provider/cost/预留。 */
export interface ClaimedMediaExtractJob {
  id: string;
  projectId: string;
  userId: string;
  input: Record<string, unknown>;
  workerId: string;
  fencingToken: number;
}

export interface WorkerRepo {
  /** 按任务和归属用户精确认领 queued 任务，供 request-scoped sk token 调度。 */
  claimJobById(
    jobId: string,
    userId: string,
    workerId: string,
  ): Promise<ClaimedJob | null>;
  /** 认领一个 queued 任务（next_action_at<=now），置 processing + lease。无则 null。 */
  claimNextJob(workerId: string): Promise<ClaimedJob | null>;
  /** 按 RocketMQ 消息中的 DB jobId 领取一个待 submit/poll 的视频短步骤。 */
  claimVideoJobById(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedVideoJob | null>;
  /** 图片 MQ 消费端按 RocketMQ 消息 jobId 领取单个图片 job（IKBGKA）；type="image"，无 request userId。 */
  claimImageJobById(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedJob | null>;
  /** Redis 消息丢失或 Worker 重启后的低频补偿扫描。 */
  listDueVideoJobIds(limit: number): Promise<string[]>;
  /** IKBGKA：图片到点/孤儿 job 低频补入队扫描（镜像 listDueVideoJobIds；type=image）。 */
  listDueImageJobIds(limit: number): Promise<string[]>;
  /** 重置图片任务中租约过期仍 processing 的孤儿任务 → queued，供恢复扫描接回。 */
  resetStalledImageJobs(): Promise<number>;
  /** 认领一个到点的图片 queued 任务（next_action_at<=now），置 processing + lease。无则 null。 */
  claimNextImageJob(workerId: string): Promise<ClaimedJob | null>;
  /** 认领一个到点的音频 queued 任务（next_action_at<=now），置 processing + lease。
   *  IKBGKA（review 2 轮）：图片已迁 MQ，本进程内认领仅剩音频。无则 null。 */
  claimNextInProcessJob(workerId: string): Promise<ClaimedJob | null>;
  /** 瞬时失败重试：processing → queued + 推迟 next_action_at + retry_count++。仅 processing 态可回退。 */
  requeueImageJobForRetry(jobId: string, nextActionAt: Date): Promise<boolean>;
  /** 领取一个待 submit/poll 的视频短步骤；过期 processing 可被新 Worker 接管。 */
  claimNextVideoJob(workerId: string): Promise<ClaimedVideoJob | null>;
  /** submit 接纳后持久化上游 taskId，并释放租约等待下一次短 poll。 */
  markVideoSubmitted(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    providerTaskId: string;
  }): Promise<boolean>;
  rescheduleVideoPoll(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    progress: number;
  }): Promise<boolean>;
  publishVideoResult(input: {
    jobId: string;
    projectId: string;
    userId: string;
    workerId: string;
    fencingToken: number;
    url: string;
    storageKey: string | null;
    mime: string | null;
    size: number | null;
    width: number;
    height: number;
    duration: number;
    /** IK7G9X：视频实扣金额（fen，由 worker 从 new-api 任务 quota 换算）；缺省 0（旧行为）。 */
    actualAmountFen?: bigint;
  }): Promise<boolean>;
  failVideoJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    code: string;
    message: string;
    /** IK9VZ0：退款校验结果（refund_confirmed / refund_unverified），落 release_note。 */
    releaseNote?: string;
  }): Promise<boolean>;
  cancelVideoBeforeDispatch(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
  }): Promise<boolean>;
  /** 按 RocketMQ 消息中的 DB jobId 领取一个待提取的媒体提取短步骤（type=media_extract，IKARDY）。 */
  claimMediaExtractJobById(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedMediaExtractJob | null>;
  /** 媒体提取进度回写（0-99，IKARDY）。守卫失败（stale worker）返回 false。 */
  updateMediaExtractProgress(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    progress: number;
  }): Promise<boolean>;
  /** 媒体提取成功：置 succeeded + 建 audio 资产 + output_asset_ids + 项目事件（IKARDY）。 */
  publishMediaExtractResult(input: {
    jobId: string;
    projectId: string;
    userId: string;
    workerId: string;
    fencingToken: number;
    url: string;
    storageKey: string;
    mime: string;
    size: number;
    duration: number | null;
  }): Promise<boolean>;
  /** 媒体提取失败：置 failed + error + 日志（IKARDY）。免费工具，无预留释放。 */
  failMediaExtractJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    code: string;
    message: string;
  }): Promise<boolean>;
  /** 提取成功：把画布占位节点更新为最终音频节点（IKARDY）。 */
  updateMediaExtractNodeToAudio(input: {
    jobId: string;
    projectId: string;
    url: string;
    mime: string;
    size: number;
    duration: number | null;
  }): Promise<boolean>;
  /** 提取失败：把画布占位节点置 failed（IKARDY）。 */
  failMediaExtractNode(input: {
    jobId: string;
    projectId: string;
    code: string;
    message: string;
  }): Promise<boolean>;
  /** 按任务归属解析输入素材；返回顺序与 assetIds 一致。 */
  resolveInputAssets(
    assetIds: string[],
    userId: string,
    projectId: string,
  ): Promise<WorkerInputAsset[]>;
  /** 媒体提取源解析：按 id+user+project 取 storageKey/mime/公网 url（IKARDY）。无 storage_key 返回 null。 */
  resolveMediaExtractSource(
    assetId: string,
    userId: string,
    projectId: string,
  ): Promise<{ storageKey: string; mime: string | null; url: string } | null>;
  /** 按 model_id 查启用能力，取 size 白名单里匹配 sizeId 的 api 值/宽高。 */
  findImageCapability(
    modelId: string,
    sizeId: string | null,
  ): Promise<ImageCapabilitySnapshot | null>;
  /** 建素材行（结果）。守卫失败（stale worker）返回 null，不落素材（IK7GRP）。 */
  createAsset(input: {
    user_id: string;
    project_id: string;
    generation_job_id: string;
    url: string;
    type: string;
    width: number | null;
    height: number | null;
    storage_key: string | null;
    mime: string | null;
    size: number | null;
    duration?: number | null;
    workerId: string;
    fencingToken: number;
  }): Promise<string | null>;
  /** 任务成功：置 succeeded + output_asset_ids + progress=100 + 清 next_action_at。
   *  守卫失败（stale worker）返回 false，不产生任何副作用（IK7GRP）。 */
  completeJob(input: {
    jobId: string;
    assetIds: string[];
    workerId: string;
    fencingToken: number;
  }): Promise<boolean>;
  /** IK9VZ0：图片结算原子化——completeJob 与 settleReservation 合并单事务。
   *  事务中段抛错整事务回滚，job 与预留不会出现「一边成功一边悬挂」。 */
  completeJobAndSettle(input: {
    jobId: string;
    assetIds: string[];
    workerId: string;
    fencingToken: number;
    actualAmountFen?: bigint;
  }): Promise<boolean>;
  /** 任务失败：置 failed + error + 记日志。
   *  守卫失败（stale worker）返回 false，不产生任何副作用（IK7GRP）。
   *  succeeded 任务不会被迟到的 failJob 翻为 failed。
   *  IK9VZ0：releaseNote 记录退款校验结果（refund_confirmed / refund_unverified），落 release_note。 */
  failJob(input: {
    jobId: string;
    errorCode: string;
    errorMessage: string;
    workerId: string;
    fencingToken: number;
    releaseNote?: string;
  }): Promise<boolean>;
  /** 结算点数（reserved→settled，actual=0 占位，真计价后补）。
   *  只在守卫通过的事务内结算，stale worker 不能结算新一次尝试的预留（IK7GRP）。
   *  IK7G9X：actualAmountFen 传入真实扣费时写真实值；缺省 0（旧行为）。 */
  settleReservation(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    actualAmountFen?: bigint;
  }): Promise<boolean>;
  appendLog(
    jobId: string,
    event: string,
    status: string | null,
    message?: string,
    payload?: unknown,
  ): Promise<void>;
}
