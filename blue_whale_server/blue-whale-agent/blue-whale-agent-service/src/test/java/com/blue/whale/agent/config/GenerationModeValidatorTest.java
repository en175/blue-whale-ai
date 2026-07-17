package com.blue.whale.agent.config;

import com.blue.whale.agent.service.generation.GenerationAdapterProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Fake 图片生成适配器的启用守卫：仅限非生产环境显式开启，生产环境不能意外启用。
 */
class GenerationModeValidatorTest {

    private final GenerationAdapterConfiguration configuration = new GenerationAdapterConfiguration();

    @Test
    void disabledAndOpenAiTosModesAreAccepted() {
        assertThatCode(() -> validate("disabled", false, new MockEnvironment()))
                .doesNotThrowAnyException();
        assertThatCode(() -> validate("openai-tos", false, new MockEnvironment()))
                .doesNotThrowAnyException();
    }

    @Test
    void unknownModeIsRejected() {
        assertThatThrownBy(() -> validate("fakee", true, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mode");
    }

    @Test
    void fakeModeRequiresExplicitNonProductionAcknowledgement() {
        assertThatThrownBy(() -> validate("fake", false, new MockEnvironment()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("fake-allowed");
    }

    @Test
    void fakeModeIsRejectedUnderProductionProfile() {
        MockEnvironment production = new MockEnvironment();
        production.setActiveProfiles("prod");
        assertThatThrownBy(() -> validate("fake", true, production))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("生产");
    }

    @Test
    void fakeModeStartsWhenExplicitlyAcknowledgedOutsideProduction() {
        assertThatCode(() -> validate("fake", true, new MockEnvironment()))
                .doesNotThrowAnyException();
        MockEnvironment test = new MockEnvironment();
        test.setActiveProfiles("test");
        assertThatCode(() -> validate("fake", true, test))
                .doesNotThrowAnyException();
    }

    private void validate(String mode, boolean fakeAllowed, MockEnvironment environment) {
        GenerationAdapterProperties properties = new GenerationAdapterProperties();
        properties.setMode(mode);
        properties.setFakeAllowed(fakeAllowed);
        configuration.generationModeValidator(properties, environment);
    }
}
