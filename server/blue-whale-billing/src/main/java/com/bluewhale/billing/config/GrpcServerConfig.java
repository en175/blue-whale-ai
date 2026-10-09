package com.bluewhale.billing.config;

import com.bluewhale.billing.adapter.inbound.grpc.BillingAdminGrpcService;
import com.bluewhale.billing.adapter.inbound.grpc.BillingGrpcService;
import io.grpc.Server;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import io.grpc.protobuf.services.ProtoReflectionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;

@Configuration
@ConditionalOnProperty(name = "billing.grpc.enabled", havingValue = "true")
public class GrpcServerConfig {

    @Bean(destroyMethod = "shutdownNow")
    public Server billingGrpcServer(@Value("${billing.grpc.port:4004}") int port,
                                    BillingGrpcService billingService,
                                    BillingAdminGrpcService adminService) throws IOException {
        return NettyServerBuilder.forPort(port)
                .addService(billingService)
                .addService(adminService)
                .addService(ProtoReflectionService.newInstance())
                .build()
                .start();
    }
}
