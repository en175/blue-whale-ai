package com.bluewhale.common.mq;

import java.util.regex.Pattern;

public final class MqEnvSuffix {

    private static final String ENV_NAME = "MQ_ENV_SUFFIX";

    private static final Pattern VALID_SUFFIX = Pattern.compile("[A-Za-z0-9_-]+");

    private MqEnvSuffix() {
    }

    public static String apply(String name) {
        return apply(name, System.getenv(ENV_NAME));
    }

    public static String apply(String name, String rawSuffix) {
        if (rawSuffix == null) {
            return name;
        }
        String suffix = rawSuffix.trim().replaceFirst("^-+", "");
        if (suffix.isEmpty()) {
            return name;
        }
        if (!VALID_SUFFIX.matcher(suffix).matches()) {
            throw new IllegalArgumentException(
                    "MQ_ENV_SUFFIX 只允许字母、数字、下划线和连字符，实际为: " + rawSuffix);
        }
        return name + "-" + suffix;
    }
}
