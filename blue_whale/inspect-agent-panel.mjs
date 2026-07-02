import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3000/canvas?prompt=生成一个小猫");
  await page.waitForSelector(".tc-agent-chat-panel", { timeout: 10000 });
  await page.waitForTimeout(800);

  const styles = await page.evaluate(() => {
    const cs = (el) => (el ? window.getComputedStyle(el) : null);
    const obj = (el, extras = []) => {
      const s = cs(el);
      if (!s) return null;
      const out = {
        tag: el.tagName,
        className: el.className,
        width: s.width,
        height: s.height,
        top: s.top,
        right: s.right,
        bottom: s.bottom,
        left: s.left,
        position: s.position,
        display: s.display,
        flexDirection: s.flexDirection,
        background: s.background,
        backgroundColor: s.backgroundColor,
        backdropFilter: s.backdropFilter,
        boxShadow: s.boxShadow,
        borderRadius: s.borderRadius,
        clipPath: s.clipPath,
        overflow: s.overflow,
        overflowX: s.overflowX,
        overflowY: s.overflowY,
        zIndex: s.zIndex,
        border: s.border,
        margin: s.margin,
        padding: s.padding,
      };
      for (const k of extras) out[k] = s[k];
      return out;
    };

    const dropByClass = document.querySelector(".tc-agent-composer-drop-target");
    const dropByData = document.querySelector("[data-canvas-reference-drop-target='agent-chat']");
    const shell = document.querySelector(".tc-agent-panel-shell");
    const shellSvg = shell?.querySelector("svg");
    const shellClipPath = shell?.querySelector("clipPath path");

    return {
      dropByClass: obj(dropByClass),
      dropByClassAttrs: dropByClass ? Object.fromEntries([...dropByClass.attributes].map((a) => [a.name, a.value])) : null,
      dropByData: obj(dropByData),
      composerOuter: obj(document.querySelector(".tc-agent-composer-outer")),
      shell: obj(shell),
      shellSvg: obj(shellSvg),
      shellClipPath: shellClipPath ? shellClipPath.getAttribute("d") : null,
    };
  });

  console.log(JSON.stringify(styles, null, 2));
  await browser.close();
})();
