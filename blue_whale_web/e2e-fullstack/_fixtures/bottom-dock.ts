/**
 * BottomDock 图片模式 UI 交互 fixture（IK2BDN T6.3）
 *
 * 只封装「真实用户可操作」的交互与请求捕获，不触碰组件内部 state。
 * 选择器以 aria-label / role / 文本为准；BottomDock UI 变化时同步本文件。
 * 注意：模型设置浮层、数量菜单、上传来源菜单均 portal 到 document.body，
 * 不能用 IMAGE_DOCK 作为定位 scope。
 */
import { expect, type Page } from "@playwright/test";

export const IMAGE_DOCK = '[data-canvas-reference-drop-target="image-dock"]';

export const SETTINGS_TRIGGER = "图像模型设置";
const POPOVER = "[data-tc-dock-popover]";

export interface ImageCommandCapture {
  payload: {
    type: string;
    input_asset_ids: unknown[];
    expected_output_count: number;
    parameters: {
      prompt?: string;
      aspect_ratio?: string;
      model_id?: string;
      size?: string;
      web_search?: boolean;
      sequential_image_generation?: boolean;
    };
  };
  /** 服务端 202 接纳返回的 Job 身份。 */
  jobId: number;
  /** 浏览器实际发送的幂等键（Idempotency-Key 头）。 */
  idempotencyKey: string;
}

/** 打开 LeftToolbar「AI 图片」Dock，并等能力表加载完成（触发钮不再显示加载中）。 */
export async function openImageDock(page: Page): Promise<void> {
  await page.getByRole("button", { name: "AI 图片" }).click();
  await expect(page.locator(IMAGE_DOCK)).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: SETTINGS_TRIGGER }),
  ).not.toContainText("加载中", { timeout: 15_000 });
}

/** 在模型设置浮层中选择宽高比分段按钮（如 "1:1"）。浮层保持打开。 */
export async function selectAspectRatio(
  page: Page,
  label: string,
): Promise<void> {
  await ensureSettingsOpen(page);
  await page
    .locator(POPOVER)
    .getByRole("button", { name: label, exact: true })
    .click();
}

/** 在模型设置浮层的分辨率下拉中选择档位（如 "2K"）。浮层保持打开。 */
export async function selectSize(page: Page, label: string): Promise<void> {
  await ensureSettingsOpen(page);
  const popover = page.locator(POPOVER);
  // 尺寸字段按钮：当前档位文本（2K/3K/4K），模型 label 不匹配该模式
  await popover
    .getByRole("button", { name: /^\d+K$/ })
    .first()
    .click();
  // 下拉打开后同名项含字段按钮本身，选项在 DOM 中位于其后，取最后一个
  await popover
    .getByRole("button", { name: label, exact: true })
    .last()
    .click();
}

/** 将联网搜索开关设置到目标状态（幂等：已在目标状态则不点）。浮层保持打开。 */
export async function setWebSearch(page: Page, on: boolean): Promise<void> {
  await ensureSettingsOpen(page);
  const toggle = page
    .locator(POPOVER)
    .getByRole("switch", { name: "联网搜索" });
  const checked = (await toggle.getAttribute("aria-checked")) === "true";
  if (checked !== on) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-checked", String(on));
}

/** 关闭模型设置浮层（再次点击触发钮）。 */
export async function closeImageSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: SETTINGS_TRIGGER }).click();
  await expect(page.locator(POPOVER)).toHaveCount(0);
}

/** 选择生成数量（如 "4x"）。数量菜单独立于模型设置浮层。 */
export async function selectQuantity(
  page: Page,
  option: string,
): Promise<void> {
  await page.getByRole("button", { name: "生成数量" }).click();
  await page
    .getByRole("listbox", { name: "选择生成数量" })
    .getByRole("option", { name: option })
    .click();
}

/**
 * 填 prompt 并点击「生成」，捕获浏览器实际 POST 的 payload、幂等键与服务端接纳的 jobId。
 * 请求经 route.fetch 真实放行到服务端（不模拟响应）。
 */
export async function submitImageCommand(
  page: Page,
  prompt: string,
): Promise<ImageCommandCapture> {
  let captured: ImageCommandCapture | undefined;
  const routePattern = "**/api/projects/*/generation-jobs";
  await page.route(routePattern, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      return route.continue();
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      data?: { generation_job_id?: number };
    };
    captured = {
      payload: request.postDataJSON() as ImageCommandCapture["payload"],
      jobId: Number(body?.data?.generation_job_id),
      idempotencyKey: request.headers()["idempotency-key"] ?? "",
    };
    await route.fulfill({ response });
  });
  try {
    await page.locator(`${IMAGE_DOCK} [contenteditable="true"]`).click();
    await page.keyboard.type(prompt);
    await page
      .locator(`${IMAGE_DOCK} button`)
      .filter({ hasText: /生成/ })
      .click();
    await expect.poll(() => captured, { timeout: 30_000 }).toBeTruthy();
    return captured!;
  } finally {
    await page.unroute(routePattern);
  }
}

/**
 * 从画布选择一张已有图片节点作为参考图，并等待 Dock 内鉴权缩略图出现（blob: src）。
 * nodeSelector 定位画布节点内的 img（如 `.react-flow__node[data-id="..."] img`）。
 */
export async function pickReferenceFromCanvas(
  page: Page,
  nodeSelector: string,
): Promise<void> {
  await page.getByRole("button", { name: "Upload reference image" }).click();
  await page
    .getByRole("menu", { name: "上传来源" })
    .getByRole("menuitem", { name: "从画布选择" })
    .click();
  await page.locator(nodeSelector).click();
  // 鉴权缩略图：AuthenticatedImage 带登录身份拉取后渲染为 blob: URL。
  // 注意 dock 内还有生成按钮的 Credits 图标 img，必须用 src 前缀限定缩略图。
  await expect(page.locator(`${IMAGE_DOCK} img[src^="blob:"]`)).toHaveCount(1, {
    timeout: 15_000,
  });
}

async function ensureSettingsOpen(page: Page): Promise<void> {
  if ((await page.locator(POPOVER).count()) === 0) {
    await page.getByRole("button", { name: SETTINGS_TRIGGER }).click();
  }
  await expect(page.locator(POPOVER)).toBeVisible();
}
