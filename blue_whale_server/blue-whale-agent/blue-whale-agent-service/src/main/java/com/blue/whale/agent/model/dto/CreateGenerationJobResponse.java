package com.blue.whale.agent.model.dto;

/** Project 级 GenerationJob 命令的首次接纳结果。 */
public record CreateGenerationJobResponse(Long generationJobId, long cursor) {
}
