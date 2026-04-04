import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TodoList } from "../src/todo.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "novel-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TodoList", () => {
  it("add: 批量添加任务，自增 id", () => {
    const todo = new TodoList();
    todo.add(["写第1章", "写第2章", "写第3章"]);

    const pending = todo.pending();
    expect(pending).toHaveLength(3);
    expect(pending[0].id).toBe(1);
    expect(pending[1].id).toBe(2);
    expect(pending[2].id).toBe(3);
    expect(pending[0].task).toBe("写第1章");
    expect(pending[0].status).toBe("pending");
  });

  it("update: 更新任务状态", () => {
    const todo = new TodoList();
    todo.add(["写第1章", "写第2章"]);

    todo.update(1, "in_progress");
    todo.update(2, "done");

    const pending = todo.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(1);
    expect(pending[0].status).toBe("in_progress");
  });

  it("update: 不存在的 id 不报错", () => {
    const todo = new TodoList();
    todo.add(["写第1章"]);
    expect(() => todo.update(999, "done")).not.toThrow();
  });

  it("pending: 只返回未完成任务", () => {
    const todo = new TodoList();
    todo.add(["a", "b", "c"]);
    todo.update(1, "done");
    todo.update(2, "in_progress");

    const pending = todo.pending();
    expect(pending).toHaveLength(2);
    expect(pending.map((i) => i.task)).toEqual(["b", "c"]);
  });

  it("toPromptString: 格式化输出包含状态图标", () => {
    const todo = new TodoList();
    todo.add(["写第1章", "写第2章", "写第3章"]);
    todo.update(1, "done");
    todo.update(2, "in_progress");

    const output = todo.toPromptString();
    expect(output).toContain("✅");
    expect(output).toContain("🔄");
    expect(output).toContain("⬜");
    expect(output).toContain("[1] 写第1章");
    expect(output).toContain("[2] 写第2章");
    expect(output).toContain("[3] 写第3章");
  });

  it("toPromptString: 空列表返回提示", () => {
    const todo = new TodoList();
    expect(todo.toPromptString()).toBe("（暂无任务）");
  });

  it("addIfAbsent: 跳过已存在任务", () => {
    const todo = new TodoList();
    todo.add(["写第1章", "写第2章"]);
    todo.addIfAbsent(["写第2章", "写第3章"]);

    const pending = todo.pending();
    expect(pending).toHaveLength(3);
    expect(pending.map((i) => i.task)).toEqual(["写第1章", "写第2章", "写第3章"]);
  });

  it("save + load: 持久化到文件并恢复", async () => {
    const filepath = path.join(tmpDir, "_todo.json");

    const todo = new TodoList();
    todo.add(["写第1章", "写第2章"]);
    todo.update(1, "done");
    await todo.save(filepath);

    const loaded = await TodoList.load(filepath);
    expect(loaded).not.toBeNull();

    const pending = loaded!.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0].task).toBe("写第2章");
    expect(pending[0].status).toBe("pending");
  });

  it("load: 文件不存在返回 null", async () => {
    const result = await TodoList.load(path.join(tmpDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("save + load: 恢复后 nextId 正确递增", async () => {
    const filepath = path.join(tmpDir, "_todo.json");

    const todo = new TodoList();
    todo.add(["写第1章", "写第2章"]);
    await todo.save(filepath);

    const loaded = await TodoList.load(filepath);
    loaded!.add(["写第3章"]);

    const all = loaded!.pending();
    const ids = all.map((i) => i.id);
    // id 应该是 1, 2, 3（不重复）
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...ids)).toBe(3);
  });
});
