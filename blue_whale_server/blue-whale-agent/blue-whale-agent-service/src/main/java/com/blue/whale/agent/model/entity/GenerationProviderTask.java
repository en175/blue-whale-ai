package com.blue.whale.agent.model.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.blue.whale.global.base.entity.BaseEntity;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

@Getter
@Setter
@Accessors(chain = true)
@TableName("generation_provider_tasks")
public class GenerationProviderTask extends BaseEntity {

    public static final String SUBMISSION_SUBMITTING = "submitting";
    public static final String SUBMISSION_SUBMITTED = "submitted";
    public static final String SUBMISSION_UNKNOWN = "unknown";
    public static final String SUBMISSION_FAILED = "failed";

    private Long generationJobId;
    private String provider;
    private String accountId;
    private String providerTaskId;
    private String submissionState;
    private String providerStatus;
    private String callbackCapabilityDigest;
    private String rawStatus;
    private String rawErrorCode;
    private String rawErrorMessage;
    private String temporaryResultUrl;
    private Integer observeCount;
}
