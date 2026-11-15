// Entry (research question, modules, counts) and the S01–S24 coverage matrix;
// plus the status pages for the Existing-benchmark and Challenge sections.
import { covGlyph, emptyState, hashCode, labelBadge, taskTitle } from "./components.js";
import { t, tEnum } from "./i18n.js";
import { h } from "./util.js";
import { renderResults } from "./results.js";

export const STAGES = ["contract", "native_oracle", "independent_assertion", "generated_output", "readout", "score"];
const COV_STATES = ["done", "partial", "failed", "missing", "planned"];

export function renderOverview(ctx) {
  const root = h("div", { class: "view overview" });
  root.append(entry(ctx), coverageMatrix(ctx));
  if (ctx.problems && ctx.problems.length) {
    root.append(h("section", { class: "block checks", "aria-labelledby": "checks-h" },
      h("h2", { id: "checks-h" }, t("checks.title")),
      h("ul", null, ctx.problems.map((p) => h("li", null, p)))));
  }
  return root;
}

function entry(ctx) {
  const { doc } = ctx;
  const modules = doc.taxonomy.modules || [];
  const withInstance = doc.tasks.filter((task) => (task.instances || []).length).length;
  const scored = doc.scores.filter((r) => r.section === "minecraft" && r.value !== null && r.value !== undefined).length;
  const unscored = doc.scores.filter((r) => r.section === "minecraft" && (r.value === null || r.value === undefined)).length;
  return h("section", { class: "entry", "aria-labelledby": "entry-q" },
    h("h1", { id: "entry-q", class: "question" }, t("entry.question")),
    h("div", { class: "modules", role: "list", "aria-label": t("entry.modules") },
      modules.map((m) => h("article", { class: `module-card mod-${m.id}`, role: "listitem" },
        h("header", null, h("span", { class: "module-id", "aria-hidden": "true" }, m.id),
          h("div", null, h("h2", null, m.name), h("p", { class: "module-q" }, m.question))),
        h("ul", { class: "subcats" }, (m.subcategories || []).map((sc) =>
          h("li", null, h("code", null, sc.id), " ", sc.name)))))),
    h("p", { class: "fine" }, t("entry.modules.note")),
    h("div", { class: "counts", "aria-label": t("entry.counts") },
      count(`${withInstance} / ${doc.tasks.length}`, t("count.tasks")),
      count(doc.runs.length, t("count.runs")),
      count(doc.systems.length, t("count.systems")),
      count(scored, t("count.scored")),
      count(unscored, t("count.notscored"))));
}

function count(value, label) {
  return h("p", { class: "count" }, h("strong", null, String(value)), h("span", null, label));
}

export function coverageMatrix(ctx) {
  const { doc, idx } = ctx;
  const legend = h("ul", { class: "cov-legend", "aria-label": "legend" },
    COV_STATES.map((st) => h("li", null, h("span", { class: `cov-cell cov-${st}`, "aria-hidden": "true" }, covGlyph(st)), t(`cstate.${st}`))));
  const table = h("table", { class: "cov-table" },
    h("caption", null, t("coverage.caption")),
    h("thead", null, h("tr", null,
      h("th", { scope: "col", class: "cov-task-h" }, t("coverage.task")),
      STAGES.map((st) => h("th", { scope: "col", class: "cov-stage-h" }, h("span", null, t(`stage.${st}`)))))));
  const body = h("tbody");
  const tally = Object.fromEntries(STAGES.map((st) => [st, Object.fromEntries(COV_STATES.map((c) => [c, 0]))]));
  for (const task of doc.tasks) {
    const rows = idx.coverageByTask.get(task.id) || new Map();
    const open = () => ctx.go("instance", { task: task.id });
    const tr = h("tr", { class: `cov-row row-${task.state}`, onclick: open });
    tr.append(h("th", { scope: "row", class: "cov-task" },
      h("button", { type: "button", class: "cov-open", onclick: (e) => { e.stopPropagation(); open(); } },
        h("span", { class: "sid" }, task.id),
        h("span", { class: "cov-mods", "aria-hidden": "true" }, (task.modules || []).map((m) => h("span", { class: `mdot mod-${m}`, title: m }))),
        taskTitle(task)),
      h("span", { class: "visually-hidden" }, ` · ${tEnum("tstate", task.state)} · ${(task.modules || []).join("/")}`)));
    for (const stage of STAGES) {
      const row = rows.get(stage);
      const state = row ? row.state : "missing";
      if (tally[stage][state] !== undefined) tally[stage][state] += 1;
      const label = `${task.id} ${t(`stage.${stage}`)}: ${t(`cstate.${state}`)}${row?.detail ? ` — ${row.detail}` : ""}${row ? "" : " (no coverage row in the index)"}`;
      tr.append(h("td", { class: "cov-td" },
        h("span", { class: `cov-cell cov-${state}`, title: label, "aria-hidden": "true" }, covGlyph(state)),
        h("span", { class: "visually-hidden" }, label)));
    }
    body.append(tr);
  }
  table.append(body);
  table.append(h("tfoot", null, h("tr", null, h("th", { scope: "row" }, t("coverage.counts")),
    STAGES.map((st) => h("td", { class: "cov-tally" },
      COV_STATES.filter((c) => tally[st][c]).map((c) =>
        h("span", { class: "tally", title: `${t(`cstate.${c}`)}: ${tally[st][c]}` },
          h("span", { class: `cov-cell mini cov-${c}`, "aria-hidden": "true" }, covGlyph(c)),
          h("span", null, String(tally[st][c])), h("span", { class: "visually-hidden" }, ` ${t(`cstate.${c}`)}`))))))));
  return h("section", { class: "block coverage", "aria-labelledby": "cov-h" },
    h("h2", { id: "cov-h" }, t("coverage.title")), legend,
    h("div", { class: "table-scroll" }, table));
}

export function renderSection(ctx, params, sectionId) {
  const info = ctx.idx.sections.get(sectionId);
  const rows = ctx.doc.scores.filter((r) => r.section === sectionId);
  const root = h("div", { class: "view section-page" },
    h("section", { class: "block section-status" },
      h("h1", null, info?.title || t(`section.${sectionId}`)),
      h("p", { class: `sec-state big state-${info?.state ?? "planned"}` }, t(`section.state.${info?.state ?? "planned"}`)),
      info?.summary ? h("p", { class: "lede" }, info.summary) : null,
      rows.length ? null : emptyState(t("section.empty"))));
  // Status rows (optional, additive): checks that exist for this section but are not scores.
  const status = Array.isArray(info?.status_rows) ? info.status_rows : [];
  if (status.length) {
    root.append(h("section", { class: "block status-rows", "aria-labelledby": `st-h-${sectionId}` },
      h("h2", { id: `st-h-${sectionId}` }, t("section.status_rows")),
      h("p", { class: "fine" }, t("section.status_rows.note")),
      h("ul", { class: "status-list" }, status.map((r) => h("li", { class: "status-item" },
        h("p", { class: "status-title" }, h("strong", null, r.title ?? r.id ?? "—"), " ", r.label ? labelBadge(r.label) : null),
        h("p", { class: "status-line" }, h("code", null, r.status ?? "—"), r.detail ? ` · ${r.detail}` : ""),
        (r.evidence || []).length ? h("ul", { class: "ev-list" }, r.evidence.map((e) => h("li", null, hashCode(e)))) : null)))));
  }
  if (rows.length) root.append(renderResults(ctx, params, sectionId, sectionId));
  return root;
}

