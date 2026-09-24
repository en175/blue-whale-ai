package com.bluewhale.common.proto;

import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.HoldRequest;
import com.bluewhale.contracts.billing.v1.UsageLine;
import com.bluewhale.contracts.billing.v1.UsageSource;
import com.bluewhale.contracts.common.v1.SpecAttrs;
import com.bluewhale.contracts.identity.v1.IdentityServiceGrpc;
import com.bluewhale.contracts.identity.v1.VerifySessionResponse;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 契约生成物冒烟：证明 {@code contracts/proto/} 的 Java 产物**能被消费**。
 *
 * <p>为什么值得一条测试：生成插件配好、目录里出现 .java 文件，都**不等于**能被使用——
 * 依赖缺失、包名不符、source root 没挂上，都可以让「生成了」和「编译得过」同时为真，
 * 直到第一个消费者引用时才炸。这条测试就是第一个消费者。
 *
 * <p>同时钉住两端的**契约形状**：字段号、枚举值、服务名。改了 proto 而忘了同步，
 * 这里会编译失败，比等到运行期序列化错位便宜得多。
 */
class GeneratedContractsSmokeTest {

    @Test
    void billing_HoldRequest_可构造且字段语义正确() {
        HoldRequest request = HoldRequest.newBuilder()
                .setUserId(42L)
                // ★ commandId 是幂等键来源（客户端生成，不是 job_id）——契约里的核心约定
                .setCommandId("cmd-abc")
                .setJobId(10086L)
                .setModelId("seedance-2.5")
                .setTaskType("text2video")
                // specs 是 SpecAttrs 消息（不是裸 map）——契约里刻意包一层，
                // 便于将来加字段而不破坏 map 的字段号语义
                .setSpecs(SpecAttrs.newBuilder().putAttrs("size", "1792x1024").build())
                .setTitle("视频生成 · seedance-2.5 1080p 5s")
                .build();

        assertThat(request.getUserId()).isEqualTo(42L);
        assertThat(request.getCommandId()).isEqualTo("cmd-abc");
        assertThat(request.getSpecs().getAttrsMap()).containsEntry("size", "1792x1024");
    }

    @Test
    void usage_quantities_是开放维度表且枚举不含零值误用() {
        UsageLine line = UsageLine.newBuilder()
                .setModelId("seedance-2.5")
                .setTaskType("text2video")
                // ★ key 与 catalog 的 baseUnit / dims / multipliers 使用同一套封闭枚举
                .putQuantities("usage.seconds", 5L)
                .putQuantities("usage.referenceCount", 2L)
                .setUsageSource(UsageSource.USAGE_SOURCE_UPSTREAM)
                .build();

        assertThat(line.getQuantitiesMap())
                .containsEntry("usage.seconds", 5L)
                .containsEntry("usage.referenceCount", 2L);
        // UNSPECIFIED 必须存在且为 0：proto3 的默认值语义，消费方据此判「没上报」
        assertThat(UsageSource.USAGE_SOURCE_UNSPECIFIED.getNumber()).isZero();
        assertThat(line.getUsageSource()).isNotEqualTo(UsageSource.USAGE_SOURCE_UNSPECIFIED);
    }

    @Test
    void identity_VerifySessionResponse_带tier供billing算折扣() {
        VerifySessionResponse response = VerifySessionResponse.newBuilder()
                .setUserId(42L)
                .setTier("pro")
                .setIsAdmin(false)
                .setUsername("tester")
                .addPermissions("pricing:publish")
                .build();

        // ★ tier 放进契约是为了避免每次 Hold 多一跳 RPC——删掉它会静默退化为 N+1
        assertThat(response.getTier()).isEqualTo("pro");
        assertThat(response.getPermissionsList()).containsExactly("pricing:publish");
    }

    @Test
    void 两个gRPC服务存根都已生成() {
        // 只断言「类存在且是 gRPC 存根」，不启动服务——本模块不是 Spring Boot 应用。
        assertThat(BillingServiceGrpc.SERVICE_NAME).isEqualTo("billing.v1.BillingService");
        assertThat(IdentityServiceGrpc.SERVICE_NAME).isEqualTo("identity.v1.IdentityService");
    }

    @Test
    void SpecAttrs_是map便于规范化前透传() {
        SpecAttrs attrs = SpecAttrs.newBuilder()
                .putAttrs("Size", "2K")        // 故意用未规范化的大小写
                .putAttrs("duration", "5")
                .build();

        // 规范化（trim + lowercase + 排序）是 billing 内部的事，契约只负责原样透传
        assertThat(attrs.getAttrsMap()).containsEntry("Size", "2K");
    }
}
