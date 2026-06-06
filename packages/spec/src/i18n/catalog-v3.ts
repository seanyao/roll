/**
 * v3-native message catalog. The frozen v2 catalog (catalog.generated.json) is
 * mechanically derived from the bash oracle and must not be hand-edited; strings
 * for behaviour that is new in v3 live here instead (see catalog.ts header).
 *
 * `briefv3.*` — the few labels the live `roll brief` digest needs beyond the
 * reused v2 `brief.*` keys (US-PORT-002). Both en and zh are always present so
 * the single-language contract (output follows ROLL_LANG, never mixes) holds.
 */
import type { Catalog } from "./index.js";

export const v3Catalog: Catalog = {
  "briefv3.full_hint": {
    en: "Run with --full for the complete lists",
    zh: "加 --full 查看完整列表",
  },
  "briefv3.all_clear": {
    en: "All clear — nothing needs your call",
    zh: "一切就绪 — 无需您拍板",
  },
  "briefv3.queue_breakdown": {
    en: "%s fixes · %s stories · %s other",
    zh: "%s 缺陷 · %s 故事 · %s 其他",
  },
};
