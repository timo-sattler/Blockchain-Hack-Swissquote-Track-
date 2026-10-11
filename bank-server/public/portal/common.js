window.api = async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
window.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
window.short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "");
window.when = (iso) => (iso ? new Date(iso).toLocaleString("de-CH") : "");
