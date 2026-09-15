import { describe, expect, it } from "vitest";
import {
  htmlToMarkdown,
  markdownToSanitizedHtml,
  renderMarkdownInline,
  unifiedTextNodeText,
  TEXT_NODE_MARKDOWN_FORMATS,
} from "./text-node-markdown.js";

/* IKFM3L 统一文本卡正文契约 v1：受限 Markdown 子集（八类）与 html 升级互转。
   契约：docs/specs/2026-09-14-ikfm3l-unified-text-node-content-contract.md */

describe("markdownToSanitizedHtml（渲染方向）", () => {
  it("八类格式各自渲染白名单标签", () => {
    expect(markdownToSanitizedHtml("# 标题一")).toContain("<h1>标题一</h1>");
    expect(markdownToSanitizedHtml("## 标题二")).toContain("<h2>标题二</h2>");
    expect(markdownToSanitizedHtml("### 标题三")).toContain("<h3>标题三</h3>");
    expect(markdownToSanitizedHtml("普通正文")).toContain("<p>普通正文</p>");
    expect(markdownToSanitizedHtml("**粗体**")).toContain("<strong>粗体</strong>");
    expect(markdownToSanitizedHtml("*斜体*")).toContain("<em>斜体</em>");
    expect(markdownToSanitizedHtml("- 甲\n- 乙")).toContain("<ul><li>甲</li><li>乙</li></ul>");
    expect(markdownToSanitizedHtml("1. 一\n2. 二")).toContain("<ol><li>一</li><li>二</li></ol>");
    expect(markdownToSanitizedHtml("---")).toContain("<hr>");
  });

  it("多块之间空行分隔，软换行渲染为 br", () => {
    expect(markdownToSanitizedHtml("# 题\n\n第一段")).toContain("<h1>题</h1><p>第一段</p>");
    expect(markdownToSanitizedHtml("第一行\n第二行")).toContain("<p>第一行<br>第二行</p>");
  });

  it("段落 空行 段落 分为两个块（空行终结段落）", () => {
    expect(markdownToSanitizedHtml("第一段\n\n第二段")).toContain("<p>第一段</p><p>第二段</p>");
    expect(markdownToSanitizedHtml("第一段\n\n第二段")).not.toContain("第一段<br>");
    // 段落 空行 标题 空行 段落
    expect(markdownToSanitizedHtml("甲\n\n# 题\n\n乙")).toContain("<p>甲</p><h1>题</h1><p>乙</p>");
  });

  it("行内混合格式嵌套渲染", () => {
    expect(markdownToSanitizedHtml("**粗中*斜*粗**")).toContain("<strong>粗中<em>斜</em>粗</strong>");
  });

  it("子集外语法按字面文本对待并转义 HTML", () => {
    const out = markdownToSanitizedHtml("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(markdownToSanitizedHtml("[链接](https://x)")).toContain("<p>[链接](https://x)</p>");
  });

  it("输出只含白名单标签", () => {
    const out = markdownToSanitizedHtml("# 题\n\n正文 **b** *i*\n\n- 项\n\n---");
    const stripped = out.replace(/<\/?(h1|h2|h3|p|strong|em|ul|ol|li|hr|br)(\s[^>]*)?\/?>/g, "");
    expect(stripped.match(/<[^>]+>/g) ?? []).toEqual([]);
  });

  it("空字符串返回空字符串", () => {
    expect(markdownToSanitizedHtml("")).toBe("");
  });
});

describe("htmlToMarkdown（升级方向）", () => {
  it("白名单 HTML 转回 Markdown 源", () => {
    expect(htmlToMarkdown("<h1>标题一</h1><p>正文</p>")).toBe("# 标题一\n\n正文");
    expect(htmlToMarkdown("<h2>题</h2>")).toBe("## 题");
    expect(htmlToMarkdown("<h3>题</h3>")).toBe("### 题");
    expect(htmlToMarkdown("<p><b>粗</b>与<strong>粗2</strong></p>")).toBe("**粗**与**粗2**");
    expect(htmlToMarkdown("<p><i>斜</i>与<em>斜2</em></p>")).toBe("*斜*与*斜2*");
    expect(htmlToMarkdown("<ul><li>甲</li><li>乙</li></ul>")).toBe("- 甲\n- 乙");
    expect(htmlToMarkdown("<ol><li>一</li><li>二</li></ol>")).toBe("1. 一\n2. 二");
    expect(htmlToMarkdown("<hr>")).toBe("---");
    expect(htmlToMarkdown("<hr/>")).toBe("---");
  });

  it("br 与多段落边界", () => {
    expect(htmlToMarkdown("<p>甲<br>乙</p>")).toBe("甲\n乙");
    expect(htmlToMarkdown("<p>第一段</p><p>第二段</p>")).toBe("第一段\n\n第二段");
    expect(htmlToMarkdown("<div>块一</div><div>块二</div>")).toBe("块一\n\n块二");
  });

  it("列表项内行内格式保留", () => {
    expect(htmlToMarkdown("<ul><li>含<b>粗</b>项</li></ul>")).toBe("- 含**粗**项");
  });

  it("白名单外标签剥离但保留文本，颜色样式降级", () => {
    expect(htmlToMarkdown('<p><span style="color:red">红字</span>正常</p>')).toBe("红字正常");
    expect(htmlToMarkdown("<p><font size=\"5\">大字</font></p>")).toBe("大字");
    expect(htmlToMarkdown("<p><u>下划线</u></p>")).toBe("下划线");
  });

  it("script/style 整体丢弃", () => {
    expect(htmlToMarkdown("<p>前</p><script>alert(1)</script><p>后</p>")).toBe("前\n\n后");
    expect(htmlToMarkdown("<p>前<style>p{}</style>后</p>")).toBe("前后");
  });

  it("HTML 实体解码", () => {
    expect(htmlToMarkdown("<p>a &amp; b &lt; c</p>")).toBe("a & b < c");
    expect(htmlToMarkdown("<p>&#20013;&#25991;</p>")).toBe("中文");
  });

  it("行内格式跨段落互不泄漏", () => {
    expect(htmlToMarkdown("<p><b>粗</b></p><p>普通</p>")).toBe("**粗**\n\n普通");
  });

  it("空与纯文本原样返回", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("<p>纯文本</p>")).toBe("纯文本");
  });
});

describe("互转幂等（契约第 6 节）", () => {
  it("markdown → html → markdown 往返不变（v1 子集）", () => {
    const cases = [
      "# 标题\n\n正文 **粗** *斜*\n\n- 项一\n- 项二\n\n1. 一\n2. 二\n\n---",
      "单段",
      "**整段粗**",
      "第一行\n第二行",
    ];
    for (const md of cases) {
      expect(htmlToMarkdown(markdownToSanitizedHtml(md))).toBe(md);
    }
  });
});

describe("renderMarkdownInline（行内片段）", () => {
  it("只渲染行内格式与转义，不产生块级标签", () => {
    expect(renderMarkdownInline("**粗** *斜*")).toBe("<strong>粗</strong> <em>斜</em>");
    expect(renderMarkdownInline("a < b")).toBe("a &lt; b");
  });
});

describe("TEXT_NODE_MARKDOWN_FORMATS", () => {
  it("声明八类能力", () => {
    expect(TEXT_NODE_MARKDOWN_FORMATS).toHaveLength(8);
  });
});

describe("unifiedTextNodeText（契约 §5 升级入口）", () => {
  it("text 优先原样返回（Markdown 源权威）", () => {
    expect(unifiedTextNodeText({ text: "# 源", html: "<h1>旧</h1>" })).toBe("# 源");
  });
  it("无 text 时 html 升级为 Markdown 源", () => {
    expect(unifiedTextNodeText({ html: "<p>旧<b>粗</b></p>" })).toBe("旧**粗**");
  });
  it("均无返回空串", () => {
    expect(unifiedTextNodeText({})).toBe("");
  });
});

describe("嵌套行内格式（Spec 审查修复）", () => {
  it("粗嵌斜输出 ***x*** 而非星号噪声", () => {
    expect(htmlToMarkdown("<p><b><i>x</i></b></p>")).toBe("***x***");
  });
});
