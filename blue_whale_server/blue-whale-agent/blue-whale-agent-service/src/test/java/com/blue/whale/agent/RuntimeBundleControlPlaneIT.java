package com.blue.whale.agent;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid",
        "blue-whale.runtime-bundle.admin-user-ids=10"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RuntimeBundleControlPlaneIT {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void adminCreatesDraftAndReadsItBack() throws Exception {
        mockMvc.perform(post("/internal/runtime-bundles/agents")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "create-agent-canvas")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "agent_definition_id": "canvas_agent",
                                  "key": "canvas-agent",
                                  "display_name": "Canvas Agent",
                                  "description": "Canvas 内部创作 Agent"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(200))
                .andExpect(jsonPath("$.data.agent_definition_id").value("canvas_agent"));

        mockMvc.perform(post("/internal/runtime-bundles/agents/{agentDefinitionId}/drafts", "canvas_agent")
                        .header("X-User-Id", "10")
                        .header("Idempotency-Key", "create-draft-canvas")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "composition": {"role_document_id": "role_main"},
                                  "resources": [{
                                    "resource_id": "role_main",
                                    "revision": 1,
                                    "kind": "role_document",
                                    "path": "AGENTS.md",
                                    "media_type": "text/markdown",
                                    "load_mode": "always_on",
                                    "content": "# Canvas Agent\\n"
                                  }]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.draft_id").isString())
                .andExpect(jsonPath("$.data.agent_definition_id").value("canvas_agent"))
                .andExpect(jsonPath("$.data.draft_revision").value(1))
                .andExpect(jsonPath("$.data.validation_state").value("editing"));

        mockMvc.perform(get("/internal/runtime-bundles/drafts/{draftId}", "canvas_agent-draft")
                        .header("X-User-Id", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.draft_id").value("canvas_agent-draft"))
                .andExpect(jsonPath("$.data.composition.role_document_id").value("role_main"))
                .andExpect(jsonPath("$.data.resources[0].content").value("# Canvas Agent\n"));
    }
}
