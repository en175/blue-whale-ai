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
    private final OpenAi openai = new OpenAi();
    private final Tos tos = new Tos();
    private final Seedance seedance = new Seedance();
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
}
