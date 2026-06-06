/**
 * US-ATTEST-001 — AC parser pins. Fixtures mirror the live roll-meta corpus
 * shapes (story headings at ##/###, `**AC:**` + task-list items, the
 * `**AC refreshed**:` near-miss, file-level blocks in one-card FIX files).
 */
import { describe, expect, it } from "vitest";
import { acForStory, parseAcBlocks } from "../src/attest/ac-parser.js";

const MULTI_STORY = `# Feature: watcher

## 背景

some prose

## US-WATCH-001 每日扫描

- As a maintainer
- I want scans

**AC refreshed**: 2026-05-25（这行不是 AC 块）

**AC:**
- [ ] 独立可执行：脚本单独跑通 —— **不挂 dream**
- [x] 拉取 release notes（主来源 + fallback）
- [ ] 维护 state 文件，记录 last_seen_version
  + last_changelog_hash 的组合键
- [ ] 首次跑只写入当前 version

## US-WATCH-002 多上游纳入

**AC:**
- [ ] Kimi / DeepSeek / Codex 全纳入
- [ ] 任意上游升级不致盲点

### FIX-150b 评审硬触发

**AC:**
- [ ] 高复杂度跳过 peer 要留痕
`;

const ONE_CARD_FIX = `# FIX-197 — loop now 报错

## 现象

text

## 修复方向

**AC:**
- [ ] 再生成后 loop now 干净无报错
- [ ] PAUSE 检查真实生效
`;

describe("parseAcBlocks", () => {
  it("attributes blocks to their story sections; near-miss lines are ignored", () => {
    const sections = parseAcBlocks(MULTI_STORY);
    expect(sections.map((s) => s.storyId)).toEqual(["US-WATCH-001", "US-WATCH-002", "FIX-150b"]);
    const w1 = sections[0]!;
    expect(w1.items).toHaveLength(4);
    expect(w1.items[0]!.id).toBe("US-WATCH-001:AC1");
    expect(w1.items[0]!.checked).toBe(false);
    expect(w1.items[1]!.checked).toBe(true); // - [x]
  });

  it("appends indented continuation lines to the previous item", () => {
    const w1 = parseAcBlocks(MULTI_STORY)[0]!;
    expect(w1.items[2]!.text).toContain("last_seen_version + last_changelog_hash 的组合键");
  });

  it("lowercase id suffix (FIX-150b) is part of the story id", () => {
    const s = parseAcBlocks(MULTI_STORY).find((x) => x.storyId === "FIX-150b");
    expect(s?.items).toHaveLength(1);
  });

  it("non-story headings (## 背景 / ## 修复方向) do not reset attribution", () => {
    const sections = parseAcBlocks(ONE_CARD_FIX);
    // FIX-197 from the H1? H1 (#) is not a section heading; ## 现象 carries no id —
    // so the block is file-level ("" storyId).
    expect(sections).toHaveLength(1);
    expect(sections[0]!.storyId).toBe("");
    expect(sections[0]!.items).toHaveLength(2);
  });
});

describe("grouped AC blocks (corpus tolerance)", () => {
  it("blank line + bold group sub-headers stay inside one block", () => {
    const doc = [
      "## US-RM-001 远程监控",
      "",
      "**AC:**",
      "",
      "**配置（config.yaml）:**",
      "- [ ] 新增可选字段 roll_meta_dir",
      "- [ ] 模板加注释示例行",
      "",
      "**推送:**",
      "- [ ] cycle hook 自动 push",
      "",
      "正文结束块。",
    ].join("\n");
    const sections = parseAcBlocks(doc);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items.map((i) => i.id)).toEqual([
      "US-RM-001:AC1",
      "US-RM-001:AC2",
      "US-RM-001:AC3",
    ]);
  });
});

describe("acForStory", () => {
  it("returns the story's own items with stable re-derived ids", () => {
    const items = acForStory(MULTI_STORY, "US-WATCH-002");
    expect(items.map((i) => i.id)).toEqual(["US-WATCH-002:AC1", "US-WATCH-002:AC2"]);
  });

  it("falls back to the file-level block for one-card FIX files", () => {
    const items = acForStory(ONE_CARD_FIX, "FIX-197");
    expect(items).toHaveLength(2);
    expect(items[0]!.id).toBe("FIX-197:AC1");
    expect(items[1]!.text).toContain("PAUSE");
  });

  it("no AC anywhere → empty list (caller renders the Claimed ladder)", () => {
    expect(acForStory("# t\n\nprose only\n", "US-X-001")).toEqual([]);
  });

  it("derivation never mutates the source (pure function contract)", () => {
    const before = MULTI_STORY;
    acForStory(MULTI_STORY, "US-WATCH-001");
    expect(MULTI_STORY).toBe(before);
  });
});

describe("US-ATTEST-012 — fileOwned: filename owns the whole card (FIX-214 实案)", () => {
  // A card file named US-ATTEST-012.md whose body has a ## heading mentioning
  // ANOTHER card id — under section attribution the trailing AC gets stolen by
  // FIX-214; when the file is ID-named the whole file belongs to the ID.
  const STOLEN = `# US-ATTEST-012 — 验收口径补全

**AC:**
- [ ] 第一条本卡验收

## 杜绝 FIX-214 实案那种 AC 劫持

**AC:**
- [ ] 第二条本卡验收
`;

  it("default attribution lets a他卡号 heading steal the second block", () => {
    // proves the bug exists without the flag: the 2nd block is attributed to FIX-214
    const owned = acForStory(STOLEN, "US-ATTEST-012");
    expect(owned).toHaveLength(1); // only the pre-heading block survives
  });

  it("fileOwned=true binds EVERY AC block to the story regardless of headings", () => {
    const items = acForStory(STOLEN, "US-ATTEST-012", { fileOwned: true });
    expect(items.map((i) => i.id)).toEqual(["US-ATTEST-012:AC1", "US-ATTEST-012:AC2"]);
    expect(items[1]!.text).toContain("第二条");
  });

  it("fileOwned keeps ids stable and source pure", () => {
    const before = STOLEN;
    const items = acForStory(STOLEN, "US-ATTEST-012", { fileOwned: true });
    expect(items.every((i, n) => i.id === `US-ATTEST-012:AC${n + 1}`)).toBe(true);
    expect(STOLEN).toBe(before);
  });
});
