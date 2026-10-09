package com.bluewhale.billing.adapter.inbound.http;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ReadyController {

    @GetMapping("/ready")
    public Map<String, Object> ready() {
        return Map.of("status", "ready");
    }
}
