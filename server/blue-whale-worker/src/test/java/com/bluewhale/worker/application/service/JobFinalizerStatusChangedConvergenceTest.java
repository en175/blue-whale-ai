package com.bluewhale.worker.application.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class JobFinalizerStatusChangedConvergenceTest {

    private static final Path SOURCE = Path.of(
            "src/main/java/com/bluewhale/worker/application/service/JobFinalizer.java");

    private static final String HELPER = "publishStatusChanged";
    private static final String HELPER_SIG = "private void " + HELPER + "(";
    private static final String CALL = HELPER + "(job, Map.of(";

    private static final int EXPECTED_CALL_SITES = 9;

    @Test
    @DisplayName("★ status_changed 只准由 publishStatusChanged 一处发出")
    void 发布点唯一() throws IOException {
        List<String> lines = readSource();
        int[] helper = helperRange(lines);

        List<Integer> bareSites = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if (i >= helper[0] && i <= helper[1]) continue;
            String line = lines.get(i);
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
    @DisplayName("9 个收敛调用点（8 个终态路径 + 取消路径），数量对账")
    void 九处都接了() throws IOException {
        long callSites = readSource().stream()
                .filter(line -> line.contains(CALL))
                .count();

        assertThat(callSites)
                .withFailMessage("终态调用点数量从 %d 变成了 %d —— 见本测试类注释",
                        EXPECTED_CALL_SITES, callSites)
                .isEqualTo(EXPECTED_CALL_SITES);
    }

    @Test
    @DisplayName("★ 四条取消路径都接了退款（它们不走 8 个终态路径）")
    void 取消路径接了退款() throws IOException {
        Path machine = Path.of(
                "src/main/java/com/bluewhale/worker/application/service/JobStateMachineService.java");
        assertThat(Files.exists(machine)).withFailMessage("找不到 %s", machine).isTrue();
        List<String> lines = Files.readAllLines(machine);

        for (String signature : List.of(
                "public boolean cancelJobBeforeDispatch(",
                "public boolean cancelVideoFrameInterpolation(",
                "public boolean cancelAudioMixIfRequested(",
                "public boolean cancelAudioVideoMuxIfRequested(")) {
            String body = methodBody(lines, signature);
            assertThat(body)
                    .withFailMessage("""
                            %s 里没有 finalizer.cancelJob：
                            取消会成功（CAS 命中、status 落到 cancelled），但那条路径不经过
                            JobFinalizer 的终态路径，于是**没有任何人告诉 billing**——
                            该 job 的退款永远发不出去，没有报错、没有红灯。""", signature.trim())
                    .contains("finalizer.cancelJob(");
        }
    }

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

    private static int[] helperRange(List<String> lines) {
        int start = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).contains(HELPER_SIG)) {
                start = i;
                break;
            }
        }
        assertThat(start)
                .withFailMessage("%s 不见了——收敛点被删掉后各路径会各发各的，钱就冻住了",
                        HELPER_SIG.trim())
                .isNotEqualTo(-1);

        for (int i = start + 1; i < lines.size(); i++) {
            if (lines.get(i).equals("    }")) {
                return new int[]{start, i};
            }
        }
        throw new AssertionError("找不到 " + HELPER + " 的结束大括号");
    }

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
