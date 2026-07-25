package com.blue.whale.agent.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AgentOrchestratorPropertiesTest {

    @Test
    void productionDefaultsToTheFrozenPydanticAdapterInsteadOfFake() {
        AgentOrchestratorProperties properties = new AgentOrchestratorProperties();

        assertThat(properties.getEngine()).isEqualTo("pydantic-ai");
        assertThat(properties.getEngineVersion()).isEqualTo("2.9.0");
        assertThat(properties.getAdapterSchemaVersion()).isEqualTo(1);
    }
}
