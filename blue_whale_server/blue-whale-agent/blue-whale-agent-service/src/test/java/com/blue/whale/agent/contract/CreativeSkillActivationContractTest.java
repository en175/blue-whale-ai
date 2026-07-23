package com.blue.whale.agent.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 锁定 Creative Skill 激活契约：同一 fixtures 在 Java / Python / TypeScript 三端必须以相同
 * snake_case wire shape 通过或被拒；并锁定 Java 运行时装载的 schema 副本与 docs/specs 原件
 * 逐字节同形。对齐 docs/specs/2026-07-24-creative-skill-activation-contract.md（IK3NHU）。
 */
class CreativeSkillActivationContractTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final SchemaRegistry REGISTRY =
            SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12);

    @Test
    void validFixturesConformToSchema() throws Exception {
        JsonNode manifest = readJson("/fixtures/creative-skill-activation/manifest.json");
        for (JsonNode entry : manifest.get("valid")) {
            String file = entry.get("file").asText();
            JsonNode fixture = readJson("/fixtures/creative-skill-activation/" + file);
            List<String> errors = validateAgainstDef(entry.get("def").asText(), fixture);
            assertThat(errors).as("valid fixture %s must conform", file).isEmpty();
        }
    }

    @Test
    void invalidFixturesAreRejected() throws Exception {
        JsonNode manifest = readJson("/fixtures/creative-skill-activation/manifest.json");
        for (JsonNode entry : manifest.get("invalid")) {
            String file = entry.get("file").asText();
            JsonNode fixture = readJson("/fixtures/creative-skill-activation/" + file);
            List<String> errors = validateAgainstDef(entry.get("def").asText(), fixture);
            assertThat(errors).as("invalid fixture %s must be rejected", file).isNotEmpty();
        }
    }

    @Test
    void classpathSchemaIsByteIdenticalToDocsOriginal() throws Exception {
        // Addendum 锁定：Java 运行时装载的 schema 副本（构建期从 docs/specs 单源拷入 classpath）
        // 与 docs/specs 原件逐字节一致，拷贝机制失效时本测试兜底。
        String classpathCopy = readText("/schema/creative-skill-activation.schema.json");
        String docsOriginal = Files.readString(
                Path.of("../../../docs/specs/creative-skill-activation.schema.json"), StandardCharsets.UTF_8);
        assertThat(classpathCopy).isEqualTo(docsOriginal);
    }

    private List<String> validateAgainstDef(String defName, JsonNode fixture) throws Exception {
        ObjectNode wrapper = MAPPER.createObjectNode();
        wrapper.put("$schema", "https://json-schema.org/draft/2020-12/schema");
        wrapper.set("$defs", readJson("/schema/creative-skill-activation.schema.json").get("$defs"));
        wrapper.put("$ref", "#/$defs/" + defName);
        Schema schema = REGISTRY.getSchema(MAPPER.writeValueAsString(wrapper), InputFormat.JSON);
        return schema.validate(fixture).stream()
                .map(Object::toString)
                .toList();
    }

    private JsonNode readJson(String resourcePath) throws Exception {
        return MAPPER.readTree(readText(resourcePath));
    }

    private String readText(String resourcePath) throws IOException {
        try (InputStream input = CreativeSkillActivationContractTest.class.getResourceAsStream(resourcePath)) {
            if (input == null) {
                throw new IllegalStateException("classpath 资源缺失: " + resourcePath);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
