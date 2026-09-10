package com.bluewhale.worker.application.processor;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 图片渠道映射矩阵测试（image-channel-parser.ts + seedream-image-size.ts 逐字对齐）。
 * <p>
 * 覆盖：
 * - seedream 代码表（hasSeedreamSizeTable / resolveSeedreamImageSize）
 * - gpt 矩阵查表（mapImageChannelRequest gpt parser）
 * - banana 双映射（quality × size）
 * - features JSON 解析（maxReferenceImages）
 * - supported_sizes 匹配（matchSupportedSize）
 */
class ImageCapabilityMatrixTest {

    // ========== seedream 代码表 ==========

    @Nested
    @DisplayName("seedream 代码表（seedream-image-size.ts）")
    class SeedreamSizeTable {

        @Test
        @DisplayName("hasSeedreamSizeTable: 已知模型 → true")
        void knownModel() {
            assertThat(ImageChannelMapper.hasSeedreamSizeTable(
                    "doubao-seedream-5-0-pro-260628")).isTrue();
            assertThat(ImageChannelMapper.hasSeedreamSizeTable(
                    "doubao-seedream-5-0-260128")).isTrue();
            assertThat(ImageChannelMapper.hasSeedreamSizeTable(
                    "doubao-seedream-4-0-250828")).isTrue();
        }

        @Test
        @DisplayName("hasSeedreamSizeTable: 未知模型 → false")
        void unknownModel() {
            assertThat(ImageChannelMapper.hasSeedreamSizeTable("gpt-image-1")).isFalse();
            assertThat(ImageChannelMapper.hasSeedreamSizeTable("unknown")).isFalse();
        }

        @Test
        @DisplayName("resolveSeedreamImageSize: pro 1K 1:1 → 1024x1024")
        void pro1k_1to1() {
            String size = ImageChannelMapper.resolveSeedreamImageSize(
                    "doubao-seedream-5-0-pro-260628", "1K", "1:1");
            assertThat(size).isEqualTo("1024x1024");
        }

        @Test
        @DisplayName("resolveSeedreamImageSize: pro 2K 16:9 → 2816x1584")
        void pro2k_16to9() {
            String size = ImageChannelMapper.resolveSeedreamImageSize(
                    "doubao-seedream-5-0-pro-260628", "2K", "16:9");
            assertThat(size).isEqualTo("2816x1584");
        }

        @Test
        @DisplayName("resolveSeedreamImageSize: 未知 ratio → null")
        void unknownRatio() {
            String size = ImageChannelMapper.resolveSeedreamImageSize(
                    "doubao-seedream-5-0-pro-260628", "1K", "99:1");
            assertThat(size).isNull();
        }

        @Test
        @DisplayName("resolveSeedreamImageSize: 未知 resolution → null")
        void unknownResolution() {
            String size = ImageChannelMapper.resolveSeedreamImageSize(
                    "doubao-seedream-5-0-pro-260628", "8K", "1:1");
            assertThat(size).isNull();
        }
    }

    // ========== gpt 矩阵 ==========

    @Nested
    @DisplayName("gpt 矩阵查表（image-channel-parser.ts:108-117）")
    class GptMatrix {

        @Test
        @DisplayName("矩阵命中 → ok + size")
        void matrixHit() {
            String mappingJson = "{\"matrix\":{\"1K\":{\"1:1\":\"1024x1024\",\"4:3\":\"1152x864\"}}}";
            var mapping = ImageChannelMapper.parseStoredMapping(
                    "gpt", mappingJson, "1K", "1:1");
            var result = ImageChannelMapper.mapImageChannelRequest(
                    mapping, "1K", "4:3");
            assertThat(result.ok()).isTrue();
            assertThat(result.size()).isEqualTo("1152x864");
        }

        @Test
        @DisplayName("矩阵未命中 → 回退 default → ok")
        void matrixFallbackToDefault() {
            String mappingJson = "{\"matrix\":{\"1K\":{\"1:1\":\"1024x1024\"}}}";
            var mapping = ImageChannelMapper.parseStoredMapping(
                    "gpt", mappingJson, "1K", "1:1");
            var result = ImageChannelMapper.mapImageChannelRequest(
                    mapping, "2K", "4:3"); // 2K 不在矩阵
            assertThat(result.ok()).isTrue();
            assertThat(result.size()).isEqualTo("1024x1024"); // 回退到 default
        }

        @Test
        @DisplayName("矩阵 + default 都未命中 → empty_mapping")
        void matrixAndDefaultMiss() {
            String mappingJson = "{\"matrix\":{}}";
            var mapping = ImageChannelMapper.parseStoredMapping(
                    "gpt", mappingJson, "x", "y");
            var result = ImageChannelMapper.mapImageChannelRequest(
                    mapping, "1K", "1:1");
            assertThat(result.ok()).isFalse();
        }

        @Test
        @DisplayName("大小写不敏感查表")
        void caseInsensitive() {
            String mappingJson = "{\"matrix\":{\"1k\":{\"1:1\":\"1024x1024\"}}}";
            var mapping = ImageChannelMapper.parseStoredMapping(
                    "gpt", mappingJson, "1k", "1:1");
            var result = ImageChannelMapper.mapImageChannelRequest(
                    mapping, "1K", "1:1");
            assertThat(result.ok()).isTrue();
            assertThat(result.size()).isEqualTo("1024x1024");
        }
    }

    // ========== banana 双映射 ==========

    @Nested
    @DisplayName("banana 双映射（image-channel-parser.ts:119-128）")
    class BananaMapping {

        @Test
        @DisplayName("quality + size 均命中 → ok + size + quality")
        void bothHit() {
            String mappingJson = "{\"quality\":{\"1K\":\"hd\",\"2K\":\"auto\"},\"size\":{\"1:1\":\"1024x1024\",\"4:3\":\"1152x864\"}}";
            var mapping = ImageChannelMapper.parseStoredMapping(
                    "banana", mappingJson, "1K", "1:1");
            var result = ImageChannelMapper.mapImageChannelRequest(
                    mapping, "2K", "4:3");
            assertThat(result.ok()).isTrue();
            assertThat(result.quality()).isEqualTo("auto");
            assertThat(result.size()).isEqualTo("1152x864");
        }

        @Test
        @DisplayName("quality 未命中 → 回退 default → ok")
        void qualityFallback() {
            String mappingJson = "{\"quality\":{\"1K\":\"hd\"},\"size\":{\"1:1\":\"1024x1024\"}}";
            var mapping = ImageChannelMapper.parseStoredMapping(
                    "banana", mappingJson, "1K", "1:1");
            var result = ImageChannelMapper.mapImageChannelRequest(
                    mapping, "2K", "1:1");
            assertThat(result.ok()).isTrue();
            assertThat(result.quality()).isEqualTo("hd"); // 回退 default
        }

        @Test
        @DisplayName("quality + size 均未命中 → empty_mapping")
        void bothMiss() {
            String mappingJson = "{\"quality\":{},\"size\":{}}";
            var mapping = ImageChannelMapper.parseStoredMapping(
                    "banana", mappingJson, "x", "y");
            var result = ImageChannelMapper.mapImageChannelRequest(
                    mapping, "1K", "1:1");
            assertThat(result.ok()).isFalse();
        }
    }

    // ========== features 解析 ==========

    @Nested
    @DisplayName("features maxReferenceImages（asset-ops.ts:127-139）")
    class FeaturesParsing {

        @Test
        @DisplayName("maxReferenceImages 驼峰")
        void camelCase() {
            int max = ImageChannelMapper.parseMaxReferenceImages(
                    "{\"maxReferenceImages\": 5}");
            assertThat(max).isEqualTo(5);
        }

        @Test
        @DisplayName("max_reference_images 蛇形")
        void snakeCase() {
            int max = ImageChannelMapper.parseMaxReferenceImages(
                    "{\"max_reference_images\": 3}");
            assertThat(max).isEqualTo(3);
        }

        @Test
        @DisplayName("缺失 → 默认 10")
        void missingDefault() {
            int max = ImageChannelMapper.parseMaxReferenceImages("{}");
            assertThat(max).isEqualTo(10);
        }

        @Test
        @DisplayName("null / 空 → 默认 10")
        void nullDefault() {
            assertThat(ImageChannelMapper.parseMaxReferenceImages(null)).isEqualTo(10);
            assertThat(ImageChannelMapper.parseMaxReferenceImages("")).isEqualTo(10);
        }
    }

    // ========== supported_sizes 匹配 ==========

    @Nested
    @DisplayName("supported_sizes 匹配（asset-ops.ts:111-126）")
    class SupportedSizesMatching {

        @Test
        @DisplayName("按 id 匹配")
        void matchById() {
            String json = "[{\"id\":\"1K\",\"api_value\":\"1024x1024\",\"width\":1024,\"height\":1024}]";
            String[] result = ImageChannelMapper.matchSupportedSize(json, "1K");
            assertThat(result).isNotNull();
            assertThat(result[0]).isEqualTo("1024x1024");
            assertThat(result[1]).isEqualTo("1024");
            assertThat(result[2]).isEqualTo("1024");
        }

        @Test
        @DisplayName("按 api_value 匹配")
        void matchByApiValue() {
            String json = "[{\"id\":\"std\",\"api_value\":\"1024x1024\",\"width\":1024,\"height\":1024}]";
            String[] result = ImageChannelMapper.matchSupportedSize(json, "1024x1024");
            assertThat(result).isNotNull();
            assertThat(result[0]).isEqualTo("1024x1024");
        }

        @Test
        @DisplayName("未匹配 → null")
        void noMatch() {
            String json = "[{\"id\":\"1K\",\"api_value\":\"1024x1024\"}]";
            String[] result = ImageChannelMapper.matchSupportedSize(json, "4K");
            assertThat(result).isNull();
        }

        @Test
        @DisplayName("null / 空 → null")
        void nullInput() {
            assertThat(ImageChannelMapper.matchSupportedSize(null, "1K")).isNull();
            assertThat(ImageChannelMapper.matchSupportedSize("[]", null)).isNull();
        }
    }
}
