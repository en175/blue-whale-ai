package com.bluewhale.common.http;

import okhttp3.OkHttpClient;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 共享 HTTP 装配的口径钉桩。
 *
 * <p>为什么要钉「派生实例共享池」：13 个 new-api 客户端各建各的 OkHttpClient 时，
 * 连接池与调度线程池是 13 套（连接无法复用、池上限没有单点）。收敛成「一份原型 +
 * 各族按超时派生」之后，这条不变式就没有任何编译期保障了——将来谁把
 * {@link NewApiHttpSupport#buildClient} 改回 {@code new OkHttpClient.Builder()}，
 * 功能测试全绿而池又散成 13 份。这里把它钉死。
 *
 * <p>同时钉住反面：派生**不**抹平超时（各族超时与 claim 租约对着调，见各族 javadoc），
 * 收敛的是池，不是超时。
 */
class NewApiHttpSupportTest {

    @Test
    @DisplayName("派生实例共享连接池与线程池，但各自持有自己的超时")
    void derivedClientsSharePoolsButKeepOwnTimeouts() {
        OkHttpClient slow = NewApiHttpSupport.buildClient(10_000, 300_000, 300_000);
        OkHttpClient fast = NewApiHttpSupport.buildClient(10_000, 300, 300);

        // 池共享（引用同一对象；OkHttp 的 newBuilder() 复制引用而非新建）
        assertThat(slow.connectionPool()).isSameAs(fast.connectionPool());
        assertThat(slow.dispatcher()).isSameAs(fast.dispatcher());

        // 超时不共享（族变化轴）
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
