package com.bluewhale.worker.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReadyControllerTest {

    private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ReadyController()).build();

    @Test
    @DisplayName("GET /ready 返回恰好 {\"status\":\"ready\"}（无 enabledTags 等残留字段）")
    void readyReturnsExactlyStatusReady() throws Exception {
        mockMvc.perform(get("/ready"))
                .andExpect(status().isOk())
                .andExpect(content().string("{\"status\":\"ready\"}"));
    }
}
