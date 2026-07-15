package com.blue.whale.agent.model.dto;

import javax.validation.constraints.NotBlank;

public record ConfirmUserInputRequest(@NotBlank String content) {
}
