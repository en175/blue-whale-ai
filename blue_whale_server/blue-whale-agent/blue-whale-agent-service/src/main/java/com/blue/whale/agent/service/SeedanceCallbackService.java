package com.blue.whale.agent.service;

import com.blue.whale.agent.common.crypto.Sha256;
import com.blue.whale.agent.mapper.GenerationJobMapper;
import com.blue.whale.agent.mapper.GenerationProviderTaskMapper;
import com.blue.whale.agent.mapper.SeedanceCallbackInboxMapper;
import com.blue.whale.agent.mapper.SeedanceCallbackSecurityAuditMapper;
import com.blue.whale.agent.model.entity.GenerationProviderTask;
import com.blue.whale.agent.model.entity.SeedanceCallbackInbox;
import com.blue.whale.agent.model.entity.SeedanceCallbackSecurityAudit;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
@RequiredArgsConstructor
public class SeedanceCallbackService {

    private static final String PROVIDER = "seedance";

    private final GenerationJobMapper jobMapper;
    private final GenerationProviderTaskMapper taskMapper;
    private final SeedanceCallbackInboxMapper inboxMapper;
    private final SeedanceCallbackSecurityAuditMapper auditMapper;
    private final ObjectMapper objectMapper;

    @Transactional
    public Outcome receive(
            String accountId,
            Long generationJobId,
            String capability,
            Map<String, Object> payload) {
        String payloadHash = Sha256.hex(canonicalJson(payload));
        String providerTaskId = text(payload.get("id"));
        // 与 Worker 保持 generation_jobs → generation_provider_tasks 的统一加锁顺序。
        jobMapper.selectForUpdate(generationJobId);
        GenerationProviderTask evidence = taskMapper.selectByJobAndProviderTaskForUpdate(
                generationJobId, providerTaskId);
        String invalidReason = invalidReason(evidence, accountId, providerTaskId, capability);
        if (invalidReason != null) {
            auditMapper.insert(new SeedanceCallbackSecurityAudit()
                    .setGenerationJobId(generationJobId)
                    .setAccountId(accountId)
                    .setProviderTaskId(providerTaskId)
                    .setReason(invalidReason)
                    .setPayloadHash(payloadHash));
            return Outcome.INVALID;
        }

        String eventId = text(payload.get("event_id"));
        String dedupKey = Sha256.hex(PROVIDER + "\n" + accountId + "\n" + providerTaskId
                + "\n" + (eventId == null ? payloadHash : eventId));
        try {
            inboxMapper.insert(new SeedanceCallbackInbox()
                    .setGenerationJobId(generationJobId)
                    .setProvider(PROVIDER)
                    .setAccountId(accountId)
                    .setProviderTaskId(providerTaskId)
                    .setDedupKey(dedupKey)
                    .setPayloadHash(payloadHash)
                    .setPayload(new LinkedHashMap<>(payload)));
        } catch (DuplicateKeyException ignored) {
            // Provider callbacks are at-least-once; duplicates remain a successful wake-up.
        }
        jobMapper.wakeVideoJob(generationJobId);
        return Outcome.ACCEPTED;
    }

    private String invalidReason(
            GenerationProviderTask evidence,
            String accountId,
            String providerTaskId,
            String capability) {
        if (evidence == null) {
            return "evidence_not_found";
        }
        if (!PROVIDER.equals(evidence.getProvider())) {
            return "provider_mismatch";
        }
        if (!constantEquals(evidence.getAccountId(), accountId)) {
            return "account_mismatch";
        }
        if (providerTaskId == null
                || !constantEquals(evidence.getProviderTaskId(), providerTaskId)) {
            return "task_mismatch";
        }
        String digest = capability == null ? null : Sha256.hex(capability);
        if (!constantEquals(evidence.getCallbackCapabilityDigest(), digest)) {
            return "capability_mismatch";
        }
        return null;
    }

    private boolean constantEquals(String expected, String actual) {
        if (expected == null || actual == null) {
            return false;
        }
        return MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                actual.getBytes(StandardCharsets.UTF_8));
    }

    private String canonicalJson(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(canonicalValue(payload));
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Seedance callback JSON 无法规范化", exception);
        }
    }

    private Object canonicalValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach((key, nested) -> sorted.put(String.valueOf(key), canonicalValue(nested)));
            return sorted;
        }
        if (value instanceof List<?> list) {
            List<Object> values = new ArrayList<>(list.size());
            list.forEach(nested -> values.add(canonicalValue(nested)));
            return values;
        }
        return value;
    }

    private String text(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value);
        return text.isBlank() ? null : text;
    }

    public enum Outcome { ACCEPTED, INVALID }
}
