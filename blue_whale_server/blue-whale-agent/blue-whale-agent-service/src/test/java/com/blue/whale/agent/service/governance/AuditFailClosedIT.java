package com.blue.whale.agent.service.governance;

import com.blue.whale.agent.mapper.AuditRecordMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = {
        "spring.cloud.nacos.discovery.enabled=false",
        "spring.cloud.nacos.config.enabled=false",
        "spring.cloud.discovery.enabled=false",
        "spring.cloud.service-registry.auto-registration.enabled=false",
        "volcengine.ark.base-url=https://ark.test.invalid"
})
@ActiveProfiles("test")
class AuditFailClosedIT {

    @Autowired
    private CostReservationService reservationService;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @MockBean
    private AuditRecordMapper auditRecordMapper;

    @BeforeEach
    void cleanFacts() {
        jdbcTemplate.batchUpdate(
                "DELETE FROM cost_reservations",
                "DELETE FROM cost_budget_locks");
    }

    @Test
    void reservationRollsBackWhenImmutableAuditCannotBeAppended() {
        assertThatThrownBy(() -> reservationService.reserve(new CostReservationCommand(
                        11L, 22L, 99L, "action-99", "generate_image",
                        new PriceQuote(100L, "image-provider", "price-2026-07",
                                "cny-2026-07", "model-policy-v1"))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("审计写入失败");

        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM cost_reservations WHERE generation_job_id = 99", Long.class))
                .isZero();
    }
}
