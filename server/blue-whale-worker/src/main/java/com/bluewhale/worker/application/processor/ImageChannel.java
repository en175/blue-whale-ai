package com.bluewhale.worker.application.processor;

import com.bluewhale.worker.infrastructure.gateway.ImageProtocol;

public enum ImageChannel {

    SEEDREAM_IMAGE("seedream-image", "image", "seedream", ImageProtocol.INLINE_IMAGE),
    GPT_IMAGE("gpt-image", "image", "gpt", ImageProtocol.INLINE_IMAGE),
    GPT_IMAGE_OPENAI("gpt-image-openai", "image", "gpt", ImageProtocol.OPENAI_IMAGES),
    BANANA_IMAGE("banana-image", "image", "banana", ImageProtocol.INLINE_IMAGE),
    SEEDREAM_VIDEO("seedream-video", "video", null, null),
    SEEDREAM_AUDIO("seedream-audio", "audio", null, null),
    SEEDREAM_TEXT("seedream-text", "text", null, null);

    private final String wireValue;
    private final String media;
    private final String parser;
    private final ImageProtocol protocol;

    ImageChannel(String wireValue, String media, String parser, ImageProtocol protocol) {
        this.wireValue = wireValue;
        this.media = media;
        this.parser = parser;
        this.protocol = protocol;
    }

    public String wireValue() {
        return wireValue;
    }

    public String media() {
        return media;
    }

    public String parser() {
        return parser;
    }

    public ImageProtocol protocol() {
        return protocol;
    }

    public static ImageChannel fromWire(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        for (ImageChannel channel : values()) {
            if (channel.wireValue.equalsIgnoreCase(value)) return channel;
        }
        return null;
    }

    public static ImageChannel defaultFor(String capabilityType) {
        if (capabilityType == null) return SEEDREAM_IMAGE;
        switch (capabilityType.trim().toLowerCase()) {
            case "video":
                return SEEDREAM_VIDEO;
            case "audio":
                return SEEDREAM_AUDIO;
            case "text":
                return SEEDREAM_TEXT;
            default:
                return SEEDREAM_IMAGE;
        }
    }
}
