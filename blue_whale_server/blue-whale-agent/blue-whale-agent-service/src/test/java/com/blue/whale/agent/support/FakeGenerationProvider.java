package com.blue.whale.agent.support;

import com.blue.whale.agent.service.generation.GenerationProvider;
import com.blue.whale.agent.service.generation.GenerationProviderRequest;
import com.blue.whale.agent.service.generation.GenerationProviderResult;

import java.util.Base64;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
public class FakeGenerationProvider implements GenerationProvider {

    private static final byte[] ONE_PIXEL_PNG = Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    private final AtomicInteger calls = new AtomicInteger();
    private volatile CountDownLatch started = new CountDownLatch(0);
    private volatile CountDownLatch release = new CountDownLatch(0);

    @Override
    public GenerationProviderResult generate(GenerationProviderRequest request) {
        calls.incrementAndGet();
        started.countDown();
        try {
            if (!release.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Fake Provider 等待释放超时");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Fake Provider 等待被中断", exception);
        }
        String prompt = String.valueOf(request.input().get("prompt"));
        if ("fake:failure".equals(prompt)) {
            return GenerationProviderResult.failure("provider_failed", "Fake Provider 显式失败");
        }
        if ("fake:no-result".equals(prompt)) {
            return GenerationProviderResult.noResult();
        }
        return GenerationProviderResult.success(ONE_PIXEL_PNG.clone(), "image/png", 1, 1);
    }

    public void blockNext() {
        started = new CountDownLatch(1);
        release = new CountDownLatch(1);
    }

    public boolean awaitStarted() throws InterruptedException {
        return started.await(5, TimeUnit.SECONDS);
    }

    public void release() {
        release.countDown();
    }

    public int callCount() {
        return calls.get();
    }

    public void reset() {
        calls.set(0);
        started = new CountDownLatch(0);
        release = new CountDownLatch(0);
    }
}
