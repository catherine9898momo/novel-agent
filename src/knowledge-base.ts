/**
 * knowledge-base.ts - 知识库管理
 *
 * 素材体系：
 *   skills/
 *     styles/           — 风格指南（已有）
 *     examples/          — 佳段库（按标签分类）
 *     techniques/        — 写作手法卡片
 *     preferences.md     — 用户偏好（HITL 反馈沉淀）
 *     _index.json        — 全局索引（标签 → 素材列表）
 *
 * 每条素材（KnowledgeEntry）包含：
 *   - id:       唯一 ID
 *   - type:     example | technique | preference
 *   - tags:     标签列表（如 "对话火花" "氛围描写" "情感爆发"）
 *   - source:   来源（参考作品名 / 本书章节 / 用户反馈）
 *   - content:  正文内容
 *   - note:     笔法要点 / 使用说明
 */

import fs from "fs/promises";
import path from "path";

const SKILLS_DIR = path.resolve("skills");

// ── 类型定义 ──────────────────────────────────────────────

export type EntryType = "example" | "technique" | "preference";

export interface KnowledgeEntry {
  id: string;
  type: EntryType;
  tags: string[];
  source: string;
  content: string;
  note?: string;
  createdAt: string;
}

export interface KnowledgeIndex {
  entries: KnowledgeEntry[];
}

// ── 索引管理 ──────────────────────────────────────────────

const INDEX_PATH = path.join(SKILLS_DIR, "_index.json");

export async function loadIndex(): Promise<KnowledgeIndex> {
  const raw = await fs.readFile(INDEX_PATH, "utf-8").catch(() => null);
  if (!raw) return { entries: [] };
  return JSON.parse(raw) as KnowledgeIndex;
}

export async function saveIndex(index: KnowledgeIndex): Promise<void> {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}

// ── 添加素材 ──────────────────────────────────────────────

let _counter = 0;

function generateId(type: EntryType): string {
  _counter++;
  const ts = Date.now().toString(36);
  return `${type}_${ts}_${_counter}`;
}

export async function addEntry(
  type: EntryType,
  tags: string[],
  source: string,
  content: string,
  note?: string,
): Promise<KnowledgeEntry> {
  const index = await loadIndex();
  const entry: KnowledgeEntry = {
    id: generateId(type),
    type,
    tags,
    source,
    content,
    note,
    createdAt: new Date().toISOString(),
  };
  index.entries.push(entry);
  await saveIndex(index);
  return entry;
}

export async function addEntries(entries: Omit<KnowledgeEntry, "id" | "createdAt">[]): Promise<number> {
  const index = await loadIndex();
  const now = new Date().toISOString();
  for (const e of entries) {
    index.entries.push({
      ...e,
      id: generateId(e.type),
      createdAt: now,
    });
  }
  await saveIndex(index);
  return entries.length;
}

// ── 检索素材 ──────────────────────────────────────────────

/**
 * 按标签检索素材（任一标签匹配即返回）
 */
export async function searchByTags(
  tags: string[],
  type?: EntryType,
  limit = 10,
): Promise<KnowledgeEntry[]> {
  const index = await loadIndex();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  return index.entries
    .filter((e) => {
      if (type && e.type !== type) return false;
      return e.tags.some((t) => tagSet.has(t.toLowerCase()));
    })
    .slice(-limit); // 取最新的
}

/**
 * 按类型获取所有素材
 */
export async function getByType(type: EntryType): Promise<KnowledgeEntry[]> {
  const index = await loadIndex();
  return index.entries.filter((e) => e.type === type);
}

/**
 * 按来源获取素材
 */
export async function getBySource(source: string): Promise<KnowledgeEntry[]> {
  const index = await loadIndex();
  return index.entries.filter((e) => e.source.includes(source));
}

/**
 * 检查某个来源是否已有素材（用于跳过重复分析）
 */
export async function hasSource(source: string): Promise<boolean> {
  const entries = await getBySource(source);
  return entries.length > 0;
}

/**
 * 删除某个来源的全部素材（用于 --force 重新分析）
 */
export async function removeBySource(source: string): Promise<number> {
  const index = await loadIndex();
  const before = index.entries.length;
  index.entries = index.entries.filter((e) => !e.source.includes(source));
  const removed = before - index.entries.length;
  if (removed > 0) await saveIndex(index);
  return removed;
}

// ── 获取所有标签 ──────────────────────────────────────────

export async function getAllTags(): Promise<Record<string, number>> {
  const index = await loadIndex();
  const counts: Record<string, number> = {};
  for (const e of index.entries) {
    for (const tag of e.tags) {
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }
  return counts;
}

// ── 偏好管理（HITL 反馈沉淀）─────────────────────────────

const PREFS_PATH = path.join(SKILLS_DIR, "preferences.md");

export async function loadPreferences(): Promise<string> {
  return await fs.readFile(PREFS_PATH, "utf-8").catch(() => "");
}

export async function appendPreference(feedback: string, context: string): Promise<void> {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  const existing = await loadPreferences();
  const date = new Date().toISOString().slice(0, 10);
  const entry = `\n### ${date} — ${context}\n- ${feedback}\n`;
  await fs.writeFile(PREFS_PATH, existing + entry, "utf-8");
}

// ── 格式化输出（注入 system prompt 用）────────────────────

/**
 * 将素材列表格式化为 system prompt 可用的文本
 */
export function formatForPrompt(entries: KnowledgeEntry[], sectionTitle: string): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => {
    let block = `> ${e.content}`;
    if (e.note) block += `\n**笔法要点**：${e.note}`;
    block += `\n_来源：${e.source} | 标签：${e.tags.join("、")}_`;
    return block;
  });
  return `\n## ${sectionTitle}\n\n${lines.join("\n\n---\n\n")}\n`;
}

/**
 * 根据章节情绪/场景标签，自动检索相关素材并格式化
 */
export async function getRelevantMaterial(
  mood?: string,
  scenes?: string[],
  limit = 5,
): Promise<string> {
  const tags: string[] = [];
  if (mood) tags.push(mood);
  if (scenes) tags.push(...scenes);
  if (tags.length === 0) return "";

  const examples = await searchByTags(tags, "example", limit);
  const techniques = await searchByTags(tags, "technique", 3);

  let result = "";
  if (examples.length > 0) {
    result += formatForPrompt(examples, "参考佳段（来自优秀作品和本书高分章节）");
  }
  if (techniques.length > 0) {
    result += formatForPrompt(techniques, "相关写作手法");
  }
  return result;
}

/**
 * 打印知识库统计信息
 */
export async function printKnowledgeStats(): Promise<void> {
  const index = await loadIndex();
  const byType: Record<string, number> = {};
  for (const e of index.entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  const prefs = await loadPreferences();
  const prefCount = (prefs.match(/^### /gm) || []).length;

  console.log("\n── 知识库统计 ──────────────────────────────────");
  console.log(`  佳段示例：${byType["example"] || 0} 条`);
  console.log(`  写作手法：${byType["technique"] || 0} 条`);
  console.log(`  用户偏好：${prefCount} 条`);
  console.log(`  总计：${index.entries.length} 条素材`);
  console.log("─────────────────────────────────────────────────\n");
}
