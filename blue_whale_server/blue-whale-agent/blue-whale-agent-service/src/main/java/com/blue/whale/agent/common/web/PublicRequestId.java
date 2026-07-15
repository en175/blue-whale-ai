package com.blue.whale.agent.common.web;

import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

public final class PublicRequestId {

    static final String ATTRIBUTE = PublicRequestId.class.getName();

    private PublicRequestId() {
    }

    public static String current() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes == null) {
            return null;
        }
        Object requestId = attributes.getAttribute(ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        return requestId instanceof String value ? value : null;
    }
}
