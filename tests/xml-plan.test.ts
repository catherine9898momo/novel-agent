/**
 * xml-plan.test.ts - XML 章节计划单测
 *
 * 验证：
 *   - planToXml: 结构化计划 → XML 输出
 *   - escapeXml: 特殊字符转义
 *   - 边界情况：空数组、可选字段
 */

import { describe, it, expect } from "vitest";
import { planToXml, type ChapterPlan } from "../src/xml-plan.js";

const basePlan: ChapterPlan = {
  chapterNum: 1,
  title: "初遇",
  pov: "沈渡",
  setting: "京城街头",
  emotionalArc: { from: "冷漠", to: "好奇" },
  scenes: [
    { order: 1, description: "男主在街头被追杀", emotion: "紧张", transition: "逃入酒楼" },
    { order: 2, description: "女主在酒楼偶遇", emotion: "惊讶" },
  ],
  foreshadowing: [
    { type: "plant", desc: "玉佩掉落", detail: "第5章回收" },
    { type: "advance", desc: "朝廷暗线", detail: "从怀疑→确认" },
  ],
  openingHook: "一把匕首划过夜色",
  closingHook: "她捡起了那枚玉佩",
  verifyChecks: [
    { item: "男主身份不能暴露" },
    { item: "情绪从冷漠过渡到好奇" },
  ],
  targetWords: 3000,
};

describe("planToXml", () => {
  it("生成完整 XML 结构", () => {
    const xml = planToXml(basePlan);

    expect(xml).toContain('<chapter_plan num="1" title="初遇">');
    expect(xml).toContain("<pov>沈渡</pov>");
    expect(xml).toContain("<setting>京城街头</setting>");
    expect(xml).toContain('<emotional_arc from="冷漠" to="好奇" />');
    expect(xml).toContain("<target_words>3000</target_words>");
    expect(xml).toContain("</chapter_plan>");
  });

  it("场景列表正确", () => {
    const xml = planToXml(basePlan);

    expect(xml).toContain('<scene order="1">');
    expect(xml).toContain("<description>男主在街头被追杀</description>");
    expect(xml).toContain("<transition>逃入酒楼</transition>");
    expect(xml).toContain('<scene order="2">');
    // 第二个场景没有 transition
    const scene2Part = xml.split('<scene order="2">')[1].split("</scene>")[0];
    expect(scene2Part).not.toContain("<transition>");
  });

  it("伏笔操作正确", () => {
    const xml = planToXml(basePlan);

    expect(xml).toContain('<plant desc="玉佩掉落" detail="第5章回收" />');
    expect(xml).toContain('<advance desc="朝廷暗线"');
  });

  it("hooks 正确", () => {
    const xml = planToXml(basePlan);

    expect(xml).toContain("<opening>一把匕首划过夜色</opening>");
    expect(xml).toContain("<closing>她捡起了那枚玉佩</closing>");
  });

  it("verify 检查项正确", () => {
    const xml = planToXml(basePlan);

    expect(xml).toContain("<check>男主身份不能暴露</check>");
    expect(xml).toContain("<check>情绪从冷漠过渡到好奇</check>");
  });

  it("空伏笔数组不输出 foreshadowing 标签", () => {
    const plan = { ...basePlan, foreshadowing: [] };
    const xml = planToXml(plan);
    expect(xml).not.toContain("<foreshadowing>");
  });

  it("空 verify 数组不输出 verify 标签", () => {
    const plan = { ...basePlan, verifyChecks: [] };
    const xml = planToXml(plan);
    expect(xml).not.toContain("<verify>");
  });

  it("特殊字符正确转义", () => {
    const plan = {
      ...basePlan,
      title: '爱与<恨> & "信念"',
      pov: "A&B",
    };
    const xml = planToXml(plan);
    expect(xml).toContain('title="爱与&lt;恨&gt; &amp; &quot;信念&quot;"');
    expect(xml).toContain("<pov>A&amp;B</pov>");
  });
});
