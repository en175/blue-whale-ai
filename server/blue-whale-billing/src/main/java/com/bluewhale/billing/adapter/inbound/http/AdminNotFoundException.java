package com.bluewhale.billing.adapter.inbound.http;

public class AdminNotFoundException extends RuntimeException {

    public AdminNotFoundException(String message) {
        super(message);
    }
}
