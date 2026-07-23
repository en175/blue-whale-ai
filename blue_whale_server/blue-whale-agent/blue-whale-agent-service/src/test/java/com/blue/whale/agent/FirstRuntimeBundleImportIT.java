package com.blue.whale.agent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.blue.whale.agent.runtimebundle.RuntimeBundleDigests;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 首版 Runtime Bundle（IK2D8R）便携包导入静态校验 IT。
 *
 * <p>被测对象是首版 Bundle 便携包（由本测试先运行
 * {@code blue-whale-agent-workspace/runtime-bundle/build.py} 现场构建到
 * {@code dist/first-runtime-bundle.json}——dist 是本地生成物，gitignore 忽略、不入库）：
 * 导入形成 BundleDraft 并经过现有 JSON Schema、引用闭包、冲突域、摘要与 token 预算
 * 静态门禁；随后发布并导出，验证资源级逻辑往返可复现（契约 §8.1：导入分配本地身份，
 * manifest 根摘要随新 baseUri 变化，资源摘要与正文逐一致）。
 */
@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.runtime-bundle.admin-user-ids=10",
        "blue-whale.runtime-bundle.worker-ids=worker-1",
        "blue-whale.runtime-bundle.approved-model-contracts="
                + "model_canvas|1.0.0|doubao-seed-1-6|text+vision+tool_calling|100000|4096",
        "blue-whale.runtime-bundle.approved-token-estimators=chars_div_4"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FirstRuntimeBundleImportIT {

    private static final Path PACKAGE_PATH = Path.of(System.getProperty("user.dir"))
            .resolve("../../../blue-whale-agent-workspace/runtime-bundle/dist/first-runtime-bundle.json")
            .normalize();

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void firstBundleImportsPublishesAndExportsWithStableResourceIdentity() throws Exception {
        runBundleBuild();
        assertThat(Files.exists(PACKAGE_PATH))
                .as("首版 Bundle 便携包已由 build.py 生成: %s", PACKAGE_PATH)
                .isTrue();
        JsonNode bundlePackage = objectMapper.readTree(Files.readString(PACKAGE_PATH));
        String originVersionId = bundlePackage.path("bundle_version_id").asText();
        String originManifestDigest = bundlePackage.path("composition")
                .path("resourceManifest").path("manifestDigest").asText();
        assertThat(originManifestDigest).startsWith("sha256:").hasSize(71);

        // 1. 导入 → BundleDraft（覆盖 JSON Schema / 引用闭包 / 冲突域 / 摘要 / 预算静态门禁）。
        createAgent("first_bundle_agent", "create-agent-first-bundle");
        JsonNode imported = adminJson(
                post("/internal/runtime-bundles/agents/first_bundle_agent/import"),
                "import-first-bundle", objectMapper.writeValueAsString(bundlePackage));
        assertThat(imported.path("data").path("agent_definition_id").asText())
                .isEqualTo("first_bundle_agent");
        String importDetails = jdbcTemplate.queryForObject("""
                SELECT details_json FROM runtime_bundle_audit_records
                WHERE operation = 'draft.imported' AND target_id = 'first_bundle_agent-draft'
                """, String.class);
        assertThat(importDetails).contains(originVersionId, originManifestDigest, "success");

        // 2. Draft 校验通过（JSON Schema 等发布前门禁在 validate 端点完整跑一遍）。
        JsonNode validation = adminJson(
                post("/internal/runtime-bundles/drafts/first_bundle_agent-draft/validate"),
                "validate-first-bundle", "{}");
        assertThat(validation.path("data").path("validation_state").asText()).isEqualTo("valid");

        // 3. 发布 → 不可变快照（本地身份，baseUri 随新 bundleVersionId 变化）。
        JsonNode published = adminJson(
                post("/internal/runtime-bundles/drafts/first_bundle_agent-draft/publish"),
                "publish-first-bundle", "{\"version\":\"1.0.0\"}");
        String versionId = published.path("data").path("bundle_version_id").asText();
        assertThat(published.path("data").path("manifest_digest").asText())
                .startsWith("sha256:").hasSize(71);

        // 4. 导出 → 资源级逻辑往返：正文、摘要、token 估算与便携包逐一致；导出包自洽。
        JsonNode exported = adminGet("/internal/runtime-bundles/versions/" + versionId + "/export")
                .path("data");
        JsonNode exportedManifest = exported.path("composition").path("resourceManifest");
        assertThat(exportedManifest.path("baseUri").asText())
                .isEqualTo("bw-bundle://" + versionId + "/");
        assertThat(digestWithoutManifestDigest(exportedManifest))
                .isEqualTo(exportedManifest.path("manifestDigest").asText());

        Map<String, JsonNode> packageResources = new HashMap<>();
        bundlePackage.path("resources").forEach(
                resource -> packageResources.put(resource.path("resource_id").asText(), resource));
        assertThat(exported.path("resources")).hasSize(packageResources.size());
        exported.path("resources").forEach(resource -> {
            String resourceId = resource.path("resource_id").asText();
            JsonNode origin = packageResources.get(resourceId);
            assertThat(origin).as("导出资源在便携包中存在: %s", resourceId).isNotNull();
            assertThat(resource.path("content").asText()).isEqualTo(origin.path("content").asText());
            assertThat(resource.path("content_digest").asText())
                    .isEqualTo(origin.path("content_digest").asText());
            assertThat(resource.path("token_estimate").asInt())
                    .isEqualTo(origin.path("token_estimate").asInt());
            assertThat(resource.path("size_bytes").asLong())
                    .isEqualTo(origin.path("size_bytes").asLong());
        });
        // composition 语义字段往返一致（RuleSet 顺序、ToolGrant、ModelProfile、预算）。
        // JsonNode 语义相等：ObjectNode 键序不敏感、ArrayNode 保序（RuleSet 顺序是契约）。
        JsonNode originComposition = bundlePackage.path("composition");
        JsonNode exportedComposition = exported.path("composition");
        assertThat(exportedComposition.path("roleDocumentId").asText())
                .isEqualTo(originComposition.path("roleDocumentId").asText());
        assertThat(exportedComposition.path("rootRuntimeSkillId").asText())
                .isEqualTo(originComposition.path("rootRuntimeSkillId").asText());
        assertThat(exportedComposition.path("ruleSet").path("rules"))
                .isEqualTo(originComposition.path("ruleSet").path("rules"));
        assertThat(exportedComposition.path("toolGrants"))
                .isEqualTo(originComposition.path("toolGrants"));
        assertThat(exportedComposition.path("modelProfiles"))
                .isEqualTo(originComposition.path("modelProfiles"));
        assertThat(exportedComposition.path("tokenBudget"))
                .isEqualTo(originComposition.path("tokenBudget"));

        // 5. 导出包再次导入第二个 Agent → 完整逻辑往返可复现。
        createAgent("first_bundle_reimport_agent", "create-agent-first-bundle-reimport");
        JsonNode reimported = adminJson(
                post("/internal/runtime-bundles/agents/first_bundle_reimport_agent/import"),
                "reimport-first-bundle", objectMapper.writeValueAsString(exported));
        assertThat(reimported.path("data").path("agent_definition_id").asText())
                .isEqualTo("first_bundle_reimport_agent");
    }

    private void runBundleBuild() throws Exception {
        Path bundleDir = PACKAGE_PATH.getParent().getParent();
        Process process = new ProcessBuilder("python3", "build.py")
                .directory(bundleDir.toFile())
                .redirectErrorStream(true)
                .start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exitCode = process.waitFor();
        assertThat(exitCode).as("build.py 构建首版 Bundle 便携包: %s", output).isEqualTo(0);
    }

    private void createAgent(String agentDefinitionId, String idempotencyKey) throws Exception {
        adminJson(post("/internal/runtime-bundles/agents"), idempotencyKey, """
                {
                  "agent_definition_id": "%s",
                  "key": "%s",
                  "display_name": "Director Runtime Agent",
                  "description": "First Runtime Bundle import test"
                }
                """.formatted(agentDefinitionId, agentDefinitionId.replace('_', '-')));
    }

    private String digestWithoutManifestDigest(JsonNode manifest) {
        ObjectNode withoutDigest = manifest.deepCopy();
        withoutDigest.remove("manifestDigest");
        return new RuntimeBundleDigests(objectMapper).canonicalJson(withoutDigest);
    }

    private JsonNode adminJson(MockHttpServletRequestBuilder request, String idempotencyKey, String body)
            throws Exception {
        // 注意：必须按字节解析。getContentAsString() 在无 charset 时按 ISO-8859-1 解码，
        // 便携包含中文资源正文（UTF-8 字节流，RFC 8259），误解码会污染摘要比对。
        byte[] content = mockMvc.perform(request
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsByteArray();
        return objectMapper.readTree(content);
    }

    private JsonNode adminGet(String path) throws Exception {
        byte[] content = mockMvc.perform(get(path).header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsByteArray();
        return objectMapper.readTree(content);
    }
}
