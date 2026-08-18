const state = {
  selectedAssets: ["保温杯主图"],
  mode: "video",
  appliedLabel: "生成卡",
};

const conversation = document.querySelector("#conversation");
const referenceRow = document.querySelector("#referenceRow");
const fakeInput = document.querySelector("#fakeInput");
const trackHint = document.querySelector("#trackHint");

const stepHints = {
  input: "用户在 Agent 输入框中带 @素材发出创作需求。",
  intent: "Agent 理解需求类型、素材引用和创作目标，但不直接生成。",
  ask: "信息不足时，Agent 先追问关键缺失信息。",
  summary: "信息充分后，Agent 总结需求理解并等待确认。",
  card: "确认需求理解后，Agent 直接生成分镜提示词生成卡。",
  dock: "用户手动应用生成卡，内容进入 Canvas dock，Agent 侧流程结束。",
};

function message(html, type = "agent") {
  const wrap = document.createElement("article");
  wrap.className = `message ${type}`;
  wrap.innerHTML = type === "user" ? `<div class="bubble">${html}</div>` : html;
  conversation.appendChild(wrap);
}

function thinking(text) {
  return `<div class="thinking"><button>思考过程⌄</button>${text}</div>`;
}

function assetText() {
  if (!state.selectedAssets.length) return "";
  return state.selectedAssets.map((item) => `@${item}`).join("、");
}

function promptPrefix() {
  const refs = assetText();
  return refs ? `参考 ${refs}，` : "";
}

function setTrack(step) {
  document.querySelectorAll(".track-step").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.step === step);
  });
  trackHint.textContent = stepHints[step] || "从素材引用到生成卡应用，逐步确认";
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("[data-flow]").forEach((button) => {
    const active = button.dataset.flow === mode;
    button.classList.toggle("is-active", active);
    button.classList.toggle("primary", active);
  });
  fakeInput.textContent =
    mode === "image"
      ? `${promptPrefix()}帮我生成一张高级干净的保温杯产品图`
      : `${promptPrefix()}帮我生成一个保温杯产品展示视频`;
}

function renderDraft() {
  conversation.innerHTML = "";
  setMode("video");
  setTrack("input");
  sync();
}

function renderIntent() {
  conversation.innerHTML = "";
  setMode("video");
  setTrack("intent");
  message(`${promptPrefix()}帮我生成一个保温杯产品展示视频`, "user");
  message(`
    ${thinking("正在识别任务类型：这是商品展示视频需求，不是立即生成动作。")}
    <p>我会先确认你要做的视频方向和素材使用方式。确认前不会生成分镜提示词生成卡，也不会触发生成。</p>
    <div class="agent-card">
      <h3>我先判断到这些信息</h3>
      <ul>
        <li>创作类型：商品展示视频</li>
        <li>产品对象：保温杯</li>
        <li>已选素材：${assetText() || "还没有选择画布素材"}</li>
        <li>下一步：补齐平台、比例、时长和核心卖点</li>
      </ul>
      <div class="card-actions">
        <button class="primary" data-next="ask">继续，让 Agent 追问</button>
      </div>
    </div>
  `);
  sync();
}

function renderAsk() {
  setTrack("ask");
  message(`
    ${thinking("正在判断信息是否充分。平台、比例、时长和卖点会影响后续分镜提示词。")}
    <p>为了让生成卡更准确，我还需要你补充几个关键信息：</p>
    <div class="agent-card">
      <h3>需要补充</h3>
      <ul>
        <li>投放平台：小红书 / 抖音 / 淘宝 / 京东</li>
        <li>画面比例：9:16 / 1:1 / 16:9</li>
        <li>视频时长：15 秒 / 30 秒</li>
        <li>核心卖点：保温、材质、容量、外观等</li>
        <li>是否使用已选素材：${assetText() || "请先点击画布素材"}</li>
      </ul>
      <div class="card-actions">
        <button class="primary" data-next="summary">补充信息</button>
      </div>
    </div>
  `);
  sync();
}

function renderSummary() {
  setTrack("summary");
  message("投放小红书，9:16，15 秒。风格高级、干净，突出保温杯质感和生活方式。", "user");
  message(`
    ${thinking("正在把用户补充内容整理成需求理解，等待明确确认。")}
    <div class="agent-card understanding-card">
      <h3>需求理解总结</h3>
      <p>做一条 <strong>15 秒小红书竖版保温杯产品展示视频</strong>。整体风格高级、干净、商业产品摄影感，重点突出哑光金属质感、杯盖细节和日常生活场景。</p>
      <ul>
        <li>使用素材：${assetText() || "@保温杯主图、@杯盖材质细节、@生活场景图"}</li>
        <li>输出内容：按时间顺序展示多张分镜提示词生成卡</li>
      </ul>
      <div class="tag-list"><span>小红书</span><span>9:16</span><span>15 秒</span><span>商品广告</span></div>
      <div class="card-actions">
        <button data-next="ask">继续补充</button>
        <button class="primary" data-next="card">确认需求理解，生成分镜提示词卡</button>
      </div>
    </div>
  `);
  sync();
}

function renderGenerationCards() {
  setTrack("card");
  message("确认需求理解，生成分镜提示词卡。", "user");
  message(`
    ${thinking("正在按镜头 1 / 2 / 3 / 4 生成四张独立生成卡，每张卡都可单独手动应用。")}
    <p>我会把这条 15 秒视频拆成 4 个镜头：光影揭幕、材质微距、生活美学和英雄收尾。整体节奏是先建立高端质感，再展示杯盖与材质细节，最后回到生活场景和产品收束。下面每张分镜提示词卡都对应一个镜头，你可以直接说“修改第 2 镜”这类自然语言要求，也可以手动应用某一张卡到 Canvas dock。</p>
    <div class="agent-card generation-card shot-generation-card">
      <h3>镜头 1 · 光影揭幕 · 0-4s</h3>
      <p><strong>画面</strong><br>纯黑背景中侧光扫过，保温杯轮廓逐渐显现。</p>
      <p><strong>提示词</strong><br>哑光深灰不锈钢保温杯，黑色旋盖，纯黑背景，单侧柔光扫过杯身，轮廓从暗部显现，商业产品摄影，9:16，无字幕无水印。</p>
      <div class="card-actions">
        <button data-next="summary">自然语言修改</button>
        <button class="primary" data-next="dock" data-shot="镜头 1 生成卡">手动应用到 Canvas dock</button>
      </div>
    </div>
    <div class="agent-card generation-card shot-generation-card">
      <h3>镜头 2 · 材质微距 · 4-8s</h3>
      <p><strong>画面</strong><br>贴近杯身磨砂金属纹理，焦点转移到杯盖螺纹。</p>
      <p><strong>提示词</strong><br>超微距展示磨砂金属颗粒和杯盖螺纹，浅景深，暖灰虚化背景，镜头缓慢推进，质感清晰稳定。</p>
      <div class="card-actions">
        <button data-next="summary">自然语言修改</button>
        <button class="primary" data-next="dock" data-shot="镜头 2 生成卡">手动应用到 Canvas dock</button>
      </div>
    </div>
    <div class="agent-card generation-card shot-generation-card">
      <h3>镜头 3 · 生活美学 · 8-12s</h3>
      <p><strong>画面</strong><br>大理石桌面、咖啡蒸汽、清晨自然光。</p>
      <p><strong>提示词</strong><br>保温杯放在大理石桌面，旁边有咖啡蒸汽和晨光，干净高级生活方式广告，柔和自然光，画面稳定。</p>
      <div class="card-actions">
        <button data-next="summary">自然语言修改</button>
        <button class="primary" data-next="dock" data-shot="镜头 3 生成卡">手动应用到 Canvas dock</button>
      </div>
    </div>
    <div class="agent-card generation-card shot-generation-card">
      <h3>镜头 4 · 英雄收尾 · 12-15s</h3>
      <p><strong>画面</strong><br>45 度产品特写，浅灰渐变背景，品牌信息预留。</p>
      <p><strong>提示词</strong><br>45 度保温杯英雄特写，浅灰渐变背景，杯身高光清晰，居中构图，商业收尾镜头，预留品牌文字空间。</p>
      <div class="card-actions">
        <button data-next="summary">自然语言修改</button>
        <button class="primary" data-next="dock" data-shot="镜头 4 生成卡">手动应用到 Canvas dock</button>
      </div>
    </div>
  `);
  sync();
}

function renderDockApplied() {
  setTrack("dock");
  message("手动应用到 Canvas dock。", "user");
  message(`
    ${thinking("正在把生成卡内容写入 Canvas dock，不创建生成任务。")}
    <div class="agent-card dock-card">
      <h3>生成卡已应用</h3>
      <p>${state.appliedLabel} 已进入 Canvas dock。</p>
      <div class="dock-preview">
        <span>Canvas dock</span>
        <strong>${state.appliedLabel} 已就绪</strong>
      </div>
    </div>
  `);
  sync();
}

function renderImageFlow() {
  conversation.innerHTML = "";
  setMode("image");
  setTrack("summary");
  message(`${promptPrefix()}帮我生成一张高级干净的保温杯产品图`, "user");
  message(`
    ${thinking("图片需求比较明确，先整理需求理解，等待确认。")}
    <div class="agent-card understanding-card">
      <h3>需求理解总结</h3>
      <p>生成一张高级干净的保温杯产品图，突出哑光深灰杯身、黑色旋盖和商业摄影质感。比例 9:16，使用当前引用素材保持产品外观。</p>
      <div class="tag-list"><span>图片</span><span>9:16</span><span>${assetText() ? "已引用素材" : "未引用素材"}</span></div>
      <div class="card-actions">
        <button>继续补充</button>
        <button class="primary" data-next="imageCard">确认需求理解，生成图片生成卡</button>
      </div>
    </div>
  `);
  sync();
}

function renderImageCard() {
  setTrack("card");
  message("确认需求理解，生成图片生成卡。", "user");
  message(`
    ${thinking("正在把图片需求整理成可手动应用的生成卡。")}
    <div class="agent-card generation-card">
      <h3>图片生成卡 · 保温杯产品图</h3>
      <p><strong>画面意图</strong><br>高端不锈钢保温杯产品摄影，哑光深灰杯身，黑色旋盖，浅灰渐变背景，柔和棚拍灯光。</p>
      <p><strong>生成提示词</strong><br>高端不锈钢保温杯产品摄影，哑光深灰杯身，黑色旋盖，浅灰渐变背景，柔和棚拍灯光，商业广告摄影风格，主体清晰居中，无水印无 Logo。</p>
      <div class="card-actions">
        <button data-next="image">自然语言修改</button>
        <button class="primary" data-next="dock">手动应用到 Canvas dock</button>
      </div>
    </div>
  `);
  sync();
}

function sync() {
  referenceRow.innerHTML = state.selectedAssets.map((item) => `<span>@${item}</span>`).join("");
  conversation.scrollTop = conversation.scrollHeight;
}

document.addEventListener("click", (event) => {
  const asset = event.target.closest(".asset-card");
  if (asset) {
    const name = asset.dataset.asset;
    asset.classList.toggle("selected");
    if (state.selectedAssets.includes(name)) {
      state.selectedAssets = state.selectedAssets.filter((item) => item !== name);
    } else {
      state.selectedAssets.push(name);
    }
    setMode(state.mode);
    sync();
    return;
  }

  const next = event.target.closest("[data-next]");
  if (next) {
    const step = next.dataset.next;
    if (step === "dock") state.appliedLabel = next.dataset.shot || (state.mode === "image" ? "图片生成卡" : "生成卡");
    if (step === "ask") renderAsk();
    if (step === "summary") renderSummary();
    if (step === "card") renderGenerationCards();
    if (step === "dock") renderDockApplied();
    if (step === "image") renderImageFlow();
    if (step === "imageCard") renderImageCard();
    return;
  }

  const action = event.target.closest("[data-action]");
  if (action) {
    if (action.dataset.action === "video") renderIntent();
    if (action.dataset.action === "image") renderImageFlow();
    if (action.dataset.action === "reset") {
      state.selectedAssets = ["保温杯主图"];
      document.querySelectorAll(".asset-card").forEach((card) => {
        card.classList.toggle("selected", card.dataset.asset === "保温杯主图");
      });
      renderDraft();
    }
  }
});

document.querySelector("#sendButton").addEventListener("click", () => {
  if (state.mode === "image") renderImageFlow();
  else renderIntent();
});

renderDraft();
