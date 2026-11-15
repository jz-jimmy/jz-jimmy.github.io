// Score against measured cost: one scatter per comparable group and metric, with the
// Pareto frontier of the candidate systems. Numbers come from results.json (`pareto`,
// `costs`, `cost_model`); nothing is computed here except the picture.
import { statusBadge } from "./components.js";
import { t } from "./i18n.js";
import { buildHash, h, s } from "./util.js";

// Two drawings, chosen by the width of the window when the view is rendered: on a narrow
// screen the picture is not shrunk (its text would be unreadable) but drawn narrower, with
// the reference labels inside the plot.
function geometry() {
  const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
  return narrow
    ? { narrow, W: 350, H: 320, M: { top: 30, right: 10, bottom: 46, left: 40 } }
    : { narrow, W: 640, H: 350, M: { top: 30, right: 150, bottom: 46, left: 52 } };
}
const SERIES = 6; // --series-1 .. --series-6; a further candidate is drawn in neutral ink

// 1-2-5 ticks; on a short axis (costs within a factor of two) a finer set, so that at
// least two ticks show.
function niceTicks(lo, hi) {
  for (const mantissas of [[1, 2, 5], [1, 1.5, 2, 3, 4, 5, 7], [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8]]) {
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e += 1) {
      for (const m of mantissas) {
        const v = Number((m * 10 ** e).toPrecision(3));
        if (v >= lo && v <= hi) out.push(v);
      }
    }
    if (out.length >= 2 || mantissas.length > 7) return out;
  }
  return [];
}

// "EdenLive-5B, two denoising steps (offline renderer ...)" -> "EdenLive-5B, two denoising steps"
const shortName = (text) => text.split(" (")[0];

const fmtCost = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const rangeText = (r) => (r.timings > 1 ? `${fmtCost(r.low)}–${fmtCost(r.high)}, ${r.timings} ${t("pareto.timings")}` : `1 ${t("pareto.timing")}`);
const gib = (bytes) => (bytes / 2 ** 30).toFixed(1);

function chartSvg(ctx, chart, axis, slotOf, tip, geo) {
  const { W, H, M, narrow } = geo;
  const pts = chart.points;
  const costed = pts.filter((p) => p.role === "candidate" && p.costs);
  const rangeOf = (p) => p.cost_ranges?.[axis.axis_id] ?? null;
  const xs = costed.flatMap((p) => [p.costs[axis.axis_id], rangeOf(p)?.high ?? p.costs[axis.axis_id]]);
  // Room on both sides in proportion to how far apart the costs are: points that differ by
  // a few percent are not squeezed into the middle of two decades.
  const pad = Math.min(2.5, Math.max(1.3, Math.sqrt(Math.max(...xs) / Math.min(...xs))));
  const lo = Math.min(...xs) / pad, hi = Math.max(...xs) * pad;
  const x = (v) => M.left + (Math.log(v / lo) / Math.log(hi / lo)) * (W - M.left - M.right);
  const y = (v) => H - M.bottom - v * (H - M.top - M.bottom);
  const name = (id) => ctx.idx.systems.get(id)?.name ?? id;
  const parts = [];
  // Recessive grid and axes.
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(s("line", { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v), class: "pz-grid" }),
      s("text", { x: M.left - 8, y: y(v) + 4, class: "pz-tick", "text-anchor": "end" }, v.toFixed(2)));
  }
  for (const v of niceTicks(lo, hi)) {
    parts.push(s("line", { x1: x(v), x2: x(v), y1: H - M.bottom, y2: H - M.bottom + 5, class: "pz-axis" }),
      s("text", { x: x(v), y: H - M.bottom + 18, class: "pz-tick", "text-anchor": "middle" }, String(v)));
  }
  parts.push(s("line", { x1: M.left, x2: W - M.right, y1: H - M.bottom, y2: H - M.bottom, class: "pz-axis" }),
    s("text", { x: M.left, y: H - 8, class: "pz-label" }, `← ${t("pareto.cheaper")}`),
    s("text", { x: W - M.right, y: H - 8, class: "pz-label", "text-anchor": "end" }, `${axis.name} (${axis.unit}, ${t("pareto.log")})`),
    s("text", { x: 2, y: 12, class: "pz-label" }, chart.metric_name));
  // Baselines and references: marks without a cost, drawn as labelled levels.
  const marks = pts.filter((p) => p.role !== "candidate" && p.value !== null).sort((a, b) => b.value - a.value);
  let lastLabelY = -Infinity;
  for (const p of marks) {
    const py = y(p.value);
    // Wide: the label sits right of the plot at the line's height. Narrow: inside the
    // plot, right-aligned just above the line. Either way a label never overlaps the last.
    const ly = Math.max(narrow ? py - 4 : py + 4, lastLabelY + 12);
    lastLabelY = ly;
    const label = `${name(p.system_id).replace(/^Degenerate: /, "").split(" (")[0]} ${p.value.toFixed(2)}`;
    parts.push(s("line", { x1: M.left, x2: W - M.right, y1: py, y2: py, class: `pz-ref pz-${p.role}` }),
      narrow ? s("text", { x: W - M.right - 2, y: ly, class: "pz-reflabel", "text-anchor": "end" }, label)
        : s("text", { x: W - M.right + 6, y: ly, class: "pz-reflabel" }, label));
  }
  // Frontier: a step line through the non-dominated candidates, cheapest first.
  const front = costed.filter((p) => p.frontier[axis.axis_id]).sort((a, b) => a.costs[axis.axis_id] - b.costs[axis.axis_id]);
  if (front.length) {
    // Up to each point's level at its own cost, then right to the next one.
    let d = "";
    front.forEach((p, i) => {
      const px = x(p.costs[axis.axis_id]), py = y(p.value);
      d += i === 0 ? `M ${px} ${y(0)} V ${py}` : ` H ${px} V ${py}`;
    });
    d += ` H ${W - M.right}`;
    // Dashed where the timings do not separate a point on it from its neighbours.
    const unsettled = front.some((p) => p.frontier_stable?.[axis.axis_id] === false);
    parts.push(s("path", { d, class: `pz-frontier${unsettled ? " unsettled" : ""}`, fill: "none" }));
  }
  // Candidates: a ringed dot, a direct label, a larger invisible hit target. Configurations
  // of one system sit close together on the cost axis, so labels go in one column right of
  // the rightmost point and its range, each joined to its dot by its colour key. They stack
  // upwards from the point's level, cheapest lowest, so that a label never lies on the
  // frontier line of its own level.
  const shown = pts.filter((q) => q.role === "candidate" && q.costs)
    .sort((a, b) => a.value - b.value || a.costs[axis.axis_id] - b.costs[axis.axis_id]);
  const longest = Math.max(...shown.map((q) => shortName(name(q.system_id)).length)) * 6.8 + 14;
  const rightmost = Math.max(...shown.map((q) => x(rangeOf(q)?.high ?? q.costs[axis.axis_id])));
  const labelX = Math.max(M.left + 6, Math.min(rightmost + 12, W - M.right - longest));
  let lastPt = Infinity;
  for (const p of shown) {
    const px = x(p.costs[axis.axis_id]), py = y(p.value);
    const labelY = Math.min(py - 9, lastPt - 13);
    lastPt = labelY;
    const slot = slotOf.get(p.system_id);
    const range = rangeOf(p);
    const stable = p.frontier_stable?.[axis.axis_id] !== false;
    const text = `${name(p.system_id)} · ${chart.metric_name} ${p.value.toFixed(3)} · ${axis.name} ${fmtCost(p.costs[axis.axis_id])} ${axis.unit}${range ? ` (${rangeText(range)})` : ""} · ${p.clips} ${t("pareto.clips")}${p.frontier[axis.axis_id] ? ` · ${t("pareto.frontier")}` : ""}${stable ? "" : ` · ${t("pareto.unsettled")}`}`;
    // The range of the timings: from each clip at its fastest (the dot) to its slowest.
    if (range && range.high > range.low) {
      const x2 = x(range.high);
      parts.push(s("line", { x1: px, x2, y1: py, y2: py, class: `pz-range pz-s${slot <= SERIES ? slot : 0}` }),
        s("line", { x1: x2, x2, y1: py - 4, y2: py + 4, class: `pz-range pz-s${slot <= SERIES ? slot : 0}` }));
    }
    const hit = s("circle", { cx: px, cy: py, r: 16, class: "pz-hit", tabindex: "0", role: "img", "aria-label": text });
    const show = () => tip.show(text, px, py);
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("focus", show);
    hit.addEventListener("pointerleave", tip.hide);
    hit.addEventListener("blur", tip.hide);
    parts.push(s("circle", { cx: px, cy: py, r: 7, class: `pz-dot pz-s${slot <= SERIES ? slot : 0}${p.frontier[axis.axis_id] ? " on-frontier" : ""}` }),
      s("circle", { cx: labelX, cy: labelY - 4, r: 3.5, class: `pz-labelkey pz-s${slot <= SERIES ? slot : 0}` }),
      s("text", { x: labelX + 7, y: labelY, class: "pz-ptlabel" }, shortName(name(p.system_id))), hit);
  }
  return s("svg", { viewBox: `0 0 ${W} ${H}`, class: "pz-svg", role: "group",
    "aria-label": `${chart.metric_name}: ${chart.comparable_group}` }, ...parts);
}

function chartCard(ctx, chart, axisId, slotOf) {
  const axis = chart.axes.find((a) => a.axis_id === axisId) ?? chart.axes[0];
  const tipBox = h("div", { class: "pz-tip", role: "status", hidden: "" });
  const plot = h("div", { class: "pz-plot" });
  const geo = geometry();
  const { W, H } = geo;
  const tip = {
    show: (text, px, py) => {
      tipBox.textContent = text;
      tipBox.hidden = false;
      tipBox.style.left = `${(px / W) * 100}%`;
      tipBox.style.top = `${(py / H) * 100}%`;
    },
    hide: () => { tipBox.hidden = true; },
  };
  plot.append(chartSvg(ctx, chart, axis, slotOf, tip, geo), tipBox);
  const name = (id) => ctx.idx.systems.get(id)?.name ?? id;
  const order = { candidate: 0, baseline: 1, reference: 2 };
  const rows = [...chart.points].sort((a, b) => order[a.role] - order[b.role] || b.value - a.value);
  const table = h("div", { class: "table-scroll" }, h("table", { class: "pz-table" },
    h("thead", null, h("tr", null, ["pareto.col.system", "pareto.col.role", "pareto.col.value", "pareto.col.cost", "pareto.col.range", "pareto.col.frontier", "col.status", "pareto.col.clips"]
      .map((k) => h("th", { scope: "col" }, k === "pareto.col.value" ? chart.metric_name : k === "pareto.col.cost" ? `${axis.name} (${axis.unit})` : t(k))))),
    h("tbody", null, rows.map((p) => h("tr", { class: `pz-row role-${p.role}` },
      h("th", { scope: "row" }, p.role === "candidate" && p.costs ? h("span", { class: `pz-key pz-s${slotOf.get(p.system_id) <= SERIES ? slotOf.get(p.system_id) : 0}`, "aria-hidden": "true" }) : null, name(p.system_id)),
      h("td", null, t(`pareto.role.${p.role}`)),
      h("td", { class: "num" }, p.value === null ? "—" : p.value.toFixed(3)),
      h("td", { class: "num" }, p.costs ? [fmtCost(p.costs[axis.axis_id]), p.cost_source === "cost_measurement" && !p.cost_ranges?.[axis.axis_id] ? h("span", { class: "fine pz-retimed" }, ` ${t("pareto.retimed")}`) : null]
        : h("span", { class: "fine" }, p.no_cost_reason)),
      h("td", { class: "num pz-rangecell" }, p.cost_ranges?.[axis.axis_id] ? rangeText(p.cost_ranges[axis.axis_id]) : "—"),
      h("td", { class: "pz-front" }, p.role !== "candidate" || !p.costs ? "—" : [p.frontier[axis.axis_id] ? t("yes") : t("no"),
        p.frontier_stable?.[axis.axis_id] === false ? h("span", { class: "fine pz-unsettled" }, ` · ${t("pareto.unsettled")}`) : null]),
      h("td", null, statusBadge(p.status)),
      h("td", { class: "num" }, String(p.clips)))))));
  return h("article", { class: "pz-card block", "data-chart": chart.chart_id },
    h("header", null, h("h3", null, chart.metric_name, " ", h("code", { class: "fine" }, chart.metric_id)),
      h("p", { class: "fine" }, h("code", null, chart.comparable_group), ` · ${t("pareto.categories")}: ${chart.categories.join(", ")}`)),
    h("ul", { class: "pz-legend" },
      h("li", null, h("span", { class: "pz-key pz-keyline", "aria-hidden": "true" }), t("pareto.frontier")),
      chart.points.some((p) => p.frontier_stable?.[axis.axis_id] === false)
        ? h("li", null, h("span", { class: "pz-key pz-keyline unsettled", "aria-hidden": "true" }), t("pareto.legend.unsettled")) : null,
      chart.points.some((p) => p.cost_ranges?.[axis.axis_id]?.timings > 1)
        ? h("li", null, h("span", { class: "pz-key pz-keyrange", "aria-hidden": "true" }), t("pareto.legend.range")) : null,
      h("li", null, h("span", { class: "pz-key pz-keyref", "aria-hidden": "true" }), t("pareto.legend.marks"))),
    plot,
    h("p", { class: "fine" }, `${axis.name}: ${axis.note}.`),
    h("p", { class: "fine pz-unc" }, chart.uncertainty_note),
    table,
    h("ul", { class: "fine pz-notes" }, chart.notes.map((n) => h("li", null, n))));
}

export function renderPareto(ctx, params) {
  const doc = ctx.doc;
  const charts = doc.pareto || [];
  const axes = charts[0]?.axes ?? [];
  const axisId = axes.some((a) => a.axis_id === params.x) ? params.x : axes[0]?.axis_id;
  // Colour follows the system, in the order systems are listed, across every chart.
  const slotOf = new Map();
  for (const sys of doc.systems) {
    if (charts.some((c) => c.points.some((p) => p.system_id === sys.id && p.role === "candidate" && p.costs))) slotOf.set(sys.id, slotOf.size + 1);
  }
  const model = doc.cost_model;
  const root = h("div", { class: "wrap pareto" },
    h("h1", null, t("pareto.title")),
    h("p", { class: "lede" }, t("pareto.intro")),
    model ? h("div", { class: "pz-model" }, h("p", null, h("strong", null, `${t("pareto.measured_on")}: `), model.allocation),
      h("p", { class: "fine" }, model.usd_per_gpu_hour ? `${model.usd_per_gpu_hour} USD / GPU-hour (${model.usd_source}). ${model.usd_note}` : model.usd_note)) : null);
  if (!charts.length) {
    root.append(h("p", { class: "empty" }, t("pareto.empty")));
    return root;
  }
  root.append(h("div", { class: "pz-axes", role: "group", "aria-label": t("pareto.xaxis") },
    h("span", { class: "fine" }, `${t("pareto.xaxis")}: `),
    axes.map((a) => h("a", { class: "btn seg", href: buildHash("pareto", { x: a.axis_id }), "aria-current": a.axis_id === axisId ? "true" : null }, a.name))));
  for (const chart of charts) root.append(chartCard(ctx, chart, axisId, slotOf));
  const costs = doc.costs || [];
  if (costs.length) {
    root.append(h("section", { class: "block pz-costs" }, h("h2", null, t("pareto.costs.title")),
      h("p", { class: "fine" }, `${t("pareto.costs.what")}: ${costs[0].measured}.`),
      costs.some((c) => c.phases) ? h("p", { class: "fine" }, `${t("pareto.costs.phases")}: ${costs.find((c) => c.phases).phases.measured}.`) : null,
      h("div", { class: "table-scroll" }, h("table", { class: "pz-table" },
        h("thead", null, h("tr", null, ["pareto.costs.run", "pareto.costs.pass", "pareto.costs.seconds", "pareto.costs.denoiser", "pareto.costs.memory", "pareto.costs.gpus", "pareto.costs.video", "pareto.costs.frames", "pareto.costs.settings", "pareto.costs.job"].map((k) => h("th", { scope: "col" }, t(k))))),
        h("tbody", null, costs.map((c) => h("tr", null,
          h("th", { scope: "row" }, h("code", null, c.run_id)),
          h("td", null, h("span", { class: "fine" }, c.timing_pass ?? t("pareto.costs.scored_job"))),
          h("td", { class: "num" }, c.wall_seconds.toFixed(1)),
          h("td", { class: "num" }, c.phases ? `${c.phases.denoiser_seconds.toFixed(2)} · ${c.phases.denoiser_calls}` : "—"),
          h("td", { class: "num" }, c.phases?.peak_gpu_memory_allocated_bytes ? gib(c.phases.peak_gpu_memory_allocated_bytes) : "—"),
          h("td", { class: "num" }, String(c.gpu_count)),
          h("td", { class: "num" }, c.video_seconds ? c.video_seconds.toFixed(2) : "—"),
          h("td", { class: "num" }, c.frames ? `${c.frames} · ${c.width}×${c.height}` : "—"),
          h("td", null, h("span", { class: "fine" }, Object.entries(c.settings || {}).filter(([k]) => !/sha256/.test(k)).map(([k, v]) => `${k} ${v}`).join(", "))),
          h("td", null, h("span", { class: "fine" }, `${c.slurm_job_id ?? "—"} · ${c.node ?? "—"}`)))))))));
  }
  return root;
}
