package com.blue.whale.agent.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "blue-whale.agent-orchestrator")
public class AgentOrchestratorProperties {
    private String engine = "pydantic-ai";
    private String engineVersion = "2.9.0";
    private Integer adapterSchemaVersion = 1;
}
