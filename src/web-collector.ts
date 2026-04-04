/**
 * web-collector.ts - 网络素材采集器
 *
 * 自动从网上搜索并提取写作素材：
 *   - 经典古言作品赏析 & 名场面分析
 *   - 写作技巧文章（伏笔、节奏、人物塑造）
 *   - 情节设定参考（双强、互虐、HE 模式）
 *   - 高热度小说的标签 & 结构分析
 *
 * 无需 API Key，使用 DuckDuckGo HTML 搜索
 *
 * 用法：
 *   npx tsx src/web-collector.ts                 # 执行全部内置搜索策略
 *   npx tsx src/web-collector.ts --url <URL>     # 抓取指定网页
 *   npx tsx src/web-collector.ts --query "关键词"  # 自定义搜索
 *   npx tsx src/web-collector.ts --force          # 忽略去重，强制重新采集
 */

import fs from "fs/promises";
import path from "path";
import * as dotenv from "dotenv";
import {
  addEntries, hasSource, removeBySource,
  printKnowledgeStats, type KnowledgeEntry,
} from "./knowledge-base.js";
import { endpoints } from "./models.js";

dotenv.config();

// ── HTML 文本提取 ─────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    // 移除 script / style 标签及其内容
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    // 替换 br / p / div / li 为换行
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|tr|blockquote)[^>]*>/gi, "\n")
    // 移除所有其他标签
    .replace(/<[^>]+>/g, "")
    // 解码 HTML 实体
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    // 清理多余空白
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── 网页抓取 ──────────────────────────────────────────────

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url: string): Promise<string> {
  const html = await fetchPage(url);
  const text = stripHtml(html);
  // 截断过长的页面（只取前 8000 字）
  return text.length > 8000 ? text.slice(0, 8000) + "\n...[内容截断]" : text;
}

// ── DuckDuckGo 搜索 ──────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  const html = await fetchPage(url);
  const results: SearchResult[] = [];

  // 提取搜索结果（DuckDuckGo HTML 版本的结构）
  const resultBlocks = html.match(/<a class="result__a"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a class="result__snippet"[^>]*>[\s\S]*?<\/a>/gi) || [];

  for (const block of resultBlocks) {
    if (results.length >= maxResults) break;

    const titleMatch = block.match(/<a class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

    if (titleMatch) {
      let resultUrl = titleMatch[1];
      // DuckDuckGo 有时会包装 URL
      const uddg = resultUrl.match(/uddg=([^&]*)/);
      if (uddg) resultUrl = decodeURIComponent(uddg[1]);

      results.push({
        title: stripHtml(titleMatch[2]).trim(),
        url: resultUrl,
        snippet: snippetMatch ? stripHtml(snippetMatch[1]).trim() : "",
      });
    }
  }

  // 备用：更宽松的匹配
  if (results.length === 0) {
    const links = html.match(/<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi) || [];
    for (const link of links) {
      if (results.length >= maxResults) break;
      const m = link.match(/href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (m) {
        let resultUrl = m[1];
        const uddg = resultUrl.match(/uddg=([^&]*)/);
        if (uddg) resultUrl = decodeURIComponent(uddg[1]);
        if (resultUrl.startsWith("http")) {
          results.push({ title: stripHtml(m[2]).trim(), url: resultUrl, snippet: "" });
        }
      }
    }
  }

  return results;
}

// ── LLM 分析网页内容 ─────────────────────────────────────

interface WebAnalysis {
  examples: { text: string; tags: string[]; note: string }[];
  techniques: { name: string; description: string; tags: string[]; example: string }[];
  plot_patterns: { name: string; description: string; tags: string[] }[];
}

async function analyzeWebContent(
  pageText: string,
  sourceUrl: string,
  sourceTitle: string,
): Promise<WebAnalysis> {
  const { client, model } = endpoints.review;

  const response = await client.messages.create({
    model,
    max_tokens: 3000,
    messages: [{
      role: "user",
      content: `你是一位古言言情小说写作顾问。请从以下网页内容中提取对古言言情创作有价值的素材。

## 来源
标题：${sourceTitle}
URL：${sourceUrl}

## 网页内容
${pageText}

## 请提取以下内容，以 JSON 格式返回：

{
  "examples": [
    {
      "text": "值得借鉴的原文片段或佳句（50-200字）",
      "tags": ["标签1", "标签2"],
      "note": "为什么值得借鉴（30字以内）"
    }
  ],
  "techniques": [
    {
      "name": "手法/技巧名称",
      "description": "说明和适用场景（80字以内）",
      "tags": ["适用标签"],
      "example": "文中的具体例子"
    }
  ],
  "plot_patterns": [
    {
      "name": "情节模式名称（如：误会-冲突-真相-和解）",
      "description": "模式说明及变体（100字以内）",
      "tags": ["适用标签"]
    }
  ]
}

## 标签体系：
- 情感类：对话火花、氛围描写、情感爆发、克制暗涌、心理独白、信息差张力、互虐、甜宠
- 场景类：开篇入戏、场景过渡、宴饮社交、独处反思、生离死别、重逢
- 技巧类：伏笔埋设、反转铺垫、节奏控制、人物塑造、感官细节、环境隐喻
- 结构类：双强设定、身份对立、先虐后甜、分离重逢、棋逢对手、暗线明线

## 要求：
- 只提取真正有价值的内容，不要凑数。无价值则返回空数组
- 如果是小说赏析文章，重点提取分析者的洞见和具体例证
- 如果是写作技巧文章，重点提取可操作的方法论
- 如果是小说正文或节选，提取佳段
- 只返回 JSON，不要其他文字`,
    }],
  });

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { examples: [], techniques: [], plot_patterns: [] };

  try {
    return JSON.parse(jsonMatch[0]) as WebAnalysis;
  } catch {
    console.warn("  [警告] JSON 解析失败，跳过");
    return { examples: [], techniques: [], plot_patterns: [] };
  }
}

// ── 内置搜索策略 ─────────────────────────────────────────

interface SearchStrategy {
  name: string;
  queries: string[];
}

const BUILTIN_STRATEGIES: SearchStrategy[] = [
  {
    name: "经典古言赏析",
    queries: [
      "古言小说经典名场面赏析 写作手法",
      "古言言情小说 文笔好 段落赏析",
      "知乎 古言小说推荐 文笔 写作技巧分析",
    ],
  },
  {
    name: "写作技巧",
    queries: [
      "小说写作 对话技巧 如何写好人物对话",
      "小说伏笔设计 技巧方法 实例",
      "古言小说 场景描写技巧 环境烘托情绪",
      "小说情感节奏控制 张弛有度 写作方法",
    ],
  },
  {
    name: "情节与人设",
    queries: [
      "古言小说 双强设定 经典情节",
      "言情小说 互虐 经典桥段设计 信息差",
      "小说人物塑造 性格反差 立体人物 方法",
      "古言小说 分离重逢 经典结构",
    ],
  },
  {
    name: "热门作品分析",
    queries: [
      "2024 2025 高分古言小说 写作特点分析",
      "晋江古言 神作 文笔分析 写法",
    ],
  },
];

// ── 单页采集流程 ─────────────────────────────────────────

async function collectFromUrl(
  url: string,
  title: string,
  force: boolean,
): Promise<number> {
  const sourceKey = `网络采集: ${url}`;

  if (await hasSource(sourceKey)) {
    if (!force) {
      console.log(`  [跳过] 已采集过: ${title}`);
      return 0;
    }
    await removeBySource(sourceKey);
  }

  let pageText: string;
  try {
    pageText = await fetchText(url);
  } catch (err) {
    console.log(`  [失败] 无法访问: ${(err as Error).message}`);
    return 0;
  }

  if (pageText.length < 200) {
    console.log("  [跳过] 内容过少");
    return 0;
  }

  const analysis = await analyzeWebContent(pageText, url, title);

  const entries: Omit<KnowledgeEntry, "id" | "createdAt">[] = [
    ...analysis.examples.map((e) => ({
      type: "example" as const,
      tags: e.tags,
      source: sourceKey,
      content: e.text,
      note: e.note,
    })),
    ...analysis.techniques.map((t) => ({
      type: "technique" as const,
      tags: t.tags,
      source: sourceKey,
      content: `**${t.name}**：${t.description}`,
      note: t.example,
    })),
    ...analysis.plot_patterns.map((p) => ({
      type: "technique" as const,
      tags: p.tags,
      source: sourceKey,
      content: `**情节模式 · ${p.name}**：${p.description}`,
    })),
  ];

  if (entries.length === 0) {
    console.log("  [跳过] 未提取到有价值的素材");
    return 0;
  }

  await addEntries(entries);
  return entries.length;
}

// ── 搜索策略执行 ─────────────────────────────────────────

async function executeStrategy(strategy: SearchStrategy, force: boolean): Promise<number> {
  console.log(`\n── 策略：${strategy.name} ──────────────────────────`);
  let totalEntries = 0;

  for (const query of strategy.queries) {
    console.log(`\n  [搜索] ${query}`);
    let results: SearchResult[];
    try {
      results = await webSearch(query, 3);
    } catch (err) {
      console.log(`  [失败] 搜索出错: ${(err as Error).message}`);
      continue;
    }

    if (results.length === 0) {
      console.log("  [搜索] 无结果");
      continue;
    }

    console.log(`  [搜索] ${results.length} 个结果`);

    for (const result of results) {
      process.stdout.write(`  [采集] ${result.title.slice(0, 40)}... `);
      const count = await collectFromUrl(result.url, result.title, force);
      if (count > 0) {
        console.log(`✓ ${count} 条素材`);
        totalEntries += count;
      }
    }
  }

  return totalEntries;
}

// ── CLI 入口 ──────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const urlIdx = args.indexOf("--url");
  const queryIdx = args.indexOf("--query");

  console.log("\n── 网络素材采集器 ──────────────────────────────────");

  if (urlIdx >= 0 && args[urlIdx + 1]) {
    // 指定 URL 模式
    const url = args[urlIdx + 1];
    console.log(`[模式] 指定 URL 采集`);
    process.stdout.write(`[采集] ${url} ... `);
    const count = await collectFromUrl(url, url, force);
    console.log(count > 0 ? `✓ ${count} 条素材` : "");
  } else if (queryIdx >= 0 && args[queryIdx + 1]) {
    // 自定义搜索模式
    const query = args[queryIdx + 1];
    console.log(`[模式] 自定义搜索: ${query}`);
    const strategy: SearchStrategy = { name: "自定义搜索", queries: [query] };
    await executeStrategy(strategy, force);
  } else {
    // 执行全部内置策略
    console.log(`[模式] 全部内置策略（${BUILTIN_STRATEGIES.length} 个）`);
    if (force) console.log("[--force] 忽略去重，强制重新采集");

    let total = 0;
    for (const strategy of BUILTIN_STRATEGIES) {
      total += await executeStrategy(strategy, force);
    }
    console.log(`\n── 采集完成，共获取 ${total} 条新素材 ────────────`);
  }

  await printKnowledgeStats();
}

const isMain = process.argv[1]?.includes("web-collector");
if (isMain) {
  main().catch(console.error);
}
