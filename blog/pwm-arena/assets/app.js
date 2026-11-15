// Boot, data indexes, shell (header, notice, navigation) and the hash router.
import { getLang, keyCount, missing, setLang, t } from "./i18n.js";
import { buildHash, byId, h, parseHash } from "./util.js";
import { renderOverview, renderSection } from "./overview.js";
import { renderResults } from "./results.js";
import { renderPareto } from "./pareto.js";
import { renderLeaderboard } from "./leaderboard.js";
import { renderPlayer, stopPlayer } from "./player.js";
import { renderInstance } from "./detail.js";
import { renderSystems, stopSessions } from "./systems.js";
import { renderLabelling, stopLabelling } from "./labelling.js";
import { openGlossary } from "./glossary.js";

const VIEWS = {
  leaderboard: renderLeaderboard,
  minecraft: renderOverview,
  results: (ctx, p) => renderResults(ctx, p, "minecraft", "results"),
  pareto: renderPareto,
  player: renderPlayer,
  instance: renderInstance,
  systems: renderSystems,
  labelling: renderLabelling,
  existing: (ctx, p) => renderSection(ctx, p, "existing"),
  challenge: (ctx, p) => renderSection(ctx, p, "challenge"),
};
const SECTION_OF = { existing: "existing", challenge: "challenge" };
const VIEW_NAV = [["leaderboard", "view.leaderboard"], ["pareto", "view.pareto"], ["minecraft", "view.overview"], ["results", "view.results"],
  ["player", "view.player"], ["systems", "view.systems"], ["labelling", "view.labelling"]];

const app = document.getElementById("app");
const ctx = { doc: null, idx: null, bundle: readBundleMeta() };
window.__pwmArena = { ctx, missingKeys: missing, keyCount };

function readBundleMeta() {
  const meta = document.querySelector('meta[name="pwm-bundle"]');
  if (!meta) return null;
  try {
    return JSON.parse(meta.getAttribute("content"));
  } catch {
    return null;
  }
}

export function validate(doc) {
  const problems = [];
  if (!doc || typeof doc !== "object") return { fatal: "not an object", problems };
  if (doc.schema_version !== "pwm-results-v1") return { fatal: String(doc.schema_version), problems };
  for (const key of ["sections", "systems", "tasks", "runs", "scores", "coverage", "metrics", "glossary"]) {
    if (!Array.isArray(doc[key])) {
      problems.push(`${key} is missing or not a list; treated as empty`);
      doc[key] = [];
    }
  }
  for (const key of ["pairs", "readers", "sessions"]) if (!Array.isArray(doc[key])) doc[key] = [];
  if (!doc.taxonomy || !Array.isArray(doc.taxonomy.modules)) {
    problems.push("taxonomy.modules is missing");
    doc.taxonomy = { modules: [], test_modes: [] };
  }
  if (doc.tasks.length !== 24) problems.push(`tasks lists ${doc.tasks.length} categories, the contract expects 24`);
  if (doc.coverage.length !== doc.tasks.length * 6) {
    problems.push(`coverage has ${doc.coverage.length} rows, expected ${doc.tasks.length * 6} (six per task)`);
  }
  const sysIds = new Set(doc.systems.map((s) => s.id));
  const unknown = new Set(doc.scores.filter((r) => !sysIds.has(r.system_id)).map((r) => r.system_id));
  if (unknown.size) problems.push(`score rows name systems not listed in systems: ${[...unknown].join(", ")}`);
  for (const r of doc.scores) {
    if (r.value === null && !r.reason) problems.push(`a score row for ${r.system_id} / ${r.task_id ?? "macro"} has no value and no reason`);
  }
  return { fatal: null, problems };
}

function buildIndex(doc) {
  const runsByInstance = new Map();
  for (const run of doc.runs) {
    const key = run.instance_id;
    if (!runsByInstance.has(key)) runsByInstance.set(key, []);
    runsByInstance.get(key).push(run);
  }
  const coverageByTask = new Map();
  for (const row of doc.coverage) {
    if (!coverageByTask.has(row.task_id)) coverageByTask.set(row.task_id, new Map());
    coverageByTask.get(row.task_id).set(row.stage, row);
  }
  return {
    systems: byId(doc.systems),
    tasks: byId(doc.tasks),
    runs: byId(doc.runs, "run_id"),
    runsByInstance,
    coverageByTask,
    sections: byId(doc.sections),
    metrics: byId(doc.metrics),
  };
}

export function go(view, params) {
  location.hash = buildHash(view, params);
}

export function replaceHash(view, params) {
  const next = buildHash(view, params);
  if (location.hash !== next) history.replaceState(null, "", next);
}

ctx.go = go;
ctx.replaceHash = replaceHash;

function renderShell(route) {
  const doc = ctx.doc;
  const section = SECTION_OF[route.view] ?? "minecraft";
  // Section navigation
  const secNav = document.getElementById("section-nav");
  secNav.replaceChildren(...["minecraft", "existing", "challenge"].map((id) => {
    const info = ctx.idx.sections.get(id);
    const current = id === section;
    return h("a", { href: `#${id}`, class: "sec-tab", "aria-current": current ? "page" : null },
      h("span", { class: "sec-name" }, t(`section.${id}`)),
      info ? h("span", { class: `sec-state state-${info.state}` }, t(`section.state.${info.state}`)) : null);
  }));
  secNav.setAttribute("aria-label", t("nav.sections"));
  // View navigation (Minecraft only)
  const viewNav = document.getElementById("view-nav");
  viewNav.hidden = section !== "minecraft";
  viewNav.setAttribute("aria-label", t("nav.views"));
  const active = route.view === "instance" ? "minecraft" : route.view || "leaderboard";
  viewNav.replaceChildren(h("div", { class: "wrap view-tabs" }, ...VIEW_NAV.map(([id, key]) =>
    h("a", { href: `#${id}`, class: "view-tab", "aria-current": id === active ? "page" : null }, t(key)))));
  // Notice band
  const notice = doc.notice || {};
  const fixture = notice.data_label === "infrastructure-fixture" || doc.build?.fixture === true || ctx.bundle?.fixture;
  const build = doc.build || {};
  const commit = build.git_commit ? String(build.git_commit).slice(0, 10) : t("meta.uncommitted");
  // One quiet line; what the preview does and does not claim opens on request.
  document.getElementById("notice").replaceChildren(h("details", { class: `wrap notice-inner${fixture ? " is-fixture" : ""}` },
    h("summary", { class: "notice-flag" },
      h("strong", null, notice.is_benchmark_release === true ? (notice.stage || "release") : t("notice.preview")),
      fixture ? h("span", { class: "fixture-flag" }, t("notice.fixture")) : null,
      h("span", { class: "notice-more" }, t("notice.more"))),
    notice.text ? h("p", { class: "notice-text" }, notice.text) : null,
    h("p", { class: "notice-meta" },
      h("span", null, `${t("meta.generated")} `, h("time", { datetime: doc.generated_utc }, doc.generated_utc ?? "—")),
      h("span", null, `${t("meta.build")} `, h("code", null, `${build.builder ?? "—"} v${build.builder_version ?? "?"} · ${commit}`)),
      ctx.bundle ? h("span", null, `${t("meta.bundle")} `, h("code", null, ctx.bundle.bundle_id)) : null)));
  document.getElementById("lang-toggle").textContent = t("lang.toggle");
  document.getElementById("lang-toggle").setAttribute("aria-label", t("lang.toggle.label"));
  document.getElementById("glossary-open").textContent = t("glossary.open");
  document.querySelector(".brand-tag").textContent = t("brand.tag");
  document.getElementById("foot-text").textContent = t("foot.text");
  document.getElementById("skip-link").textContent = t("skip");
}

let lastView = null;
function route() {
  if (!ctx.doc) return;
  const r = parseHash(location.hash);
  if (!VIEWS[r.view]) r.view = "leaderboard";
  stopPlayer();
  stopSessions();
  stopLabelling();
  renderShell(r);
  const view = VIEWS[r.view];
  let content;
  try {
    content = view(ctx, r.params);
  } catch (error) {
    console.error(error);
    content = errorPanel(String(error && error.message ? error.message : error));
  }
  app.replaceChildren(content);
  app.removeAttribute("aria-busy");
  if (lastView !== null && lastView !== r.view) {
    document.getElementById("main").focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
  lastView = r.view;
  document.title = `PWM-Arena Results`;
}

function errorPanel(message) {
  return h("div", { class: "state-panel error", role: "alert" },
    h("h2", null, t("error.title")), h("p", null, message),
    h("button", { type: "button", class: "btn", onclick: () => boot() }, t("error.retry")));
}

async function boot() {
  app.setAttribute("aria-busy", "true");
  app.replaceChildren(h("div", { class: "state-panel loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), t("loading")));
  try {
    const response = await fetch("results.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(t("error.fetch", { status: response.status }));
    const doc = await response.json();
    const checked = validate(doc);
    if (checked.fatal) throw new Error(t("error.schema", { found: checked.fatal }));
    ctx.doc = doc;
    ctx.problems = checked.problems;
    ctx.idx = buildIndex(doc);
    route();
  } catch (error) {
    app.removeAttribute("aria-busy");
    app.replaceChildren(errorPanel(error.message || String(error)));
  }
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  setLang(getLang() === "zh" ? "en" : "zh");
  route();
});
document.getElementById("glossary-open").addEventListener("click", () => openGlossary(ctx));
document.getElementById("skip-link").addEventListener("click", () => document.getElementById("main").focus());
addEventListener("hashchange", route);
const glossaryDialog = document.getElementById("glossary");
glossaryDialog.addEventListener("click", (e) => { if (e.target === glossaryDialog) glossaryDialog.close(); });
setLang(getLang());
boot();
