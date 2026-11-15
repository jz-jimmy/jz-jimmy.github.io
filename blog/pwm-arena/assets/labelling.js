// Blind labelling: one query at a time, only the picture (or the pictures of a short clip),
// the question and the options.
// Labels stay in this browser (localStorage) and, inside an artifact viewer that grants
// the db capability, are also written to the page's store under the viewer's own path.
import { t } from "./i18n.js";
import { capability, h, reducedMotion, saveFile, store } from "./util.js";

let keyHandler = null;
let clipTimer = null;
// Pictures of a clip query are stepped slower than the clip ran: the question is about
// the change from the first picture to the last, not about speed.
const CLIP_STEP_MS = 250;
const CLIP_HOLD_STEPS = 3;

function stopClip() {
  if (clipTimer) clearInterval(clipTimer);
  clipTimer = null;
}

export function stopLabelling() {
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  stopClip();
}

// A clip query: one picture at a time (looping, or stepped by hand), and the first and
// the last picture side by side underneath.
function clipView(q) {
  const frames = q.frames;
  const n = frames.length;
  const ratio = frames[0].width && frames[0].height ? `aspect-ratio:${frames[0].width}/${frames[0].height}` : null;
  for (const f of frames) new Image().src = f.url;
  let index = 0;
  let tick = 0;
  const img = h("img", { id: "lab-clip-img", src: frames[0].url, alt: "", width: frames[0].width || null, height: frames[0].height || null });
  const count = h("span", { class: "num", id: "lab-clip-count" });
  const slider = h("input", { type: "range", id: "lab-clip-pos", min: "0", max: String(n - 1), step: "1", value: "0", "aria-label": t("label.clip.position") });
  const play = h("button", { type: "button", class: "btn", id: "lab-clip-play" });
  const show = (i) => {
    index = Math.max(0, Math.min(n - 1, i));
    img.src = frames[index].url;
    slider.value = String(index);
    count.textContent = t("label.clip.frame", { i: index + 1, n });
  };
  const setPlaying = (on) => {
    stopClip();
    if (on) {
      tick = index;
      // The last picture is held for a few steps before the loop starts again.
      clipTimer = setInterval(() => { tick = (tick + 1) % (n + CLIP_HOLD_STEPS); show(tick); }, CLIP_STEP_MS);
    }
    play.textContent = on ? t("label.clip.pause") : t("label.clip.play");
    play.setAttribute("aria-pressed", String(on));
  };
  slider.addEventListener("input", () => { setPlaying(false); show(Number(slider.value)); });
  play.addEventListener("click", () => setPlaying(!clipTimer));
  show(0);
  setPlaying(!reducedMotion());
  const end = (f, label) => h("figure", { class: "clip-end" },
    h("img", { src: f.url, alt: "", width: f.width || null, height: f.height || null, loading: "lazy" }), h("figcaption", { class: "fine" }, label));
  return h("div", { class: "label-clip" },
    h("div", { class: "label-img", style: ratio }, img),
    h("div", { class: "clip-controls" }, play, slider, count),
    h("p", { class: "fine" }, t("label.clip.note", { n })),
    h("div", { class: "clip-ends" }, end(frames[0], t("label.clip.first")), end(frames[n - 1], t("label.clip.last"))));
}

function key(packet) {
  return `pwm-arena.labels.${packet}`;
}

export function renderLabelling(ctx) {
  stopLabelling();
  const ann = ctx.doc.annotation || {};
  const queries = ann.queries || [];
  const packet = ann.packet_id || "unknown-packet";
  const root = h("div", { class: "view labelling" },
    h("h1", { class: "view-title" }, t("label.title")), h("p", { class: "lede" }, t("label.intro")),
    ann.instructions ? h("p", { class: "note" }, ann.instructions) : null);
  if (!queries.length) {
    root.append(h("p", { class: "empty" }, t("label.empty")));
    return root;
  }
  const saved = store.get(key(packet), null);
  const state = saved && Array.isArray(saved.labels)
    ? { annotator: saved.annotator || "", labels: saved.labels, skipped: saved.skipped || [], history: saved.history || [] }
    : { annotator: "", labels: [], skipped: [], history: [] };
  let started = Boolean(state.annotator);
  const persistNote = h("p", { class: "fine persist", role: "status" }, t("label.saved.local"));
  const area = h("div", { class: "label-area" });
  root.append(area, persistNote);

  // Optional shared store, behind a feature check.
  let remote = null;
  let remoteIndex = null;
  (async () => {
    const [db, user] = await Promise.all([capability("db"), capability("user")]);
    if (!db || !user) return;
    try {
      const uid = await user.id();
      if (!uid) return;
      const safePacket = packet.replace(/[^A-Za-z0-9_-]/g, "_");
      remote = db.doc(`labels/${uid}/packets/${safePacket}`);
      // One small document per annotator names the packets they have labelled, so the
      // store can be read back without knowing packet ids in advance.
      remoteIndex = { ref: db.doc(`labels/${uid}`), field: `packet_${safePacket}`, written: false };
      persistNote.textContent = `${t("label.saved.local")} ${t("label.saved.store")}`;
    } catch {
      remote = null;
    }
  })();
  let writing = Promise.resolve();
  let pending = false;
  function save() {
    store.set(key(packet), state);
    if (!remote) return;
    if (pending) return;
    pending = true;
    writing = writing.then(async () => {
      pending = false;
      try {
        await remote.set({ schema_version: ann.label_schema?.schema_version || "pwm-human-labels-v1", packet_id: packet,
          annotator: state.annotator, labels: state.labels, updated_utc: new Date().toISOString() });
        if (remoteIndex && !remoteIndex.written) {
          const mark = { [remoteIndex.field]: new Date().toISOString() };
          // update() needs an existing document; the first packet creates it.
          await remoteIndex.ref.update(mark).catch(() => remoteIndex.ref.set(mark));
          remoteIndex.written = true;
        }
      } catch {
        persistNote.textContent = t("label.saved.storefail");
      }
    });
  }

  const done = () => new Set([...state.labels.map((l) => l.query_id), ...state.skipped]);
  const nextQuery = () => queries.find((q) => !done().has(q.query_id));

  function choose(q, label) {
    state.labels = state.labels.filter((l) => l.query_id !== q.query_id);
    state.labels.push({ query_id: q.query_id, label, annotator: state.annotator, labelled_utc: new Date().toISOString() });
    state.history.push({ type: "label", query_id: q.query_id });
    save();
    draw(true);
  }
  function skip(q) {
    state.skipped.push(q.query_id);
    state.history.push({ type: "skip", query_id: q.query_id });
    save();
    draw(true);
  }
  function undo() {
    const last = state.history.pop();
    if (!last) return;
    if (last.type === "label") state.labels = state.labels.filter((l) => l.query_id !== last.query_id);
    else state.skipped = state.skipped.filter((id) => id !== last.query_id);
    save();
    draw(true);
  }
  function exportLabels() {
    const body = { schema_version: ann.label_schema?.schema_version || "pwm-human-labels-v1", packet_id: packet,
      exported_utc: new Date().toISOString(), annotator: state.annotator,
      // No build provenance here: labels must stay blind to where each image came from.
      source: { results_generated_utc: ctx.doc.generated_utc },
      fields: ann.label_schema?.fields || ["query_id", "label", "annotator", "labelled_utc"], labels: state.labels };
    return saveFile(`pwm-human-labels-${packet}-${state.annotator.replace(/[^A-Za-z0-9_-]+/g, "_") || "anon"}.json`, JSON.stringify(body, null, 2) + "\n", "application/json");
  }

  function nameForm() {
    const input = h("input", { id: "lab-name", type: "text", autocomplete: "nickname", required: true, value: state.annotator, "aria-describedby": "lab-name-hint", maxlength: 80 });
    const err = h("p", { class: "reason", role: "alert", hidden: true }, t("label.name.hint"));
    const form = h("form", { class: "name-form", onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { err.hidden = false; input.focus(); return; }
      state.annotator = name;
      started = true;
      save();
      draw(true);
    } }, h("label", { for: "lab-name" }, t("label.name")), input,
    h("p", { class: "fine", id: "lab-name-hint" }, t("label.name.hint")), err,
    h("button", { type: "submit", class: "btn primary" }, t("label.start")));
    return form;
  }

  function draw(focus) {
    stopClip();
    if (!started) {
      area.replaceChildren(nameForm());
      return;
    }
    const q = nextQuery();
    const progress = h("div", { class: "progress" },
      h("p", { class: "num" }, t("label.progress", { done: state.labels.length, total: queries.length, skipped: state.skipped.length })),
      h("progress", { max: queries.length, value: state.labels.length, "aria-hidden": "true" }),
      h("p", { class: "fine" }, `${state.annotator} · `, h("button", { type: "button", class: "link-btn", onclick: () => { started = false; draw(true); } }, t("label.change"))));
    const tools = h("div", { class: "label-tools" },
      h("button", { type: "button", class: "btn", id: "lab-undo", disabled: !state.history.length, onclick: undo }, `${t("label.undo")} (U)`),
      h("button", { type: "button", class: "btn", id: "lab-export", onclick: async () => {
        const r = await exportLabels();
        persistNote.textContent = t(`download.${r}`);
      } }, t("label.export")));
    if (!q) {
      area.replaceChildren(progress, h("div", { class: "label-card done" }, h("p", null, t("label.done")),
        state.skipped.length ? h("button", { type: "button", class: "btn", onclick: () => { state.skipped = []; save(); draw(true); } }, `${t("label.skip")}: ${state.skipped.length} ↺`) : null), tools);
      return;
    }
    const pos = queries.indexOf(q) + 1;
    const img = q.image || {};
    const opts = q.options || [];
    stopClip();
    const picture = Array.isArray(q.frames) && q.frames.length > 1 ? clipView(q)
      : h("div", { class: "label-img", style: img.width && img.height ? `aspect-ratio:${img.width}/${img.height}` : null },
        h("img", { src: img.url, alt: "", width: img.width || null, height: img.height || null, decoding: "async" }));
    const card = h("article", { class: "label-card", "aria-labelledby": "lab-q" },
      h("p", { class: "eyebrow" }, t("label.query", { i: pos, n: queries.length })),
      picture,
      h("h2", { id: "lab-q", class: "label-question" }, q.question),
      h("div", { class: "options", role: "group", "aria-labelledby": "lab-q" }, opts.map((o, i) =>
        h("button", { type: "button", class: "btn option", "data-key": String(i + 1), onclick: () => choose(q, o) },
          h("kbd", null, String(i + 1)), o))),
      h("div", { class: "label-actions" },
        h("button", { type: "button", class: "btn ghost", id: "lab-skip", onclick: () => skip(q) }, `${t("label.skip")} (S)`),
        h("p", { class: "fine" }, t("label.keys", { n: opts.length }))));
    area.replaceChildren(progress, card, tools);
    if (focus) card.querySelector(".option")?.focus({ preventScroll: true });
    keyHandler && document.removeEventListener("keydown", keyHandler);
    keyHandler = (e) => {
      const tag = e.target?.tagName;
      if (e.altKey || e.ctrlKey || e.metaKey || ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || document.querySelector("dialog[open]")) return;
      const cur = nextQuery();
      if (/^[1-9]$/.test(e.key) && cur && Number(e.key) <= (cur.options || []).length) { e.preventDefault(); choose(cur, cur.options[Number(e.key) - 1]); }
      else if ((e.key === "s" || e.key === "S") && cur) { e.preventDefault(); skip(cur); }
      else if (e.key === "u" || e.key === "U") { e.preventDefault(); undo(); }
    };
    document.addEventListener("keydown", keyHandler);
  }
  draw(false);
  return root;
}
