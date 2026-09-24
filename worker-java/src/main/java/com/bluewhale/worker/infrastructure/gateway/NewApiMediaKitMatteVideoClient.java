package com.bluewhale.worker.infrastructure.gateway;

import com.bluewhale.worker.domain.contract.VideoMattingContract;
import com.bluewhale.worker.domain.error.GenerationError;
import com.bluewhale.worker.domain.error.VideoMattingError;
import com.bluewhale.worker.domain.dto.ParentTaskObservation;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * new-api 网关 MediaKit 智能抠像客户端（IKHK99，父规格 IKHJRC，契约 IKHK7F；
 * IKHKMK 家族模板收敛后同构：submit / poll 的 HTTP 骨架在
 * {@link NewApiMediaKitAsyncTaskClient}，本类只保留**双端点按模式分流**、契约枚举兜底校验
 * 与 completed 结果解析）。
 * <p>
 * 双端点是 family 首例：其余六个 MediaKit 异步工具都是「一个工具 = 一条提交路径 = 一个
 * 模型名」，可直接把路径写成单路径子类的模板方法；抠像无查询参数可表达模式（模式即端点，
 * ADR-0112），故本类持两个单端点子类实例（{@link EndpointClient}，各持有自己的路径与
 * 模型名常量）按模式分流，对外仍是单 bean、单套 submit/poll 签名（处理器与家族同形）。
 * <p>
 * 端点（网关**对客**路径，常量单源在 {@link VideoMattingContract}）：
 * <ul>
 *   <li>submit：POST {SUBMIT_PATHS[mode]}（30s 超时，异步提交秒级入队）</li>
 *   <li>poll：GET {POLL_PATH_PREFIX}{task_id}（10s 超时）——两工具任务流程完全相同、
 *       共用同一条查询路由，查询与模式无关</li>
 * </ul>
 * ⚠️ 网关路径 ≠ 火山上游路径（IKH67T 实测：混用即 404 Invalid URL，任务卡在提交相）。
 * 火山上游侧对应 POST /api/v1/tools/matte-portrait-video 与
 * /api/v1/tools/matte-greenscreen-video（官方开发指南 PDF 逐字），由网关内部转发，
 * 本仓不直连上游。鉴权与家族同构（契约 §5 / ADR-0080）：Authorization: Bearer 任务冻结的
 * 用户 sk-（processor 从 job.input.provider_credential 取出传入）+ X-Trace-Id +
 * X-Client-System: bluewhale。
 * <p>
 * 出站请求映射（官方开发指南 PDF「快速入门」+「进阶使用·选择输出格式与背景颜色」节）：
 * model（对客模型名，按模式取值，网关按模型名路由 MediaKit 渠道，本期 model_price 配 0）+
 * video_url（源视频公网对象存储地址）+ format（WEBM / MP4 透传）+ background_color
 * （**仅 format=MP4 时出站且显式携带**——官方两端点默认底色不同〔人像 green、绿幕 black〕，
 * 本仓统一冻结 white 防歧义；WEBM 透明不接受背景色）。模式不进出站参数（选择端点即选择
 * 模式）。不发 client_token（本仓 command_idempotency 幂等键，与官方提交参数无关）/
 * callback_url / callback_args / queue_id / media_output_destination（家族轮询口径 +
 * worker 转存自家 TOS，ADR-0112）。
 * <p>
 * 响应形状（官方开发指南 PDF）：submit = {success, task_id, request_id}（success=false 时带
 * error{code,type,message,param}）；poll 顶层含 task_id / status 与 completed 态
 * result{video_url, resolution, duration}——video_url 为 24h 临时链接，processor 须立即
 * 转存自家 TOS（查询接口在结果临期 2 小时内自动续期，轮询天然保活）。status 大小写与
 * 中间态枚举官方 PDF 未逐字冻结，按小写归一容错解析（completed→succeeded、failed→failed、
 * 其余→processing，家族先例同款）。
 * <p>
 * 错误分类复用 NewApiErrorClassifier（content &gt; quota &gt; provider_failed，§5 优先级；
 * 本 PDF 未含错误对象节，错误信封口径 = 家族先例）；poll 的网络超时 / 连接失败 /
 * HTTP 429/5xx 抛错时以 cause 携带状态（{@link NewApiVideoClient.HttpStatusException} 复用），
 * 供 processor 按 isTransientPollError 语义判定瞬时重排。
 */
@Component
public class NewApiMediaKitMatteVideoClient {

    /** 模式 → 单端点客户端（模式集合直接取契约 SUBMIT_PATHS 的键：端点即模式，无第二份枚举）。 */
    private final Map<String, EndpointClient> endpoints;

    public NewApiMediaKitMatteVideoClient() {
        this(System.getenv("NEW_API_BASE_URL"));
    }

    /** 测试用构造器：注入 base URL。 */
    NewApiMediaKitMatteVideoClient(String baseUrl) {
        Map<String, EndpointClient> clients = new LinkedHashMap<>();
        for (String mode : VideoMattingContract.SUBMIT_PATHS.keySet()) {
            clients.put(mode, new EndpointClient(baseUrl, mode));
        }
        this.endpoints = Map.copyOf(clients);
    }

    /**
     * 提交智能抠像异步任务（官方「提交成功响应」：返回 task_id；双端点按模式分流）。
     *
     * @param token           per-job Bearer 凭证（任务冻结的用户 sk-）
     * @param videoUrl        源视频公网对象存储地址
     * @param mode            任务冻结的抠像模式（portrait / greenscreen，IKHK7F 契约枚举；
     *                        经契约 SUBMIT_PATHS / MODEL_NAMES 分流端点与模型名）
     * @param format          输出格式（WEBM / MP4，透传官方 format 参数）
     * @param backgroundColor MP4 纯色背景色（white / black / green；仅 format=MP4 时非 null——
     *                        显式携带防两端点官方默认底色歧义；WEBM 时须为 null，出站不带）
     * @return 上游任务 id（processor 存 provider_task_id 后转轮询）
     * @throws VideoMattingError 按错误分类抛错
     */
    public String submit(String token, String videoUrl, String mode, String format, String backgroundColor) {
        return endpointOf(mode).submit(token, videoUrl, format, backgroundColor);
    }

    /**
     * 查询智能抠像异步任务（两工具共用同一个查询端点；轮询至 completed / failed，窗口 30 天）。
     *
     * @param token  per-job Bearer 凭证
     * @param taskId 提交返回的上游任务 id
     * @return 观测结果（status = succeeded | processing | failed；succeeded 时带
     *         result.video_url（24h 临时链接）/ result.resolution 档位 / result.duration 秒；
     *         failed 时带上游错误文本供 §5 分类与透传）
     * @throws VideoMattingError 网络 / HTTP / 解析错误（瞬时语义由 cause 携带，processor 判定）
     */
    public MatteVideoTaskObservation poll(String token, String taskId) {
        // 查询路由与模式无关（契约 POLL_PATH_PREFIX 单源），任一单端点实例执行等价
        return endpoints.values().iterator().next().poll(token, taskId);
    }

    private EndpointClient endpointOf(String mode) {
        EndpointClient endpoint = endpoints.get(mode);
        if (endpoint == null) {
            // processor 已按契约枚举校验，此处兜底防御（retry 冻结快照可能带历史脏值）
            throw new VideoMattingError(GenerationError.ERROR_INVALID_INPUT, "抠像模式非法: " + mode);
        }
        return endpoint;
    }

    /**
     * 单端点客户端（一个上游工具 = 一条提交路径 = 一个模型名；IKHKMK 家族模板形态：
     * 模板方法五件套 + 契约枚举校验 + 出站 payload 构造 + completed 结果解析）。
     */
    static final class EndpointClient extends NewApiMediaKitAsyncTaskClient {

        /** 本端点对应的抠像模式（契约 MODE_* 常量，用于取路径与模型名）。 */
        private final String mode;

        EndpointClient(String baseUrl, String mode) {
            super(baseUrl);
            this.mode = mode;
        }

        @Override
        protected String submitPath() {
            return VideoMattingContract.SUBMIT_PATHS.get(mode);
        }

        @Override
        protected String pollPathPrefix() {
            return VideoMattingContract.POLL_PATH_PREFIX;
        }

        @Override
        protected String taskLabel() {
            return "智能抠像";
        }

        @Override
        protected String fallbackCode() {
            return VideoMattingContract.ERROR_VIDEO_MATTING_FAILED;
        }

        @Override
        protected RuntimeException error(String code, String message) {
            return new VideoMattingError(code, message);
        }

        /**
         * 本端点提交（模式由实例固定，无需再传）。
         *
         * @param token           per-job Bearer 凭证
         * @param videoUrl        源视频公网对象存储地址
         * @param format          输出格式（WEBM / MP4）
         * @param backgroundColor MP4 纯色背景色（WEBM 时须为 null）
         * @return 上游任务 id
         */
        String submit(String token, String videoUrl, String format, String backgroundColor) {
            if (!VideoMattingContract.SUPPORTED_FORMATS.contains(format)) {
                throw error(GenerationError.ERROR_INVALID_INPUT, "抠像输出格式非法: " + format);
            }
            if (!VideoMattingContract.FORMAT_MP4.equals(format) && backgroundColor != null) {                // WEBM 透明不接受背景色（契约 refine 同款），防御历史脏值：拒绝而非静默改写
                throw error(GenerationError.ERROR_INVALID_INPUT, "WEBM 透明输出不接受 background_color");
            }

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("model", VideoMattingContract.MODEL_NAMES.get(mode));
            payload.put(VideoMattingContract.SUBMIT_KEY_VIDEO_URL, videoUrl);
            payload.put(VideoMattingContract.SUBMIT_KEY_FORMAT, format);
            if (backgroundColor != null) {
                payload.put(VideoMattingContract.SUBMIT_KEY_BACKGROUND_COLOR, backgroundColor);
            }
            return executeSubmit(token, payload);
        }

        /**
         * 本端点任务查询（status 三分支判定 + completed 结果解析）。
         *
         * @return 观测结果（见 {@link MatteVideoTaskObservation}）
         */
        MatteVideoTaskObservation poll(String token, String taskId) {
            PollBody body = executePoll(token, taskId);
            String normalized = normalizedStatus(body);

            if ("failed".equals(normalized)) {
                // 上游错误信号：error 对象（code/message/param/type——TaskError / ApiError）与
                // 顶层 message 都读、取非空合并（骨架 extract* 两方法同款）
                return new MatteVideoTaskObservation("failed", null, null, null,
                        extractUpstreamCode(body), extractPollUpstreamMessage(body));
            }

            if ("completed".equals(normalized)) {
                JsonNode result = body.data().path("result");
                String videoUrl = NewApiMediaKitJsonSupport.textOrNull(result, "video_url");
                String resolution = NewApiMediaKitJsonSupport.textOrNull(result, "resolution");
                Double durationSec = result.path("duration").isNumber()
                        ? result.path("duration").asDouble() : null;
                return new MatteVideoTaskObservation("succeeded", videoUrl, resolution, durationSec,
                        null, null);
            }

            // running / queued 等中间态 → 继续轮询（官方中间态枚举未逐字冻结，统一 processing）
            return new MatteVideoTaskObservation("processing", null, null, null, null, null);
        }
    }

    /**
     * 智能抠像任务观测（对齐 SceneSplitTaskObservation 形态，差异 = 单产物 result 三键）。
     * status: succeeded | processing | failed。
     */
    public record MatteVideoTaskObservation(
            String status,
            /** completed 时的 result.video_url（火山 24h 临时链接，调用方须立即下载转存
             *  自有存储，不跨进程落库）。 */
            String videoUrl,
            /** completed 时的 result.resolution 档位（字符串如 "1080p"，同名同值透传；可 null，
             *  processor 判缺失落兜底失败）。 */
            String resolution,
            /** completed 时的 result.duration（秒，官方精确值；可 null，缺失回落源时长）。 */
            Double durationSec,
            /** failed 时的上游 error.code（可 null）。 */
            String upstreamCode,
            /** failed 时的上游可读原因（error.message / 顶层 message，可 null）。 */
            String upstreamMessage
    ) implements ParentTaskObservation {}
}
