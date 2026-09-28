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

/**
 * gRPC server 的启动。
 *
 * <h2>为什么用 {@code billing.grpc.enabled} 开关而不是默认启动</h2>
 *
 * 默认启动会让**每一个 @SpringBootTest** 都去绑一个真实端口——
 * 测试之间的端口冲突变成随机失败，而根因与测试内容毫无关系。
 * 开关默认关闭，生产在 application.yml 里显式打开；
 * 需要走真实链路的集成测试显式打开并指定端口 0（由内核分配空闲端口，绝不冲突）。
 *
 * <p>端口约定：worker=4002，billing HTTP=4003，billing gRPC=4004（见 application.yml）。
 */
@Configuration
@ConditionalOnProperty(name = "billing.grpc.enabled", havingValue = "true")
public class GrpcServerConfig {

    /**
     * 启动并返回 server；Bean 销毁时关闭（不关闭会让测试 JVM 挂住不退）。
     *
     * <p>两个 service **同一个端口**：{@code BillingService}（产品面，用户在等待路径上）
     * 与 {@code BillingAdminService}（运营面，低频人工查询）。合并不是图省事——
     * 它们共享同一份应用层与同一个账本，分端口只会在运维上多一个要配的地址，
     * 而两边的权限本来就得靠网络策略而不是端口号来划。
     */
    @Bean(destroyMethod = "shutdownNow")
    public Server billingGrpcServer(@Value("${billing.grpc.port:4004}") int port,
                                    BillingGrpcService billingService,
                                    BillingAdminGrpcService adminService) throws IOException {
        return NettyServerBuilder.forPort(port)
                .addService(billingService)
                .addService(adminService)
                // 反射服务：本地用 grpcurl 验证时不必带 .proto 文件。
                // 它把服务与消息的描述**暴露给任何能连上该端口的人**——所以 billing
                // 的 gRPC 端口只应暴露在内网（契约注释里也写了：Hold 不可由公网直达）。
                .addService(ProtoReflectionService.newInstance())
                .build()
                .start();
    }
}
