import { describe, expect, it } from "vitest";
import { v3Catalog } from "../src/i18n/catalog-v3.js";
import { t } from "../src/i18n/index.js";

describe("v3Catalog", () => {
  const keys = [
    "ideav3.recorded",
    "ideav3.type",
    "ideav3.section",
    "ideav3.text",
    "ideav3.kind_bug",
    "ideav3.kind_idea",
    "ideav3.usage",
    "ideav3.empty",
    "ideav3.lint_failed",
    "ideav3.lint_hint",
    "releasev3.usage",
    "releasev3.title",
    "releasev3.current",
    "releasev3.next",
    "releasev3.tag",
    "releasev3.changelog",
    "releasev3.changelog_ready",
    "releasev3.changelog_empty",
    "releasev3.flow_title",
    "releasev3.step_bump",
    "releasev3.step_commit",
    "releasev3.step_merge",
    "releasev3.step_tag",
    "releasev3.gate_note",
    "releasev3.gate_preview",
    "releasev3.no_pkg",
    "loopv3.monitor_retired",
    "loopv3.attach_retired",
    "design.usage",
    "design.not_roll_project",
    "design.skill_missing",
    "design.no_agent",
    "design.unknown_agent",
    "design.bare_backlog_help",
    // FIX-1453 — capture i18n keys
    "capture.usage",
    "capture.unknown_subcommand",
    "capture.local_window.usage",
    "capture.local_window.unsafe_id",
    "capture.local_window.loopback_only",
    "capture.local_window.result",
    "capture.local_window.no_extension",
    "capture.local_window.privacy",
    "capture.local_window.selector",
    "capture.local_window.screenshot",
    "capture.local_window.receipt",
    "capture.local_window.reason",
    "capture.local_window.prepare_must_be_list",
    "capture.local_window.prepare_max_actions",
    "capture.local_window.prepare_action_object",
    "capture.local_window.prepare_wait_ms",
    "capture.local_window.prepare_waits_max",
    "capture.local_window.prepare_selector_required",
    "capture.local_window.prepare_fill_required",
    "capture.local_window.prepare_only_permits",
    "capture.migrate.revert",
    "capture.migrate.result",
    "capture.migrate.detail",
    "capture.dry_run_not_written",
    "capture.written",
    "capture.no_change",
    "capture.repair.usage",
    "capture.repair.no_record",
    "capture.repair.failed_delivery",
    "capture.repair.not_degraded",
    "capture.repair.result",
    "capture.repair.reopened",
    "capture.repair.visual",
    "capture.readiness.title",
    "capture.readiness.gateway_ready",
    "capture.readiness.gateway_unavailable",
    "capture.readiness.renderer_ready",
    "capture.readiness.renderer_unavailable",
    "capture.readiness.policy",
    "capture.readiness.migration",
  ];

  it("every v3 key carries both en and zh (no mixed-language gap)", () => {
    for (const k of keys) {
      const e = v3Catalog[k];
      expect(e, k).toBeDefined();
      expect(e?.en, k).toBeTruthy();
      expect(e?.zh, k).toBeTruthy();
    }
  });

  it("idea capture labels resolve single-language with no prose bleed", () => {
    // The interpolated %s carries diagnostic category tokens (path/filename/…),
    // so assert on the prose labels, which must be fully localized.
    expect(t(v3Catalog, "en", "ideav3.recorded", "FIX-001")).toContain("FIX-001");
    expect(t(v3Catalog, "zh", "ideav3.recorded", "FIX-001")).toContain("已记录");
    expect(t(v3Catalog, "zh", "ideav3.text")).not.toMatch(/[A-Za-z]/);
    expect(t(v3Catalog, "zh", "ideav3.lint_hint")).not.toMatch(/[A-Za-z]/);
  });

  it("t() resolves a v3 key to a single language with no cross-language bleed", () => {
    const en = t(v3Catalog, "en", "ideav3.recorded", "FIX-001");
    const zh = t(v3Catalog, "zh", "ideav3.recorded", "FIX-001");
    expect(en).toContain("Recorded");
    expect(zh).not.toMatch(/[A-Za-z]{4,}/); // no English words leak into the zh form
    expect(en).not.toEqual(zh);
  });
});
