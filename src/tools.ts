/**
 * tools.ts - 工具定义与执行逻辑 (s02 概念)
 *
 * 两件事：
 *   1. 定义工具的"说明书"（给 LLM 看，它靠这个决定要不要调用）
 *   2. 定义工具的"实现"（给我们自己执行）
 */

import fs from "fs/promises";
import path from "path";
import type { Tool, ToolHandlers } from "./agent-loop.js";
import type { TodoList, TodoStatus } from "./todo.js";

// novels 输出目录，相对于项目根目录
const NOVELS_DIR = path.resolve("novels");

/**
 * TOOLS_DEFINITION - 工具的"说明书"数组，直接传给 API
 *
 * LLM 看这个决定：要不要调用工具、调用哪个、传什么参数
 * description 写得越清楚，LLM 调用越准确
 */
export const TOOLS_DEFINITION: Tool[] = [
  {
    name: "write_chapter",
    description: "将一章小说内容写入文件。每章写完后调用此工具保存。",
    input_schema: {
      type: "object" as const,
      properties: {
        chapter_number: {
          type: "number",
          description: "章节编号，从 1 开始",
        },
        title: {
          type: "string",
          description: "章节标题",
        },
        content: {
          type: "string",
          description: "章节正文内容",
        },
      },
      required: ["chapter_number", "title", "content"],
    },
  },
  {
    name: "read_chapter",
    description: "读取已写好的某章内容，用于回顾剧情保持连贯性。",
    input_schema: {
      type: "object" as const,
      properties: {
        chapter_number: {
          type: "number",
          description: "要读取的章节编号",
        },
      },
      required: ["chapter_number"],
    },
  },
  {
    name: "list_chapters",
    description: "列出当前已写好的所有章节，用于了解整体进度。",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "write_plan",
    description: "保存规划文件。type 可以是 outline（故事大纲）、characters（人物设定）、relationships（人物关系）。规划阶段必须依次生成这三个文件。",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["outline", "characters", "relationships"],
          description: "规划文件类型",
        },
        content: {
          type: "string",
          description: "文件内容（Markdown 格式）",
        },
      },
      required: ["type", "content"],
    },
  },
  {
    name: "read_plan",
    description: "读取已保存的规划文件（outline/characters/relationships），写章节前必须先读取这三个文件。",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["outline", "characters", "relationships"],
          description: "要读取的规划文件类型",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "update_todo",
    description: "更新任务列表中某个任务的状态。每章写完后调用，将对应任务标记为 done。",
    input_schema: {
      type: "object" as const,
      properties: {
        id: {
          type: "number",
          description: "任务 id（任务列表里方括号内的数字）",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done"],
          description: "新状态",
        },
      },
      required: ["id", "status"],
    },
  },
  {
    name: "propose_chapters",
    description: "规划阶段完成后，调用此工具提交章节列表。支持简单字符串数组或带元数据的对象数组。",
    input_schema: {
      type: "object" as const,
      properties: {
        chapters: {
          type: "array",
          description: "章节列表，每项可以是字符串或包含元数据的对象",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  title: { type: "string", description: "章节标题，例如 '第一章：入京'" },
                  target_words: { type: "number", description: "目标字数，默认 2000" },
                  mood: { type: "string", description: "情绪基调，例如：紧张、温情、悲伤" },
                  required_scenes: {
                    type: "array",
                    items: { type: "string" },
                    description: "本章必须出现的场景或事件",
                  },
                  plot_hooks: {
                    type: "array",
                    items: { type: "string" },
                    description: "本章需要埋下的伏笔",
                  },
                  transition_notes: {
                    type: "string",
                    description: "场景过渡说明：各场景之间如何自然衔接，禁止硬切",
                  },
                },
                required: ["title"],
              },
            ],
          },
        },
      },
      required: ["chapters"],
    },
  },
  {
    name: "write_story_so_far",
    description: "每章写完后调用，更新累积故事摘要。摘要应包含：已发生的关键事件、人物状态变化、未解决的伏笔。",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "截至本章的故事摘要（Markdown 格式，500-800字）",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "read_story_so_far",
    description: "读取累积故事摘要，了解前面章节已发生的事件和人物状态。",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "write_handoff",
    description: "每章写完后调用，记录本章交接备忘供下一章使用。内容应包含：结尾情绪状态、未完成的对话或动作、需要下一章衔接的线索。",
    input_schema: {
      type: "object" as const,
      properties: {
        chapter_number: {
          type: "number",
          description: "本章编号",
        },
        content: {
          type: "string",
          description: "交接备忘内容（200字以内）",
        },
      },
      required: ["chapter_number", "content"],
    },
  },
  {
    name: "update_foreshadowing",
    description: "每章写完后调用，更新伏笔追踪状态。传入本章涉及的所有伏笔变动（新埋的、推进的、已回收的）。",
    input_schema: {
      type: "object" as const,
      properties: {
        updates: {
          type: "array",
          description: "伏笔变动列表",
          items: {
            type: "object",
            properties: {
              desc: { type: "string", description: "伏笔描述" },
              chapter: { type: "string", description: "涉及章节，如'第5章'" },
              status: { type: "string", enum: ["埋下", "推进中", "已回收"], description: "伏笔当前状态" },
              expected_resolution: { type: "string", description: "预期回收位置（新埋伏笔必填）" },
            },
            required: ["desc", "chapter", "status"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    // Layer 3: LLM 感觉上下文太长时主动调用，触发强制压缩
    name: "compact",
    description: "当你感觉对话历史过长、上下文即将超出限制时，主动调用此工具压缩历史。无需任何参数。",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

/**
 * makeToolHandlers - 创建工具的实际执行函数
 *
 * @param novelTitle - 小说标题，决定输出目录
 * @param todo       - 可选的任务列表实例
 * @param compactFn  - 可选的强制压缩回调（Layer 3）
 */
export function makeToolHandlers(
  novelTitle: string,
  todo?: TodoList,
  compactFn?: () => Promise<string>,
  todoFilepath?: string,
  onChaptersProposed?: (chapters: string[]) => void,
): ToolHandlers {
  const novelDir = path.join(NOVELS_DIR, novelTitle);

  return {
    write_chapter: async (input) => {
      const { chapter_number, content } = input as {
        chapter_number: number;
        title: string;
        content: string;
      };
      // 自动剔除标题中的"第X章"前缀，保持文件命名一致
      const title = (input as { title: string }).title.replace(/^第\d+章\s*/, "");

      await fs.mkdir(novelDir, { recursive: true });

      const prefix = String(chapter_number).padStart(3, "0");
      const files = await fs.readdir(novelDir).catch(() => [] as string[]);

      // 幂等保护：已有正式文件则跳过
      const existing = files.find((f) => f.startsWith(prefix) && !f.startsWith(`_draft_${prefix}`));
      if (existing) return `第${chapter_number}章已存在（${existing}），跳过写入`;

      const draftPath = path.join(novelDir, `_draft_${prefix}.md`);
      const finalPath = path.join(novelDir, `${prefix}-${title}.md`);

      // 先写草稿，再原子重命名——崩溃时草稿留存，启动时可检测并清理
      await fs.writeFile(draftPath, `# 第${chapter_number}章 ${title}\n\n${content}`, "utf-8");
      await fs.rename(draftPath, finalPath);

      return `第${chapter_number}章《${title}》已保存到 ${finalPath}`;
    },

    read_chapter: async (input) => {
      const { chapter_number } = input as { chapter_number: number };

      const prefix = String(chapter_number).padStart(3, "0");

      const files = await fs.readdir(novelDir).catch(() => []);
      const file = files.find((f) => f.startsWith(prefix));

      if (!file) return `第${chapter_number}章尚未写作`;

      return await fs.readFile(path.join(novelDir, file), "utf-8");
    },

    list_chapters: async () => {
      const files = await fs.readdir(novelDir).catch(() => []);
      const chapters = files.filter((f) => f.endsWith(".md") && !f.startsWith("_"));

      if (chapters.length === 0) return "尚未写作任何章节";

      return `已完成章节：\n${chapters.join("\n")}`;
    },

    write_plan: async (input) => {
      const { type, content } = input as { type: string; content: string };

      await fs.mkdir(novelDir, { recursive: true });

      const filename = `_${type}.md`;
      const filepath = path.join(novelDir, filename);

      await fs.writeFile(filepath, content, "utf-8");

      return `规划文件 ${filename} 已保存到 ${filepath}`;
    },

    read_plan: async (input) => {
      const { type } = input as { type: string };

      const filepath = path.join(novelDir, `_${type}.md`);
      const content = await fs.readFile(filepath, "utf-8").catch(() => null);

      if (!content) return `规划文件 _${type}.md 尚未生成，请先完成规划阶段。`;

      return content;
    },

    update_todo: async (input) => {
      if (!todo) return "todo list 未初始化";
      const { id, status } = input as { id: number; status: TodoStatus };
      todo.update(id, status);
      // s07: 每次更新后持久化到文件
      if (todoFilepath) await todo.save(todoFilepath);
      return `任务 [${id}] 已更新为 ${status}\n\n当前进度：\n${todo.toPromptString()}`;
    },

    write_story_so_far: async (input) => {
      const { summary } = input as { summary: string };
      const filepath = path.join(novelDir, "_story_so_far.md");
      await fs.writeFile(filepath, summary, "utf-8");
      return `故事摘要已更新（${summary.length} 字）`;
    },

    read_story_so_far: async () => {
      const filepath = path.join(novelDir, "_story_so_far.md");
      const content = await fs.readFile(filepath, "utf-8").catch(() => null);
      if (!content) return "尚无故事摘要（这是第一章）";
      return content;
    },

    write_handoff: async (input) => {
      const { chapter_number, content } = input as { chapter_number: number; content: string };
      await fs.mkdir(novelDir, { recursive: true });
      const prefix = String(chapter_number).padStart(3, "0");
      const filepath = path.join(novelDir, `_handoff_${prefix}.md`);
      await fs.writeFile(filepath, content, "utf-8");
      return `第${chapter_number}章交接备忘已保存`;
    },

    update_foreshadowing: async (input) => {
      const { updates } = input as {
        updates: Array<{ desc: string; chapter: string; status: string; expected_resolution?: string }>;
      };
      const filepath = path.join(novelDir, "_foreshadowing.json");
      const existing = await fs.readFile(filepath, "utf-8").catch(() => "[]");
      const foreshadowing = JSON.parse(existing) as Array<{
        desc: string; planted_at: string; status: string; expected_resolution: string;
      }>;

      for (const update of updates) {
        const existing_item = foreshadowing.find((f) => f.desc === update.desc);
        if (existing_item) {
          existing_item.status = update.status;
          if (update.status === "已回收") {
            existing_item.expected_resolution = update.chapter;
          }
        } else {
          foreshadowing.push({
            desc: update.desc,
            planted_at: update.chapter,
            status: update.status,
            expected_resolution: update.expected_resolution ?? "",
          });
        }
      }

      await fs.writeFile(filepath, JSON.stringify(foreshadowing, null, 2), "utf-8");
      const active = foreshadowing.filter((f) => f.status !== "已回收");
      return `伏笔状态已更新（共 ${foreshadowing.length} 条，${active.length} 条未回收）`;
    },

    // Layer 3: 主动压缩工具
    compact: async () => {
      if (!compactFn) return "compact 未配置";
      return await compactFn();
    },

    propose_chapters: async (input) => {
      const { chapters } = input as { chapters: (string | { title: string; target_words?: number; mood?: string; required_scenes?: string[]; plot_hooks?: string[]; transition_notes?: string })[] };
      const normalized = chapters.map((c) => typeof c === "string" ? { title: c } : c);
      const filepath = path.join(novelDir, "_chapters.json");
      await fs.writeFile(filepath, JSON.stringify(normalized, null, 2), "utf-8");
      onChaptersProposed?.(normalized.map((c) => c.title));
      return `章节列表已保存（共 ${normalized.length} 章）：\n${normalized.map((c) => c.title).join("\n")}`;
    },
  };
}
