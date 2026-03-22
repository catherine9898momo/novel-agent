/**
 * todo.ts - 任务追踪 (s03 + s07 概念)
 *
 * Agent 写长篇小说时需要记住"还有哪些章节没写"
 * 用一个简单的内存数组模拟 todo list，注入到 system prompt 里
 * LLM 每次看到 todo list 就知道下一步该做什么
 *
 * s07: 任务状态持久化到 _todo.json，重启后无需重建
 */

import fs from "fs/promises";

export type TodoStatus = "pending" | "in_progress" | "done";

export interface TodoItem {
  id: number;          // 唯一 id，方便更新状态
  task: string;        // 任务描述，比如"写第3章：华山论剑"
  status: TodoStatus;  // 当前状态
}

export class TodoList {
  private items: TodoItem[] = []; // 所有任务，内存存储
  private nextId = 1;             // 自增 id

  // 批量添加任务，初始化时用
  add(tasks: string[]): void {
    for (const task of tasks) {
      this.items.push({ id: this.nextId++, task, status: "pending" });
    }
  }

  // 更新某个任务的状态
  update(id: number, status: TodoStatus): void {
    const item = this.items.find((i) => i.id === id);
    if (item) item.status = status;
  }

  // 把 todo list 格式化成文字，注入到 system prompt 里
  // LLM 读这段文字就知道整体进度
  toPromptString(): string {
    if (this.items.length === 0) return "（暂无任务）";

    return this.items
      .map((i) => {
        const icon =
          i.status === "done"        ? "✅" :
          i.status === "in_progress" ? "🔄" : "⬜";
        return `${icon} [${i.id}] ${i.task}`;
      })
      .join("\n");
  }

  // 取出所有未完成的任务，用于判断是否全部写完
  pending(): TodoItem[] {
    return this.items.filter((i) => i.status !== "done");
  }

  // s07: 持久化到文件
  async save(filepath: string): Promise<void> {
    await fs.writeFile(filepath, JSON.stringify(this.items, null, 2), "utf-8");
  }

  // s07: 从文件恢复，返回 null 表示文件不存在
  static async load(filepath: string): Promise<TodoList | null> {
    const raw = await fs.readFile(filepath, "utf-8").catch(() => null);
    if (!raw) return null;
    const items: TodoItem[] = JSON.parse(raw);
    const list = new TodoList();
    list.items = items;
    list.nextId = Math.max(0, ...items.map((i) => i.id)) + 1;
    return list;
  }

  // 追加新任务（用于扩展章节），跳过已存在的同名任务
  addIfAbsent(tasks: string[]): void {
    for (const task of tasks) {
      if (!this.items.some((i) => i.task === task)) {
        this.items.push({ id: this.nextId++, task, status: "pending" });
      }
    }
  }
}
