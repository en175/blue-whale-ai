
export interface ClaimedJob {
  cancelRequested?: boolean;
  id: string;
  project_id: string;
  user_id: string;
  type: string;
  input: Record<string, unknown> | null;
  retry_count: number;
  fencingToken: number;
}

export interface ImageCapabilitySnapshot {
  model_id: string;
  api_size: string | null;
  image_reference_max: number;
  channel: string | null;
  request_mapping: unknown;
  default_size: string;
  default_aspect_ratio: string;
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
  material_id: string | null;
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
  pollCount: number;
  progress: number;
  parentProviderTaskId: string | null;
  reservedAmountFen: bigint | null;
}

export interface ClaimedMediaExtractJob {
  id: string;
  projectId: string;
  userId: string;
  input: Record<string, unknown>;
  workerId: string;
  fencingToken: number;
}

export interface WorkerRepo {
  claimJobById(
    jobId: string,
    userId: string,
    workerId: string,
  ): Promise<ClaimedJob | null>;
  claimNextJob(workerId: string): Promise<ClaimedJob | null>;
  claimVideoJobById(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedVideoJob | null>;
  claimImageJobById(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedJob | null>;
  claimAudioJobById(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedJob | null>;
  listDueVideoJobIds(limit: number): Promise<string[]>;
  listDueImageJobIds(limit: number): Promise<string[]>;
  listDueAudioJobIds(limit: number): Promise<string[]>;
  listDueMediaExtractJobIds(limit: number): Promise<string[]>;
  resetStalledImageJobs(): Promise<number>;
  claimNextImageJob(workerId: string): Promise<ClaimedJob | null>;
  claimNextInProcessJob(workerId: string): Promise<ClaimedJob | null>;
  requeueImageJobForRetry(jobId: string, nextActionAt: Date): Promise<boolean>;
  claimNextVideoJob(workerId: string): Promise<ClaimedVideoJob | null>;
  markProviderSubmitted(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    providerTaskId: string;
  }): Promise<boolean>;
  rescheduleProviderPoll(input: {
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
    actualAmountFen?: bigint;
  }): Promise<boolean>;
  failVideoJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    code: string;
    message: string;
    releaseNote?: string;
    details?: Record<string, unknown>;
  }): Promise<boolean>;
  cancelVideoBeforeDispatch(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
  }): Promise<boolean>;
  claimMediaExtractJobById(
    jobId: string,
    workerId: string,
  ): Promise<ClaimedMediaExtractJob | null>;
  updateMediaExtractProgress(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    progress: number;
  }): Promise<boolean>;
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
  failMediaExtractJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }): Promise<boolean>;
  resolveInputAssets(
    assetIds: string[],
    userId: string,
    projectId: string,
  ): Promise<WorkerInputAsset[]>;
  resolveMediaExtractSource(
    assetId: string,
    userId: string,
    projectId: string,
  ): Promise<{ storageKey: string; mime: string | null; url: string } | null>;
  findImageCapability(
    modelId: string,
    sizeId: string | null,
  ): Promise<ImageCapabilitySnapshot | null>;
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
  completeJob(input: {
    jobId: string;
    assetIds: string[];
    workerId: string;
    fencingToken: number;
  }): Promise<boolean>;
  completeJobAndSettle(input: {
    jobId: string;
    assetIds: string[];
    workerId: string;
    fencingToken: number;
    actualAmountFen?: bigint;
  }): Promise<boolean>;
  failJob(input: {
    jobId: string;
    errorCode: string;
    errorMessage: string;
    workerId: string;
    fencingToken: number;
    releaseNote?: string;
    details?: Record<string, unknown>;
  }): Promise<boolean>;
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
