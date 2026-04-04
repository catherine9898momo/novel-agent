/**
 * inspect.ts - 知识库检视工具
 *
 * 浏览、过滤、评估、清理知识库素材
 *
 * 用法：
 *   npx tsx src/inspect.ts                    # 总览 + 按来源分组统计
 *   npx tsx src/inspect.ts --tag 对话火花      # 按标签筛选
 *   npx tsx src/inspect.ts --type example     # 按类型筛选
 *   npx tsx src/inspect.ts --source 长公主     # 按来源筛选
 *   npx tsx src/inspect.ts --full             # 显示完整内容（默认截断）
 *   npx tsx src/inspect.ts --delete <id>      # 删除指定素材
 *   npx tsx src/inspect.ts --audit            # LLM 自动评估素材质量
 */

import {
  loadIndex, saveIndex, getAllTags, getByType, getBySource,
  searchByTags, type KnowledgeEntry, type KnowledgeIndex,
} from "./knowledge-base.js";

// ── 格式化输出 ────────────────────────────────────────────

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

function printEntry(entry: KnowledgeEntry, full: boolean): void {
  const typeIcon = entry.type === "example" ? "📝" : entry.type === "technique" ? "🔧" : "💡";
  const content = full ? entry.content : truncate(entry.content.replace(/\n/g, " "), 80);

  console.log(`  ${typeIcon} ${c("cyan", entry.id)}`);
  console.log(`     ${c("bold", content)}`);
  if (entry.note) {
    console.log(`     ${c("dim", `笔法: ${full ? entry.note : truncate(entry.note, 60)}`)}`);
  }
  console.log(`     ${c("yellow", entry.tags.join(" · "))}  ${c("dim", `← ${truncate(entry.source, 40)}`)}`);
  console.log();
}

// ── 总览 ──────────────────────────────────────────────────

async function showOverview(): Promise<void> {
  const index = await loadIndex();
  const total = index.entries.length;

  if (total === 0) {
    console.log("\n知识库为空。运行以下命令填充素材：");
    console.log("  npm run analyze   — 分析本地参考作品");
    console.log("  npm run collect   — 网络采集写作素材\n");
    return;
  }

  // 按类型统计
  const byType: Record<string, number> = {};
  for (const e of index.entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  // 按来源统计
  const bySource: Record<string, number> = {};
  for (const e of index.entries) {
    // 简化来源显示
    const short = e.source.replace(/（.*）/, "").replace(/网络采集: https?:\/\/[^/]+/, (m) => m.split("/").slice(0, 3).join("/"));
    bySource[short] = (bySource[short] || 0) + 1;
  }

  // 标签 Top 10
  const tags = await getAllTags();
  const topTags = Object.entries(tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log(`\n${c("bold", "── 知识库总览 ──────────────────────────────────")}`);
  console.log(`总计: ${c("green", String(total))} 条素材\n`);

  console.log(c("bold", "按类型:"));
  if (byType["example"]) console.log(`  📝 佳段示例:  ${byType["example"]} 条`);
  if (byType["technique"]) console.log(`  🔧 写作手法:  ${byType["technique"]} 条`);
  if (byType["preference"]) console.log(`  💡 用户偏好:  ${byType["preference"]} 条`);

  console.log(`\n${c("bold", "按来源:")}`);
  for (const [source, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(3)} 条  ← ${source}`);
  }

  console.log(`\n${c("bold", "热门标签 Top 10:")}`);
  for (const [tag, count] of topTags) {
    const bar = "█".repeat(Math.min(count, 20));
    console.log(`  ${tag.padEnd(10)} ${c("cyan", bar)} ${count}`);
  }
  console.log();
}

// ── 筛选浏览 ──────────────────────────────────────────────

async function showFiltered(
  filter: { tag?: string; type?: string; source?: string },
  full: boolean,
): Promise<void> {
  const index = await loadIndex();
  let results = index.entries;

  if (filter.tag) {
    results = results.filter((e) => e.tags.some((t) => t.includes(filter.tag!)));
  }
  if (filter.type) {
    results = results.filter((e) => e.type === filter.type);
  }
  if (filter.source) {
    results = results.filter((e) => e.source.includes(filter.source!));
  }

  const filterDesc = Object.entries(filter)
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  console.log(`\n${c("bold", `── 筛选结果: ${filterDesc} ──`)}`);
  console.log(`匹配: ${c("green", String(results.length))} 条\n`);

  if (results.length === 0) {
    console.log("无匹配素材。\n");
    return;
  }

  for (const entry of results) {
    printEntry(entry, full);
  }
}

// ── 删除素材 ──────────────────────────────────────────────

async function deleteEntry(id: string): Promise<void> {
  const index = await loadIndex();
  const before = index.entries.length;
  const target = index.entries.find((e) => e.id === id);

  if (!target) {
    console.log(`\n${c("red", `未找到 ID: ${id}`)}`);
    console.log("提示: 用 npx tsx src/inspect.ts 查看所有素材 ID\n");
    return;
  }

  console.log(`\n将删除:`);
  printEntry(target, true);

  index.entries = index.entries.filter((e) => e.id !== id);
  await saveIndex(index);
  console.log(`${c("green", "✓")} 已删除 (${before} → ${index.entries.length})\n`);
}

// ── LLM 质量审计 ──────────────────────────────────────────

async function auditQuality(): Promise<void> {
  const { endpoints } = await import("./models.js");
  const index = await loadIndex();

  if (index.entries.length === 0) {
    console.log("\n知识库为空，无需审计。\n");
    return;
  }

  console.log(`\n${c("bold", "── 素材质量审计 ──────────────────────────────────")}`);
  console.log(`审计 ${index.entries.length} 条素材...\n`);

  // 将所有素材序列化给 LLM 评估
  const serialized = index.entries.map((e, i) => {
    return `[${i + 1}] ID: ${e.id} | 类型: ${e.type} | 标签: ${e.tags.join(",")}\n内容: ${truncate(e.content, 150)}\n来源: ${e.source}`;
  }).join("\n---\n");

  const { client, model } = endpoints.review;
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `你是一位古言言情小说写作素材库的质量审计员。以下是知识库中的全部素材，请评估质量并给出建议。

## 素材列表
${serialized}

## 请用以下 JSON 格式返回审计结果：
{
  "overall_score": "A/B/C/D（A=优秀 B=良好 C=一般 D=需整理）",
  "summary": "整体评价（50字以内）",
  "high_quality": ["高质量素材的ID列表"],
  "low_quality": [
    { "id": "建议删除或修改的素材ID", "reason": "原因" }
  ],
  "missing_topics": ["知识库中缺失但对古言创作很重要的主题"],
  "tag_suggestions": ["建议新增的标签"]
}

## 评判标准：
- 佳段示例：是否真正优秀、有借鉴价值，还是平庸凑数？
- 写作手法：是否可操作、有具体例证，还是空泛废话？
- 标签：是否准确反映内容？
- 多样性：标签/来源是否过于集中？
- 只返回 JSON`,
    }],
  });

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log("审计结果解析失败。原始输出：");
    console.log(raw);
    return;
  }

  try {
    const audit = JSON.parse(jsonMatch[0]) as {
      overall_score: string;
      summary: string;
      high_quality: string[];
      low_quality: { id: string; reason: string }[];
      missing_topics: string[];
      tag_suggestions: string[];
    };

    const scoreColor = audit.overall_score === "A" ? "green"
      : audit.overall_score === "B" ? "cyan"
      : audit.overall_score === "C" ? "yellow" : "red";

    console.log(`整体评级: ${c(scoreColor, audit.overall_score)}`);
    console.log(`评价: ${audit.summary}\n`);

    if (audit.high_quality.length > 0) {
      console.log(c("green", `✓ 高质量素材 (${audit.high_quality.length} 条):`));
      for (const id of audit.high_quality) {
        const e = index.entries.find((e) => e.id === id);
        if (e) console.log(`  ${id}: ${truncate(e.content, 50)}`);
      }
      console.log();
    }

    if (audit.low_quality.length > 0) {
      console.log(c("red", `✗ 建议改进 (${audit.low_quality.length} 条):`));
      for (const item of audit.low_quality) {
        console.log(`  ${item.id}: ${item.reason}`);
      }
      console.log(`\n  删除命令: npx tsx src/inspect.ts --delete <ID>`);
      console.log();
    }

    if (audit.missing_topics.length > 0) {
      console.log(c("yellow", "⚠ 缺失主题（建议补充）:"));
      for (const topic of audit.missing_topics) {
        console.log(`  - ${topic}`);
      }
      console.log(`\n  补充命令: npm run collect -- --query "古言 ${audit.missing_topics[0]}"`);
      console.log();
    }

    if (audit.tag_suggestions.length > 0) {
      console.log(c("magenta", "💡 建议新增标签:"));
      console.log(`  ${audit.tag_suggestions.join("、")}\n`);
    }
  } catch {
    console.log("审计 JSON 解析失败。原始输出：");
    console.log(raw);
  }
}

// ── CLI ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : undefined;
  const type = args.includes("--type") ? args[args.indexOf("--type") + 1] : undefined;
  const source = args.includes("--source") ? args[args.indexOf("--source") + 1] : undefined;
  const full = args.includes("--full");
  const deleteId = args.includes("--delete") ? args[args.indexOf("--delete") + 1] : undefined;
  const audit = args.includes("--audit");

  if (deleteId) {
    await deleteEntry(deleteId);
  } else if (audit) {
    await auditQuality();
  } else if (tag || type || source) {
    await showFiltered({ tag, type, source }, full);
  } else {
    await showOverview();
    // 无参数时也显示全部素材（截断模式）
    const index = await loadIndex();
    if (index.entries.length > 0) {
      console.log(c("bold", "── 全部素材 ──────────────────────────────────\n"));
      for (const entry of index.entries) {
        printEntry(entry, full);
      }
      console.log(c("dim", "提示: 加 --full 查看完整内容 | --audit 让 LLM 评估质量\n"));
    }
  }
}

const isMain = process.argv[1]?.includes("inspect");
if (isMain) {
  main().catch(console.error);
}
