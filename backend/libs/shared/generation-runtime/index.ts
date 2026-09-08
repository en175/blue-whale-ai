export { createFakeGenerationAdapter } from "./fake-generation-adapter.js";
export { createNewApiVideoTaskProvider } from "./new-api-video-task-provider.js";
export {
  AudioProviderError,
  type AudioProvider,
  type GenerateAudioInput,
  type GeneratedAudio,
} from "./audio-provider.js";
export {
  createNewApiAudioProvider,
  type NewApiAudioProviderOptions,
} from "./new-api-audio-provider.js";
export {
  createPassthroughVideoMediaRelay,
  createTosVideoMediaRelay,
  loadGenerationMediaRelayMode,
  loadGenerationTosConfig,
  type GenerationMediaRelayMode,
  type GenerationTosConfig,
} from "./tos-video-media-relay.js";
export { runVideoWorkerLoop } from "./video-worker-loop.js";
export {
  readAssetId,
  readAssetIds,
  readMaterialId,
  readMaterialRefs,
  uniqueAssetIds,
  uniqueMaterialRefs,
  VideoInputError,
  type MaterialReference,
} from "./material-reference.js";
export { videoDimensions, dimensionsFromSize } from "./video-dimensions.js";
export { validateReferences, validateReferenceVideo, isSeedance2Model } from "./video-reference-validation.js";
export {
  runVideoJobStep,
  type GenerationCredentialVault,
  type StoredVideo,
  type VideoJobClaim,
  type VideoJobRunnerRepo,
  type VideoMediaRelay,
  type VideoTaskObservation,
  type VideoTaskProvider,
  type VideoWorkerInputAsset,
} from "./video-job-runner.js";
export {
  MediaExtractError,
  runMediaExtractStep,
  type MediaExtractClaim,
  type MediaExtractDownloader,
  type MediaExtractRunnerRepo,
  type MediaExtractUploader,
  type MediaExtractWorker,
  type RunMediaExtractStepDeps,
} from "./media-extract-runner.js";
