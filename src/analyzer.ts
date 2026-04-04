/**
 * analyzer.ts - 参考作品分析器
 *
 * 读取 downloads/ 下的 txt 文件，分块用 LLM 提取：
 *   - 佳段（标注标签）
 *   - 写作手法/措辞技巧
 *   - 风格特征
 *
 * 分析结果存入 skills/_index.json 知识库
 *
 * 用法：npx tsx src/analyzer.ts [文件路径]
 */

import fs from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { addEntries, printKnowledgeStats, hasSource, removeBySource, type KnowledgeEntry } from "./knowledge-base.js";
import { endpoints } from "./models.js";

dotenv.config();

// ── 文件读取（支持 UTF-8 / UTF-16LE）─────────────────────

async function readTextFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  // 检测 BOM：UTF-16 LE = FF FE
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString("utf16le").replace(/^\ufeff/, "");
  }
  // UTF-16 BE = FE FF
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // Node 不直接支持 utf16be，手动 swap bytes
    for (let i = 0; i < buf.length - 1; i += 2) {
      const tmp = buf[i];
      buf[i] = buf[i + 1];
      buf[i + 1] = tmp;
    }
    return buf.toString("utf16le").replace(/^\ufeff/, "");
  }
  // 默认 UTF-8
  return buf.toString("utf-8").replace(/^\ufeff/, "");
}

// ── 文本分块 ──────────────────────────────────────────────

interface TextChunk {
  index: number;
  position: string; // "开篇" | "前期" | "中期" | "后期" | "结尾"
  text: string;
}

/**
 * 智能采样：不分析全文，选取关键位置的片段
 * 开篇 + 前期2段 + 中期2段 + 后期2段 + 结尾 = 8 个采样点
 */
export function sampleChunks(fullText: string, chunkSize = 4000): TextChunk[] {
  // 去掉简介/作者信息等元数据（通常在前几百字）
  const lines = fullText.split(/\r?\n/);
  let bodyStart = 0;
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (lines[i].match(/第.{1,4}[章回节]/) || lines[i].match(/^\d+[、.．]/)) {
      bodyStart = i;
      break;
    }
  }
  const body = lines.slice(bodyStart).join("\n");
  const totalLen = body.length;

  if (totalLen < chunkSize * 3) {
    // 短文本，直接返回全文分 2-3 块
    const chunks: TextChunk[] = [];
    for (let i = 0; i < body.length; i += chunkSize) {
      chunks.push({
        index: chunks.length,
        position: i === 0 ? "开篇" : i + chunkSize >= body.length ? "结尾" : "中期",
        text: body.slice(i, i + chunkSize),
      });
    }
    return chunks;
  }

  // 采样位置（百分比）
  const samplePoints = [
    { pct: 0, position: "开篇" as const },
    { pct: 0.1, position: "前期" as const },
    { pct: 0.2, position: "前期" as const },
    { pct: 0.4, position: "中期" as const },
    { pct: 0.55, position: "中期" as const },
    { pct: 0.7, position: "后期" as const },
    { pct: 0.85, position: "后期" as const },
    { pct: 0.95, position: "结尾" as const },
  ];

  return samplePoints.map((sp, idx) => {
    const start = Math.floor(totalLen * sp.pct);
    // 找到最近的换行符作为起点，避免截断段落
    const adjustedStart = body.indexOf("\n", start);
    const finalStart = adjustedStart > 0 && adjustedStart - start < 200 ? adjustedStart : start;
    return {
      index: idx,
      position: sp.position,
      text: body.slice(finalStart, finalStart + chunkSize),
    };
  });
}

// ── LLM 分析单个片段 ─────────────────────────────────────

interface ChunkAnalysis {
  examples: {
    text: string;
    tags: string[];
    note: string;
  }[];
  techniques: {
    name: string;
    description: string;
    tags: string[];
    example: string;
  }[];
}

async function analyzeChunk(
  client: Anthropic,
  model: string,
  bookName: string,
  chunk: TextChunk,
): Promise<ChunkAnalysis> {
  const prompt = `你是一位资深文学评论家和写作教练。请分析以下小说片段（来自《${bookName}》的${chunk.position}部分），提取有价值的写作素材。

## 小说片段
${chunk.text}

## 请提取以下内容，以 JSON 格式返回：

{
  "examples": [
    {
      "text": "原文佳段（50-200字，保留原文不改动）",
      "tags": ["标签1", "标签2"],
      "note": "笔法要点：为什么这段写得好，可以怎么借鉴（30字以内）"
    }
  ],
  "techniques": [
    {
      "name": "手法名称（如：对比蒙太奇、留白暗示、感官通感）",
      "description": "这种手法的说明和使用场景（50字以内）",
      "tags": ["适用场景标签"],
      "example": "从上文提取的运用此手法的例句"
    }
  ]
}

## 标签体系（请从中选择，也可新增）：
- 情感类：对话火花、氛围描写、情感爆发、克制暗涌、心理独白、信息差张力
- 场景类：开篇入戏、场景过渡、战斗打斗、宴饮社交、独处反思、生离死别
- 技巧类：伏笔埋设、反转铺垫、节奏控制、人物塑造、感官细节、环境隐喻
- 风格类：文白夹杂、短句节奏、对比反差、留白含蓄、幽默自嘲

## 要求：
- 只提取真正优秀的段落，不要凑数，每个片段提取 1-3 个佳段、0-2 个手法即可
- 佳段必须是原文，不要改动
- 如果片段质量一般，可以返回空数组
- 只返回 JSON，不要其他文字`;

  const response = await client.messages.create({
    model,
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // 提取 JSON
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { examples: [], techniques: [] };

  try {
    return JSON.parse(jsonMatch[0]) as ChunkAnalysis;
  } catch {
    console.warn(`[分析] 片段 ${chunk.index} JSON 解析失败，跳过`);
    return { examples: [], techniques: [] };
  }
}

// ── 综合分析（全书风格总结）──────────────────────────────

async function synthesizeStyle(
  client: Anthropic,
  model: string,
  bookName: string,
  allAnalyses: ChunkAnalysis[],
): Promise<string> {
  const allExamples = allAnalyses.flatMap((a) => a.examples);
  const allTechniques = allAnalyses.flatMap((a) => a.techniques);

  const summary = `佳段 ${allExamples.length} 个，手法 ${allTechniques.length} 个。
手法列表：${allTechniques.map((t) => t.name).join("、")}
标签分布：${[...new Set(allExamples.flatMap((e) => e.tags))].join("、")}`;

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `你是文学评论家。基于对《${bookName}》的分析结果，写一份简洁的风格总结报告（300-500字）。

## 分析统计
${summary}

## 提取到的写作手法
${allTechniques.map((t) => `- **${t.name}**：${t.description}`).join("\n")}

## 要求：
- 总结这部作品的核心风格特征
- 提炼 3-5 条最值得学习的写作原则
- 用于指导后续小说创作，语言要实用、可操作`,
    }],
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
}

// ── 主流程 ────────────────────────────────────────────────

export async function analyzeBook(filePath: string, force = false): Promise<void> {
  const fileName = path.basename(filePath, path.extname(filePath));
  // 从文件名提取书名（去掉作者信息）
  const bookName = fileName
    .replace(/^\d+/, "")
    .replace(/[《》]/g, "")
    .replace(/作者[：:].*$/, "")
    .trim();

  console.log(`\n── 分析《${bookName}》──────────────────────────────`);
  console.log(`文件：${filePath}`);

  // 检查是否已分析过
  const sourceKey = `《${bookName}》`;
  if (await hasSource(sourceKey)) {
    if (!force) {
      console.log(`[跳过] 《${bookName}》已分析过，知识库中已有相关素材。使用 --force 重新分析。`);
      return;
    }
    // force 模式：先删除旧素材
    const removed = await removeBySource(sourceKey);
    console.log(`[重置] 已删除旧素材 ${removed} 条，重新分析...`);
  }

  // 读取文件
  console.log("[读取] 加载文件...");
  const fullText = await readTextFile(filePath);
  console.log(`[读取] ${fullText.length} 字符`);

  // 采样分块
  const chunks = sampleChunks(fullText);
  console.log(`[采样] ${chunks.length} 个片段：${chunks.map((c) => c.position).join("、")}`);

  // 使用 review 端点分析（分析任务适合 GLM/GPT-5）
  const { client, model } = endpoints.review;
  console.log(`[模型] ${model}`);

  // 逐块分析
  const allAnalyses: ChunkAnalysis[] = [];
  for (const chunk of chunks) {
    process.stdout.write(`[分析] 片段 ${chunk.index + 1}/${chunks.length}（${chunk.position}）... `);
    const analysis = await analyzeChunk(client, model, bookName, chunk);
    allAnalyses.push(analysis);
    console.log(`佳段 ${analysis.examples.length} | 手法 ${analysis.techniques.length}`);
  }

  // 汇总
  const allExamples = allAnalyses.flatMap((a) => a.examples);
  const allTechniques = allAnalyses.flatMap((a) => a.techniques);
  console.log(`\n[汇总] 共提取佳段 ${allExamples.length} 个，手法 ${allTechniques.length} 个`);

  // 去重（相同 text 的佳段合并）
  const seenTexts = new Set<string>();
  const uniqueExamples = allExamples.filter((e) => {
    const key = e.text.slice(0, 50);
    if (seenTexts.has(key)) return false;
    seenTexts.add(key);
    return true;
  });

  const seenNames = new Set<string>();
  const uniqueTechniques = allTechniques.filter((t) => {
    if (seenNames.has(t.name)) return false;
    seenNames.add(t.name);
    return true;
  });

  // 存入知识库
  const entries: Omit<KnowledgeEntry, "id" | "createdAt">[] = [
    ...uniqueExamples.map((e) => ({
      type: "example" as const,
      tags: e.tags,
      source: `《${bookName}》`,
      content: e.text,
      note: e.note,
    })),
    ...uniqueTechniques.map((t) => ({
      type: "technique" as const,
      tags: t.tags,
      source: `《${bookName}》`,
      content: `**${t.name}**：${t.description}`,
      note: t.example,
    })),
  ];

  const count = await addEntries(entries);
  console.log(`[存储] ${count} 条素材已存入知识库`);

  // 生成风格总结
  console.log("[综合] 生成风格总结...");
  const styleSummary = await synthesizeStyle(client, model, bookName, allAnalyses);

  // 保存风格总结到 skills/styles/
  const styleDir = path.resolve("skills", "styles");
  await fs.mkdir(styleDir, { recursive: true });
  const safeBookName = bookName.replace(/[/\\:*?"<>|]/g, "_");
  const stylePath = path.join(styleDir, `${safeBookName}-分析.md`);
  await fs.writeFile(
    stylePath,
    `# 《${bookName}》风格分析报告\n\n_自动生成于 ${new Date().toISOString().slice(0, 10)}_\n\n${styleSummary}\n`,
    "utf-8",
  );
  console.log(`[保存] 风格总结 → ${stylePath}`);

  await printKnowledgeStats();
  console.log("── 分析完成 ────────────────────────────────────\n");
}

// ── CLI 入口 ──────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const filePaths = args.filter((a) => a !== "--force");

  if (filePaths.length === 0) {
    // 扫描 downloads/ 目录
    const dlDir = path.resolve("downloads");
    const files = await fs.readdir(dlDir).catch((): string[] => []);
    const txtFiles = files.filter((f) => f.endsWith(".txt"));

    if (txtFiles.length === 0) {
      console.log("用法：npx tsx src/analyzer.ts [文件路径] [--force]");
      console.log("或将 txt 文件放入 downloads/ 目录后直接运行");
      console.log("\n选项：");
      console.log("  --force  强制重新分析已处理过的作品");
      return;
    }

    console.log(`\n发现 ${txtFiles.length} 个参考作品：`);
    txtFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    if (force) console.log("\n[--force] 将重新分析所有作品");

    for (const file of txtFiles) {
      await analyzeBook(path.join(dlDir, file), force);
    }
  } else {
    for (const fp of filePaths) {
      await analyzeBook(path.resolve(fp), force);
    }
  }
}

// 仅在直接运行时执行
const isMain = process.argv[1]?.includes("analyzer");
if (isMain) {
  main().catch(console.error);
}
