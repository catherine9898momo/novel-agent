/**
 * plan-skeleton.ts - 从 Markdown 规划文件提取骨架摘要
 *
 * 零 API 成本，纯正则提取：
 *   - 保留所有标题（# / ## / ### / ####）
 *   - 保留每个段落的首句（句号/问号/感叹号截断）
 *   - 保留表格（三幕结构等关键信息）
 *   - 保留 code block（关系图等）
 *   - 丢弃段落的后续详细描写
 *
 * 效果：23KB outline → ~3-4KB 骨架，包含章节规划所需的全部结构信息
 */

/**
 * 从 Markdown 文件内容提取骨架
 * @param md - 原始 Markdown 内容
 * @param maxCharsPerSection - 每个 section 首段最多保留字符数（默认 150）
 */
export function extractSkeleton(md: string, maxCharsPerSection = 150): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let inTable = false;
  let sectionContentAdded = false; // 当前 section 是否已添加了首段摘要

  for (const line of lines) {
    // code block（保留，如关系图）
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        // code block 结束，算作该 section 已有内容
        sectionContentAdded = true;
      }
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }
    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    // 标题行：始终保留
    if (/^#{1,6}\s/.test(line)) {
      result.push(line);
      sectionContentAdded = false; // 新 section 开始
      continue;
    }

    // 分割线：保留
    if (/^---\s*$/.test(line.trim())) {
      result.push(line);
      continue;
    }

    // 表格行：始终保留
    if (line.trimStart().startsWith("|")) {
      inTable = true;
      result.push(line);
      continue;
    }
    if (inTable && line.trim() === "") {
      inTable = false;
      result.push(line);
      continue;
    }

    // 空行：保留（保持可读性）
    if (line.trim() === "") {
      result.push(line);
      continue;
    }

    // 正文行：只保留每个 section 的首段首句
    if (!sectionContentAdded) {
      const firstSentence = extractFirstSentence(line, maxCharsPerSection);
      result.push(firstSentence);
      sectionContentAdded = true;
    }
    // 后续行丢弃
  }

  // 清理连续空行
  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 提取一行文本的首句
 */
function extractFirstSentence(line: string, maxChars: number): string {
  // 匹配中英文句号、问号、感叹号
  const match = line.match(/^(.+?[。？！.?!])/);
  if (match && match[1].length <= maxChars) {
    return match[1];
  }
  // 没有句号或超长，硬截断
  if (line.length > maxChars) {
    return line.slice(0, maxChars) + "…";
  }
  return line;
}
