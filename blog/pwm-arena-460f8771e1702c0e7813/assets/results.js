// Results browser: filters (in the hash), groups by comparable_group, never ranks
// across groups, sets reference and baseline rows apart, exports the current view.
import { kindBadge, labelBadge, labelSummary, moduleChip, statusBadge } from "./components.js";
import { t, tEnum } from "./i18n.js";
import { append, buildHash, copyText, fmtValue, h, inViewer, saveFile, toCSV, uniq } from "./util.js";

const FILTERS = [
  ["mod", "filter.module", (r) => r.module],
  ["sub", "filter.subcategory", (r) => r.subcategory],
  ["mode", "filter.mode", (r) => r.test_mode],
  ["kind", "filter.kind", (r, ctx) => ctx.idx.systems.get(r.system_id)?.kind],
  ["st", "filter.status", (r) => r.status],
  ["task", "filter.task", (r) => r.task_id ?? "macro"],
];
const TIER = { learned: 0, composed: 0, degenerate_baseline: 1, reference: 2 };
const TIER_KEY = ["tier.systems", "tier.baselines", "tier.reference"];
const SORTS = { system: "col.system", task: "col.task", value: "col.value", status: "col.status" };

export function renderResults(ctx, params, sectionId, viewName) {
  const all = ctx.doc.scores.filter((r) => r.section === sectionId);
  const state = { ...params };
  const root = h("section", { class: "block results", "aria-labelledby": `res-h-${sectionId}` });
  root.append(h("h2", { id: `res-h-${sectionId}` }, t("results.title")), h("p", { class: "lede" }, t("results.intro")));

  const controls = h("div", { class: "filters", role: "group", "aria-label": t("results.title") });
  const out = h("div", { class: "results-out", "aria-live": "polite" });
  const toolbar = h("div", { class: "toolbar" });
  const toast = h("span", { class: "toast", role: "status" });
  const openState = new Map(); // group key -> open, once the viewer toggles it

  function filtered() {
    return all.filter((r) => FILTERS.every(([key, , get]) => !state[key] || String(get(r, ctx) ?? "") === state[key]));
  }

  function update() {
    ctx.replaceHash(viewName, state);
    drawControls();
    drawTable();
  }

  function drawControls() {
    controls.replaceChildren(...FILTERS.map(([key, labelKey, get]) => {
      let pool = all;
      if (key === "sub" && state.mod) pool = all.filter((r) => r.module === state.mod);
      const values = uniq(pool.map((r) => get(r, ctx)).filter((v) => v !== null && v !== undefined).map(String)).sort();
      if (state[key] && !values.includes(state[key])) values.push(state[key]);
      const id = `f-${sectionId}-${key}`;
      const select = h("select", { id, onchange: (e) => {
        state[key] = e.target.value || undefined;
        if (key === "mod") state.sub = undefined;
        update();
      } }, h("option", { value: "" }, t("filter.any")), values.map((v) =>
        h("option", { value: v, selected: state[key] === v }, optionLabel(ctx, key, v))));
      return h("div", { class: "field" }, h("label", { for: id }, t(labelKey)), select);
    }), h("button", { type: "button", class: "btn ghost", onclick: () => {
      for (const [key] of FILTERS) state[key] = undefined;
      state.sort = undefined;
      state.dir = undefined;
      update();
    } }, t("filter.reset")));
  }

  function rowsForExport() {
    return filtered().map((r) => ({
      ...r,
      system_name: ctx.idx.systems.get(r.system_id)?.name ?? null,
      system_kind: ctx.idx.systems.get(r.system_id)?.kind ?? null,
      system_label: ctx.idx.systems.get(r.system_id)?.label ?? null,
    }));
  }

  async function report(promise) {
    const result = await promise;
    toast.textContent = t(`download.${result}`);
    setTimeout(() => { toast.textContent = ""; }, 3000);
  }

  // Inside an artifact viewer the frame's own address is not a link anyone can open; the
  // viewer's Share menu copies the page link instead.
  if (!inViewer()) {
    toolbar.append(h("button", { type: "button", class: "btn", onclick: async () => {
      ctx.replaceHash(viewName, state);
      toast.textContent = (await copyText(location.href)) ? t("filter.copied") : t("filter.copyfail");
      setTimeout(() => { toast.textContent = ""; }, 3000);
    } }, t("filter.copy")));
  }
  toolbar.append(
    h("button", { type: "button", class: "btn", onclick: () => {
      const rows = rowsForExport().map((r) => ({ ...r,
        coverage_scored: r.coverage?.categories_scored ?? null, coverage_total: r.coverage?.categories_total ?? null,
        run_ids: (r.run_ids || []).join(";"),
        labels_certified: r.label_summary?.certified ?? null, labels_agreed: r.label_summary?.agreed ?? null,
        labels_unresolved: r.label_summary?.unresolved ?? null,
        resolved_checkpoints: r.label_summary?.checkpoints_resolved ?? null,
        resolved_checkpoints_passed: r.label_summary?.checkpoints_resolved_passed ?? null }));
      const cols = ["section", "comparable_group", "system_id", "system_name", "system_kind", "system_label", "module", "subcategory",
        "test_mode", "metric_id", "metric_name", "origin", "scope", "task_id", "value", "numerator", "denominator", "unit",
        "direction", "status", "reason", "readable_rate", "coverage_scored", "coverage_total", "confidence_interval", "ci_note", "run_ids",
        "labels_certified", "labels_agreed", "labels_unresolved", "resolved_checkpoints", "resolved_checkpoints_passed"];
      report(saveFile(`pwm-results-${sectionId}-view.csv`, toCSV(rows, cols), "text/csv"));
    } }, t("download.csv")),
    h("button", { type: "button", class: "btn", onclick: () => {
      const body = { schema_version: "pwm-results-view-v1", source_schema: ctx.doc.schema_version,
        generated_utc: ctx.doc.generated_utc, build: ctx.doc.build, notice: ctx.doc.notice, section: sectionId,
        filters: Object.fromEntries(FILTERS.map(([k]) => [k, state[k] ?? null])), rows: rowsForExport() };
      report(saveFile(`pwm-results-${sectionId}-view.json`, JSON.stringify(body, null, 2) + "\n", "application/json"));
    } }, t("download.json")),
    h("button", { type: "button", class: "btn ghost", onclick: () => setAll(true) }, t("results.expand")),
    h("button", { type: "button", class: "btn ghost", onclick: () => setAll(false) }, t("results.collapse")),
    toast);

  function sortRows(rows) {
    const key = state.sort;
    const dir = state.dir === "desc" ? -1 : 1;
    const tier = (r) => TIER[ctx.idx.systems.get(r.system_id)?.kind] ?? 0;
    const cmp = {
      system: (a, b) => (ctx.idx.systems.get(a.system_id)?.name ?? a.system_id).localeCompare(ctx.idx.systems.get(b.system_id)?.name ?? b.system_id),
      task: (a, b) => String(a.task_id ?? "~").localeCompare(String(b.task_id ?? "~")),
      value: (a, b) => (a.value ?? -Infinity) - (b.value ?? -Infinity),
      status: (a, b) => String(a.status).localeCompare(String(b.status)),
    }[key];
    return rows.map((r, i) => [r, i]).sort(([a, ia], [b, ib]) => {
      const t0 = tier(a) - tier(b);
      if (t0) return t0;
      if (cmp) {
        // Missing values always sort last, whatever the direction.
        if (key === "value" && (a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
        const c = cmp(a, b) * dir;
        if (c) return c;
      }
      return ia - ib;
    }).map(([r]) => r);
  }

  function header(col, labelKey) {
    const sortable = SORTS[col];
    const active = state.sort === col;
    const aria = active ? (state.dir === "desc" ? "descending" : "ascending") : "none";
    const th = h("th", { scope: "col", class: `col-${col}`, "aria-sort": sortable ? aria : null });
    if (!sortable) {
      th.append(t(labelKey));
      return th;
    }
    th.append(h("button", { type: "button", class: "sort", "aria-label": t("col.sort", { col: t(labelKey) }), onclick: () => {
      if (state.sort === col) state.dir = state.dir === "desc" ? undefined : "desc";
      else { state.sort = col; state.dir = undefined; }
      if (state.sort === col && state.dir === undefined && aria === "descending") state.sort = undefined;
      update();
    } }, t(labelKey), h("span", { class: "sort-ind", "aria-hidden": "true" }, active ? (state.dir === "desc" ? "▼" : "▲") : "↕")));
    return th;
  }

  function drawTable() {
    const rows = filtered();
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.comparable_group ?? "(no group)"}\u0000${r.metric_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const frag = [h("p", { class: "showing" }, t("results.showing", { n: rows.length, total: all.length, groups: groups.size }))];
    if (!rows.length) frag.push(h("p", { class: "empty" }, t("results.none")));
    // Group order (never by value): groups with evaluated systems first, then reference-only,
    // then baseline-only; index order inside each rank. Only the first group opens by default
    // unless a filter narrows the view or there are few groups: each header already names
    // the group, its metric, its systems and its row count.
    const kindOf = (r) => ctx.idx.systems.get(r.system_id)?.kind;
    // Groups whose rows are all infrastructure fixtures go last, visibly set apart.
    const fixtureOnly = (list) => list.every((r) => r.label === "infrastructure-fixture");
    const rank = (list) => fixtureOnly(list) ? 3
      : list.some((r) => (TIER[kindOf(r)] ?? 0) === 0) ? 0
        : list.some((r) => kindOf(r) === "reference") ? 1 : 2;
    const ordered = [...groups].map(([key, list], i) => [key, list, rank(list), i])
      .sort((a, b) => a[2] - b[2] || a[3] - b[3]);
    const narrowed = FILTERS.some(([k]) => state[k]) || groups.size <= 4;
    let position = 0;
    for (const [key, list, groupRank] of ordered) {
      const [group] = key.split("\u0000");
      const metric = ctx.idx.metrics.get(list[0].metric_id);
      const open = openState.has(key) ? openState.get(key) : (narrowed || position === 0);
      position += 1;
      const members = uniq(list.map((r) => ctx.idx.systems.get(r.system_id)?.name ?? r.system_id));
      const table = h("table", { class: "res-table" },
        h("caption", { class: "visually-hidden" }, `${t("results.group")} ${group}, ${list[0].metric_name ?? list[0].metric_id}`),
        h("thead", null, h("tr", null,
          header("system", "col.system"), header("task", "col.task"), header("cap", "col.capability"),
          header("value", "col.value"), header("status", "col.status"),
          header("readable", "col.readable"), header("coverage", "col.coverage"),
          header("unc", "col.uncertainty"), header("ev", "col.evidence"))));
      const body = h("tbody");
      let lastTier = null;
      for (const r of sortRows(list)) {
        const sys = ctx.idx.systems.get(r.system_id);
        const tier = TIER[sys?.kind] ?? 0;
        if (tier !== lastTier && (tier > 0 || lastTier !== null)) {
          body.append(h("tr", { class: `tier-row tier-${tier}` }, h("th", { colspan: 9, scope: "rowgroup" }, t(TIER_KEY[tier]))));
        }
        lastTier = tier;
        const row = scoreRow(ctx, r, sys, tier);
        body.append(row);
        const wide = reasonRow(r, tier);
        if (wide) {
          row.classList.add("has-reason-row");
          body.append(wide);
        }
      }
      table.append(body);
      const fixture = groupRank === 3;
      const details = h("details", { class: `res-group${fixture ? " res-group-fixture" : ""}`, open,
        // Remember only a viewer's deviation from the default (toggle also fires on creation).
        ontoggle: (e) => { if (e.currentTarget.open === open) openState.delete(key); else openState.set(key, e.currentTarget.open); } },
        h("summary", { class: "res-group-h" },
          h("div", null,
            h("p", { class: "eyebrow" }, h("span", { class: "disclosure", "aria-hidden": "true" }), t("results.group")),
            h("h3", null, h("code", null, group)),
            h("p", { class: "metric-line" }, h("strong", null, list[0].metric_name ?? list[0].metric_id), " ",
              h("code", null, list[0].metric_id), metric?.direction ? ` · ${metric.direction.replace(/_/g, " ")}` : "",
              list[0].origin ? ` · ${list[0].origin}` : ""),
            h("p", { class: "group-members" }, t("results.group.members", { n: list.length, systems: members.join(" · ") })),
            fixture ? h("p", { class: "group-fixture" }, labelBadge("infrastructure-fixture"), " ", t("results.group.fixture")) : null),
          h("p", { class: "group-note" }, t("results.group.note"))),
        h("div", { class: "table-scroll" }, table));
      frag.push(details);
    }
    out.replaceChildren(...frag);
  }

  function setAll(open) {
    for (const el of out.querySelectorAll("details.res-group")) el.open = open;
  }

  drawControls();
  drawTable();
  root.append(controls, toolbar, out);
  return root;
}

function optionLabel(ctx, key, value) {
  if (key === "mod") {
    const m = ctx.doc.taxonomy.modules.find((x) => x.id === value);
    return m ? `${value} · ${m.name}` : value;
  }
  if (key === "sub") {
    for (const m of ctx.doc.taxonomy.modules) {
      const sc = (m.subcategories || []).find((x) => x.id === value);
      if (sc) return `${value} · ${sc.name}`;
    }
    return value;
  }
  if (key === "mode") {
    const tm = (ctx.doc.taxonomy.test_modes || []).find((x) => x.id === value);
    return tm ? `${value} · ${tm.name}` : value;
  }
  if (key === "kind") return tEnum("kind", value);
  if (key === "st") return tEnum("status", value);
  if (key === "task") {
    if (value === "macro") return t("scope.category_macro");
    const task = ctx.idx.tasks.get(value);
    return task ? `${value} · ${task.title}` : value;
  }
  return value;
}

// A long reason gets its own full-width line under its row. In the narrow card layout
// this line is hidden and the copy inside the value cell shows instead.
function reasonRow(r, tier) {
  if (!r.reason || r.reason.length <= 70) return null;
  return h("tr", { class: `res-reason-row tier-${tier}` },
    h("td", { class: "col-system" }),
    h("td", { colspan: 8 }, h("span", { class: "reason" }, r.reason)));
}

function scoreRow(ctx, r, sys, tier) {
  const task = r.task_id ? ctx.idx.tasks.get(r.task_id) : null;
  const tm = (ctx.doc.taxonomy.test_modes || []).find((x) => x.id === r.test_mode);
  const valueText = fmtValue(r.value, r.unit);
  const valueCell = h("td", { class: "col-value", "data-label": t("col.value") });
  if (valueText === null) {
    append(valueCell, [h("span", { class: "val-missing" }, t("value.missing")),
      h("span", { class: "reason" }, r.reason || "—")]);
  } else {
    const pct = r.unit === "fraction" ? Math.max(0, Math.min(1, r.value)) : null;
    append(valueCell, [h("span", { class: "val" },
      h("strong", { class: "num" }, valueText),
      r.numerator !== null && r.numerator !== undefined && r.denominator !== null && r.denominator !== undefined
        ? h("span", { class: "frac" }, `${r.numerator} / ${r.denominator}`) : null),
    pct !== null ? h("span", { class: `meter mod-${r.module}`, "aria-hidden": "true" }, h("span", { style: `width:${(pct * 100).toFixed(1)}%` })) : null,
    r.reason ? h("span", { class: "reason" }, r.reason) : null,
    labelSummary(r.label_summary)]);
  }
  const hasMedia = r.task_id && (r.run_ids || []).some((id) => ctx.idx.runs.get(id)?.media?.video);
  const cov = r.coverage;
  return h("tr", { class: `res-row tier-${tier} kind-${sys?.kind ?? "unknown"}` },
    h("th", { scope: "row", class: "col-system", "data-label": t("col.system") },
      h("span", { class: "sys-name" }, sys?.name ?? r.system_id),
      // The row's own data label (e.g. adapted, infrastructure-fixture) wins over the system's.
      h("span", { class: "sys-badges" }, sys ? kindBadge(sys.kind) : null, labelBadge(r.label ?? sys?.label))),
    h("td", { class: "col-task", "data-label": t("col.task") }, task
      ? h("span", null, h("code", { class: "sid" }, task.id), " ", h("span", { class: "task-short" }, task.title))
      : h("span", { class: "macro" }, t("scope.category_macro"))),
    h("td", { class: "col-cap", "data-label": t("col.capability") }, h("span", { class: "cap-line" }, r.module ? moduleChip(r.module, false, ctx.doc.taxonomy) : "—", r.subcategory ? h("code", { class: "subcat" }, r.subcategory) : null),
      h("span", { class: "mode-name" }, `${t("col.mode")} `, h("span", { class: "mode" }, r.test_mode ?? "—"), tm ? ` ${tm.name}` : "")),
    valueCell,
    h("td", { class: "col-status", "data-label": t("col.status") }, statusBadge(r.status)),
    h("td", { class: `col-readable num${r.readable_rate === null || r.readable_rate === undefined ? " is-empty" : ""}`, "data-label": t("col.readable") }, r.readable_rate === null || r.readable_rate === undefined ? "—" : r.readable_rate.toFixed(2)),
    h("td", { class: `col-coverage num${cov ? "" : " is-empty"}`, "data-label": t("col.coverage") }, cov ? `${cov.categories_scored ?? "—"} / ${cov.categories_total ?? "—"}` : "—"),
    h("td", { class: `col-unc${r.confidence_interval ? "" : " no-ci"}`, "data-label": t("col.uncertainty") }, r.confidence_interval ? JSON.stringify(r.confidence_interval) : h("span", { class: "fine" }, r.ci_note ?? "—")),
    h("td", { class: "col-ev", "data-label": t("col.evidence") },
      hasMedia ? h("a", { class: "link-btn", href: buildHash("player", { task: r.task_id }) }, t("link.player")) : null,
      r.task_id ? h("a", { class: "link-btn", href: buildHash("instance", { task: r.task_id }) }, t("link.detail")) : null,
      h("span", { class: "fine" }, ` ${(r.run_ids || []).length} runs`)));
}
