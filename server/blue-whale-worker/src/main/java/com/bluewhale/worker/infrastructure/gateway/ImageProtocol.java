package com.bluewhale.worker.infrastructure.gateway;

public enum ImageProtocol {

    OPENAI_IMAGES("openai-images"),

    INLINE_IMAGE("inline-image");

    private final String wireValue;

    ImageProtocol(String wireValue) {
        this.wireValue = wireValue;
    }

    public String wireValue() {
        return wireValue;
    }

}
