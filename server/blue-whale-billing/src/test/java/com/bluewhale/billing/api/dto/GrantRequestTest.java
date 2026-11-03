package com.bluewhale.billing.api.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GrantRequestTest {

    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

    @Test
    void 到期时刻按北京时间落库而不是UTC墙钟() throws Exception {
        GrantRequest request = json.readValue("""
                {"userId":1,"source":"purchased","amount":1000,"bizId":"RC1",
                 "expiresAt":"2028-11-03T02:38:05.000Z"}
                """, GrantRequest.class);

        assertThat(request.expiresAtLocal())
                .isEqualTo(LocalDateTime.of(2028, 11, 3, 10, 38, 5));
    }

    @Test
    void 未传到期时刻保持为空() throws Exception {
        GrantRequest request = json.readValue("""
                {"userId":1,"source":"gift","amount":500,"bizId":"G1"}
                """, GrantRequest.class);

        assertThat(request.expiresAtLocal()).isNull();
    }

    @Test
    void 不带偏移的时间戳被拒绝() {
        assertThatThrownBy(() -> json.readValue("""
                {"userId":1,"source":"purchased","amount":1000,"bizId":"RC2",
                 "expiresAt":"2028-11-03T10:38:05"}
                """, GrantRequest.class))
                .isInstanceOf(InvalidFormatException.class);
    }
}
