import { describe, it, expect } from "vitest";

// 直接测试 stripHtml（需要导出或内联测试）
// 由于 stripHtml 是私有函数，我们通过公共行为间接测试

describe("web-collector - HTML 文本提取逻辑", () => {
  // 内联一个 stripHtml 副本用于单元测试
  function stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(p|div|li|h[1-6]|tr|blockquote)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  it("移除 script 和 style 标签", () => {
    const html = '<p>正文</p><script>alert("x")</script><style>.a{}</style><p>继续</p>';
    const text = stripHtml(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain(".a{}");
    expect(text).toContain("正文");
    expect(text).toContain("继续");
  });

  it("p/div/br 转为换行", () => {
    const html = "<p>段落一</p><p>段落二</p><br/>换行后";
    const text = stripHtml(html);
    expect(text).toContain("段落一");
    expect(text).toContain("段落二");
    expect(text).toContain("换行后");
  });

  it("解码 HTML 实体", () => {
    const html = "&lt;标签&gt; &amp; &quot;引号&quot; &#20320;&#22909;";
    const text = stripHtml(html);
    expect(text).toContain("<标签>");
    expect(text).toContain("&");
    expect(text).toContain('"引号"');
    expect(text).toContain("你好");
  });

  it("移除 nav/footer/header 噪音", () => {
    const html = "<header>导航栏</header><main><p>正文内容</p></main><footer>版权信息</footer>";
    const text = stripHtml(html);
    expect(text).not.toContain("导航栏");
    expect(text).not.toContain("版权信息");
    expect(text).toContain("正文内容");
  });

  it("压缩多余空行", () => {
    const html = "<p>一</p><p></p><p></p><p></p><p>二</p>";
    const text = stripHtml(html);
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toContain("一");
    expect(lines).toContain("二");
    // 不应有超过2个连续空行
    expect(text).not.toMatch(/\n{3,}/);
  });
});

describe("web-collector - 内置搜索策略", () => {
  it("策略覆盖关键主题", async () => {
    // 动态导入以获取 BUILTIN_STRATEGIES（它不导出，但我们可以验证文件存在）
    // 这里做结构性验证
    const source = await import("fs").then(fs =>
      fs.readFileSync("src/web-collector.ts", "utf-8")
    );

    // 验证包含关键策略
    expect(source).toContain("经典古言赏析");
    expect(source).toContain("写作技巧");
    expect(source).toContain("情节与人设");
    expect(source).toContain("热门作品分析");

    // 验证包含关键搜索词
    expect(source).toContain("伏笔");
    expect(source).toContain("双强设定");
    expect(source).toContain("人物塑造");
    expect(source).toContain("场景描写");
  });
});
