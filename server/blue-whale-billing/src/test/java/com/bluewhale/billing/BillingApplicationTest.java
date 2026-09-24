package com.bluewhale.billing;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 骨架冒烟：上下文能起、{@code GET /ready} 能返回。
 *
 * <p>这条测试的价值在于**钉住「另一个模块能复用 server/blue-whale-common」**——
 * billing 依赖 libs 却编译不过的话，这里就没有「起得来」可言。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class BillingApplicationTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    @Test
    void 上下文可启动且就绪探针可用() {
        ResponseEntity<String> response = rest.getForEntity("/ready", String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).contains("ready");
    }
}
