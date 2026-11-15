// Task / instance detail: contract, prompt, budgets, responsibility split, provenance,
// limits, retained failures, coverage and downloads.
import { covGlyph, cpBadge, dl, emptyState, hashCode, kindBadge, labelBadge, moduleChip, runStatusBadge, taskTitle } from "./components.js";
import { t, tEnum } from "./i18n.js";
import { buildHash, fmtJSONValue, fmtSeconds, h, saveFile, saveFromUrl, shortHash, uniq } from "./util.js";
import { STAGES } from "./overview.js";

export function renderInstance(ctx, params) {
  const { doc, idx } = ctx;
  const task = idx.tasks.get(params.task) || doc.tasks[0];
  const root = h("div", { class: "view detail" });
  if (!task) {
    root.append(emptyState(t("instance.noinstance", { state: "—" })));
    return root;
  }
  const toast = h("span", { class: "toast", role: "status" });
  const say = async (p) => { toast.textContent = t(`download.${await p}`); setTimeout(() => { toast.textContent = ""; }, 3000); };
  root.append(h("p", null, h("a", { href: "#minecraft", class: "link-btn" }, `← ${t("instance.back")}`)),
    h("header", { class: "detail-head" },
      h("p", { class: "eyebrow" }, t("instance.title")),
      h("h1", null, h("code", { class: "sid big" }, task.id), " ", taskTitle(task, { block: true })),
      h("div", { class: "chips" }, (task.modules || []).map((m) => moduleChip(m, true, doc.taxonomy)),
        (task.subcategories || []).map((sc) => h("code", { class: "subcat" }, sc)),
        h("span", { class: `badge tstate tstate-${task.state}` }, tEnum("tstate", task.state))),
      dl([[t("instance.semantics"), task.new_semantics ?? null], [t("instance.policy"), task.branch_policy ?? null]])),
    toast);

  // Coverage strip for this task
  const cov = idx.coverageByTask.get(task.id) || new Map();
  root.append(h("section", { class: "block" }, h("h2", null, t("instance.coverage")),
    h("ol", { class: "stage-strip" }, STAGES.map((st) => {
      const row = cov.get(st);
      const state = row?.state ?? "missing";
      return h("li", { class: `stage-item cov-${state}` },
        h("span", { class: `cov-cell cov-${state}`, "aria-hidden": "true" }, covGlyph(state)),
        h("span", { class: "stage-name" }, t(`stage.${st}`)), h("span", { class: "stage-state" }, t(`cstate.${state}`)),
        row?.detail ? h("span", { class: "fine" }, row.detail) : null,
        (row?.evidence || []).map((e) => h("span", { class: "fine" }, hashCode(e))));
    }))));

  const instances = task.instances || [];
  const runIds = new Set(doc.runs.filter((r) => r.task_id === task.id).map((r) => r.instance_id));
  const allInstIds = uniq([...instances.map((i) => i.instance_id), ...runIds]);
  if (!allInstIds.length) root.append(h("section", { class: "block" }, emptyState(t("instance.noinstance", { state: tEnum("tstate", task.state) }))));

  for (const instId of allInstIds) {
    const inst = instances.find((i) => i.instance_id === instId) || { instance_id: instId };
    const rank = (r) => ({ reference: 0, learned: 1, composed: 1, degenerate_baseline: 2 })[idx.systems.get(r.system_id)?.kind] ?? 1;
    const runs = (idx.runsByInstance.get(instId) || []).slice().sort((a, b) => rank(a) - rank(b) || a.system_id.localeCompare(b.system_id) || String(a.branch).localeCompare(String(b.branch)));
    const hasMedia = runs.some((r) => r.media?.video);
    const block = h("section", { class: "block instance", "aria-labelledby": `inst-${instId}` },
      h("h2", { id: `inst-${instId}` }, h("code", null, instId),
        hasMedia ? h("a", { class: "link-btn", href: buildHash("player", { task: task.id, inst: instId }) }, t("instance.open.player")) : null));
    block.append(h("div", { class: "two-col" },
      h("div", null, h("h3", null, t("instance.contract")),
        inst.contract ? hashCode(inst.contract) : h("p", { class: "fine" }, t("instance.nocontract")),
        dl([[t("instance.profile"), inst.environment_profile ?? null],
          [t("instance.branches"), (inst.branches || []).map((b) => `${b}${inst.branch_meaning?.[b] ? `: ${inst.branch_meaning[b]}` : ""}`).join(" · ") || null]])),
      h("div", null, h("h3", null, t("instance.expected")), expectedTable(inst))));

    // Systems on this instance: responsibility split, budget, prompt
    const systems = uniq(runs.map((r) => r.system_id)).map((id) => idx.systems.get(id)).filter(Boolean);
    if (systems.length) {
      block.append(h("h3", null, t("instance.split")), h("div", { class: "table-scroll" }, h("table", { class: "split-table" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, t("col.system")), ["P", "D", "R"].map((m) => h("th", { scope: "col" }, moduleChip(m, false, doc.taxonomy))),
          h("th", { scope: "col" }, t("instance.budget")))),
        h("tbody", null, systems.map((sys) => h("tr", { class: `kind-${sys.kind}` },
          h("th", { scope: "row" }, h("span", { class: "sys-name" }, sys.name), h("span", { class: "sys-badges" }, kindBadge(sys.kind), labelBadge(sys.label))),
          ["P", "D", "R"].map((m) => h("td", { class: (sys.learned_components || []).includes(m) ? "learned" : null },
            sys.responsibility?.[m] ?? "—", (sys.learned_components || []).includes(m) ? h("span", { class: "badge learned-tag" }, t("kind.learned")) : null)),
          h("td", null, sys.information_budget ?? "—")))))));
    }
    const prompts = uniq(runs.map((r) => r.prompt).filter(Boolean));
    if (prompts.length) block.append(h("h3", null, t("instance.prompt")), ...prompts.map((p) => h("blockquote", { class: "prompt" }, p)));

    // Runs
    block.append(h("h3", null, t("instance.runs")));
    const runList = h("div", { class: "run-list" });
    for (const run of runs) {
      const sys = idx.systems.get(run.system_id);
      const v = run.media?.video;
      runList.append(h("details", { class: `run kind-${sys?.kind ?? "unknown"}` },
        h("summary", null, h("strong", null, sys?.name ?? run.system_id), h("span", { class: "badge branch" }, run.branch),
          runStatusBadge(run.status), labelBadge(run.label),
          run.branch_success === true ? cpBadge("pass") : run.branch_success === false ? cpBadge("fail") : null,
          h("code", { class: "run-id" }, run.run_id)),
        run.status_reason ? h("p", { class: "reason" }, run.status_reason) : null,
        dl([[t("col.mode"), run.test_mode ?? null], [t("instance.versions"), `${run.protocol_version ?? "—"} · ${run.scoring_version ?? "—"}`],
          [t("instance.job"), run.provenance?.slurm_job_id ?? null],
          [t("systems.revisions"), run.provenance?.revisions ? Object.entries(run.provenance.revisions).map(([k, val]) => `${k}: ${val ?? "—"}`).join(" · ") : null],
          ["Oracle run", run.oracle_run_id ?? null],
          ["Video", v ? `${v.width}×${v.height} · ${v.fps} fps · ${v.frames ?? v.timestamps_seconds?.length} frames · ${v.bytes ?? "?"} B · sha256 ${shortHash(v.sha256)}` : null]]),
        (run.checkpoints || []).length ? h("div", { class: "table-scroll" }, h("table", { class: "field-table" },
          h("thead", null, h("tr", null, ["player.checkpoint", "player.source", "field.status"].map((k) => h("th", { scope: "col" }, t(k))), h("th", { scope: "col" }, "frame · media time"), h("th", { scope: "col" }, t("field.field")))),
          h("tbody", null, run.checkpoints.map((cp) => h("tr", null,
            h("th", { scope: "row" }, h("code", null, cp.checkpoint_id), ` · step ${cp.logical_step ?? "—"}`),
            h("td", null, `${cp.readout_source}${cp.reader_id ? ` · ${cp.reader_id}` : ""}`),
            h("td", null, cpBadge(cp.status), cp.reason ? h("span", { class: "reason" }, cp.reason) : null),
            h("td", { class: "num" }, cp.observation_frame === null || cp.observation_frame === undefined ? "—" : `${cp.observation_frame} · ${fmtSeconds(cp.media_seconds)}`),
            h("td", null, (cp.fields || []).map((f) => h("span", { class: `fv st-${f.status}` }, h("code", null, f.field), ` ${fmtJSONValue(f.expected)} → ${f.observed === null || f.observed === undefined ? "null" : fmtJSONValue(f.observed)}`)))))))) : null,
        (run.evidence || []).length ? h("div", null, h("h4", null, t("instance.evidence")), h("ul", { class: "ev-list" }, run.evidence.map((e) => h("li", null, `${e.kind ?? ""} `, hashCode(e))))) : null,
        (run.limits || []).length ? h("div", null, h("h4", null, t("instance.limits")), h("ul", null, run.limits.map((l) => h("li", null, l)))) : null,
        h("div", { class: "dl-row" }, h("span", { class: "label" }, t("instance.downloads")),
          h("button", { type: "button", class: "btn small", onclick: () => say(saveFile(`${run.run_id.replace(/[^A-Za-z0-9._-]+/g, "_")}.json`, JSON.stringify(run, null, 2) + "\n", "application/json")) }, t("instance.dl.run")),
          v ? h("button", { type: "button", class: "btn small", onclick: () => say(saveFromUrl(`${run.run_id.replace(/[^A-Za-z0-9._-]+/g, "_")}.mp4`, v.url)) }, `${t("instance.dl.video")} (${Math.round((v.bytes || 0) / 1024)} KiB)`) : null)));
    }
    if (!runs.length) runList.append(emptyState("—"));
    block.append(runList);
    root.append(block);
  }

  if ((task.retained_failures || []).length) {
    root.append(h("section", { class: "block" }, h("h2", null, t("instance.failures")),
      h("ul", { class: "failures" }, task.retained_failures.map((f) => h("li", null, h("strong", null, f.what), `: ${f.reason}`, f.evidence ? h("code", { class: "path" }, ` ${f.evidence}`) : null)))));
  }
  if ((task.notes || []).length) root.append(h("section", { class: "block" }, h("h2", null, t("instance.notes")), h("ul", null, task.notes.map((n) => h("li", null, n)))));
  return root;
}

function expectedTable(inst) {
  const cps = inst.checkpoints || [];
  if (!cps.length) return h("p", { class: "fine" }, "—");
  const branches = inst.branches || uniq(cps.flatMap((c) => Object.keys(c.expected || {})));
  return h("div", { class: "table-scroll" }, h("table", { class: "field-table" },
    h("thead", null, h("tr", null, h("th", { scope: "col" }, t("player.checkpoint")), branches.map((b) => h("th", { scope: "col" }, b)))),
    h("tbody", null, cps.map((cp) => h("tr", null,
      h("th", { scope: "row" }, h("code", null, cp.checkpoint_id), ` · step ${cp.logical_step ?? "—"}`, cp.oracle_visible === false ? " · not visible" : ""),
      branches.map((b) => h("td", null, cp.expected?.[b] ? Object.entries(cp.expected[b]).map(([k, val]) => h("span", { class: "fv" }, h("code", null, k), ` ${fmtJSONValue(val)}`)) : "—")))))));
}
