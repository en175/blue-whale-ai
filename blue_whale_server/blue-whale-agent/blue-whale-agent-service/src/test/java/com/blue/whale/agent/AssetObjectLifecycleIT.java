package com.blue.whale.agent;

import com.blue.whale.agent.mapper.AssetMapper;
import com.blue.whale.agent.model.dto.AssetObjectTransferHandle;
import com.blue.whale.agent.model.entity.Asset;
import com.blue.whale.agent.service.AssetObjectLifecycleService;
import com.blue.whale.agent.service.generation.AssetObjectGarbageCollector;
import com.blue.whale.agent.service.generation.PreparedGenerationObject;
import com.blue.whale.agent.service.generation.StoredGenerationObject;
import com.blue.whale.agent.support.FakeGenerationConfiguration;
import com.blue.whale.agent.support.FakeGenerationStorage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.generation.worker-scheduled=false",
        "blue-whale.generation.asset-gc-scheduled=false"
})
@ActiveProfiles("test")
@Import(FakeGenerationConfiguration.class)
class AssetObjectLifecycleIT {

    @Autowired
    private AssetObjectLifecycleService lifecycleService;
    @Autowired
    private AssetObjectGarbageCollector collector;
    @Autowired
    private FakeGenerationStorage storage;
    @Autowired
    private AssetMapper assetMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void cleanFacts() {
        storage.clear();
        jdbcTemplate.batchUpdate(
                "DELETE FROM asset_object_transfers",
                "DELETE FROM asset_storage_objects",
                "DELETE FROM assets");
    }

    @Test
    void deletesOnlyObjectsUnreferencedContinuouslyForSevenDays() {
        StoredGenerationObject orphan = storeTracked("orphan");
        jdbcTemplate.update("UPDATE asset_storage_objects "
                + "SET first_unreferenced_at = DATEADD('DAY', -8, CURRENT_TIMESTAMP) "
                + "WHERE storage_key = ?", orphan.storageKey());

        assertThat(collector.runOnce("asset-gc-test")).isTrue();

        assertThat(storage.read(orphan.storageKey())).isNull();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT state FROM asset_storage_objects WHERE storage_key = ?",
                String.class, orphan.storageKey())).isEqualTo("deleted");
    }

    @Test
    void finalReferenceCheckKeepsAcceptedAssetAndResetsGracePeriod() {
        StoredGenerationObject stored = storeTracked("referenced");
        lifecycleService.protectReference(
                stored.storageKey(), stored.contentSha256(), Asset.SOURCE_GENERATED);
        assetMapper.insert(new Asset()
                .setUserId(10L)
                .setType(Asset.TYPE_IMAGE)
                .setStorageKey(stored.storageKey())
                .setContentSha256(stored.contentSha256())
                .setSource(Asset.SOURCE_GENERATED)
                .setStatus(Asset.STATUS_NORMAL));
        jdbcTemplate.update("UPDATE asset_storage_objects "
                + "SET first_unreferenced_at = DATEADD('DAY', -8, CURRENT_TIMESTAMP) "
                + "WHERE storage_key = ?", stored.storageKey());

        assertThat(collector.runOnce("asset-gc-test")).isFalse();

        assertThat(storage.read(stored.storageKey())).isNotNull();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT first_unreferenced_at FROM asset_storage_objects WHERE storage_key = ?",
                java.sql.Timestamp.class, stored.storageKey())).isNull();
    }

    @Test
    void expiredActiveTransferStartsANewSevenDayGracePeriodBeforeDeletion() {
        byte[] content = "expired-transfer".getBytes(StandardCharsets.UTF_8);
        PreparedGenerationObject prepared = storage.prepare(content, "image/png");
        AssetObjectTransferHandle transfer = lifecycleService.beginTransfer(
                prepared.storageKey(), Asset.SOURCE_GENERATED);
        storage.store(prepared, content);
        jdbcTemplate.update("UPDATE asset_object_transfers SET expires_at = "
                + "DATEADD('MINUTE', -1, CURRENT_TIMESTAMP) WHERE transfer_token = ?",
                transfer.token());

        assertThat(collector.runOnce("asset-gc-test")).isTrue();
        assertThat(storage.read(prepared.storageKey())).isNotNull();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT active_transfer_count FROM asset_storage_objects WHERE storage_key = ?",
                Integer.class, prepared.storageKey())).isZero();

        jdbcTemplate.update("UPDATE asset_storage_objects "
                + "SET first_unreferenced_at = DATEADD('DAY', -8, CURRENT_TIMESTAMP) "
                + "WHERE storage_key = ?", prepared.storageKey());
        assertThat(collector.runOnce("asset-gc-test")).isTrue();
        assertThat(storage.read(prepared.storageKey())).isNull();
    }

    @Test
    void concurrentTransfersShareOneLifecycleIdentity() throws Exception {
        byte[] content = "shared-content".getBytes(StandardCharsets.UTF_8);
        PreparedGenerationObject prepared = storage.prepare(content, "image/png");
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        CompletableFuture<AssetObjectTransferHandle> first = beginConcurrently(prepared, ready, start);
        CompletableFuture<AssetObjectTransferHandle> second = beginConcurrently(prepared, ready, start);
        assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
        start.countDown();

        AssetObjectTransferHandle firstHandle = first.get(5, TimeUnit.SECONDS);
        AssetObjectTransferHandle secondHandle = second.get(5, TimeUnit.SECONDS);

        assertThat(firstHandle.token()).isNotEqualTo(secondHandle.token());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM asset_storage_objects WHERE storage_key = ?",
                Long.class, prepared.storageKey())).isOne();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT active_transfer_count FROM asset_storage_objects WHERE storage_key = ?",
                Integer.class, prepared.storageKey())).isEqualTo(2);
        lifecycleService.failTransfer(firstHandle);
        lifecycleService.failTransfer(secondHandle);
    }

    private StoredGenerationObject storeTracked(String value) {
        byte[] content = value.getBytes(StandardCharsets.UTF_8);
        PreparedGenerationObject prepared = storage.prepare(content, "image/png");
        AssetObjectTransferHandle transfer = lifecycleService.beginTransfer(
                prepared.storageKey(), Asset.SOURCE_GENERATED);
        StoredGenerationObject stored = storage.store(prepared, content);
        lifecycleService.completeTransfer(transfer, stored.contentSha256());
        return stored;
    }

    private CompletableFuture<AssetObjectTransferHandle> beginConcurrently(
            PreparedGenerationObject prepared,
            CountDownLatch ready,
            CountDownLatch start) {
        return CompletableFuture.supplyAsync(() -> {
            ready.countDown();
            try {
                if (!start.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("并发传输未开始");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("并发传输被中断", exception);
            }
            return lifecycleService.beginTransfer(
                    prepared.storageKey(), Asset.SOURCE_GENERATED);
        });
    }
}
