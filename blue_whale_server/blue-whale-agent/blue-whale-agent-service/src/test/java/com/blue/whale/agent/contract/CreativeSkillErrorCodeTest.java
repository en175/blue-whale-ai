package com.blue.whale.agent.contract;

import static org.assertj.core.api.Assertions.assertThat;

import com.blue.whale.global.base.resp.SystemCode;
import org.junit.jupiter.api.Test;

/** 锁定 Creative Skill 激活错误码稳定编号（契约 §8，IK3NPC）。 */
class CreativeSkillErrorCodeTest {

    @Test
    void creativeSkillErrorCodesMatchContract() {
        assertThat(SystemCode.CREATIVE_SKILL_UNAVAILABLE_CODE).isEqualTo(100306);
        assertThat(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE_CODE).isEqualTo(100307);
        assertThat(SystemCode.CREATIVE_SKILL_SELECTION_NOT_ALLOWED_CODE).isEqualTo(100308);
        assertThat(SystemCode.CREATIVE_SKILL_NOT_A_CANDIDATE_CODE).isEqualTo(100309);
        assertThat(SystemCode.CREATIVE_SKILL_ALREADY_ACTIVATED_CODE).isEqualTo(100310);

        assertThat(SystemCode.CREATIVE_SKILL_UNAVAILABLE.getCode()).isEqualTo(100306);
        assertThat(SystemCode.CREATIVE_SKILL_VERSION_UNAVAILABLE.getCode()).isEqualTo(100307);
        assertThat(SystemCode.CREATIVE_SKILL_SELECTION_NOT_ALLOWED.getCode()).isEqualTo(100308);
        assertThat(SystemCode.CREATIVE_SKILL_NOT_A_CANDIDATE.getCode()).isEqualTo(100309);
        assertThat(SystemCode.CREATIVE_SKILL_ALREADY_ACTIVATED.getCode()).isEqualTo(100310);
    }
}
