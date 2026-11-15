// Evidence player: oracle and system streams on one timeline. Each stream shows the
// frame whose own presentation timestamp covers the timeline position; frame numbers
// are never assumed to line up across streams.
import { cpBadge, kindBadge, labelBadge, labelCell, runStatusBadge, taskTitle } from "./components.js";
import { t } from "./i18n.js";
import { buildHash, copyText, fmtJSONValue, fmtSeconds, frameAt, h, inViewer, s, store, uniq } from "./util.js";

const KIND_ORDER = { reference: 0, learned: 1, composed: 1, degenerate_baseline: 2 };
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
let active = null; // the live player, so the router can stop it

export function stopPlayer() {
  if (active) active.destroy();
  active = null;
}

export function renderPlayer(ctx, params) {
  const { doc, idx } = ctx;
  const mediaTasks = doc.tasks.filter((task) => doc.runs.some((r) => r.task_id === task.id && r.media?.video));
  const root = h("div", { class: "view player-view" });
  root.append(h("h1", { class: "view-title" }, t("player.title")));
  if (!mediaTasks.length) {
    root.append(h("p", { class: "empty" }, t("player.notask")));
    return root;
  }
  const task = idx.tasks.get(params.task) && mediaTasks.includes(idx.tasks.get(params.task)) ? idx.tasks.get(params.task) : mediaTasks[0];
  const instanceIds = uniq(doc.runs.filter((r) => r.task_id === task.id && r.media?.video).map((r) => r.instance_id));
  const instId = instanceIds.includes(params.inst) ? params.inst : instanceIds[0];
  const instance = (task.instances || []).find((i) => i.instance_id === instId) || null;
  const instRuns = (idx.runsByInstance.get(instId) || []).slice();
  const branches = uniq([...(instance?.branches || []), ...instRuns.map((r) => r.branch)]);
  const branch = branches.includes(params.br) ? params.br : branches[0];
  const pairable = branches.length === 2;
  const state = {
    task: task.id, inst: instId, br: branch,
    lay: pairable && params.lay === "paired" ? "paired" : "streams",
    cp: params.cp, t: Number.isFinite(Number(params.t)) ? Number(params.t) / 1000 : 0,
  };
  let showRoi = store.get("pwm-arena.roi", true) !== false;
  const sysOf = (run) => idx.systems.get(run.system_id);
  const order = (a, b) => (KIND_ORDER[sysOf(a)?.kind] ?? 1) - (KIND_ORDER[sysOf(b)?.kind] ?? 1) || a.system_id.localeCompare(b.system_id);
  const shownBranches = state.lay === "paired" ? branches : [state.br];
  const shownRuns = instRuns.filter((r) => shownBranches.includes(r.branch)).sort(order);
  const mediaRuns = shownRuns.filter((r) => r.media?.video);
  const noMedia = shownRuns.filter((r) => !r.media?.video);

  // ---------------------------------------------------------------- pickers
  const navigate = (patch) => ctx.go("player", { ...hashState(), t: 0, ...patch });
  const hashState = () => ({ task: state.task, inst: state.inst, br: state.br, lay: state.lay === "paired" ? "paired" : undefined,
    cp: state.cp, t: Math.round(cursor * 1000) || undefined });
  const taskSel = h("select", { id: "pl-task", onchange: (e) => navigate({ task: e.target.value, inst: undefined, br: undefined, cp: undefined }) },
    mediaTasks.map((tk) => h("option", { value: tk.id, selected: tk.id === task.id }, `${tk.id} · ${tk.title}`)));
  const instSel = h("select", { id: "pl-inst", onchange: (e) => navigate({ inst: e.target.value, br: undefined, cp: undefined }) },
    instanceIds.map((id) => h("option", { value: id, selected: id === instId }, id)));
  const branchBtns = h("div", { class: "seg", role: "group", "aria-labelledby": "pl-br-l" },
    branches.map((b) => h("button", { type: "button", class: "seg-btn", "aria-pressed": String(b === state.br && state.lay !== "paired"),
      onclick: () => navigate({ br: b, lay: undefined, t: Math.round(cursor * 1000) || undefined }) },
    `${b}${instance?.branch_meaning?.[b] ? ` · ${instance.branch_meaning[b]}` : ""}`)));
  const layoutBtns = h("div", { class: "seg", role: "group", "aria-labelledby": "pl-lay-l" },
    h("button", { type: "button", class: "seg-btn", "aria-pressed": String(state.lay === "streams"),
      onclick: () => navigate({ lay: undefined, t: Math.round(cursor * 1000) || undefined }) }, t("player.layout.streams")),
    h("button", { type: "button", class: "seg-btn", "aria-pressed": String(state.lay === "paired"), disabled: !pairable,
      onclick: () => navigate({ lay: "paired", t: Math.round(cursor * 1000) || undefined }) }, t("player.layout.paired")));
  root.append(h("div", { class: "pickers" },
    h("div", { class: "field" }, h("label", { for: "pl-task" }, t("player.task")), taskSel),
    h("div", { class: "field" }, h("label", { for: "pl-inst" }, t("player.instance")), instSel),
    h("div", { class: "field" }, h("span", { class: "label", id: "pl-br-l" }, t("player.branch")), branchBtns),
    h("div", { class: "field" }, h("span", { class: "label", id: "pl-lay-l" }, t("player.layout")), layoutBtns)),
  h("div", { class: "player-task" }, h("code", { class: "sid" }, task.id), taskTitle(task, { block: true }),
    h("a", { class: "link-btn", href: buildHash("instance", { task: task.id }) }, t("link.detail"))));

  // ---------------------------------------------------------------- notices
  const notes = h("div", { class: "player-notes" });
  const fpsList = mediaRuns.map((r) => `${sysOf(r)?.name ?? r.system_id}${state.lay === "paired" ? ` (${r.branch})` : ""}: ${r.media.video.fps ?? "?"} fps, ${r.media.video.frames ?? r.media.video.timestamps_seconds?.length ?? "?"} frames, ${r.media.video.width}×${r.media.video.height}`);
  const distinctFps = uniq(mediaRuns.map((r) => r.media.video.fps));
  notes.append(h("p", { class: distinctFps.length > 1 ? "note warn" : "note" },
    distinctFps.length > 1 ? t("player.fps", { list: fpsList.join(" · ") }) : `${t("player.fps.same")} ${fpsList.join(" · ")}`));
  if (noMedia.length) {
    notes.append(h("div", { class: "note warn" }, h("p", null, t("player.nomedia")),
      h("ul", null, noMedia.map((r) => h("li", null, h("strong", null, sysOf(r)?.name ?? r.system_id), ` · ${r.branch} · `,
        runStatusBadge(r.status), r.status_reason ? ` ${r.status_reason}` : r.checkpoints?.length ? ` ${r.checkpoints[0].readout_source} readout, no frames` : "")))));
  }
  root.append(notes);

  // ---------------------------------------------------------------- tiles
  const tiles = [];
  const stage = h("div", { class: `stage lay-${state.lay}${showRoi ? " roi-on" : ""} n${Math.min(6, mediaRuns.length)}` });
  const tileFor = (run) => {
    const sys = sysOf(run);
    const v = run.media.video;
    const ts = Array.isArray(v.timestamps_seconds) && v.timestamps_seconds.length ? v.timestamps_seconds
      : Array.from({ length: v.frames || 0 }, (_, i) => i / (v.fps || 1));
    const video = h("video", { muted: true, playsinline: true, preload: "none", poster: run.media.poster?.url ?? null,
      src: v.url, "aria-label": `${sys?.name ?? run.system_id}, branch ${run.branch}`, width: v.width, height: v.height });
    video.muted = true;
    const overlay = s("svg", { class: "roi", viewBox: `0 0 ${v.width || 16} ${v.height || 9}`, preserveAspectRatio: "none", "aria-hidden": "true" });
    const msg = h("p", { class: "tile-msg", hidden: true });
    const readout = h("p", { class: "tile-readout num" }, "—");
    const frame = h("div", { class: "frame", style: `aspect-ratio:${v.width || 16}/${v.height || 9}` }, video, overlay, msg);
    const el = h("figure", { class: `tile kind-${sys?.kind ?? "unknown"}` },
      h("figcaption", null,
        h("span", { class: "tile-name" }, sys?.name ?? run.system_id),
        h("span", { class: "tile-badges" }, sys ? kindBadge(sys.kind) : null, labelBadge(run.label || sys?.label),
          state.lay === "paired" ? h("span", { class: "badge branch" }, run.branch) : null),
        h("span", { class: "tile-meta num" }, `${v.width}×${v.height} · ${v.fps ?? "?"} fps · ${ts.length} frames`)),
      frame, readout);
    const tile = { run, sys, video, ts, overlay, readout, el, msg, loaded: false, failed: false };
    video.addEventListener("error", () => {
      tile.failed = true;
      msg.hidden = false;
      msg.textContent = t("player.loadfail", { name: v.url });
    });
    return tile;
  };
  if (state.lay === "paired") {
    const systems = uniq(mediaRuns.map((r) => r.system_id));
    stage.append(h("div", { class: "pair-head" }), ...branches.map((b) => h("p", { class: "pair-col-h" }, `${b}${instance?.branch_meaning?.[b] ? ` · ${instance.branch_meaning[b]}` : ""}`)));
    for (const sysId of systems) {
      stage.append(h("p", { class: "pair-row-h" }, idx.systems.get(sysId)?.name ?? sysId));
      for (const b of branches) {
        const run = mediaRuns.find((r) => r.system_id === sysId && r.branch === b);
        if (run) {
          const tile = tileFor(run);
          tiles.push(tile);
          stage.append(tile.el);
        } else stage.append(h("div", { class: "tile missing" }, h("p", null, `${b}: ${t("player.nostreamtime")}`)));
      }
    }
  } else {
    for (const run of mediaRuns) {
      const tile = tileFor(run);
      tiles.push(tile);
      stage.append(tile.el);
    }
  }

  const maxTime = Math.max(0, ...tiles.map((tile) => tile.ts[tile.ts.length - 1] ?? 0));
  let cursor = Math.min(Math.max(0, state.t), maxTime);
  let playing = false;
  let raf = 0;
  let last = 0;
  let speed = SPEEDS.includes(store.get("pwm-arena.speed", 1)) ? store.get("pwm-arena.speed", 1) : 1;

  // ---------------------------------------------------------------- controls
  const playBtn = h("button", { type: "button", class: "btn primary", id: "pl-play" }, t("player.play"));
  const prevBtn = h("button", { type: "button", class: "btn", id: "pl-prev", "aria-label": t("player.prev") }, "◀︎ 1");
  const nextBtn = h("button", { type: "button", class: "btn", id: "pl-next", "aria-label": t("player.next") }, "1 ▶︎");
  const speedSel = h("select", { id: "pl-speed", onchange: (e) => {
    speed = Number(e.target.value);
    store.set("pwm-arena.speed", speed);
    for (const tile of tiles) tile.video.playbackRate = speed;
  } }, SPEEDS.map((v) => h("option", { value: v, selected: v === speed }, `${v}×`)));
  const roiBox = h("input", { type: "checkbox", id: "pl-roi", checked: showRoi, onchange: (e) => {
    showRoi = e.target.checked;
    store.set("pwm-arena.roi", showRoi);
    stage.classList.toggle("roi-on", showRoi);
  } });
  const range = h("input", { type: "range", id: "pl-range", min: 0, max: maxTime.toFixed(4), step: 0.001, value: cursor, "aria-label": t("player.time") });
  const clock = h("output", { class: "clock num", for: "pl-range" }, fmtSeconds(cursor));
  // Hidden inside an artifact viewer: the frame's own address is not a link anyone can open.
  const shareBtn = h("button", { type: "button", class: "btn ghost", hidden: inViewer() }, t("player.share"));
  const status = h("span", { class: "toast", role: "status" });
  root.append(stage, h("div", { class: "transport" },
    h("div", { class: "transport-row" }, playBtn, prevBtn, nextBtn,
      h("label", { class: "inline", for: "pl-speed" }, t("player.speed")), speedSel,
      h("label", { class: "inline check", for: "pl-roi" }, roiBox, t("player.roi")), clock, shareBtn, status),
    h("div", { class: "scrub" }, range)));

  // Lanes: one per tile, checkpoint and event marks at that stream's own media time.
  const lanes = h("div", { class: "lanes", "aria-hidden": "true" });
  const heads = [];
  for (const tile of tiles) {
    const track = h("div", { class: "lane-track" });
    for (const cp of tile.run.checkpoints || []) {
      if (cp.media_seconds === null || cp.media_seconds === undefined) continue;
      track.append(h("button", { type: "button", tabindex: "-1", class: `mark cp-mark cp-${cp.status}`, title: `${cp.checkpoint_id} · frame ${cp.observation_frame} · ${fmtSeconds(cp.media_seconds)} · ${cp.status}`,
        style: `left:${pctOf(cp.media_seconds)}%`, onclick: () => { selectCp(cp.checkpoint_id); seek(cp.media_seconds); } }, "◆"));
    }
    for (const ev of tile.run.events || []) {
      if (ev.media_seconds === null || ev.media_seconds === undefined) continue;
      track.append(h("span", { class: "mark ev-mark", title: `${ev.kind}: ${ev.text} · ${fmtSeconds(ev.media_seconds)}`, style: `left:${pctOf(ev.media_seconds)}%` }, "▲"));
    }
    const end = tile.ts[tile.ts.length - 1] ?? 0;
    track.append(h("span", { class: "lane-extent", style: `left:${pctOf(tile.ts[0] ?? 0)}%;width:${pctOf(end) - pctOf(tile.ts[0] ?? 0)}%` }));
    const head = h("span", { class: "lane-head" });
    heads.push(head);
    track.append(head);
    lanes.append(h("div", { class: "lane" }, h("span", { class: "lane-label", title: tile.sys?.name ?? tile.run.system_id }, `${tile.sys?.name ?? tile.run.system_id}${state.lay === "paired" ? ` · ${tile.run.branch}` : ""}`), track));
  }
  root.append(h("div", { class: "lanes-wrap" }, lanes,
    h("p", { class: "fine" }, t("player.marks")), h("p", { class: "fine keys" }, t("player.keys"))));
  function pctOf(sec) {
    return maxTime > 0 ? Math.max(0, Math.min(100, (sec / maxTime) * 100)) : 0;
  }

  // ---------------------------------------------------------------- checkpoints
  const cpIds = uniq(shownRuns.flatMap((r) => (r.checkpoints || []).map((c) => c.checkpoint_id)));
  if (!cpIds.includes(state.cp)) state.cp = cpIds[cpIds.length - 1];
  const cpTabs = h("div", { class: "seg cp-tabs", role: "group", "aria-label": t("player.checkpoint") });
  const cpBody = h("div", { class: "cp-body" });
  function selectCp(id) {
    state.cp = id;
    for (const b of cpTabs.children) b.setAttribute("aria-pressed", String(b.dataset.cp === id));
    drawCheckpoint();
    drawRoi();
    syncHash();
  }
  for (const id of cpIds) {
    const step = shownRuns.flatMap((r) => r.checkpoints || []).find((c) => c.checkpoint_id === id)?.logical_step;
    cpTabs.append(h("button", { type: "button", class: "seg-btn", dataset: { cp: id }, "aria-pressed": String(id === state.cp), onclick: () => selectCp(id) },
      `${id}${step !== undefined ? ` · step ${step}` : ""}`));
  }
  function drawCheckpoint() {
    const cards = [];
    for (const run of shownRuns) {
      const cp = (run.checkpoints || []).find((c) => c.checkpoint_id === state.cp);
      const sys = sysOf(run);
      if (!cp) continue;
      const goto = cp.media_seconds !== null && cp.media_seconds !== undefined && run.media?.video
        ? h("button", { type: "button", class: "link-btn", onclick: () => seek(cp.media_seconds) },
          `${t("player.goto", { i: cp.observation_frame })} · ${fmtSeconds(cp.media_seconds)}`)
        : h("span", { class: "fine" }, t("player.nostreamtime"));
      cards.push(h("article", { class: `cp-card kind-${sys?.kind ?? "unknown"}` },
        h("header", null, h("strong", null, sys?.name ?? run.system_id), h("span", { class: "badge branch" }, run.branch), cpBadge(cp.status)),
        h("p", { class: "fine" }, `${t("player.source")}: ${cp.readout_source}${cp.reader_id ? ` · ${cp.reader_id}` : ""} · logical step ${cp.logical_step ?? "—"} · `, goto),
        cp.reason ? h("p", { class: "reason" }, cp.reason) : null,
        h("div", { class: "table-scroll" }, h("table", { class: "field-table" },
          h("thead", null, h("tr", null, ["field.field", "field.expected", "field.observed", "field.status", "field.margin", ...(cp.label_protocol ? ["field.label"] : [])].map((k) => h("th", { scope: "col" }, t(k))))),
          h("tbody", null, (cp.fields || []).map((f) => h("tr", null,
            h("th", { scope: "row" }, h("code", null, f.field)),
            h("td", null, h("code", null, fmtJSONValue(f.expected))),
            h("td", null, f.observed === null || f.observed === undefined ? h("span", { class: "val-missing" }, "null") : h("code", null, fmtJSONValue(f.observed))),
            h("td", null, cpBadge(f.status)),
            h("td", { class: "num" }, f.margin === null || f.margin === undefined ? "—" : f.margin.toFixed(2)),
            cp.label_protocol ? h("td", { class: "col-label" }, labelCell(f)) : null))))),
        cp.changed_field_f1 !== null && cp.changed_field_f1 !== undefined ? h("p", { class: "fine" }, `${t("field.f1")}: ${cp.changed_field_f1.toFixed(2)}`) : null));
    }
    cpBody.replaceChildren(...cards);
  }
  const prompt = shownRuns.find((r) => r.prompt)?.prompt;
  const events = shownRuns.flatMap((r) => (r.events || []).map((e) => ({ ...e, run: r })));
  root.append(h("section", { class: "block cp-panel", "aria-labelledby": "cp-h" },
    h("h2", { id: "cp-h" }, t("player.checkpoint")), cpTabs, cpBody),
  h("section", { class: "block two-col" },
    h("div", null, h("h3", null, t("player.prompt")), prompt ? h("blockquote", { class: "prompt" }, prompt) : h("p", { class: "fine" }, "—")),
    h("div", null, h("h3", null, t("player.events")), events.length ? h("ul", { class: "events" }, events.map((e) => h("li", null,
      h("strong", null, sysOf(e.run)?.name ?? e.run.system_id), ` · ${e.run.branch} · step ${e.logical_step ?? "—"} · ${e.kind}: ${e.text} · `,
      e.media_seconds === null || e.media_seconds === undefined ? h("em", null, "no media time") : fmtSeconds(e.media_seconds)))) : h("p", { class: "fine" }, t("player.noevents")))));

  function drawRoi() {
    for (const tile of tiles) {
      const cp = (tile.run.checkpoints || []).find((c) => c.checkpoint_id === state.cp);
      const w = tile.run.media.video.width || 1;
      const hh = tile.run.media.video.height || 1;
      const shapes = [];
      for (const f of cp?.fields || []) {
        if (!Array.isArray(f.roi) || f.roi.length !== 4) continue;
        let [x, y, rw, rh] = f.roi;
        if ([x, y, rw, rh].every((n) => n <= 1)) { x *= w; y *= hh; rw *= w; rh *= hh; }
        // Label size follows the stream width so it stays legible when a tile is drawn small.
        const fs = Math.max(12, Math.round(w / 30));
        shapes.push(s("rect", { x, y, width: rw, height: rh, class: `roi-box st-${f.status}`, fill: "none", "vector-effect": "non-scaling-stroke" }),
          s("text", { x: x + 4, y: Math.max(fs, y - fs / 3), class: `roi-label st-${f.status}`, fill: "currentColor",
            style: `font-size:${fs}px;stroke-width:${(fs / 5).toFixed(1)}px` },
            // The box belongs to the checkpoint's observation frame, not to every frame shown.
            `${f.field}: ${f.status}${typeof cp.media_seconds === "number" ? ` @ ${cp.media_seconds.toFixed(2)} s` : ""}`));
      }
      tile.overlay.replaceChildren(...shapes);
    }
  }

  // ---------------------------------------------------------------- clock
  let loadingPromise = null;
  function ensureLoaded() {
    if (!loadingPromise) {
      status.textContent = t("player.loading");
      loadingPromise = Promise.all(tiles.map((tile) => new Promise((resolve) => {
        const v = tile.video;
        if (v.readyState >= 2) { tile.loaded = true; resolve(); return; }
        const done = () => { tile.loaded = v.readyState >= 1; v.removeEventListener("loadeddata", done); v.removeEventListener("error", done); resolve(); };
        v.addEventListener("loadeddata", done);
        v.addEventListener("error", done);
        setTimeout(done, 20000);
        v.preload = "auto";
        v.load();
      }))).then(() => { status.textContent = ""; });
    }
    return loadingPromise;
  }

  function paint() {
    range.value = String(cursor);
    clock.textContent = fmtSeconds(cursor);
    range.setAttribute("aria-valuetext", fmtSeconds(cursor));
    const pct = pctOf(cursor);
    for (const head of heads) head.style.left = `${pct}%`;
    for (const tile of tiles) {
      const n = tile.ts.length;
      const i = frameAt(tile.ts, cursor);
      const lastT = tile.ts[n - 1];
      let text;
      if (i === null) text = t("player.before");
      else if (cursor > lastT + 1e-6) text = `${t("player.frame", { i, n: n - 1, t: fmtSeconds(tile.ts[i]) })} · ${t("player.after", { t: fmtSeconds(lastT) })}`;
      else text = t("player.frame", { i, n: n - 1, t: fmtSeconds(tile.ts[i]) });
      tile.readout.textContent = text;
      tile.el.classList.toggle("ended", i !== null && cursor > lastT + 1e-6);
      if (!playing && tile.loaded && !tile.failed) {
        const target = (i === null ? tile.ts[0] : tile.ts[i]) + 0.001;
        if (Math.abs(tile.video.currentTime - target) > 0.0005) tile.video.currentTime = target;
      }
    }
  }

  function tick(now) {
    const dt = (now - last) / 1000;
    last = now;
    cursor = Math.min(maxTime, cursor + dt * speed);
    for (const tile of tiles) {
      if (!tile.loaded || tile.failed) continue;
      const v = tile.video;
      const first = tile.ts[0];
      const lastT = tile.ts[tile.ts.length - 1];
      if (cursor >= first && cursor <= lastT) {
        const fps = tile.run.media.video.fps || 20;
        if (Math.abs(v.currentTime - cursor) > Math.max(0.12, 2 / fps)) v.currentTime = cursor;
        if (v.paused) { v.playbackRate = speed; v.play().catch(() => {}); }
      } else if (!v.paused) {
        v.pause();
        v.currentTime = (cursor > lastT ? lastT : first) + 0.001;
      }
    }
    paintLight();
    if (cursor >= maxTime) { pause(); return; }
    raf = requestAnimationFrame(tick);
  }

  function paintLight() {
    // During playback only the readouts and the playhead move; videos run themselves.
    const saved = playing;
    playing = true;
    paint();
    playing = saved;
  }

  async function play() {
    if (playing) return;
    await ensureLoaded();
    if (cursor >= maxTime - 1e-6) cursor = 0;
    playing = true;
    playBtn.textContent = t("player.pause");
    playBtn.setAttribute("aria-pressed", "true");
    for (const tile of tiles) {
      if (!tile.loaded || tile.failed) continue;
      tile.video.playbackRate = speed;
      tile.video.currentTime = Math.min(Math.max(cursor, tile.ts[0]), tile.ts[tile.ts.length - 1]) + 0.001;
    }
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    cancelAnimationFrame(raf);
    const was = playing;
    playing = false;
    for (const tile of tiles) tile.video.pause();
    playBtn.textContent = t("player.play");
    playBtn.setAttribute("aria-pressed", "false");
    if (was) {
      paint();
      syncHash();
    }
  }

  async function seek(sec) {
    pause();
    cursor = Math.min(Math.max(0, sec), maxTime);
    paint();
    syncHash();
    await ensureLoaded();
    paint();
  }

  function step(dir) {
    const times = uniq(tiles.flatMap((tile) => tile.ts)).sort((a, b) => a - b);
    const next = dir > 0 ? times.find((x) => x > cursor + 1e-6) : times.filter((x) => x < cursor - 1e-6).pop();
    seek(next ?? (dir > 0 ? maxTime : 0));
  }

  let hashTimer = 0;
  function syncHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => ctx.replaceHash("player", hashState()), 150);
  }

  playBtn.addEventListener("click", () => (playing ? pause() : play()));
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  range.addEventListener("input", () => seek(Number(range.value)));
  shareBtn.addEventListener("click", async () => {
    pause();
    ctx.replaceHash("player", hashState());
    status.textContent = (await copyText(location.href)) ? t("filter.copied") : t("filter.copyfail");
  });
  const onKey = (e) => {
    const tag = e.target?.tagName;
    if (e.altKey || e.ctrlKey || e.metaKey || ["INPUT", "SELECT", "TEXTAREA"].includes(tag) || document.querySelector("dialog[open]")) return;
    if (e.key === " " && tag !== "BUTTON" && tag !== "A") { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if ((e.key === "a" || e.key === "A") && branches.includes("A")) navigate({ br: "A", lay: undefined, t: Math.round(cursor * 1000) || undefined });
    else if ((e.key === "b" || e.key === "B") && branches.includes("B")) navigate({ br: "B", lay: undefined, t: Math.round(cursor * 1000) || undefined });
  };
  document.addEventListener("keydown", onKey);
  const onHide = () => { if (document.hidden) pause(); };
  document.addEventListener("visibilitychange", onHide);

  drawCheckpoint();
  drawRoi();
  paint();
  if (cursor > 0) ensureLoaded().then(paint);

  stopPlayer();
  active = {
    destroy() {
      pause();
      clearTimeout(hashTimer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onHide);
      for (const tile of tiles) { tile.video.removeAttribute("src"); tile.video.load(); }
    },
    // Exposed for browser QA only: reads state, never changes evidence.
    debug: () => ({ cursor, playing, maxTime, tiles: tiles.map((tile) => ({ run: tile.run.run_id, currentTime: tile.video.currentTime,
      readyState: tile.video.readyState, frame: frameAt(tile.ts, cursor), fps: tile.run.media.video.fps })) }),
  };
  window.__pwmArena.player = active;
  return root;
}
