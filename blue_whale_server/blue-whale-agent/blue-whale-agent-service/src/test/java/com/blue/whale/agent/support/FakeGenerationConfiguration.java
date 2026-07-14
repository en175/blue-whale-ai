package com.blue.whale.agent.support;

import com.blue.whale.agent.service.GenerationJobClaimService;
import com.blue.whale.agent.service.GenerationResultAcceptanceService;
import com.blue.whale.agent.service.generation.GenerationProvider;
import com.blue.whale.agent.service.generation.GenerationStorage;
import com.blue.whale.agent.service.generation.GenerationWorker;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;

@TestConfiguration
public class FakeGenerationConfiguration {

    @Bean
    FakeGenerationProvider fakeGenerationProvider() {
        return new FakeGenerationProvider();
    }

    @Bean
    FakeGenerationStorage fakeGenerationStorage() {
        return new FakeGenerationStorage();
    }

    @Bean
    GenerationWorker generationWorker(
            GenerationJobClaimService claimService,
            GenerationResultAcceptanceService acceptanceService,
            GenerationProvider provider,
            GenerationStorage storage) {
        return new GenerationWorker(claimService, acceptanceService, provider, storage);
    }
}
