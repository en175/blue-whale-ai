package com.bluewhale.common.http;

import okhttp3.OkHttpClient;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class NewApiHttpSupportTest {

    @Test
    @DisplayName("派生实例共享连接池与线程池，但各自持有自己的超时")
    void derivedClientsSharePoolsButKeepOwnTimeouts() {
        OkHttpClient slow = NewApiHttpSupport.buildClient(10_000, 300_000, 300_000);
        OkHttpClient fast = NewApiHttpSupport.buildClient(10_000, 300, 300);

        assertThat(slow.connectionPool()).isSameAs(fast.connectionPool());
        assertThat(slow.dispatcher()).isSameAs(fast.dispatcher());

        assertThat(slow.readTimeoutMillis()).isEqualTo(300_000);
        assertThat(fast.readTimeoutMillis()).isEqualTo(300);
        assertThat(fast.writeTimeoutMillis()).isEqualTo(300);
        assertThat(fast.connectTimeoutMillis()).isEqualTo(10_000);
    }

    @Test
    @DisplayName("normalizeBaseUrl：去尾斜杠；null/空白即抛（不返回空串）")
    void normalizeBaseUrlStripsTrailingSlashesAndRejectsBlank() {
        assertThat(NewApiHttpSupport.normalizeBaseUrl("http://new-api:3000/"))
                .isEqualTo("http://new-api:3000");
        assertThat(NewApiHttpSupport.normalizeBaseUrl("http://new-api:3000"))
                .isEqualTo("http://new-api:3000");

        assertThatThrownBy(() -> NewApiHttpSupport.normalizeBaseUrl(""))
                .as("空串必须抛，不能返回空串让调用方拼出没有 host 的 URL")
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(NewApiHttpSupport.BASE_URL_MISSING_MSG);
        assertThatThrownBy(() -> NewApiHttpSupport.normalizeBaseUrl(null))
                .isInstanceOf(IllegalStateException.class);
    }
}
