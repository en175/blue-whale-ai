package com.bluewhale.common.proto;

import com.bluewhale.contracts.billing.v1.BillingServiceGrpc;
import com.bluewhale.contracts.billing.v1.ChargeRequest;
import com.bluewhale.contracts.common.v1.SpecAttrs;
import com.bluewhale.contracts.identity.v1.IdentityServiceGrpc;
import com.bluewhale.contracts.identity.v1.VerifySessionResponse;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GeneratedContractsSmokeTest {

    @Test
    void billing_ChargeRequest_可构造且字段语义正确() {
        ChargeRequest request = ChargeRequest.newBuilder()
                .setUserId(42L)
                .setCommandId("cmd-abc")
                .setJobId(10086L)
                .setModelId("seedance-2.5")
                .setTaskType("text2video")
                .setSpecs(SpecAttrs.newBuilder().putAttrs("size", "1792x1024").build())
                .setTitle("视频生成 · seedance-2.5 1080p 5s")
                .build();

        assertThat(request.getUserId()).isEqualTo(42L);
        assertThat(request.getCommandId()).isEqualTo("cmd-abc");
        assertThat(request.getSpecs().getAttrsMap()).containsEntry("size", "1792x1024");
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

        assertThat(response.getTier()).isEqualTo("pro");
        assertThat(response.getPermissionsList()).containsExactly("pricing:publish");
    }

    @Test
    void 两个gRPC服务存根都已生成() {
        assertThat(BillingServiceGrpc.SERVICE_NAME).isEqualTo("billing.v1.BillingService");
        assertThat(IdentityServiceGrpc.SERVICE_NAME).isEqualTo("identity.v1.IdentityService");
    }

    @Test
    void SpecAttrs_是map便于规范化前透传() {
        SpecAttrs attrs = SpecAttrs.newBuilder()
                .putAttrs("Size", "2K")
                .putAttrs("duration", "5")
                .build();

        assertThat(attrs.getAttrsMap()).containsEntry("Size", "2K");
    }
}
