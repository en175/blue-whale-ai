package com.blue.whale.agent.service.generation;

public interface AsyncGenerationProvider {

    ProviderTaskReference submit(AsyncGenerationSpec spec);

    ProviderObservation observe(ProviderTaskReference reference);

    void requestCancel(ProviderTaskReference reference);

    ProviderCancellationCapability cancellationCapability();

    String providerId();

    String accountId();
}
