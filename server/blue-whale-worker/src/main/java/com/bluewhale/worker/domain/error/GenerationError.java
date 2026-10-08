package com.bluewhale.worker.domain.error;

public final class GenerationError {

    private GenerationError() {}


    public static final String UNKNOWN = "unknown";

    public static final String ERROR_QUOTA_EXHAUSTED = "quota_exhausted";

    public static final String ERROR_PROVIDER_CREDENTIAL_MISSING = "provider_credential_missing";

    public static final String ERROR_MODEL_UNAVAILABLE = "model_unavailable";

    public static final String ERROR_REFERENCE_ASSET_UNAVAILABLE = "reference_asset_unavailable";

    public static final String ERROR_INVALID_INPUT = "invalid_input";

    public static final String ERROR_INVALID_REFERENCE = "invalid_reference";

    public static final String ERROR_INVALID_REFERENCE_TYPE = "invalid_reference_type";

    public static final String ERROR_UNSUPPORTED_TYPE = "unsupported_type";

    public static final String ERROR_UNSUPPORTED_INPUT = "unsupported_input";

    public static final String ERROR_NO_RESULT = "no_result";

    public static final String ERROR_PROVIDER_FAILED = "provider_failed";

    public static final String ERROR_PROVIDER_TIMEOUT = "provider_timeout";

    public static final String ERROR_CONTENT_REJECTED = "content_rejected";

    public static final String ERROR_CONTENT_REJECTED_REFERENCE = "content_rejected_reference";

    public static final String ERROR_CONTENT_REJECTED_AUDIO = "content_rejected_audio";

    public static final String ERROR_PROVIDER_CONFIG = "provider_config";

    public static final String ERROR_INVALID_REFERENCE_MEDIA = "invalid_reference_media";

    public static final String ERROR_REFERENCE_LIMIT_EXCEEDED = "reference_limit_exceeded";

    public static final String ERROR_TASK_TYPE_PARAM_CONSTRAINT = "task_type_param_constraint";
}
