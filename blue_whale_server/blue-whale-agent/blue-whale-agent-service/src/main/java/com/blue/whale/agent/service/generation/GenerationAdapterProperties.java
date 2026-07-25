package com.blue.whale.agent.service.generation;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@Getter
@Setter
@ConfigurationProperties(prefix = "blue-whale.generation")
public class GenerationAdapterProperties {

    private String mode = "disabled";
    /** 显式确认在非生产环境启用 Fake 适配器（mode=fake 时必须为 true） */
    private boolean fakeAllowed = false;
    /**
     * 显式确认在非生产环境启用受控真实图片验收（IK1NS3）：仅 mode=openai-tos 时有效，
     * 以非生产确定性证据源替换 fail-closed 占位证据源；生产 profile 拒绝启动。
     */
    private boolean acceptanceAllowed = false;
    private final OpenAi openai = new OpenAi();
    private final Tos tos = new Tos();
    private final Seedance seedance = new Seedance();
    private final AgentPlan agentPlan = new AgentPlan();
    private boolean workerScheduled = true;

    @Getter
    @Setter
    public static class OpenAi {
        private String apiKey;
        private String baseUrl = "https://api.openai.com";
        private String model = "gpt-image-2";
        private int maxImageBytes = 20 * 1024 * 1024;
    }

    @Getter
    @Setter
    public static class Tos {
        private String accessKey;
        private String secretKey;
        private String region;
        private String endpoint;
        private String bucket;
        private String prefix = "generation";
        private long signedUrlTtlSeconds = 300;
        private int maxReadBytes = 20 * 1024 * 1024;
        private long maxVideoBytes = 200L * 1024 * 1024;
    }

    @Getter
    @Setter
    public static class Seedance {
        public static final String MODEL = "doubao-seedance-2-0-260128";

        private String accountId = "default";
        private String callbackBaseUrl;
        private int initialPollSeconds = 5;
        private int maxPollSeconds = 30;
        private List<String> allowedResultHostSuffixes = List.of("volces.com");
    }

    /**
     * Agent Plan 模式（IK21O4）本地磁盘生成存储配置：内容寻址对象落 Docker 卷持久化，
     * 重启不丢；切到 TOS 等对象存储由后续工单负责（接口抽象现成）。
     */
    @Getter
    @Setter
    public static class AgentPlan {
        /** 本地磁盘生成存储根目录（Docker 卷挂载点，重启不丢）。 */
        private String storageRoot = "/var/lib/blue-whale/generation";
    }
}
