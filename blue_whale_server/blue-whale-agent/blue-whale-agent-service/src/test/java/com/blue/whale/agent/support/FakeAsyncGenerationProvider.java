package com.blue.whale.agent.support;

import com.blue.whale.agent.service.generation.AsyncGenerationProvider;
import com.blue.whale.agent.service.generation.AsyncGenerationSpec;
import com.blue.whale.agent.service.generation.ProviderObservation;
import com.blue.whale.agent.service.generation.ProviderSubmissionException;
import com.blue.whale.agent.service.generation.ProviderTaskReference;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class FakeAsyncGenerationProvider implements AsyncGenerationProvider {

    private static final String TASK_ID = "fake-seedance-task-1";

    private final AtomicInteger submissions = new AtomicInteger();
    private final AtomicInteger observations = new AtomicInteger();
    private final AtomicInteger cancellations = new AtomicInteger();
    private volatile String callbackUrl;
    private volatile ProviderObservation observation;
    private volatile boolean ambiguousSubmission;
    private volatile boolean rejectedSubmission;
    private volatile boolean succeedsOnCancelConfirmation;
    private volatile CountDownLatch submissionStarted;
    private volatile CountDownLatch submissionRelease;

    public FakeAsyncGenerationProvider() {
        reset();
    }

    @Override
    public ProviderTaskReference submit(AsyncGenerationSpec spec) {
        submissions.incrementAndGet();
        callbackUrl = spec.callbackUrl();
        CountDownLatch started = submissionStarted;
        CountDownLatch release = submissionRelease;
        if (started != null && release != null) {
            started.countDown();
            try {
                if (!release.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Fake submission release timed out");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Fake submission interrupted", exception);
            }
        }
        if (ambiguousSubmission) {
            throw new ProviderSubmissionException(
                    true, "connection_reset", "Fake ambiguous submission", null);
        }
        if (rejectedSubmission) {
            throw new ProviderSubmissionException(
                    false, "invalid_request", "Fake rejected submission", null);
        }
        return new ProviderTaskReference(providerId(), accountId(), TASK_ID);
    }

    @Override
    public ProviderObservation observe(ProviderTaskReference reference) {
        observations.incrementAndGet();
        return observation;
    }

    @Override
    public void requestCancel(ProviderTaskReference reference) {
        cancellations.incrementAndGet();
        if (succeedsOnCancelConfirmation) {
            succeed();
        } else {
            observation = new ProviderObservation(
                    ProviderObservation.Status.CANCELLED, null, null,
                    null, null, "cancelled", null, null);
        }
    }

    @Override
    public String providerId() {
        return "seedance";
    }

    @Override
    public String accountId() {
        return "default";
    }

    public void succeed() {
        observation = new ProviderObservation(
                ProviderObservation.Status.SUCCEEDED,
                "https://provider.invalid/temp.mp4", 4,
                null, null, "succeeded", null, null);
    }

    public void reset() {
        submissions.set(0);
        observations.set(0);
        cancellations.set(0);
        callbackUrl = null;
        ambiguousSubmission = false;
        rejectedSubmission = false;
        succeedsOnCancelConfirmation = false;
        submissionStarted = null;
        submissionRelease = null;
        observation = new ProviderObservation(
                ProviderObservation.Status.QUEUED, null, null,
                null, null, "queued", null, null);
    }

    public int submissionCount() {
        return submissions.get();
    }

    public int observationCount() {
        return observations.get();
    }

    public int cancellationCount() {
        return cancellations.get();
    }

    public String callbackUrl() {
        return callbackUrl;
    }

    public String taskId() {
        return TASK_ID;
    }

    public void submitAmbiguously() {
        ambiguousSubmission = true;
    }

    public void rejectSubmission() {
        rejectedSubmission = true;
    }

    public void succeedOnCancelConfirmation() {
        succeedsOnCancelConfirmation = true;
    }

    public void blockSubmission() {
        submissionStarted = new CountDownLatch(1);
        submissionRelease = new CountDownLatch(1);
    }

    public boolean awaitSubmissionStarted() throws InterruptedException {
        CountDownLatch started = submissionStarted;
        return started != null && started.await(5, TimeUnit.SECONDS);
    }

    public void releaseSubmission() {
        CountDownLatch release = submissionRelease;
        if (release != null) {
            release.countDown();
        }
    }
}
