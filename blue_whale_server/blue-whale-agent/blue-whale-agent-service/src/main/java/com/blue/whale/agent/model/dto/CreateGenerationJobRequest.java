package com.blue.whale.agent.model.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

import javax.validation.Valid;
import javax.validation.constraints.AssertTrue;
import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Positive;
import javax.validation.constraints.Size;
import java.util.List;

/** BottomDock 创建 Project 级 GenerationJob 的产品中性命令。 */
public class CreateGenerationJobRequest {

    @JsonProperty("type")
    @NotBlank
    private String type;

    @JsonProperty("input_asset_ids")
    @NotNull
    @Size(max = 4)
    private List<@Positive Long> inputAssetIds;

    @JsonProperty("parameters")
    @NotNull
    @Valid
    private GenerationParameters parameters;

    @JsonProperty("expected_output_count")
    @NotNull
    @Min(1)
    @Max(1)
    private Integer expectedOutputCount;

    @JsonIgnore
    private boolean unsupportedField;

    public String type() {
        return type;
    }

    public List<Long> inputAssetIds() {
        return inputAssetIds;
    }

    public GenerationParameters parameters() {
        return parameters;
    }

    public Integer expectedOutputCount() {
        return expectedOutputCount;
    }

    @JsonAnySetter
    public void rejectUnsupportedField(String name, Object value) {
        unsupportedField = true;
    }

    @JsonIgnore
    @AssertTrue(message = "包含不支持的字段")
    public boolean isFreeOfUnsupportedFields() {
        return !unsupportedField;
    }

    public static class GenerationParameters {

        @JsonProperty("prompt")
        @NotBlank
        @Size(max = 4000)
        private String prompt;

        @JsonProperty("aspect_ratio")
        @NotBlank
        @Pattern(regexp = "[1-9][0-9]*:[1-9][0-9]*")
        private String aspectRatio;

        @JsonIgnore
        private boolean unsupportedField;

        public String prompt() {
            return prompt;
        }

        public String aspectRatio() {
            return aspectRatio;
        }

        @JsonAnySetter
        public void rejectUnsupportedField(String name, Object value) {
            unsupportedField = true;
        }

        @JsonIgnore
        @AssertTrue(message = "包含不支持的字段")
        public boolean isFreeOfUnsupportedFields() {
            return !unsupportedField;
        }
    }
}
