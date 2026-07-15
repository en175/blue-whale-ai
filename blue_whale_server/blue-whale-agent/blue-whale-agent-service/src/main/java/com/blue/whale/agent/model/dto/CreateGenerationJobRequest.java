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
import java.util.Set;

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
    @Max(4)
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

    @JsonIgnore
    @AssertTrue(message = "视频生成仅支持 0 或 1 个参考图片 Asset")
    public boolean isValidVideoInputCount() {
        return !"video".equals(type) || inputAssetIds == null || inputAssetIds.size() <= 1;
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

        @JsonProperty("resolution")
        private String resolution;

        @JsonProperty("duration")
        private Integer duration;

        @JsonIgnore
        private boolean unsupportedField;

        public String prompt() {
            return prompt;
        }

        public String aspectRatio() {
            return aspectRatio;
        }

        public String resolution() {
            return resolution;
        }

        public Integer duration() {
            return duration;
        }

        @JsonIgnore
        public boolean isValidFor(String type) {
            if ("image".equals(type)) {
                return resolution == null && duration == null;
            }
            return "video".equals(type)
                    && Set.of("16:9", "4:3", "1:1", "3:4", "9:16", "21:9")
                    .contains(aspectRatio)
                    && Set.of("480p", "720p", "1080p").contains(resolution)
                    && duration != null && duration >= 4 && duration <= 15;
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
