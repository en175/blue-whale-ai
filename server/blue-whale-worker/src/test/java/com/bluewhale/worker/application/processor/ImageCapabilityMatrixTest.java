package com.bluewhale.worker.application.processor;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ImageCapabilityMatrixTest {


    private static final String SEEDREAM_MAPPING =
            "{\"matrix\":{\"1K\":{\"1:1\":\"1024x1024\",\"16:9\":\"1424x800\"},"
                    + "\"2K\":{\"1:1\":\"2048x2048\",\"16:9\":\"2816x1584\"}}}";

    @Nested
    @DisplayName("seedream 尺寸矩阵（能力行 request_mapping）")
    class SeedreamSizeMatrix {

        @Test
        @DisplayName("hasSizeMatrix: 带 matrix 的能力行 → true")
        void hasMatrix() {
            assertThat(ImageChannelParser.hasSizeMatrix(SEEDREAM_MAPPING)).isTrue();
        }

        @Test
        @DisplayName("hasSizeMatrix: 无 matrix / NULL / 空 matrix → false")
        void noMatrix() {
            assertThat(ImageChannelParser.hasSizeMatrix(null)).isFalse();
            assertThat(ImageChannelParser.hasSizeMatrix("")).isFalse();
            assertThat(ImageChannelParser.hasSizeMatrix("{}")).isFalse();
            assertThat(ImageChannelParser.hasSizeMatrix("{\"matrix\":{}}")).isFalse();
        }

        @Test
        @DisplayName("命中：1K 1:1 → 1024x1024")
        void hit1k11() {
            assertThat(ImageChannelParser.resolveSeedreamSize(SEEDREAM_MAPPING, "1K", "1:1"))
                    .isEqualTo("1024x1024");
        }

        @Test
        @DisplayName("命中：2K 16:9 → 2816x1584")
        void hit2k169() {
            assertThat(ImageChannelParser.resolveSeedreamSize(SEEDREAM_MAPPING, "2K", "16:9"))
                    .isEqualTo("2816x1584");
        }

        @Test
        @DisplayName("键大小写不敏感：小写 1k 亦命中")
        void caseInsensitiveResolution() {
            assertThat(ImageChannelParser.resolveSeedreamSize(SEEDREAM_MAPPING, "1k", "1:1"))
                    .isEqualTo("1024x1024");
        }

        @Test
        @DisplayName("未命中：未知 ratio / 未知 resolution / NULL 入参 → null（无回落，调用方报错）")
        void misses() {
            assertThat(ImageChannelParser.resolveSeedreamSize(SEEDREAM_MAPPING, "1K", "99:1")).isNull();
            assertThat(ImageChannelParser.resolveSeedreamSize(SEEDREAM_MAPPING, "8K", "1:1")).isNull();
            assertThat(ImageChannelParser.resolveSeedreamSize(null, "1K", "1:1")).isNull();
            assertThat(ImageChannelParser.resolveSeedreamSize(SEEDREAM_MAPPING, null, "1:1")).isNull();
        }
    }


    @Nested
    @DisplayName("gpt 矩阵查表（image-channel-parser.ts:108-117）")
    class GptMatrix {

        @Test
        @DisplayName("矩阵命中 → ok + size")
        void matrixHit() {
            String mappingJson = "{\"matrix\":{\"1K\":{\"1:1\":\"1024x1024\",\"4:3\":\"1152x864\"}}}";
            var mapping = ImageChannelParser.parseStoredMapping(
                    ImageChannel.GPT_IMAGE, mappingJson, "1K", "1:1");
            var result = ImageChannelParser.mapImageChannelRequest(
                    mapping, "1K", "4:3");
            assertThat(result.ok()).isTrue();
            assertThat(result.size()).isEqualTo("1152x864");
        }

        @Test
        @DisplayName("矩阵未命中 → 回退 default → ok")
        void matrixFallbackToDefault() {
            String mappingJson = "{\"matrix\":{\"1K\":{\"1:1\":\"1024x1024\"}}}";
            var mapping = ImageChannelParser.parseStoredMapping(
                    ImageChannel.GPT_IMAGE, mappingJson, "1K", "1:1");
            var result = ImageChannelParser.mapImageChannelRequest(
                    mapping, "2K", "4:3");
            assertThat(result.ok()).isTrue();
            assertThat(result.size()).isEqualTo("1024x1024");
        }

        @Test
        @DisplayName("矩阵 + default 都未命中 → empty_mapping")
        void matrixAndDefaultMiss() {
            String mappingJson = "{\"matrix\":{}}";
            var mapping = ImageChannelParser.parseStoredMapping(
                    ImageChannel.GPT_IMAGE, mappingJson, "x", "y");
            var result = ImageChannelParser.mapImageChannelRequest(
                    mapping, "1K", "1:1");
            assertThat(result.ok()).isFalse();
        }

        @Test
        @DisplayName("大小写不敏感查表")
        void caseInsensitive() {
            String mappingJson = "{\"matrix\":{\"1k\":{\"1:1\":\"1024x1024\"}}}";
            var mapping = ImageChannelParser.parseStoredMapping(
                    ImageChannel.GPT_IMAGE, mappingJson, "1k", "1:1");
            var result = ImageChannelParser.mapImageChannelRequest(
                    mapping, "1K", "1:1");
            assertThat(result.ok()).isTrue();
            assertThat(result.size()).isEqualTo("1024x1024");
        }
    }


    @Nested
    @DisplayName("banana 双映射（image-channel-parser.ts:119-128）")
    class BananaMapping {

        @Test
        @DisplayName("quality + size 均命中 → ok + size + quality")
        void bothHit() {
            String mappingJson = "{\"quality\":{\"1K\":\"hd\",\"2K\":\"auto\"},\"size\":{\"1:1\":\"1024x1024\",\"4:3\":\"1152x864\"}}";
            var mapping = ImageChannelParser.parseStoredMapping(
                    ImageChannel.BANANA_IMAGE, mappingJson, "1K", "1:1");
            var result = ImageChannelParser.mapImageChannelRequest(
                    mapping, "2K", "4:3");
            assertThat(result.ok()).isTrue();
            assertThat(result.quality()).isEqualTo("auto");
            assertThat(result.size()).isEqualTo("1152x864");
        }

        @Test
        @DisplayName("quality 未命中 → 回退 default → ok")
        void qualityFallback() {
            String mappingJson = "{\"quality\":{\"1K\":\"hd\"},\"size\":{\"1:1\":\"1024x1024\"}}";
            var mapping = ImageChannelParser.parseStoredMapping(
                    ImageChannel.BANANA_IMAGE, mappingJson, "1K", "1:1");
            var result = ImageChannelParser.mapImageChannelRequest(
                    mapping, "2K", "1:1");
            assertThat(result.ok()).isTrue();
            assertThat(result.quality()).isEqualTo("hd");
        }

        @Test
        @DisplayName("quality + size 均未命中 → empty_mapping")
        void bothMiss() {
            String mappingJson = "{\"quality\":{},\"size\":{}}";
            var mapping = ImageChannelParser.parseStoredMapping(
                    ImageChannel.BANANA_IMAGE, mappingJson, "x", "y");
            var result = ImageChannelParser.mapImageChannelRequest(
                    mapping, "1K", "1:1");
            assertThat(result.ok()).isFalse();
        }
    }


    @Nested
    @DisplayName("features imageReferenceMax（asset-ops.ts:127-139）")
    class FeaturesParsing {

        @Test
        @DisplayName("imageReferenceMax 驼峰")
        void camelCase() {
            int max = ImageChannelParser.parseMaxReferenceImages(
                    "{\"imageReferenceMax\": 5}");
            assertThat(max).isEqualTo(5);
        }

        @Test
        @DisplayName("image_reference_max 蛇形")
        void snakeCase() {
            int max = ImageChannelParser.parseMaxReferenceImages(
                    "{\"image_reference_max\": 3}");
            assertThat(max).isEqualTo(3);
        }

        @Test
        @DisplayName("缺失 → 默认 10")
        void missingDefault() {
            int max = ImageChannelParser.parseMaxReferenceImages("{}");
            assertThat(max).isEqualTo(10);
        }

        @Test
        @DisplayName("null / 空 → 默认 10")
        void nullDefault() {
            assertThat(ImageChannelParser.parseMaxReferenceImages(null)).isEqualTo(10);
            assertThat(ImageChannelParser.parseMaxReferenceImages("")).isEqualTo(10);
        }
    }


    @Nested
    @DisplayName("supported_sizes 匹配（asset-ops.ts:111-126）")
    class SupportedSizesMatching {

        @Test
        @DisplayName("按 id 匹配 → 返回该档位的出站值")
        void matchById() {
            String json = "[{\"id\":\"1K\",\"api_value\":\"1024x1024\",\"width\":1024,\"height\":1024}]";
            assertThat(ImageChannelParser.matchSupportedSize(json, "1K")).isEqualTo("1024x1024");
        }

        @Test
        @DisplayName("按 api_value 匹配")
        void matchByApiValue() {
            String json = "[{\"id\":\"std\",\"api_value\":\"1024x1024\",\"width\":1024,\"height\":1024}]";
            assertThat(ImageChannelParser.matchSupportedSize(json, "1024x1024"))
                    .isEqualTo("1024x1024");
        }

        @Test
        @DisplayName("★ 条目没有出站值 → null，调用方保持行级 api_size 兜底（IKHTVR）")
        void noApiValue() {
            assertThat(ImageChannelParser.matchSupportedSize("[{\"id\":\"1K\"}]", "1K")).isNull();
        }

        @Test
        @DisplayName("未匹配 → null")
        void noMatch() {
            String json = "[{\"id\":\"1K\",\"api_value\":\"1024x1024\"}]";
            assertThat(ImageChannelParser.matchSupportedSize(json, "4K")).isNull();
        }

        @Test
        @DisplayName("null / 空 → null")
        void nullInput() {
            assertThat(ImageChannelParser.matchSupportedSize(null, "1K")).isNull();
            assertThat(ImageChannelParser.matchSupportedSize("[]", null)).isNull();
        }
    }
}
