// Shared presentational pieces: badges, chips, titles, definition lists.
import { getLang, t, tEnum } from "./i18n.js";
import { h, shortHash } from "./util.js";

const STATUS_GLYPH = {
  oracle_self_check: "◇",
  state_level: "▣",
  provisional_uncalibrated_reader: "△",
  auto_labelled: "◆",
  auto_labelled_uncertified: "◈",
  adapted_metric: "⇄",
  baseline: "▽",
  not_scored: "○",
};
const CP_GLYPH = { pass: "✓", fail: "✕", unreadable: "?", unsupported: "⊘", excluded: "–", missing: "○" };
const COV_GLYPH = { done: "■", partial: "◩", failed: "✕", missing: "□", planned: "·" };

export function statusBadge(status) {
  return h("span", { class: `badge status-${status}`, title: tEnum("status", status) },
    h("span", { class: "glyph", "aria-hidden": "true" }, STATUS_GLYPH[status] ?? "•"),
    tEnum("status", status));
}

export function cpBadge(status) {
  return h("span", { class: `badge cp cp-${status}` },
    h("span", { class: "glyph", "aria-hidden": "true" }, CP_GLYPH[status] ?? "•"),
    tEnum("cp", status));
}

/** How the labels behind a score row were obtained (ADR 0013): counts and the resolved-only value. */
export function labelSummary(ls) {
  if (!ls) return null;
  return h("span", { class: "label-sum" },
    t("labels.summary", { certified: ls.certified, agreed: ls.agreed, unresolved: ls.unresolved }), " ",
    ls.checkpoints_resolved ? t("labels.resolved", { passed: ls.checkpoints_resolved_passed, resolved: ls.checkpoints_resolved })
      : t("labels.none_resolved"));
}

/** A field's automatic label: status and what each annotator answered. */
export function labelCell(f) {
  if (!f.label_status) return "—";
  const answers = Object.entries(f.annotator_answers || {}).map(([who, what]) => `${who}: ${what}`).join("; ");
  return h("span", { class: `lab-st lab-st-${f.label_status}`, title: f.label_reason ?? "" },
    h("strong", null, t(`labels.status.${f.label_status}`)), answers ? h("span", { class: "fine" }, ` ${answers}`) : null);
}

export function runStatusBadge(status) {
  const cls = status === "completed" ? "pass" : status === "failed_retained" ? "fail" : "missing";
  return h("span", { class: `badge cp cp-${cls}` }, tEnum("run", status));
}

export function covGlyph(state) {
  return COV_GLYPH[state] ?? "?";
}

export function kindBadge(kind) {
  return h("span", { class: `badge kind kind-${kind}` }, tEnum("kind", kind));
}

export function labelBadge(label) {
  if (!label) return null;
  return h("span", { class: `badge lab lab-${label}`, title: label }, tEnum("label", label));
}

export function moduleChip(id, withName, taxonomy) {
  const mod = (taxonomy?.modules || []).find((m) => m.id === id);
  return h("span", { class: `mod mod-${id}`, title: mod ? mod.name : id },
    h("span", { class: "mod-dot", "aria-hidden": "true" }), withName && mod ? `${id} · ${mod.name}` : id);
}

export function demoBadge(mode) {
  return h("span", { class: `badge demo demo-${mode}` }, tEnum("demo", mode));
}

export function taskTitle(task, { block = false } = {}) {
  if (!task) return h("span", null, "—");
  const zhFirst = getLang() === "zh" && task.title_zh;
  const primary = zhFirst ? task.title_zh : task.title;
  // Inline titles in English mode show English only (the Chinese line is for block titles),
  // so a host without a CJK font never draws broken fragments under compact rows.
  const secondary = zhFirst ? task.title : (block ? task.title_zh : null);
  return h(block ? "div" : "span", { class: "task-title" },
    h("span", { class: "tt-primary", lang: zhFirst ? "zh-CN" : "en" }, primary),
    secondary ? h("span", { class: "tt-secondary", lang: zhFirst ? "en" : "zh-CN" }, secondary) : null);
}

export function dl(pairs, cls = "kv") {
  const list = h("dl", { class: cls });
  for (const [key, value] of pairs) {
    if (value === undefined) continue;
    list.append(h("div", null, h("dt", null, key), h("dd", null, value === null ? "—" : value)));
  }
  return list;
}

export function hashCode(item) {
  if (!item) return "—";
  return h("span", { class: "evidence-ref" },
    h("code", { class: "path" }, item.path ?? item.url ?? "—"), " ",
    h("code", { class: "sha", title: item.sha256 ?? "" }, `sha256 ${shortHash(item.sha256)}`));
}

export function section(title, ...children) {
  return h("section", { class: "block" }, h("h2", null, title), ...children);
}

export function emptyState(text) {
  return h("p", { class: "empty" }, text);
}

export function sysLabel(sys) {
  return sys ? sys.name : "—";
}

export function yesNo(v) {
  return v === true ? t("yes") : v === false ? t("no") : "—";
}
