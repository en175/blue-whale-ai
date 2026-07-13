package com.blue.whale.agent.model.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.experimental.Accessors;

/**
 * PATCH /api/skills/mine/{id} 请求体。
 */
@Getter
@Setter
@Accessors(chain = true)
@NoArgsConstructor
@AllArgsConstructor
public class AutoUpdateRequest {

    /** auto 开关 */
    private Boolean auto;
}
