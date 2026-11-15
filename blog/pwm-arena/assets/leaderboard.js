// Landing view: one ranked table per track, in the manner of a benchmark leaderboard.
//
// A track is a comparable group of the results index restricted to the categories
// that every system in the group has a value for (the builder writes those macro
// rows under "<group>/common-categories"). Nothing is computed here: every number
// is a score row of results.json. Trivial baselines are listed with the models,
// unranked, because a model that does not beat them has shown nothing.
import { t } from "./i18n.js";
import { buildHash, h } from "./util.js";

const METRICS = ["pwm.checkpoint_success.v1", "pwm.branch_success.v1", "pwm.pair_success.v1"];
const SUFFIX = "/common-categories";

function tracks(doc) {
  const seen = new Map();
  for (const r of doc.scores) {
    if (r.section !== "minecraft" || r.scope !== "category_macro") continue;
    if (!r.comparable_group.endsWith(SUFFIX) || seen.has(r.comparable_group)) continue;
    const base = r.comparable_group.slice(0, -SUFFIX.length);
    seen.set(r.comparable_group, { id: r.module || base, group: r.comparable_group, base, module: r.module });
  }
  return [...seen.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function categoriesOf(row) {
  const m = /categories:\s*([^;]+)/.exec(row.reason || "");
  return m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
}

function pct(value) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function isBaseline(sys) {
  return sys && sys.kind === "degenerate_baseline";
}

function shortName(sys) {
  // The registry names say how a system was run; the table wants the system. The rest is in "Type".
  const name = (sys?.name || sys?.id || "").replace(/^(Degenerate|Trivial baseline): /, "");
  return name.split(" states ")[0].split(" (")[0];
}

function bar(value) {
  const w = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return h("span", { class: "lb-bar", "aria-hidden": "true" }, h("span", { class: "lb-bar-fill", style: `width:${w}%` }));
}

function link(view, params, cls, current, text) {
  return h("a", { href: buildHash(view, params), class: cls, "aria-current": current ? "true" : null }, text);
}

export function renderLeaderboard(ctx, params) {
  const { doc, idx } = ctx;
  const all = tracks(doc);
  const root = h("div", { class: "view leaderboard" });
  root.append(hero(doc));
  if (!all.length) {
    root.append(h("p", { class: "lb-empty" }, t("lb.empty")));
    return root;
  }
  const track = all.find((x) => String(x.id) === params.track) || all[0];
  const metric = METRICS.includes(params.metric) ? params.metric : METRICS[0];
  const mode = params.v === "matrix" ? "matrix" : "ranking";
  const state = { track: String(track.id), metric, v: mode === "matrix" ? "matrix" : undefined };

  root.append(h("nav", { class: "lb-tracks", "aria-label": t("lb.tracks") }, all.map((x) =>
    link("leaderboard", { ...state, track: String(x.id) }, "lb-track", x === track,
      [h("span", { class: "lb-track-name" }, t(`lb.track.${x.id}`)), h("span", { class: "lb-track-sub" }, t(`lb.track.${x.id}.sub`))]))));

  const rows = doc.scores.filter((r) => r.scope === "category_macro" && r.comparable_group === track.group && r.metric_id === metric)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const cats = rows.length ? categoriesOf(rows[0]) : [];
  const metricName = (id) => t(`lb.metric.${id.split(".")[1]}`);

  const board = h("section", { class: "lb-board", "aria-labelledby": "lb-title" });
  board.append(h("div", { class: "lb-toolbar" },
    h("p", { id: "lb-title", class: "lb-crumb" }, `PWM-Arena / ${t(`lb.track.${track.id}`)} / `,
      h("span", null, t("lb.ncat", { n: cats.length }))),
    h("div", { class: "lb-controls" },
      h("div", { class: "lb-seg", role: "group", "aria-label": t("lb.metric") }, METRICS.map((id) =>
        link("leaderboard", { ...state, metric: id }, "lb-seg-item", id === metric, metricName(id)))),
      h("div", { class: "lb-seg", role: "group", "aria-label": t("lb.view") },
        link("leaderboard", { ...state, v: undefined }, "lb-seg-item", mode === "ranking", t("lb.view.ranking")),
        link("leaderboard", { ...state, v: "matrix" }, "lb-seg-item", mode === "matrix", t("lb.view.matrix")),
        h("a", { href: "#pareto", class: "lb-seg-item" }, t("lb.view.pareto"))))));

  board.append(h("div", { class: "lb-scroll" }, mode === "matrix"
    ? matrix(doc, idx, track, metric, rows, cats)
    : ranking(idx, rows)));
  board.append(h("p", { class: "lb-caption" }, t("lb.caption", { metric: metricName(metric), n: cats.length, cats: cats.join(", ") }),
    " ", t(`lb.caption.${track.id}`)));
  root.append(board);
  root.append(h("p", { class: "lb-more" },
    h("a", { href: "#results" }, t("lb.more.results")), " · ",
    h("a", { href: "#minecraft" }, t("lb.more.tasks")), " · ",
    h("a", { href: "#player" }, t("lb.more.player"))));
  return root;
}

function hero(doc) {
  const withRef = doc.tasks.filter((task) => (task.instances || []).length).length;
  const scored = new Set(doc.scores.filter((r) => r.value !== null && r.value !== undefined && r.label !== "infrastructure-fixture")
    .map((r) => r.system_id));
  const models = doc.systems.filter((x) => (x.kind === "learned" || x.kind === "composed") && scored.has(x.id)).length;
  return h("header", { class: "lb-hero" },
    h("h1", null, "PWM-Arena"),
    h("p", { class: "lb-tagline" }, t("lb.tagline")),
    h("p", { class: "lb-facts" },
      h("span", null, h("strong", null, `${withRef} / ${doc.tasks.length}`), ` ${t("lb.fact.tasks")}`),
      h("span", null, h("strong", null, String(models)), ` ${t("lb.fact.models")}`),
      h("span", null, h("strong", null, String(doc.runs.length)), ` ${t("lb.fact.runs")}`)),
    h("p", { class: "lb-actions" },
      h("a", { class: "lb-action", href: "#minecraft" }, t("lb.action.tasks")),
      h("a", { class: "lb-action", href: "#pareto" }, t("lb.action.pareto")),
      h("a", { class: "lb-action", href: "#player" }, t("lb.action.player")),
      h("button", { type: "button", class: "lb-action", onclick: () => document.getElementById("glossary-open").click() }, t("lb.action.methods"))));
}

function ranking(idx, rows) {
  const table = h("table", { class: "lb-table" },
    h("thead", null, h("tr", null,
      h("th", { scope: "col", class: "num" }, t("lb.col.rank")),
      h("th", { scope: "col" }, t("lb.col.system")),
      h("th", { scope: "col" }, t("lb.col.type")),
      h("th", { scope: "col" }, t("lb.col.score")),
      h("th", { scope: "col", class: "num" }, t("lb.col.categories")),
      h("th", { scope: "col" }, t("lb.col.basis")))));
  const body = h("tbody");
  let rank = 0;
  let last = null;
  let position = 0;
  for (const r of rows) {
    const sys = idx.systems.get(r.system_id);
    const base = isBaseline(sys);
    if (!base) {
      position += 1;
      if (r.value !== last) rank = position;
      last = r.value;
    }
    const ls = r.label_summary;
    body.append(h("tr", { class: base ? "lb-row is-baseline" : "lb-row" },
      h("td", { class: "num lb-rank" }, base ? "—" : String(rank)),
      h("th", { scope: "row", class: "lb-system" }, shortName(sys)),
      h("td", { class: "lb-type" }, base ? t("lb.type.baseline") : (sys?.paradigm || t("lb.type.model"))),
      h("td", { class: "lb-score" }, h("strong", null, pct(r.value)), bar(r.value)),
      h("td", { class: "num" }, r.coverage ? String(r.coverage.categories_scored) : "—"),
      h("td", { class: "lb-basis" }, ls
        ? t("lb.basis.auto", { resolved: ls.fields - ls.unresolved, fields: ls.fields })
        : t(base ? "lb.basis.baseline" : "lb.basis.state"))));
  }
  table.append(body);
  return table;
}

function matrix(doc, idx, track, metric, rows, cats) {
  const cell = new Map();
  for (const r of doc.scores) {
    if (r.scope !== "task" || r.comparable_group !== track.base || r.metric_id !== metric) continue;
    cell.set(`${r.system_id}|${r.task_id}`, r.value);
  }
  const table = h("table", { class: "lb-table lb-matrix" },
    h("thead", null, h("tr", null,
      h("th", { scope: "col" }, t("lb.col.system")),
      cats.map((c) => h("th", { scope: "col", class: "num" }, h("a", { href: buildHash("instance", { task: c }) }, c))),
      h("th", { scope: "col", class: "num" }, t("lb.col.mean")))));
  const body = h("tbody");
  for (const r of rows) {
    const sys = idx.systems.get(r.system_id);
    body.append(h("tr", { class: isBaseline(sys) ? "lb-row is-baseline" : "lb-row" },
      h("th", { scope: "row", class: "lb-system" }, shortName(sys)),
      cats.map((c) => {
        const v = cell.get(`${r.system_id}|${c}`);
        const known = v !== null && v !== undefined;
        return h("td", { class: "num lb-cell", style: known ? `--v:${v}` : null }, known ? (v * 100).toFixed(0) : "—");
      }),
      h("td", { class: "num lb-mean" }, h("strong", null, pct(r.value)))));
  }
  table.append(body);
  return table;
}
