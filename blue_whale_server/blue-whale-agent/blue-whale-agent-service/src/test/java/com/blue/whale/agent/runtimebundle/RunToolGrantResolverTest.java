package com.blue.whale.agent.runtimebundle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RunToolGrantResolverTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RuntimeBundleService runtimeBundleService = mock(RuntimeBundleService.class);
    private final RunToolGrantResolver resolver = new RunToolGrantResolver(runtimeBundleService);

    @Test
    void resolvesAuthorizedGrantByToolIdAndRegistryVersion() {
        when(runtimeBundleService.readVersion("bv-1")).thenReturn(snapshotWithGrant(
                "create_image_generation_job", 1, "side_effect", true));
        Optional<RunToolGrantResolver.ResolvedToolGrant> grant =
                resolver.resolve("bv-1", "create_image_generation_job", 1);
        assertThat(grant).isPresent();
        assertThat(grant.get().effect()).isEqualTo("side_effect");
        assertThat(grant.get().proposalOnly()).isTrue();
        assertThat(grant.get().argumentSchema().path("$schema").asText()).isEqualTo("x");
    }

    @Test
    void distinguishesSameToolIdAcrossRegistryVersions() {
        when(runtimeBundleService.readVersion("bv-1")).thenReturn(snapshotWithGrant(
                "create_image_generation_job", 2, "side_effect", true));
        assertThat(resolver.resolve("bv-1", "create_image_generation_job", 1)).isEmpty();
    }

    @Test
    void missingGrantForUnauthorizedToolIsEmpty() {
        when(runtimeBundleService.readVersion("bv-1")).thenReturn(snapshotWithGrant(
                "create_image_generation_job", 1, "side_effect", true));
        assertThat(resolver.resolve("bv-1", "canvas.read", 1)).isEmpty();
    }

    @Test
    void blankBundleVersionIdIsEmptyWithoutLookup() {
        assertThat(resolver.resolve(null, "create_image_generation_job", 1)).isEmpty();
        assertThat(resolver.resolve("  ", "create_image_generation_job", 1)).isEmpty();
    }

    private JsonNode snapshotWithGrant(String toolId, int version, String effect, boolean proposalOnly) {
        ObjectNode grant = objectMapper.createObjectNode()
                .put("toolName", toolId)
                .put("registryVersion", version)
                .put("effect", effect)
                .put("proposalOnly", proposalOnly);
        grant.set("argumentSchema", objectMapper.createObjectNode().put("$schema", "x"));
        grant.set("constraints", objectMapper.createObjectNode());
        ObjectNode composition = objectMapper.createObjectNode();
        composition.putArray("toolGrants").add(grant);
        return objectMapper.createObjectNode().set("composition", composition);
    }
}
