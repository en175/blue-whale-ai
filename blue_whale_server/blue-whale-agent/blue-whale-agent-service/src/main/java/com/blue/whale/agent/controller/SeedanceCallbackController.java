package com.blue.whale.agent.controller;

import com.blue.whale.agent.service.SeedanceCallbackService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/webhooks/seedance/{accountId}/{generationJobId}")
@RequiredArgsConstructor
public class SeedanceCallbackController {

    private final SeedanceCallbackService callbackService;

    @PostMapping
    public ResponseEntity<Void> receive(
            @PathVariable String accountId,
            @PathVariable Long generationJobId,
            @RequestParam(required = false) String capability,
            @RequestBody Map<String, Object> payload) {
        SeedanceCallbackService.Outcome outcome = callbackService.receive(
                accountId, generationJobId, capability, payload);
        return ResponseEntity.status(outcome == SeedanceCallbackService.Outcome.ACCEPTED
                ? HttpStatus.ACCEPTED : HttpStatus.NO_CONTENT).build();
    }
}
