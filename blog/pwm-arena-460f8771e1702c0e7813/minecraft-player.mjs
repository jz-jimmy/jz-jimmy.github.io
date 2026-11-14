// Pure presentation-time selection. Engine and input clocks never enter this function.
export function frameAt(timestamps, seconds) {
  if (!Number.isFinite(seconds) || !Array.isArray(timestamps) || !timestamps.length) return null;
  if (seconds < timestamps[0] || seconds > timestamps.at(-1) + 1e-7) return null;
  let low = 0, high = timestamps.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestamps[middle] < seconds) low = middle + 1;
    else high = middle;
  }
  return low > 0 && seconds - timestamps[low - 1] <= timestamps[low] - seconds ? low - 1 : low;
}
export function validateManifest(data) {
  if (data?.schema_version !== "pwm-minecraft-web-evidence-v1" || data.live_demo !== false
      || data.semantic_score !== null || !Array.isArray(data.entries) || !data.entries.length) throw new Error("证据清单版本不兼容或内容为空。");
  const ids = new Set();
  for (const entry of data.entries) {
    if (ids.has(entry.id) || entry.mode !== "recorded" || entry.semantic_score !== null
        || entry.live_demo !== false || entry.result_section !== "Minecraft") throw new Error("证据模式或实例标识无效。");
    ids.add(entry.id);
    for (const stream of [entry.native, entry.model]) {
      const pts = stream.timestamps_seconds;
      if (!/^\/minecraft-data\/media\/[a-f0-9]{64}\.mp4$/.test(stream.url)
          || !/^[a-f0-9]{64}$/.test(stream.sha256)
          || !Array.isArray(pts) || pts.length !== entry.frames
          || pts.some((t, i) => !Number.isFinite(t) || t < 0 || (i > 0 && t <= pts[i - 1]))) throw new Error("媒体时间戳或来源无效。");
    }
  }
  return data;
}
