/**
 * MVP 全栈验收（IK1NS2）：AgentChatPanel 生图闭环
 *
 * 链路：进入 Project → 创作澄清 → 自然语言回答恢复原 AgentRun → generate_image
 * → Fake 成功（Asset = Card = NodeItem）→ 拖动 NodeItem → 刷新由 Project Snapshot 恢复
 * → Fake 确定性失败（稳定产品错误）→ 失败 Card 重试关联新 Job（retry_of_job_id）→ 最终成功。
 *
 * 断言权威：UI（SSE/快照投影）+ Project Snapshot API（经 Web rewrite → Gateway）。
 * 本套件由 scripts/run-mvp-acceptance.sh 驱动（隔离 Compose 全栈，Fake Provider，零真实费用）。
 */
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  bearerClient,
  fetchSnapshot,
  loginViaApi,
  seedSession,
  type ProjectSnapshot,
} from "./_fixtures/fullstack-auth";

const CHAT_BODY = ".tc-agent-chat-body";
const COMPOSER = ".tc-agent-composer-editor";
const SEND_BUTTON = "button.tc-agent-send-btn";
const GENERATION_NODE = '.react-flow__node[data-id^="generation-job-"]';

async function openChatPanel(page: Page): Promise<void> {
  const panel = page.locator(".tc-agent-chat-panel");
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Canvas Agent" }).click();
  }
  await expect(panel).toBeVisible();
}

async function sendChatMessage(page: Page, text: string): Promise<void> {
  await page.locator(COMPOSER).fill(text);
  await page.locator(SEND_BUTTON).click();
}

async function listProjectIds(api: APIRequestContext): Promise<number[]> {
  const res = await api.get("/api/projects");
  const body = (await res.json()) as { data: Array<{ id: number }> };
  return body.data.map((p) => p.id);
}

function canvasNodePositions(
  snapshot: ProjectSnapshot,
): Array<{ id: string; x: number; y: number }> {
  const raw = snapshot.canvas?.nodes;
  if (!raw) return [];
  const nodes = JSON.parse(raw) as Array<{
    id: string;
    position?: { x: number; y: number };
  }>;
  return nodes.map((n) => ({
    id: n.id,
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
  }));
}

test("MVP 全栈闭环：创作澄清→成功生成→拖动刷新恢复→失败重试", async ({
  page,
  baseURL,
}) => {
  const session = await loginViaApi(baseURL!);
  await seedSession(page, session);
  const api = await bearerClient(baseURL!, session);
  let projectId = 0;
  let firstJobId = "";
  let firstAssetId = "";

  await test.step("进入 Project：服务端认可的合成测试认证态，API 全经 Gateway", async () => {
    await page.goto("/canvas");
    // 空库时前端自动创建「未命名项目」；等后端项目出现并以其为权威
    await expect
      .poll(async () => (await listProjectIds(api)).length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    projectId = (await listProjectIds(api))[0];
    await openChatPanel(page);
  });

  await test.step("创作澄清：不完整生图意图创建 creation_clarification UserInputRequest", async () => {
    await sendChatMessage(page, "澄清:鲸鱼");
    await expect(page.locator(CHAT_BODY)).toContainText(
      "请补充你希望生成的「鲸鱼」",
      {
        timeout: 60_000,
      },
    );
    await expect
      .poll(
        async () => {
          const snap = await fetchSnapshot(api, projectId);
          const req = snap.agent_runs[0]?.active_input_request;
          return req ? `${req.request_type}:${req.status}` : "";
        },
        { timeout: 60_000 },
      )
      .toBe("creation_clarification:pending");
  });

  await test.step("自然语言回答：恢复原 AgentRun，产生 source=agent_run 的 generate_image Job", async () => {
    await sendChatMessage(page, "水墨风格，留白");
    await expect(page.locator(CHAT_BODY)).toContainText(
      "已接纳，正在生成图片",
      {
        timeout: 60_000,
      },
    );
    // prompt = checkpoint 中的 topic + 本次回答，证明原 AgentRun 从持久化 RuntimeCheckpoint 恢复
    await expect
      .poll(
        async () => {
          const snap = await fetchSnapshot(api, projectId);
          const job = snap.generation_jobs[0];
          if (!job) return "";
          firstJobId = String(job.job_id);
          return `${job.source}:${job.input?.prompt ?? ""}`;
        },
        { timeout: 60_000 },
      )
      .toBe("agent_run:鲸鱼，水墨风格，留白");
  });

  await test.step("Fake 成功：只创建一个私有 Asset，Card 与 NodeItem 引用同一身份", async () => {
    // 成功卡带 data-asset-id（生成中卡没有），先等它出现再读，避免读早
    const successCard = page.locator(`${CHAT_BODY} [data-asset-id]`).first();
    await expect(successCard).toBeVisible({ timeout: 90_000 });
    firstAssetId = (await successCard.getAttribute("data-asset-id"))!;
    expect(firstAssetId).toBeTruthy();
    await expect(
      page.locator("button.tc-agent-card-cta").first(),
    ).toHaveAttribute("aria-label", "手动应用");

    await expect(page.locator(GENERATION_NODE)).toHaveCount(1, {
      timeout: 60_000,
    });
    // Card 与画布 NodeItem 是同一 Asset 身份的两个投影
    await expect(
      page.locator(`${GENERATION_NODE} [data-asset-id]`),
    ).toHaveAttribute("data-asset-id", firstAssetId);

    const snap = await fetchSnapshot(api, projectId);
    const job = snap.generation_jobs.find(
      (j) => String(j.job_id) === firstJobId,
    )!;
    expect(job.status).toBe("succeeded");
    expect(job.agent_run_id).toBeTruthy();
    expect(job.outputs).toHaveLength(1);
    expect(String(job.outputs![0].asset_id)).toBe(firstAssetId);
    expect(Object.keys(snap.assets)).toHaveLength(1);
    expect(snap.assets[firstAssetId]).toBeTruthy();
    // 私有 Asset：携带网关认可的身份可访问；未认证访问被网关 JWT 拦截（401）
    const content = await api.get(
      `/api/projects/${projectId}/assets/${firstAssetId}/content`,
    );
    expect(content.ok()).toBeTruthy();
    const anon = await request.newContext({ baseURL });
    try {
      const denied = await anon.get(
        `/api/projects/${projectId}/assets/${firstAssetId}/content`,
      );
      expect(denied.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });

  await test.step("拖动 NodeItem 后刷新：Project Snapshot 恢复全部状态与最后位置，无重复节点", async () => {
    // 拖动前画布世界坐标（SSE 投影落位后已有一次保存，Snapshot 必有记录）
    const beforePositions = canvasNodePositions(
      await fetchSnapshot(api, projectId),
    );
    expect(beforePositions).toHaveLength(1);

    const node = page.locator(GENERATION_NODE);
    const beforeBox = (await node.boundingBox())!;
    await page.mouse.move(
      beforeBox.x + beforeBox.width / 2,
      beforeBox.y + beforeBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      beforeBox.x + beforeBox.width / 2 + 220,
      beforeBox.y + beforeBox.height / 2 + 160,
      {
        steps: 12,
      },
    );
    await page.mouse.up();
    const draggedBox = (await node.boundingBox())!;
    expect(Math.abs(draggedBox.x - beforeBox.x)).toBeGreaterThan(50);

    // 位置经 Project/Canvas 权威接口持久化：以 Project Snapshot 为权威等它落到拖后坐标
    //（拖动 +220/+160，zoom=1 时世界坐标同量变化，留 ±40 容差吸收渲染抖动）
    let savedPositions: Array<{ id: string; x: number; y: number }> = [];
    await expect
      .poll(
        async () => {
          savedPositions = canvasNodePositions(
            await fetchSnapshot(api, projectId),
          );
          if (savedPositions.length !== 1) return false;
          const dx = savedPositions[0].x - beforePositions[0].x;
          const dy = savedPositions[0].y - beforePositions[0].y;
          return Math.abs(dx - 220) <= 40 && Math.abs(dy - 160) <= 40;
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    // 刷新前先取出页面里的「活」token 再重种子：App 首次挂载已旋转过 refresh_token
    //（旧 RT 随即作废），addInitScript 若重放原始种子，刷新后 mount refresh 会失败并清空登录态
    const liveTokens = await page.evaluate(() => ({
      access: window.localStorage.getItem("bw-access-token"),
      refresh: window.localStorage.getItem("bw-refresh-token"),
    }));
    expect(liveTokens.access).toBeTruthy();
    await page.addInitScript((t) => {
      window.localStorage.setItem("bw-access-token", t.access!);
      window.localStorage.setItem("bw-refresh-token", t.refresh!);
    }, liveTokens);
    await page.reload();
    await expect(page.locator(GENERATION_NODE)).toHaveCount(1, {
      timeout: 60_000,
    });
    const restoredBox = (await page.locator(GENERATION_NODE).boundingBox())!;
    expect(Math.abs(restoredBox.x - draggedBox.x)).toBeLessThan(15);
    expect(Math.abs(restoredBox.y - draggedBox.y)).toBeLessThan(15);

    // 产品权威终态：Conversation / Card / GenerationJob / Asset / NodeItem / 位置全部恢复
    const snap = await fetchSnapshot(api, projectId);
    const userTexts = snap.conversation_messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    expect(userTexts).toContain("澄清:鲸鱼");
    expect(userTexts).toContain("水墨风格，留白");
    // assistant 侧（澄清问题、生成受理）也随 Snapshot 恢复
    const assistantTexts = snap.conversation_messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content);
    expect(assistantTexts.some((t) => t.includes("请补充你希望生成的"))).toBe(
      true,
    );
    expect(assistantTexts).toContain("已接纳，正在生成图片。");
    expect(snap.generation_jobs).toHaveLength(1);
    expect(Object.keys(snap.assets)).toHaveLength(1);
    expect(canvasNodePositions(snap)).toEqual(savedPositions);

    // 聊天 Card 仍唯一且引用同一 Asset（无重复投影）
    await openChatPanel(page);
    await expect(page.locator(`${CHAT_BODY} [data-asset-id]`)).toHaveCount(1);
    await expect(page.locator(`${CHAT_BODY} [data-asset-id]`)).toHaveAttribute(
      "data-asset-id",
      firstAssetId,
    );
  });

  await test.step("Fake 确定性失败：原 Job 与输出槽位进入失败终态，只展示稳定产品错误", async () => {
    await sendChatMessage(page, "生成一张fake:failure");
    const errorCard = page.locator(".tc-agent-card-error");
    await expect(errorCard).toHaveText("图像生成失败", { timeout: 90_000 });
    // 稳定、安全：不泄漏 Fake Provider 内部细节
    await expect(errorCard).not.toContainText(/fake|provider/i);

    await expect
      .poll(
        async () => {
          const snap = await fetchSnapshot(api, projectId);
          const failed = snap.generation_jobs.find(
            (j) => j.input?.prompt === "fake:failure",
          );
          if (failed?.status !== "failed") return "";
          return `${failed.error?.message ?? ""}|${failed.outputs?.[0]?.status ?? ""}|${Object.keys(snap.assets).length}`;
        },
        { timeout: 90_000 },
      )
      .toBe("图像生成失败|failed|1"); // Job 与输出槽位同入失败终态，且不产生新 Asset
  });

  await test.step("失败 Card 重试：创建 retry_of_job_id 关联的新 Job，原 Job 保持失败，新 Job 成功", async () => {
    const failedSnap = await fetchSnapshot(api, projectId);
    const failedJob = failedSnap.generation_jobs.find(
      (j) => j.input?.prompt === "fake:failure",
    )!;

    await page.getByRole("button", { name: "生成失败，可重试" }).click();

    // 新 Asset 投影为第二张成功 Card 与第二个 NodeItem；原失败卡原样保留
    await expect(page.locator(`${CHAT_BODY} [data-asset-id]`)).toHaveCount(2, {
      timeout: 90_000,
    });
    await expect(page.locator(GENERATION_NODE)).toHaveCount(2, {
      timeout: 60_000,
    });
    await expect(page.locator(".tc-agent-card-error")).toHaveCount(1);

    await expect
      .poll(
        async () => {
          const snap = await fetchSnapshot(api, projectId);
          const retry = snap.generation_jobs.find(
            (j) => String(j.retry_of_job_id ?? "") === String(failedJob.job_id),
          );
          return retry?.status ?? "";
        },
        { timeout: 90_000 },
      )
      .toBe("succeeded");

    const snap = await fetchSnapshot(api, projectId);
    const original = snap.generation_jobs.find(
      (j) => String(j.job_id) === String(failedJob.job_id),
    )!;
    expect(original.status).toBe("failed"); // 原 Job 失败终态不被改写
    expect(original.outputs?.[0]?.status).toBe("failed"); // 原输出槽位保持失败终态
    const retry = snap.generation_jobs.find(
      (j) => String(j.retry_of_job_id ?? "") === String(failedJob.job_id),
    )!;
    expect(String(retry.job_id)).not.toBe(String(failedJob.job_id));
    expect(Object.keys(snap.assets)).toHaveLength(2);
    const retryAssetId = String(retry.outputs![0].asset_id);
    expect(retryAssetId).not.toBe(firstAssetId);
    expect(snap.assets[retryAssetId]).toBeTruthy();
  });

  await api.dispose();
});
