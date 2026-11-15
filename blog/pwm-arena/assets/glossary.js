// Methods & glossary drawer: clocks note, labels, metrics, readers, taxonomy.
import { dl, moduleChip, yesNo } from "./components.js";
import { t } from "./i18n.js";
import { h } from "./util.js";

export function openGlossary(ctx) {
  const dialog = document.getElementById("glossary");
  if (!ctx.doc) return;
  const { doc } = ctx;
  const clocks = (doc.glossary || []).find((g) => /clock/i.test(g.term ?? ""));
  const terms = (doc.glossary || []).filter((g) => g !== clocks);
  const close = h("button", { type: "button", class: "btn ghost close", onclick: () => dialog.close() }, t("glossary.close"));
  dialog.replaceChildren(h("div", { class: "drawer" },
    h("header", { class: "drawer-head" }, h("h2", { id: "glossary-h" }, t("glossary.title")), close),
    h("nav", { class: "drawer-toc", "aria-label": t("glossary.title") },
      ["clocks", "terms", "metrics", "readers", ...(doc.auto_labelling ? ["autolabel"] : []), "modes", "taxonomy"].map((id) => h("a", { href: `#g-${id}`, onclick: (e) => {
        e.preventDefault();
        dialog.querySelector(`#g-${id}`)?.scrollIntoView({ block: "start" });
      } }, t(`glossary.${id}`)))),
    h("section", { id: "g-clocks", class: "g-sec clocks" }, h("h3", null, t("glossary.clocks")),
      h("p", null, t("glossary.clocks.text")), clocks && (clocks.definition ?? clocks.text) && (clocks.definition ?? clocks.text) !== t("glossary.clocks.text") ? h("p", { class: "fine" }, clocks.definition ?? clocks.text) : null),
    h("section", { id: "g-terms", class: "g-sec" }, h("h3", null, t("glossary.terms")),
      terms.length ? h("dl", { class: "terms" }, terms.map((g) => h("div", null, h("dt", null, g.term ?? g.id ?? "—"), h("dd", null, g.definition ?? g.text ?? "—")))) : h("p", { class: "fine" }, "—")),
    h("section", { id: "g-metrics", class: "g-sec" }, h("h3", null, t("glossary.metrics")),
      (doc.metrics || []).map((m) => h("article", { class: "metric" },
        h("h4", null, m.name ?? m.id, " ", h("code", null, m.id)),
        m.formula ? h("p", null, m.formula) : null,
        dl(Object.entries(m).filter(([k]) => !["id", "name", "formula"].includes(k)).map(([k, v]) => [k.replace(/_/g, " "), v === null ? null : typeof v === "object" ? JSON.stringify(v) : String(v)]))))),
    h("section", { id: "g-readers", class: "g-sec" }, h("h3", null, t("glossary.readers")),
      (doc.readers || []).length ? doc.readers.map((r) => h("article", { class: "metric" },
        h("h4", null, h("code", null, r.reader_id), ` · ${r.kind ?? ""}`),
        dl([[t("reader.calibration"), r.calibration ?? null], [t("reader.certified"), yesNo(r.certified_for_scoring)],
          ["state classes", (r.state_classes || []).join(", ") || null]]),
        // Limits first: the first one says what the native accuracy does and does not show.
        (r.limits || []).length ? h("ul", { class: "fine reader-limits" }, r.limits.map((l) => h("li", null, l))) : null,
        // One compact block per validation domain (the drawer is narrow): counts first, then
        // accuracy as correct / readable, the truth -> read confusion and the notes.
        (r.validation || []).length ? h("div", { class: "val-list" }, r.validation.map((v) => h("div", { class: "val-row" },
          h("p", { class: "val-head" }, h("code", null, v.domain), " ", h("span", { class: "fine" }, v.truth_source ?? "")),
          dl([["n", String(v.n ?? "—")], [t("val.correct"), count(v.n_correct)], [t("val.readable"), count(v.n_readable)],
            [t("val.not_evaluable"), count(v.n_not_evaluable)],
            [t("val.accuracy"), v.accuracy === null || v.accuracy === undefined ? "—"
              : `${v.accuracy.toFixed(2)}${v.n_correct != null && v.n_readable != null ? ` (${v.n_correct}/${v.n_readable})` : ""}`],
            [t("val.readable_rate"), v.readable_rate === null || v.readable_rate === undefined ? "—" : v.readable_rate.toFixed(2)],
            [t("val.confusion"), confusionText(v.confusion)]], "kv val-kv"),
          (v.notes || []).length ? h("ul", { class: "val-notes fine" }, v.notes.map((n) => h("li", null, n))) : null))) : null,
        null)) : h("p", { class: "fine" }, "—")),
    autoLabelling(doc.auto_labelling),
    h("section", { id: "g-modes", class: "g-sec" }, h("h3", null, t("glossary.modes")),
      h("dl", { class: "terms" }, (doc.taxonomy.test_modes || []).map((m) => h("div", null, h("dt", null, `${m.id} · ${m.name}`), h("dd", null, `${m.given ? `given ${m.given}; ` : ""}${m.measured ? `measures ${m.measured}` : ""}`))))),
    h("section", { id: "g-taxonomy", class: "g-sec" }, h("h3", null, `${t("glossary.taxonomy")} ${doc.taxonomy.version ? `(${doc.taxonomy.version})` : ""}`),
      (doc.taxonomy.modules || []).map((m) => h("div", { class: "tax" }, h("p", null, moduleChip(m.id, true, doc.taxonomy)), h("p", { class: "fine" }, m.question),
        h("ul", null, (m.subcategories || []).map((sc) => h("li", null, h("code", null, sc.id), ` ${sc.name}`))))))));
  dialog.setAttribute("aria-labelledby", "glossary-h");
  if (!dialog.open) dialog.showModal();
  close.focus();
}

// ADR 0013: who labels generated pictures, how each did where the answer is known, and
// how often they agree. Tables scroll inside the narrow drawer.
function autoLabelling(al) {
  if (!al) return null;
  const pct = (x) => (x === null || x === undefined ? "—" : x.toFixed(3));
  const table = (cls, heads, rows) => h("div", { class: "table-scroll" }, h("table", { class: `al-table ${cls}` },
    h("thead", null, h("tr", null, heads.map((k) => h("th", { scope: "col" }, t(k))))),
    h("tbody", null, rows.map((cells) => h("tr", null, cells.map((c, i) => h(i === 0 ? "th" : "td", i === 0 ? { scope: "row" } : null, c)))))));
  const verdict = (v) => (v.certified ? "certified" : v.supports_labels ? "usable" : "refused");
  return h("section", { id: "g-autolabel", class: "g-sec" }, h("h3", null, t("glossary.autolabel")),
    h("p", null, t("al.intro")),
    h("p", { class: "fine" }, t("al.rule", { confidence: Math.round(al.confidence * 100), target: al.target }), " ", h("code", null, al.protocol), " · ", h("code", null, al.adr)),
    h("p", { class: "al-counts" }, t("al.counts", al.label_counts)),
    h("h4", null, t("al.annotators")),
    h("dl", { class: "terms al-annotators" }, al.annotators.map((a) => h("div", null, h("dt", null, h("code", null, a.annotator_id)),
      h("dd", null, a.kind, h("span", { class: "fine" }, ` ${t("al.sees")}: ${a.sees}.`))))),
    h("h4", null, t("al.certification")),
    table("al-cert", ["al.col.annotator", "al.col.class", "al.col.clusters", "al.col.bound", "al.col.occluded", "al.col.verdict"],
      al.certification.map((v) => [h("code", null, v.annotator_id), h("code", null, v.state_class),
        `${v.clusters_decided - v.clusters_wrong} / ${v.clusters_decided}`, pct(v.lower_bound),
        v.occluded_items ? `${v.occluded_cannot_tell} / ${v.occluded_items}` : "—",
        h("span", { class: `al-verdict al-${verdict(v)}` }, h("strong", null, t(`al.verdict.${verdict(v)}`)), v.reason ? h("span", { class: "fine" }, ` ${v.reason}`) : null)])),
    h("details", { class: "al-sets" }, h("summary", null, t("al.sets")),
      table("al-known", ["al.col.annotator", "al.col.class", "al.col.set", "al.col.items", "al.col.interval"],
        al.known_answer.map((r) => [h("code", null, r.annotator_id), h("code", null, r.state_class), r.set,
          `${r.correct} / ${r.decided ?? r.items}`, r.interval95 ? `${pct(r.interval95[0])} – ${pct(r.interval95[1])}` : "—"]))),
    h("h4", null, t("al.agreement")),
    table("al-agree", ["al.col.class", "al.col.annotator", "al.col.same", "al.col.kappa"],
      al.agreement.map((r) => [h("code", null, r.state_class), r.annotators.join(" × "), `${r.same_answer} / ${r.queries}`, pct(r.kappa)])),
    h("h4", null, t("al.limits")),
    h("ul", { class: "fine reader-limits" }, al.limits.map((l) => h("li", null, l))));
}

function count(value) {
  return value === null || value === undefined ? "—" : String(value);
}

// {"14": {"0": 2}} -> "14 → 0 ×2" (truth → read).
function confusionText(confusion) {
  if (!confusion || typeof confusion !== "object") return "—";
  const parts = [];
  for (const [truth, reads] of Object.entries(confusion)) {
    for (const [read, n] of Object.entries(reads || {})) parts.push(`${truth} → ${read} ×${n}`);
  }
  return parts.length ? parts.join("; ") : "—";
}
