package com.bluewhale.billing.adapter.inbound;

import com.bluewhale.billing.adapter.inbound.http.AdminNotFoundException;
import com.bluewhale.billing.application.CatalogCompiler;
import com.bluewhale.billing.domain.ledger.InsufficientCreditsException;
import com.bluewhale.billing.domain.pricing.BasePriceResolver;
import com.bluewhale.billing.domain.pricing.PricingEngine;
import com.bluewhale.billing.domain.pricing.Usage;
import io.grpc.Status;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;

/**
 * billing 的**错误分类学**：异常 → 契约错误码，以及每个码在两个传输层上的状态。
 *
 * <p>此前这套判定散在三处传输层里（用户面 gRPC、管理面 gRPC、管理面 HTTP），
 * 每处各持一份码常量与一条 if 链。后果是「这个异常对外叫什么码」有三个答案，
 * 而其中一处改了另一处不会红 —— 跨语言那一侧更难发现：{@code billing-client.ts} 按
 * status description 的**前缀词**反解码，Java 侧改措辞，TS 侧静默退化成 502。
 *
 * <p>现在码只在本类定义一次，判定也只在本类做一次；三处传输层退化成「把 {@link Failure}
 * 搬成自己的状态对象」的薄壳。**分支顺序这条隐性知识**也收在这里唯一一处。
 *
 * <p>⚠️ 顺序从具体到宽泛。{@link InsufficientCreditsException} 与
 * {@link AdminNotFoundException} 都**不是** {@link IllegalArgumentException} 的子类，
 * 所以顺序错了不会被误判成「参数错误」，而是一路掉到兜底的 {@code INTERNAL} ——
 * 对外表现为「billing 挂了」，比误判更难排查。
 *
 * <p>⚠️ 本类**不吞异常、不记日志**：内部错误由各传输层自己 {@code log.error}（它们才知道
 * 该用哪个 logger 与上下文），本类只回答「它是什么」。
 */
public final class BillingErrorTaxonomy {

    private BillingErrorTaxonomy() {}

    /**
     * 判定的**表面**。绝大多数异常在三个面上同码同义，唯一的例外见 {@link #classify}。
     */
    public enum Surface {
        /**
         * 用户面（{@code BillingService}）：调用方是终端用户，**他改不了定价配置**。
         */
        USER,
        /**
         * 管理面（{@code BillingAdminService} 与 HTTP 管理接口）：调用方是运营，
         * **他正是定价文档的作者**。
         */
        ADMIN,
    }

    /**
     * 契约错误码。
     *
     * <p>{@code proto} 里逐条列着这些字面量，调用方按它决定 fail closed 的方式。
     * 改这些字符串等于改契约，要同步改 proto 注释与调用方 ——
     * `billing-contract-parity.test.ts` 的「错误码」那段现在会红。
     *
     * <p>每个码同时决定两个传输层的状态：gRPC 的 {@code Status.Code} 与 HTTP 的状态码。
     * 摆在**同一行**是刻意的 —— 这两个值本来就该一起改，分开写迟早漂。
     */
    public enum Code {
        /** 余额不足。HTTP 402 是「付费相关」而不是「参数错误」，别再合并回 400。 */
        INSUFFICIENT_CREDITS("INSUFFICIENT_CREDITS", Status.Code.FAILED_PRECONDITION,
                HttpStatus.PAYMENT_REQUIRED),
        /** 算不出价：请求本身合法，是规则没覆盖到这个组合 → 对运维是「去补配置」的信号。 */
        UNPRICEABLE("UNPRICEABLE", Status.Code.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST),
        /** 幂等键撞车：不是失败，是**已经做过了**。 */
        DUPLICATE("DUPLICATE", Status.Code.ALREADY_EXISTS, HttpStatus.CONFLICT),
        /** 目标不存在（改/删一条已被删掉的记录）。与 400 是两句不同的人话。 */
        NOT_FOUND("NOT_FOUND", Status.Code.NOT_FOUND, HttpStatus.NOT_FOUND),
        /** 请求本身不成立（参数、已提交的目录文档、请求体解析失败）。 */
        INVALID_ARGUMENT("INVALID_ARGUMENT", Status.Code.INVALID_ARGUMENT, HttpStatus.BAD_REQUEST),
        /** 内部错误：**原文只进日志**，对外统一一句话。 */
        INTERNAL("INTERNAL", Status.Code.INTERNAL, HttpStatus.INTERNAL_SERVER_ERROR);

        private final String wire;
        private final Status.Code grpcCode;
        private final HttpStatus httpStatus;

        Code(String wire, Status.Code grpcCode, HttpStatus httpStatus) {
            this.wire = wire;
            this.grpcCode = grpcCode;
            this.httpStatus = httpStatus;
        }

        /** 契约字面量（status description 的前缀、HTTP body 的 {@code code} 字段）。 */
        public String wire() {
            return wire;
        }

        public Status.Code grpcCode() {
            return grpcCode;
        }

        public HttpStatus httpStatus() {
            return httpStatus;
        }
    }

    /**
     * 内部错误对外统一说的那句话。
     *
     * <p>栈信息可能带库表名、SQL 片段或金额，**只进日志**；调用方靠 traceId 对回去。
     */
    public static final String INTERNAL_MESSAGE = "billing 内部错误";

    /**
     * 幂等键撞车时对外说的话。
     *
     * <p>它不是异常原文：{@code DuplicateKeyException} 的 message 是 JDBC 的错误串
     * （表名、索引名），对调用方没有意义。
     */
    public static final String DUPLICATE_MESSAGE =
            "该幂等键已存在：这次操作之前已经成功过，未重复执行";

    /**
     * 判定结果。
     *
     * @param logDetail 异常原文 —— **只给日志**。{@link Code#INTERNAL} 时不得外发，
     *                  外发一律走 {@link #outwardDetail()} / {@link #description()}。
     *                  名字带 `log` 前缀就是为了让误用在调用点显形 ——
     *                  一个叫 `detail()` 的取值器，在边界上被人随手用掉太容易了。
     */
    public record Failure(Code code, String logDetail) {

        /**
         * 对外文案：内部错误只给一句通用话，其余用异常原文。
         *
         * <p>与 {@link #logDetail()} 的区别就是这一条 —— **外发只走本方法或 {@link #description()}**。
         */
        public String outwardDetail() {
            return code == Code.INTERNAL ? INTERNAL_MESSAGE : logDetail;
        }

        /**
         * gRPC status 的 description。
         *
         * <p>格式是 `<CODE>: <原文>` —— **调用方按前缀反解码**（见
         * {@code backend/libs/shared/billing/billing-client.ts} 的 `toBillingHoldError`），
         * 所以这个格式是契约的一部分，不是随手拼的展示串。
         *
         * <p>内部错误**不带码前缀**（此前三处都如此）：对调用方它只需要知道「billing 挂了」，
         * 多一个码不增加信息量。
         */
        public String description() {
            return code == Code.INTERNAL
                    ? outwardDetail()
                    : code.wire() + ": " + outwardDetail();
        }

        /** 内部错误：调用方不该把原文给出去，传输层该记日志。 */
        public boolean internal() {
            return code == Code.INTERNAL;
        }
    }

    /**
     * **唯一的判定点**：异常 → 码 + 原文。
     *
     * <p>⚠️ 顺序从具体到宽泛，见类注释。
     *
     * <p>⚠️ 唯一按 {@link Surface} 分叉的是 {@link CatalogCompiler.CompileException}：
     * 管理面提交的**就是这份文档本身**（告诉他去改文档，{@code INVALID_ARGUMENT}）；
     * 用户面拿到的是「这条能力行的规则坏了」，他改不了，只能换一个模型
     * （{@code UNPRICEABLE}）。两处原本的注释都写明这个区分是刻意的 ——
     * 混成一个码，运维看到时无法判断该去查目录还是查自己刚提交的文档。
     */
    public static Failure classify(RuntimeException e, Surface surface) {
        if (e instanceof InsufficientCreditsException) {
            return new Failure(Code.INSUFFICIENT_CREDITS, e.getMessage());
        }
        if (e instanceof CatalogCompiler.CompileException) {
            // 见方法注释：唯一按面分叉的一处
            return new Failure(
                    surface == Surface.ADMIN ? Code.INVALID_ARGUMENT : Code.UNPRICEABLE,
                    e.getMessage());
        }
        if (e instanceof PricingEngine.RuleNotFoundException
                || e instanceof BasePriceResolver.UnpriceableSpecException
                || e instanceof Usage.ContractQuantityUnavailableException) {
            return new Failure(Code.UNPRICEABLE, e.getMessage());
        }
        if (e instanceof AdminNotFoundException) {
            // ⚠️ 必须排在下面 IllegalArgumentException 之前。虽然当前它不是 IAE 的子类
            //    （顺序错了会掉到 INTERNAL 而不是 INVALID_ARGUMENT），但这条依赖是隐性的：
            //    哪天有人把它改成 `extends IllegalArgumentException`，就会静默变成 400，
            //    而运营对着一个没有问题的表单反复保存 —— 与 404 是相反的两句话。
            return new Failure(Code.NOT_FOUND, e.getMessage());
        }
        if (e instanceof DuplicateKeyException) {
            // ⚠️ 用户面此前**没有**这个分支（那个异常会一路落到 INTERNAL 500）。共用一条链
            //    之后用户面也会返回 DUPLICATE / ALREADY_EXISTS —— 这是对的（幂等键撞车不是
            //    「billing 挂了」），但它确实是共用带来的 wire 差异，记在这里免得下次有人
            //    对着 diff 反推半天。可达路径是并发竞态：`CreditService.hold` 的幂等预检在
            //    取锁之前，两个同 commandId 的请求都能过预检，输的那个撞唯一索引。
            //    调用方按 (码, 原因词) **一起**判，认得的是另外两个词，所以对外表现不变。
            //
            //    ⚠️ `DuplicateGrantKeyException`（HTTP 包里的那个）**刻意不在这里**：它是
            //    HTTP 面的特例，要多回一个 existingBizId，由 AdminExceptionHandler 自己的
            //    处理器接。它继承的是 RuntimeException 而不是 DuplicateKeyException，
            //    真掉到这里会变成 INTERNAL —— 别把它「顺手修」进这条链，
            //    那会让那个处理器拿不到 existingBizId。
            return new Failure(Code.DUPLICATE, DUPLICATE_MESSAGE);
        }
        if (e instanceof IllegalArgumentException) {
            return new Failure(Code.INVALID_ARGUMENT, e.getMessage());
        }
        return new Failure(Code.INTERNAL, e.getMessage());
    }
}
