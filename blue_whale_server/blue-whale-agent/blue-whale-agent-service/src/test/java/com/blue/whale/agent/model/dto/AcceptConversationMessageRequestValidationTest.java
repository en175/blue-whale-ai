package com.blue.whale.agent.model.dto;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import javax.validation.ConstraintViolation;
import javax.validation.Validation;
import javax.validation.Validator;
import org.junit.jupiter.api.Test;

/** forced_creative_skill_id 字段校验：可空，非空按 CreativeSkillId 正则（IK3NPC）。 */
class AcceptConversationMessageRequestValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    private AcceptConversationMessageRequest request(String forcedId) {
        return new AcceptConversationMessageRequest(
                "client-1", "内容", null, null, null, forcedId);
    }

    @Test
    void nullForcedIdPasses() {
        assertThat(validator.validate(request(null))).isEmpty();
    }

    @Test
    void validIdPasses() {
        assertThat(validator.validate(request("cs_poster_design"))).isEmpty();
    }

    @Test
    void invalidIdRejected() {
        // 大写 + 太短，违反 ^[a-z][a-z0-9_]{2,79}$
        Set<ConstraintViolation<AcceptConversationMessageRequest>> violations =
                validator.validate(request("Bad"));
        assertThat(violations).isNotEmpty();
    }
}
