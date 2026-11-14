import { frameAt, validateManifest } from "./minecraft-player.mjs";
const assetURL = path => new URL(path.replace(/^\//, ""), import.meta.url).href;
const $ = id => document.getElementById(id);
const node = (tag, text = "", className = "") => { const e = document.createElement(tag); e.textContent = text; e.className = className; return e; };
const videos = [$("native"), $("generated")];
let manifest, entry, cursor = 0, playing = false, animation, anchorTime = 0, anchorCursor = 0, ready = false, loading = null, generation = 0;
let indices = [null, null];
const maxTime = () => Math.max(entry.native.timestamps_seconds.at(-1), entry.model.timestamps_seconds.at(-1));
const streams = () => [entry.native, entry.model];
const query = new URL(location.href).searchParams;
function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("task", entry.task_id); url.searchParams.set("branch", entry.branch);
  url.searchParams.set("t", cursor.toFixed(3)); url.searchParams.set("model", entry.model_id);
  history.replaceState(null, "", url); $("share").href = url.href;
}
function stop() { playing = false; cancelAnimationFrame(animation); $("play").textContent = "播放两路"; if (entry) updateUrl(); }
function showError(message) { $("error").textContent = message; $("error").hidden = false; }
function fieldList(target, values) {
  target.replaceChildren();
  for (const [key, value] of values) target.append(node("dt", key), node("dd", value === null || value === undefined ? "未测 / 未记录" : String(value)));
}
function paint(seconds) {
  cursor = Math.min(maxTime(), Math.max(0, seconds));
  $("timeline").value = String(cursor); $("time").textContent = `${cursor.toFixed(3)} s`;
  $("previous").disabled = !ready || cursor <= 0; $("next").disabled = !ready || cursor >= maxTime();
  const frames = streams().map(stream => frameAt(stream.timestamps_seconds, cursor));
  for (let i = 0; i < videos.length; i++) {
    const index = frames[i], video = videos[i];
    if (ready && index !== null && indices[i] !== index) video.currentTime = streams()[i].timestamps_seconds[index] + 0.000001;
    indices[i] = index;
    video.style.visibility = index === null ? "hidden" : "visible";
    $(i ? "model-frame" : "native-frame").textContent = index === null ? "此媒体时间没有对应帧 / missing coverage" : `Frame ${index} / ${entry.frames - 1}  ·  PTS ${streams()[i].timestamps_seconds[index].toFixed(3)} s${ready ? "" : "  ·  按播放加载"}`;
  }
  const observation = frames[0] === null ? null : entry.observations[frames[0]];
  const pose = observation?.player_pos;
  fieldList($("observation"), [
    ["Recorded frame", observation?.recorded_frame], ["API step", observation?.api_step],
    ["Native counter", observation?.native_player_tick_counter], ["Logical slot", observation?.logical_step],
    ["Phase", observation?.phase], ["Camera position", pose ? [pose.x, pose.y, pose.z].map(v => Number(v).toFixed(3)).join(", ") : null],
  ]);
}
async function ensureMedia() {
  if (ready) return true;
  if (loading) return loading;
  const token = generation;
  $("play").textContent = "加载两路视频…"; $("play").disabled = true;
  loading = Promise.all(videos.map((video, i) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("视频加载超时，请重试。")), 30000);
    const finish = error => { clearTimeout(timeout); video.removeEventListener("loadeddata", loaded); video.removeEventListener("error", failed); error ? reject(error) : resolve(); };
    const loaded = () => finish();
    const failed = () => finish(new Error("真实视频加载失败。请检查连接后重试。"));
    video.addEventListener("loadeddata", loaded); video.addEventListener("error", failed);
    video.preload = "auto"; video.src = assetURL(streams()[i].url); video.load();
  }))).then(() => {
    if (token !== generation) return false;
    ready = true; $("model-placeholder").hidden = true; indices = [null, null]; $("timeline").disabled = false;
    $("error").hidden = true; paint(cursor); return true;
  }).catch(error => { if (token === generation) showError(error.message); return false; })
    .finally(() => { if (token === generation) { loading = null; $("play").disabled = false; $("play").textContent = "播放两路"; } });
  return loading;
}
function animate(now) {
  if (!playing) return;
  const time = anchorCursor + (now - anchorTime) / 1000 * Number($("speed").value);
  paint(time);
  if (time >= maxTime()) stop(); else animation = requestAnimationFrame(animate);
}
function choose(selected, requestedTime = cursor) {
  stop(); generation++; loading = null; ready = false; entry = selected; indices = [null, null];
  for (const video of videos) { video.pause(); video.removeAttribute("src"); video.load(); }
  $("native").poster = assetURL(entry.poster.url); $("generated").removeAttribute("poster"); $("model-placeholder").hidden = false;
  $("task").value = entry.task_id; $("case-title").textContent = `${entry.task_id} / ${entry.title}`;
  $("case-description").textContent = `${entry.description} · ${entry.branch === "single" ? "单轨迹" : `Branch ${entry.branch} · ${entry.branch === "A" ? "干预" : "匹配对照"}`}`;
  $("clip-info").textContent = `${entry.frames} frames / ${entry.fps} fps / native ${entry.native.width}×${entry.native.height} → model ${entry.model.width}×${entry.model.height}`;
  $("budget").textContent = entry.information_budget;
  $("prompt").textContent = JSON.stringify(entry.prompt, null, 2);
  $("events").textContent = entry.events.length ? JSON.stringify(entry.events, null, 2) : "No mid-run rule event recorded for this clip.";
  $("duration").textContent = `0.000 – ${maxTime().toFixed(3)} s`;
  $("timeline").max = String(maxTime()); $("timeline").disabled = true;
  $("play").disabled = false; $("play").textContent = "播放两路"; $("error").hidden = true;
  $("branches").replaceChildren();
  for (const candidate of manifest.entries.filter(e => e.task_id === entry.task_id)) {
    const button = node("button", candidate.branch === "single" ? "Single trajectory" : `Branch ${candidate.branch} · ${candidate.branch === "A" ? "干预" : "对照"}`);
    button.setAttribute("aria-pressed", String(candidate.id === entry.id)); button.addEventListener("click", () => choose(candidate)); $("branches").append(button);
  }
  $("checkpoint-list").replaceChildren();
  for (const checkpoint of entry.checkpoints) {
    const row = node("div", "", "checkpoint");
    const label = node("button", `${checkpoint.checkpoint} ↗`);
    label.disabled = checkpoint.observation_frame === null;
    label.addEventListener("click", async () => { stop(); if (await ensureMedia()) { paint(entry.native.timestamps_seconds[checkpoint.observation_frame]); updateUrl(); } });
    const identity = node("div"); identity.append(label, node("p", `API ${checkpoint.api_step ?? "—"} · slot ${checkpoint.logical_step ?? "—"}`, "small muted"));
    row.append(identity, node("pre", JSON.stringify(checkpoint.native_state, null, 2)), node("span", `${checkpoint.verified ? "原生谓词已核验" : "未核验"} · 像素未校准`, "checkpoint-status"));
    $("checkpoint-list").append(row);
  }
  if (!entry.checkpoints.length) $("checkpoint-list").append(node("p", "该轨迹没有原生谓词检查点；请查看逐帧运动记录。", "small muted"));
  const dl = node("dl"); fieldList(dl, [["Run", entry.run_id], ["Condition", entry.condition_id], ["Mode", "Recorded / R offline oracle proxy"], ["Native job", entry.native_job_id], ["Model job", entry.model_job_id], ["Native profile", entry.native_profile], ["Model source revision", entry.model_source_revision], ["Model weights revision", entry.model_weights_revision], ["Native video SHA256", entry.native.sha256], ["Model video SHA256", entry.model.sha256], ["Semantic score", null]]);
  $("provenance").replaceChildren(dl);
  for (const [id, url] of [["source-evidence", entry.evidence.url], ["native-download", entry.native.url], ["model-download", entry.model.url]]) { $(id).href = assetURL(url); $(id).setAttribute("download", ""); }
  paint(requestedTime); updateUrl();
}
$("play").addEventListener("click", async () => {
  if (playing) { stop(); return; }
  const token = generation;
  if (!await ensureMedia() || token !== generation) return;
  if (cursor >= maxTime()) paint(0);
  playing = true; anchorTime = performance.now(); anchorCursor = cursor;
  $("play").textContent = "暂停两路"; animation = requestAnimationFrame(animate);
});
$("timeline").addEventListener("input", () => { stop(); paint(Number($("timeline").value)); updateUrl(); });
for (const [id, direction] of [["previous", -1], ["next", 1]]) $(id).addEventListener("click", () => {
  stop(); const times = [...new Set(streams().flatMap(s => s.timestamps_seconds))].sort((a, b) => a - b);
  paint(direction < 0 ? times.filter(t => t < cursor - 1e-7).at(-1) ?? 0 : times.find(t => t > cursor + 1e-7) ?? maxTime()); updateUrl();
});
$("speed").addEventListener("change", () => { if (playing) { anchorTime = performance.now(); anchorCursor = cursor; } });
$("zoom").addEventListener("click", () => { const value = document.body.classList.toggle("zoomed"); $("zoom").setAttribute("aria-pressed", String(value)); $("zoom").textContent = value ? "恢复并排" : "放大画面"; });
$("task").addEventListener("change", () => choose(manifest.entries.find(e => e.task_id === $("task").value), 0));
$("share").addEventListener("click", async event => { event.preventDefault(); updateUrl(); try { await navigator.clipboard.writeText(location.href); $("share").textContent = "已复制当前视图 ✓"; } catch { $("share").textContent = "请复制浏览器地址栏中的当前链接"; } });
$("download").addEventListener("click", () => { const blob = new Blob([JSON.stringify({ ...entry, presentation_cursor_seconds: cursor }, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = node("a"); a.href = url; a.download = `${entry.id}-evidence.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
addEventListener("pagehide", stop);
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
try {
  const response = await fetch(assetURL("/minecraft-data/manifest.json"));
  if (!response.ok) throw new Error(`证据清单加载失败 (${response.status})。请刷新重试。`);
  manifest = validateManifest(await response.json());
  const tasks = [...new Set(manifest.entries.map(e => e.task_id))].sort();
  for (const task of tasks) { const option = node("option", `${task} · ${manifest.entries.find(e => e.task_id === task).title}`); option.value = task; $("task").append(option); }
  $("task").disabled = false;
  const selected = manifest.entries.find(e => e.task_id === query.get("task") && e.branch === query.get("branch")) || manifest.entries.find(e => e.task_id === query.get("task")) || manifest.entries[0];
  // Assign before choose(): stop() must never rewrite the deep link using another case.
  entry = selected; choose(selected, Number(query.get("t")) || 0);
  const grid = node("div", "", "coverage-grid");
  for (const [value, title, description] of [[`${tasks.length} / 24`, "本页语义类别", tasks.join(" · ")], [String(manifest.entries.length), "原生 / 模型配对片段", "完整片段 · 分支保留"], [String(manifest.entries.reduce((n, e) => n + e.frames * 2, 0)), "已保存视频帧", "帧不是独立统计样本"], ["—", "语义正确性评分", "独立读取器校准待完成"]]) {
    const item = node("div", "", "coverage-item"); item.append(node("strong", value), node("p", title), node("p", description, "muted")); grid.append(item);
  }
  $("coverage").append(grid); $("release-id").textContent = `Evidence export · ${manifest.created_utc.slice(0, 10)} · v1`;
  $("loading").hidden = true; $("viewer").hidden = false;
} catch (error) { $("loading").hidden = true; showError(error.message); }
