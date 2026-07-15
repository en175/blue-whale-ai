package com.blue.whale.agent.service.generation;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Getter
@Setter
@ConfigurationProperties(prefix = "blue-whale.generation")
public class GenerationAdapterProperties {

    private String mode = "disabled";
    private final OpenAi openai = new OpenAi();
    private final Tos tos = new Tos();

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
    }
}
