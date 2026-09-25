package com.bluewhale.worker.application.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 终态发布点收敛的**源码守卫**。
 *
 * <h2>为什么这条要用扫源码的方式钉</h2>
 *
 * {@link JobFinalizer} 里每一个终态路径都必须在发 {@code status_changed} 的同时
 * 发一条 billing 事件——前者是用户看到的进度，后者是**解冻预扣**。
 * 两者由 {@code publishStatusChanged} 保证同进同出。
 *
 * <p>但这条约束没有一个运行时断言能表达：新加第 9 个家族时，只要作者顺手写了
 * {@code eventPublisher.publish(..., "generation_job.status_changed", ...)}，
 * 代码照样编译、测试照样绿、功能照样正常——**只有那个 job 的钱永远冻着**。
 * 而这恰恰是最容易被复制粘贴带出来的一种错。
 *
 * <p>所以这里退一步，直接钉住「这个字符串只准在 helper 内部出现」。
 * 它扫的是源码文本，不是行为；换来的是新家族接入时**当场红**。
 * （同款思路见仓内三轨 SQL 的 parity 测试：约束钉在源码形态上，不在运行结果上。）
 */
class JobFinalizerStatusChangedConvergenceTest {

    private static final Path SOURCE = Path.of(
            "src/main/java/com/bluewhale/worker/application/service/JobFinalizer.java");

    private static final String HELPER = "publishStatusChanged";
    private static final String HELPER_SIG = "private void " + HELPER + "(";
    private static final String CALL = HELPER + "(job, Map.of(";

    /** 一个终态路径 = 一次 helper 调用。4 成功族 + 4 失败族。 */
    private static final int EXPECTED_CALL_SITES = 8;

    @Test
    @DisplayName("★ status_changed 只准由 publishStatusChanged 一处发出")
    void 发布点唯一() throws IOException {
        List<String> lines = readSource();
        int[] helper = helperRange(lines);

        List<Integer> bareSites = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if (i >= helper[0] && i <= helper[1]) continue; // helper 内部就是唯一允许的那处
            String line = lines.get(i);
            // 只认代码行：注释里出现这个方法名是在**描述**它，不是调用它
            // （本测试类的 javadoc 与 helper 的 javadoc 都提到这段文本）
            if (isComment(line)) continue;
            if (line.contains("eventPublisher.publish(") && line.contains("status_changed")) {
                bareSites.add(i + 1);
            }
        }

        assertThat(bareSites)
                .withFailMessage("""
                        这些行绕过了 %s 直接发 status_changed：%s
                        后果不是显示问题——那条路径上的 billing 结算事件不会发出，
                        该 job 的预扣永远冻着，且没有任何自动补偿会来救。
                        改法：换成 %s)。""", HELPER, bareSites, CALL)
                .isEmpty();
    }

    @Test
    @DisplayName("helper 内部同时发两条：project_events 的 status_changed + billing 事件")
    void helper同时发两条() throws IOException {
        List<String> lines = readSource();
        int[] helper = helperRange(lines);
        String body = String.join("\n", lines.subList(helper[0], helper[1] + 1));

        assertThat(body).contains("generation_job.status_changed");
        assertThat(body).contains("settlementPublisher.publishTerminal(");
    }

    @Test
    @DisplayName("8 个终态路径都接了收敛点（数量对账，少一处即为漏接）")
    void 八处都接了() throws IOException {
        long callSites = readSource().stream()
                .filter(line -> line.contains(CALL))
                .count();

        // 数量变了不一定是错，但一定是**有人动了终态路径**：
        // 加家族要确认新路径也接了 billing 事件，删路径要同步改这里。
        assertThat(callSites)
                .withFailMessage("终态调用点数量从 %d 变成了 %d —— 见本测试类注释",
                        EXPECTED_CALL_SITES, callSites)
                .isEqualTo(EXPECTED_CALL_SITES);
    }

    @Test
    @DisplayName("★ 两条取消路径都接了预扣解冻（它们不走 8 个终态路径）")
    void 取消路径接了解冻() throws IOException {
        // 取消把 status='cancelled' 的 CAS 写在自己的 mapper SQL 里，由 JobStateMachineService
        // 调用，**完全不经过 JobFinalizer 的 8 个终态路径**。所以上面那三条断言一条都盖不到它。
        // 接上解冻之前，这个缺口的表现是：job 已经终态，而那笔预扣没有任何人会去动它。
        //
        // ⚠️ 按**方法**取而不是按行取：cancelVideoFrameInterpolation 里那两条 CAS 落在同一句
        //    三目表达式的两行上，按行数会数出 3 个「调用点」，而那只是 1 个决策点。
        Path machine = Path.of(
                "src/main/java/com/bluewhale/worker/application/service/JobStateMachineService.java");
        assertThat(Files.exists(machine)).withFailMessage("找不到 %s", machine).isTrue();
        List<String> lines = Files.readAllLines(machine);

        for (String signature : List.of(
                "public boolean cancelVideoBeforeDispatch(",
                "public boolean cancelVideoFrameInterpolation(")) {
            String body = methodBody(lines, signature);
            assertThat(body)
                    .withFailMessage("""
                            %s 里没有 releaseHoldForCancelled：
                            取消会成功（CAS 命中、status 落到 cancelled），但那条路径不经过
                            JobFinalizer 的终态路径，于是**没有任何人告诉 billing**——
                            该 job 的预扣永远冻着，没有报错、没有红灯。""", signature.trim())
                    .contains("releaseHoldForCancelled");
        }
    }

    /** 按签名行取一个方法的源码体（到下一个 `    }` 行为止）。 */
    private static String methodBody(List<String> lines, String signature) {
        int start = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).contains(signature)) {
                start = i;
                break;
            }
        }
        assertThat(start)
                .withFailMessage("%s 不见了——取消入口被改名/删除后本守卫会失效", signature.trim())
                .isNotEqualTo(-1);

        for (int i = start + 1; i < lines.size(); i++) {
            if (lines.get(i).equals("    }")) {
                return String.join("\n", lines.subList(start, i + 1));
            }
        }
        throw new AssertionError("找不到 " + signature + " 的结束大括号");
    }

    /**
     * helper 方法体的行号区间（闭区间，0-based）。
     *
     * <p>靠「签名行 → 缩进 4 空格的单独 {@code }} 行」界定，因为本类里没有嵌套在
     * helper 内部的匿名类 / lambda 块，这个简化成立。找不到就断言失败——
     * 与其静默产出一个错的区间，不如让守卫自己先红。
     */
    private static int[] helperRange(List<String> lines) {
        int start = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).contains(HELPER_SIG)) {
                start = i;
                break;
            }
        }
        assertThat(start)
                .withFailMessage("%s 不见了——收敛点被删掉后 8 处会各发各的，钱就冻住了",
                        HELPER_SIG.trim())
                .isNotEqualTo(-1);

        for (int i = start + 1; i < lines.size(); i++) {
            if (lines.get(i).equals("    }")) {
                return new int[]{start, i};
            }
        }
        throw new AssertionError("找不到 " + HELPER + " 的结束大括号");
    }

    /**
     * 注释行判定（行注释、块注释的续行 {@code * ...}、以及 {@code /** *}{@code /} 本身）。
     *
     * <p>够用即可：本文件的用途是挡复制粘贴带出的**裸调用**，不是写一个 Java 词法分析器。
     * 字符串字面量里出现这两个词的情形在这里不存在。
     */
    private static boolean isComment(String line) {
        String trimmed = line.trim();
        return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    }

    private static List<String> readSource() throws IOException {
        assertThat(Files.exists(SOURCE))
                .withFailMessage("找不到 %s（工作目录 = %s）；本测试假定从模块根运行",
                        SOURCE, Path.of("").toAbsolutePath())
                .isTrue();
        return Files.readAllLines(SOURCE);
    }
}
