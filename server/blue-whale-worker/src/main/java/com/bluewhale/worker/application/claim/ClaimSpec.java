package com.bluewhale.worker.application.claim;

import com.bluewhale.worker.domain.entity.GenerationJobEntity;
import com.bluewhale.worker.infrastructure.mapper.GenerationJobMapper;

import java.time.LocalDateTime;
import java.util.List;
import java.util.function.IntSupplier;
import java.util.function.LongFunction;

public record ClaimSpec(
        String type,
        IntSupplier lease,
        LongFunction<GenerationJobEntity> candidateLookup,
        ClaimCas cas
) {

    @FunctionalInterface
    public interface ClaimCas {
        int claim(Long jobId, String workerId, LocalDateTime leaseExpiresAt,
                  Long fencingToken, String candidateStatus);
    }

    public int leaseSeconds() {
        return lease.getAsInt();
    }

    public GenerationJobEntity candidate(Long jobId) {
        return candidateLookup.apply(jobId);
    }

    public int claimCas(Long jobId, String workerId, LocalDateTime leaseExpiresAt,
                        Long fencingToken, String candidateStatus) {
        return cas.claim(jobId, workerId, leaseExpiresAt, fencingToken, candidateStatus);
    }


    public static ClaimSpec bySources(String type, int leaseSeconds, List<String> sources,
                                      GenerationJobMapper mapper) {
        return new ClaimSpec(type, () -> leaseSeconds,
                jobId -> mapper.findCandidateByTypeAndSources(jobId, type, sources),
                mapper::claimImageCas);
    }

    public static ClaimSpec typeOnly(String type, int leaseSeconds, GenerationJobMapper mapper) {
        return new ClaimSpec(type, () -> leaseSeconds,
                jobId -> mapper.findCandidateByTypeOnly(jobId, type),
                mapper::claimImageCas);
    }

    public static ClaimSpec typeOnly(String type, int leaseSeconds, GenerationJobMapper mapper,
                                     ClaimCas cas) {
        return new ClaimSpec(type, () -> leaseSeconds,
                jobId -> mapper.findCandidateByTypeOnly(jobId, type),
                cas);
    }
}
