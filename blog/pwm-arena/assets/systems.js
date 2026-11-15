// Systems: one card per configuration, its demo mode stated as recorded, and its
// recorded sessions played turn by turn.
import { demoBadge, dl, hashCode, kindBadge, labelBadge, moduleChip } from "./components.js";
import { t, tEnum } from "./i18n.js";
import { append, h } from "./util.js";

const ORDER = { learned: 0, composed: 0, degenerate_baseline: 1, reference: 2 };
let videos = [];

export function stopSessions() {
  for (const v of videos) v.pause();
  videos = [];
}

export function renderSystems(ctx) {
  const { doc } = ctx;
  const root = h("div", { class: "view systems" },
    h("h1", { class: "view-title" }, t("systems.title")), h("p", { class: "lede" }, t("systems.intro")));
  const systems = doc.systems.slice().sort((a, b) => (ORDER[a.kind] ?? 0) - (ORDER[b.kind] ?? 0));
  const grid = h("div", { class: "sys-grid" });
  for (const sys of systems) {
    const sessions = (doc.sessions || []).filter((x) => x.system_id === sys.id);
    grid.append(h("article", { class: `sys-card kind-${sys.kind}`, id: `sys-${sys.id}` },
      h("header", null, h("h2", null, sys.name), h("div", { class: "chips" }, kindBadge(sys.kind), labelBadge(sys.label), demoBadge(sys.demo?.mode ?? "unavailable")),
        h("code", { class: "fine" }, sys.id)),
      h("div", { class: "split" }, ["P", "D", "R"].map((m) => h("div", { class: `split-cell${(sys.learned_components || []).includes(m) ? " learned" : ""}` },
        moduleChip(m, false, doc.taxonomy), h("span", null, sys.responsibility?.[m] ?? "—"),
        (sys.learned_components || []).includes(m) ? h("span", { class: "badge learned-tag" }, t("kind.learned")) : null))),
      dl([[t("systems.paradigm"), sys.paradigm ?? null],
        [t("systems.modes"), (sys.test_modes || []).join(" · ") || null],
        [t("systems.learned"), (sys.learned_components || []).length ? sys.learned_components.join(", ") : t("systems.none")],
        [t("systems.interface"), sys.interface ?? null],
        [t("instance.budget"), sys.information_budget ?? null],
        [t("systems.revisions"), sys.revisions ? Object.entries(sys.revisions).map(([k, v]) => `${k}: ${v ?? "—"}`).join(" · ") : null],
        [t("systems.demo"), `${tEnum("demo", sys.demo?.mode ?? "unavailable")}${sys.demo?.note ? `. ${sys.demo.note}` : ""}`]]),
      (sys.notes || []).length ? h("ul", { class: "notes" }, sys.notes.map((n) => h("li", null, n))) : null,
      sessions.length ? h("div", { class: "sessions" }, h("h3", null, t("systems.sessions")), sessions.map((x) => sessionPlayer(x))) : null));
  }
  root.append(grid);
  return root;
}

function sessionPlayer(session) {
  const turns = session.turns || [];
  let current = 0;
  const body = h("div", { class: "turn-body", "aria-live": "polite" });
  const tabs = h("div", { class: "seg turn-tabs", role: "group", "aria-label": session.title });
  function draw() {
    for (const [i, b] of [...tabs.children].entries()) b.setAttribute("aria-pressed", String(i === current));
    const turn = turns[current];
    if (!turn) { body.replaceChildren(h("p", { class: "empty" }, "—")); return; }
    const v = turn.media?.video;
    let video = null;
    if (v) {
      video = h("video", { controls: true, muted: true, playsinline: true, preload: "none", poster: turn.media.poster?.url ?? null, src: v.url, width: v.width, height: v.height, "aria-label": t("session.turn", { n: turn.turn }) });
      videos.push(video);
    }
    body.replaceChildren();
    append(body, [
      h("div", { class: "turn-io" },
        h("div", null, h("h4", null, t("session.user")), h("blockquote", { class: "prompt" }, turn.user_input ?? "—")),
        h("div", null, h("h4", null, t("session.model")), turn.model_output === null || turn.model_output === undefined
          ? h("p", { class: "val-missing" }, t("session.nooutput")) : h("pre", { class: "code" }, turn.model_output)),
        h("div", null, h("h4", null, t("session.outcome")), h("span", { class: `badge cp cp-${turn.status === "completed" ? "pass" : "fail"}` }, tEnum("run", turn.status)),
          turn.reason ? h("p", { class: "reason" }, turn.reason) : null)),
      video ? h("div", { class: "frame session-frame", style: `aspect-ratio:${v.width}/${v.height}` }, video) : null]);
  }
  turns.forEach((turn, i) => tabs.append(h("button", { type: "button", class: `seg-btn turn-${turn.status}`, onclick: () => { stopSessions(); current = i; draw(); } },
    `${t("session.turn", { n: turn.turn })} · ${tEnum("run", turn.status)}`)));
  draw();
  const acc = session.acceptance || {};
  return h("article", { class: "session" },
    h("header", null, h("h4", null, session.title ?? session.session_id), demoBadge(session.mode ?? "recorded"),
      h("span", { class: `badge cp cp-${acc.status === "passed_limited" ? "pass" : "fail"}` }, `${t("session.acceptance")}: ${tEnum("acc", acc.status)}`)),
    acc.reason ? h("p", { class: "reason" }, acc.reason) : null,
    tabs, body,
    h("p", { class: "fine" }, t("session.exploration")),
    (session.limits || []).length ? h("ul", { class: "fine" }, session.limits.map((l) => h("li", null, l))) : null,
    (session.evidence || []).length ? h("ul", { class: "ev-list" }, session.evidence.map((e) => h("li", null, hashCode(e)))) : null);
}
