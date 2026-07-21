package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
final class RuntimeBundleSchemaValidator {

    private final ObjectMapper objectMapper;
    private final Schema schema;
    private final Schema draft202012MetaSchema;

    RuntimeBundleSchemaValidator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        SchemaRegistry registry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12);
        this.schema = loadSchema(
                registry,
                "/schema/runtime-agent-bundle.schema.json",
                "Runtime Agent Bundle Schema 未打包",
                "Runtime Agent Bundle Schema 无法读取");
        this.draft202012MetaSchema = loadSchema(
                registry,
                "/draft/2020-12/schema",
                "Draft 2020-12 元 Schema 未打包",
                "Draft 2020-12 元 Schema 无法读取");
    }

    List<String> validate(JsonNode snapshot) {
        try {
            return schema.validate(objectMapper.writeValueAsString(snapshot), InputFormat.JSON,
                            context -> context.executionConfig(config -> config.formatAssertionsEnabled(true)))
                    .stream()
                    .map(Object::toString)
                    .toList();
        } catch (JsonProcessingException exception) {
            return List.of("snapshot_json_unreadable");
        }
    }

    List<String> validateToolSchema(JsonNode argumentSchema) {
        return draft202012MetaSchema.validate(argumentSchema).stream()
                .map(Object::toString)
                .toList();
    }

    private Schema loadSchema(
            SchemaRegistry registry, String resourcePath, String missingMessage, String unreadableMessage) {
        try (InputStream input = RuntimeBundleSchemaValidator.class.getResourceAsStream(resourcePath)) {
            if (input == null) {
                throw new IllegalStateException(missingMessage);
            }
            String schemaData = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            return registry.getSchema(schemaData, InputFormat.JSON);
        } catch (IOException exception) {
            throw new IllegalStateException(unreadableMessage, exception);
        }
    }
}
