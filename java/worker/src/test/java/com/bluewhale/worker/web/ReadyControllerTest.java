package com.bluewhale.worker.web;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /ready} 契约（ADR-0084 修正六 / 契约 §16 决策 6）。
 * <p>
 * 修正六删掉了 {@code enabledTags} 与 {@code consumerGroupSuffix} 两个字段：
 * 运维事实源从「读数组判断这个实例在消费什么」变回「进程活着即全部 tag 在消费」。
 * 故响应体必须**恰好**是 {@code {"status":"ready"}}，多一个字段都意味着旧开关语义复活。
 */
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
