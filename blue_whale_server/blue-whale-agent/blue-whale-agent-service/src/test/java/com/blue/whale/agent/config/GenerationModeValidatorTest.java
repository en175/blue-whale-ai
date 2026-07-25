package com.blue.whale.agent.config;

import com.blue.whale.agent.service.generation.GenerationAdapterProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 图片生成适配器的启用守卫：Fake 与受控真实验收都仅限非生产环境显式开启，
 * 生产环境不能意外启用；未知或互相矛盾的组合拒绝启动。
 */
class GenerationModeValidatorTest {

    private final GenerationAdapterConfiguration configuration = new GenerationAdapterConfiguration();

    @Test
    void disabledAndOpenAiTosModesAreAccepted() {
        assertThatCode(() -> validate("disabled", false, false, new MockEnvironment()))
                .doesNotThrowAnyException();
        assertThatCode(() -> validate("openai-tos", false, false, new MockEnvironment()))
                .doesNotThrowAnyException();
    }

    @Test
    void unknownModeIsRejected() {
        assertThatThrownBy(() -> validate("fakee", true, false, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mode");
    }

    @Test
    void fakeModeRequiresExplicitNonProductionAcknowledgement() {
        assertThatThrownBy(() -> validate("fake", false, false, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("fake-allowed");
    }

    @Test
    void fakeModeIsRejectedUnderProductionProfile() {
        MockEnvironment production = new MockEnvironment();
        production.setActiveProfiles("prod");
        assertThatThrownBy(() -> validate("fake", true, false, production))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("生产");
    }

    @Test
    void fakeModeStartsWhenExplicitlyAcknowledgedOutsideProduction() {
        assertThatCode(() -> validate("fake", true, false, new MockEnvironment()))
                .doesNotThrowAnyException();
        MockEnvironment test = new MockEnvironment();
        test.setActiveProfiles("test");
        assertThatCode(() -> validate("fake", true, false, test))
                .doesNotThrowAnyException();
    }

    @Test
    void acceptanceRequiresOpenAiTosMode() {
        assertThatThrownBy(() -> validate("disabled", false, true, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("acceptance-allowed");
        assertThatThrownBy(() -> validate("fake", true, true, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("acceptance-allowed");
    }

    @Test
    void acceptanceIsRejectedUnderProductionProfile() {
        MockEnvironment production = new MockEnvironment();
        production.setActiveProfiles("prod");
        assertThatThrownBy(() -> validate("openai-tos", false, true, production))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("生产");
    }

    @Test
    void acceptanceStartsWithOpenAiTosOutsideProduction() {
        assertThatCode(() -> validate("openai-tos", false, true, new MockEnvironment()))
                .doesNotThrowAnyException();
        MockEnvironment test = new MockEnvironment();
        test.setActiveProfiles("test");
        assertThatCode(() -> validate("openai-tos", false, true, test))
                .doesNotThrowAnyException();
    }

    // ===== Agent Plan 模式（IK21O4）：ARK key/base-url 缺失即 fail-closed，生产拒绝 =====

    @Test
    void agentPlanRequiresArkApiKey() {
        MockEnvironment env = arkEnvironment(null,
                "https://ark.cn-beijing.volces.com/api/plan/v3");
        assertThatThrownBy(() -> validateAgentPlan(env))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("ark.api-key");
    }

    @Test
    void agentPlanRequiresArkBaseUrl() {
        MockEnvironment env = arkEnvironment("ark-test-key", null);
        assertThatThrownBy(() -> validateAgentPlan(env))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("ark.base-url");
    }

    @Test
    void agentPlanRequiresPlanEndpointBaseUrl() {
        MockEnvironment env = arkEnvironment("ark-test-key",
                "https://ark.cn-beijing.volces.com/api/v3");
        assertThatThrownBy(() -> validateAgentPlan(env))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("plan");
    }

    @Test
    void agentPlanRejectedUnderProductionProfile() {
        MockEnvironment prod = arkEnvironment("ark-test-key",
                "https://ark.cn-beijing.volces.com/api/plan/v3");
        prod.setActiveProfiles("prod");
        assertThatThrownBy(() -> validateAgentPlan(prod))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("生产");
    }

    @Test
    void agentPlanStartsWithKeyAndPlanEndpointOutsideProduction() {
        MockEnvironment env = arkEnvironment("ark-test-key",
                "https://ark.cn-beijing.volces.com/api/plan/v3");
        assertThatCode(() -> validateAgentPlan(env)).doesNotThrowAnyException();
        MockEnvironment test = arkEnvironment("ark-test-key",
                "https://ark.cn-beijing.volces.com/api/plan/v3");
        test.setActiveProfiles("test");
        assertThatCode(() -> validateAgentPlan(test)).doesNotThrowAnyException();
    }

    private void validate(
            String mode, boolean fakeAllowed, boolean acceptanceAllowed, MockEnvironment environment) {
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.setMode(mode);
        properties.setFakeAllowed(fakeAllowed);
        properties.setAcceptanceAllowed(acceptanceAllowed);
        configuration.generationModeValidator(properties, environment);
    }

    private void validateAgentPlan(MockEnvironment environment) {
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.setMode("agent-plan");
        configuration.generationModeValidator(properties, environment);
    }

    private MockEnvironment arkEnvironment(String apiKey, String baseUrl) {
        MockEnvironment environment = new MockEnvironment();
        if (apiKey != null) {
            environment.setProperty("volcengine.ark.api-key", apiKey);
        }
        if (baseUrl != null) {
            environment.setProperty("volcengine.ark.base-url", baseUrl);
        }
        return environment;
    }
}
