package com.blue.whale.agent.runtimebundle;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 锁定 Runtime Agent Bundle schema 已切除 CreativeSkill 资源形态：不再定义 CreativeSkill，
 * 也不接受 kind=creative_skill 资源（IK3NHU，Creative Skill 资源形态移至
 * docs/specs/2026-07-24-creative-skill-activation-contract.md 独立契约）。
 */
class RuntimeBundleCreativeSkillRemovalTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final SchemaRegistry REGISTRY =
            SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12);
    private static final String DIGEST =
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test
    void bundleSchemaNoLongerDefinesCreativeSkill() throws Exception {
        String bundleSchema = readText("/schema/runtime-agent-bundle.schema.json");
        assertThat(bundleSchema).doesNotContain("CreativeSkill");
        assertThat(bundleSchema).doesNotContain("creative_skill");
    }

    @Test
    void bundleManifestRejectsCreativeSkillResource() throws Exception {
        Schema manifestSchema = resourceManifestSchema();
        ObjectNode manifest = minimalManifest();
        assertThat(validate(manifestSchema, manifest))
                .as("control manifest with role_document + runtime_skill must conform")
                .isEmpty();

        ObjectNode skillResource = (ObjectNode) manifest.get("resources").get(1);
        skillResource.put("kind", "creative_skill");
        assertThat(validate(manifestSchema, manifest))
                .as("manifest with kind=creative_skill resource must be rejected")
                .isNotEmpty();
    }

    private Schema resourceManifestSchema() throws Exception {
        ObjectNode wrapper = MAPPER.createObjectNode();
        wrapper.put("$schema", "https://json-schema.org/draft/2020-12/schema");
        wrapper.set("$defs", MAPPER.readTree(readText("/schema/runtime-agent-bundle.schema.json")).get("$defs"));
        wrapper.put("$ref", "#/$defs/ResourceManifest");
        return REGISTRY.getSchema(MAPPER.writeValueAsString(wrapper), InputFormat.JSON);
    }

    private List<String> validate(Schema schema, ObjectNode instance) {
        return schema.validate(instance).stream()
                .map(Object::toString)
                .toList();
    }

    private ObjectNode minimalManifest() {
        ObjectNode manifest = MAPPER.createObjectNode();
        manifest.put("formatVersion", 1);
        manifest.put("baseUri", "bw-bundle://bundle_v1/");
        manifest.put("digestAlgorithm", "sha256");
        manifest.put("manifestDigest", DIGEST);
        ArrayNode resources = manifest.putArray("resources");
        resources.add(resource("role_doc", "role_document", "always_on", "roles/root.md", false));
        resources.add(resource("root_skill", "runtime_skill", "on_demand", "skills/root.md", true));
        return manifest;
    }

    private ObjectNode resource(
            String resourceId, String kind, String loadMode, String path, boolean withMetadata) {
        ObjectNode resource = MAPPER.createObjectNode();
        resource.put("resourceId", resourceId);
        resource.put("revision", 1);
        resource.put("path", path);
        resource.put("mediaType", "text/markdown");
        resource.put("loadMode", loadMode);
        resource.put("contentDigest", DIGEST);
        resource.put("sizeBytes", 10);
        resource.put("tokenEstimate", 5);
        resource.put("kind", kind);
        resource.putArray("references");
        if (withMetadata) {
            ObjectNode metadata = resource.putObject("metadata");
            metadata.put("name", "root-skill");
            metadata.put("description", "Root runtime skill.");
            metadata.put("allowImplicitInvocation", false);
        }
        return resource;
    }

    private String readText(String resourcePath) throws IOException {
        try (InputStream input = RuntimeBundleCreativeSkillRemovalTest.class.getResourceAsStream(resourcePath)) {
            if (input == null) {
                throw new IllegalStateException("classpath 资源缺失: " + resourcePath);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
