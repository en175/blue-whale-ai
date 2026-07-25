package com.blue.whale.agent.service.generation;

import com.blue.whale.agent.service.ProjectAssetAccessService;
import com.volcengine.ApiException;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskResult;
import com.volcengine.ark.runtime.model.content.generation.DeleteContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.GetContentGenerationTaskRequest;
import com.volcengine.ark.runtime.model.content.generation.GetContentGenerationTaskResponse;
import com.volcengine.ark.runtime.service.ArkService;
import org.springframework.beans.factory.ObjectProvider;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class SeedanceAsyncGenerationProvider implements AsyncGenerationProvider {

    private static final String PROVIDER = "seedance";

    private final ObjectProvider<ArkService> arkServiceProvider;
    private final ProjectAssetAccessService assetAccessService;
    private final GenerationAdapterProperties properties;

    public SeedanceAsyncGenerationProvider(
            ObjectProvider<ArkService> arkServiceProvider,
            ProjectAssetAccessService assetAccessService,
            GenerationAdapterProperties properties) {
        this.arkServiceProvider = arkServiceProvider;
        this.assetAccessService = assetAccessService;
        this.properties = properties;
    }

    @Override
    public ProviderTaskReference submit(AsyncGenerationSpec spec) {
        List<CreateContentGenerationTaskRequest.Content> content = new ArrayList<>();
        content.add(CreateContentGenerationTaskRequest.Content.builder()
                .type("text")
                .text(spec.prompt())
                .build());
        if (spec.referenceAssetId() != null) {
            String signedUrl = assetAccessService.sign(
                    spec.projectId(), spec.referenceAssetId(), spec.userId()).url();
            content.add(CreateContentGenerationTaskRequest.Content.builder()
                    .type("image_url")
                    .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                            .url(signedUrl)
                            .build())
                    .build());
        }
        CreateContentGenerationTaskRequest request = CreateContentGenerationTaskRequest.builder()
                .model(GenerationAdapterProperties.Seedance.MODEL)
                .content(content)
                .ratio(spec.aspectRatio())
                .resolution(spec.resolution())
                .duration((long) spec.durationSeconds())
                .callbackUrl(spec.callbackUrl())
                .build();
        try {
            CreateContentGenerationTaskResult result = requireArk().createContentGenerationTask(request);
            if (result == null || result.getId() == null || result.getId().isBlank()) {
                throw new ProviderSubmissionException(
                        true, "missing_task_id", "Seedance 创建任务未返回任务 ID", null);
            }
            return new ProviderTaskReference(PROVIDER, accountId(), result.getId());
        } catch (ProviderSubmissionException exception) {
            throw exception;
        } catch (Exception exception) {
            throw submissionException(exception);
        }
    }

    @Override
    public ProviderObservation observe(ProviderTaskReference reference) {
        verifyReference(reference);
        try {
            GetContentGenerationTaskResponse response = requireArk().getContentGenerationTask(
                    GetContentGenerationTaskRequest.builder().taskId(reference.taskId()).build());
            String rawStatus = response.getStatus();
            String rawErrorCode = response.getError() == null ? null : response.getError().getCode();
            String rawErrorMessage = response.getError() == null ? null : response.getError().getMessage();
            String temporaryUrl = response.getContent() == null
                    ? null : response.getContent().getVideoUrl();
            Integer duration = response.getDuration() == null
                    ? null : Math.toIntExact(response.getDuration());
            StatusAndError normalized = normalize(rawStatus, rawErrorCode, rawErrorMessage);
            return new ProviderObservation(normalized.status(), temporaryUrl, duration,
                    normalized.errorCode(), normalized.errorMessage(), rawStatus,
                    rawErrorCode, rawErrorMessage);
        } catch (Exception exception) {
            throw new IllegalStateException("Seedance 任务查询失败", exception);
        }
    }

    @Override
    public void requestCancel(ProviderTaskReference reference) {
        verifyReference(reference);
        try {
            requireArk().deleteContentGenerationTask(
                    DeleteContentGenerationTaskRequest.builder().taskId(reference.taskId()).build());
        } catch (Exception exception) {
            throw new IllegalStateException("Seedance 任务取消失败", exception);
        }
    }

    @Override
    public ProviderCancellationCapability cancellationCapability() {
        return ProviderCancellationCapability.QUEUED_ONLY;
    }

    @Override
    public String providerId() {
        return PROVIDER;
    }

    @Override
    public String accountId() {
        return properties.getSeedance().getAccountId();
    }

    private ArkService requireArk() {
        ArkService service = arkServiceProvider.getIfAvailable();
        if (service == null) {
            throw new IllegalStateException("ARK_API_KEY 未配置");
        }
        return service;
    }

    private ProviderSubmissionException submissionException(Exception exception) {
        if (exception instanceof IllegalStateException
                && "ARK_API_KEY 未配置".equals(exception.getMessage())) {
            return new ProviderSubmissionException(false, "provider_not_configured",
                    stableMessage(exception), exception);
        }
        if (exception instanceof ApiException apiException) {
            int code = apiException.getCode();
            boolean ambiguous = code <= 0 || code >= 500;
            return new ProviderSubmissionException(ambiguous, String.valueOf(code),
                    stableMessage(apiException), apiException);
        }
        return new ProviderSubmissionException(true, "submission_unknown",
                stableMessage(exception), exception);
    }

    private StatusAndError normalize(
            String rawStatus,
            String rawErrorCode,
            String rawErrorMessage) {
        String status = rawStatus == null ? "" : rawStatus.toLowerCase(Locale.ROOT);
        return switch (status) {
            case "queued" -> new StatusAndError(ProviderObservation.Status.QUEUED, null, null);
            case "running", "processing" -> new StatusAndError(
                    ProviderObservation.Status.RUNNING, null, null);
            case "succeeded" -> new StatusAndError(
                    ProviderObservation.Status.SUCCEEDED, null, null);
            case "cancelled", "canceled" -> new StatusAndError(
                    ProviderObservation.Status.CANCELLED, null, null);
            case "failed" -> new StatusAndError(ProviderObservation.Status.FAILED,
                    "provider_failed", "视频生成失败");
            default -> new StatusAndError(ProviderObservation.Status.RUNNING, null, null);
        };
    }

    private void verifyReference(ProviderTaskReference reference) {
        if (reference == null || !PROVIDER.equals(reference.providerId())
                || !accountId().equals(reference.accountId())
                || reference.taskId() == null || reference.taskId().isBlank()) {
            throw new IllegalArgumentException("Seedance 任务引用无效");
        }
    }

    private String stableMessage(Exception exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            return exception.getClass().getSimpleName();
        }
        return message.length() <= 1000 ? message : message.substring(0, 1000);
    }

    private record StatusAndError(
            ProviderObservation.Status status,
            String errorCode,
            String errorMessage) {
    }
}
