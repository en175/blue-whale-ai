package com.bluewhale.billing.testsupport;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class BillingTestDatabaseGateTest {

    @Nested
    @DisplayName("库名解析")
    class 库名解析 {

        @Test
        void 带参数的连接串取到库名() {
            assertThat(BillingTestDatabaseGate.databaseName(
                    "jdbc:mysql://localhost:13306/bw_billing_test?useSSL=false&characterEncoding=utf8"))
                    .isEqualTo("bw_billing_test");
        }

        @Test
        void 不带参数也能取到库名() {
            assertThat(BillingTestDatabaseGate.databaseName(
                    "jdbc:mysql://127.0.0.1:3306/bw_billing_test_IKDLQF"))
                    .isEqualTo("bw_billing_test_IKDLQF");
        }

        @Test
        void 取不到库名时返回空串() {
            assertThat(BillingTestDatabaseGate.databaseName("jdbc:mysql://localhost:13306/")).isEmpty();
            assertThat(BillingTestDatabaseGate.databaseName(null)).isEmpty();
            assertThat(BillingTestDatabaseGate.databaseName("")).isEmpty();
        }
    }

    @Nested
    @DisplayName("测试专用库判据")
    class 测试专用库判据 {

        @Test
        void 接受测试专用库名() {
            assertThat(BillingTestDatabaseGate.isTestDatabase("bw_billing_test")).isTrue();
            assertThat(BillingTestDatabaseGate.isTestDatabase("bw_billing_test_IKDLQF")).isTrue();
            assertThat(BillingTestDatabaseGate.isTestDatabase("bw_billing_test_2")).isTrue();
        }

        @Test
        void 拒绝开发库与生产库() {
            assertThat(BillingTestDatabaseGate.isTestDatabase("bw_billing")).isFalse();
            assertThat(BillingTestDatabaseGate.isTestDatabase("bw_billing_prod")).isFalse();
            assertThat(BillingTestDatabaseGate.isTestDatabase("bw_billing_test2")).isFalse();
            assertThat(BillingTestDatabaseGate.isTestDatabase("bw_billing_test-2")).isFalse();
            assertThat(BillingTestDatabaseGate.isTestDatabase("blue_whale")).isFalse();
            assertThat(BillingTestDatabaseGate.isTestDatabase("")).isFalse();
            assertThat(BillingTestDatabaseGate.isTestDatabase(null)).isFalse();
        }
    }

    @Nested
    @DisplayName("连接串解析")
    class 连接串解析 {

        @Test
        void 未覆盖时用测试配置里的缺省值() {
            assertThat(BillingTestDatabaseGate.isTestDatabase(BillingTestDatabaseGate.databaseName(
                    BillingTestDatabaseGate.configuredDefaultUrl())))
                    .as("测试缺省落点必须本身就是测试专用库，否则「没配的人」会跑到开发库上")
                    .isTrue();
        }
    }
}
