// Small DOM, formatting, hash, storage and file helpers. No framework, no network.

/** Build an element. Strings and numbers become text nodes; never parsed as HTML. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "style") el.setAttribute("style", value);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const SVGNS = "http://www.w3.org/2000/svg";
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function fmtValue(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (unit === "fraction") return value.toFixed(2);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3);
}

export function fmtSeconds(sec, digits = 3) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  return `${sec.toFixed(digits)} s`;
}

export function fmtJSONValue(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function shortHash(sha) {
  return typeof sha === "string" && sha.length > 16 ? `${sha.slice(0, 12)}…` : sha ?? "—";
}

// ---------------------------------------------------------------- hash routing
// The hash is one "name": ASCII letters, digits and hyphens only (artifact-safe).
// Layout: view[-key-value]*. Values escape every other character as Z + two hex
// digits per UTF-8 byte (and Z itself), so they never contain a hyphen.
export function encodeValue(text) {
  const bytes = new TextEncoder().encode(String(text));
  let out = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    out += /[A-Za-z0-9]/.test(c) && c !== "Z" ? c : `Z${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function decodeValue(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "Z" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(text.charCodeAt(i) & 0xff);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function parseHash(hash) {
  const raw = (hash || "").replace(/^#/, "");
  const parts = raw.split("-").filter((p) => p.length);
  const view = parts.shift() || "";
  const params = {};
  for (let i = 0; i + 1 < parts.length; i += 2) params[parts[i]] = decodeValue(parts[i + 1]);
  return { view, params };
}

export function buildHash(view, params = {}) {
  const parts = [view];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(key, encodeValue(value));
  }
  return `#${parts.join("-")}`;
}

// ---------------------------------------------------------------- storage
export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------- runtime capabilities
// Inside a claude.ai artifact viewer `window.claude.use` exists; elsewhere it does not.
const capCache = new Map();
export function capability(name) {
  if (!capCache.has(name)) {
    let promise = Promise.resolve(null);
    try {
      if (window.claude && typeof window.claude.use === "function") {
        promise = Promise.race([
          window.claude.use(name).catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(null), 12000)),
        ]);
      }
    } catch {
      promise = Promise.resolve(null);
    }
    capCache.set(name, promise);
  }
  return capCache.get(name);
}

/**
 * Offer a file to the viewer. In an artifact viewer use the downloads capability
 * (direct downloads are blocked there); elsewhere fall back to an object URL.
 * `data` is a string or Blob. Resolves to "saved" | "declined" | "failed".
 */
export async function saveFile(filename, data, type = "application/octet-stream") {
  const downloads = await capability("downloads");
  if (downloads) {
    try {
      await downloads.save({ filename, data });
      return "saved";
    } catch (error) {
      return error && error.code === "declined" ? "declined" : "failed";
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: filename, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return "saved";
  } catch {
    return "failed";
  }
}

export async function saveFromUrl(filename, url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return "failed";
    return await saveFile(filename, await response.blob());
  } catch {
    return "failed";
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Inside a claude.ai artifact viewer the frame's own address is not a link anyone can open. */
export function inViewer() {
  try {
    return Boolean(window.claude && typeof window.claude.use === "function");
  } catch {
    return false;
  }
}

export function toCSV(rows, columns) {
  const esc = (v) => {
    const text = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- presentation time
/** Index of the frame shown at `seconds` in a stream with these presentation timestamps. */
export function frameAt(timestamps, seconds) {
  if (!Array.isArray(timestamps) || !timestamps.length || !Number.isFinite(seconds)) return null;
  if (seconds < timestamps[0]) return null;
  let low = 0;
  let high = timestamps.length - 1;
  if (seconds >= timestamps[high]) return high;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (timestamps[mid] <= seconds + 1e-9) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function uniq(list) {
  return [...new Set(list)];
}

export function byId(list, key = "id") {
  const map = new Map();
  for (const item of list || []) map.set(item[key], item);
  return map;
}

export function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
