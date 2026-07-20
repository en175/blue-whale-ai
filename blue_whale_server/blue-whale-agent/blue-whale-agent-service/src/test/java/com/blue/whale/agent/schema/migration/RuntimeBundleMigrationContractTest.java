package com.blue.whale.agent.schema.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

class RuntimeBundleMigrationContractTest {

    @Test
    void v10DeclaresControlPlaneTablesAndAgentRunPins() throws Exception {
        String migration = new String(new ClassPathResource(
                "db/migrations/V10__runtime-agent-bundle.sql").getInputStream().readAllBytes(),
                StandardCharsets.UTF_8);

        for (String table : new String[] {
                "runtime_agent_definitions", "runtime_bundle_drafts", "runtime_bundle_versions",
                "runtime_bundle_resources", "runtime_bundle_write_idempotency",
                "runtime_bundle_audit_records"}) {
            assertThat(migration).contains("CREATE TABLE " + table);
        }
        for (String column : new String[] {
                "bundle_version_id", "manifest_digest", "model_profile_id",
                "model_profile_version", "activated_creative_skill_versions"}) {
            assertThat(migration).contains("ADD COLUMN " + column);
        }
        assertThat(migration).contains("resource_revision INT NOT NULL");
        assertThat(migration).contains("response_json JSON NULL");
    }
}
