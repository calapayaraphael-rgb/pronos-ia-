// Seul point de contact reseau de l'app : tout passe par /api/v1.
const BASE = (import.meta.env.VITE_API_URL || "/api/v1").replace(/\/$/, "");
const TOKEN_KEY = "pronos_token";

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function req(path, { method = "GET", body, withAuth = true } = {}) {
  const headers = { "content-type": "application/json" };
  const t = auth.get();
  if (withAuth && t) headers.authorization = "Bearer " + t;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error("Serveur injoignable. Vérifiez l'URL de l'API ou votre connexion.");
  }
  if (res.status === 401) { onUnauthorized(); throw new Error("Session expirée, reconnectez-vous."); }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

export const api = {
  base: BASE,
  get: (p) => req(p),
  post: (p, b) => req(p, { method: "POST", body: b }),
  patch: (p, b) => req(p, { method: "PATCH", body: b }),
  del: (p) => req(p, { method: "DELETE" }),
  login: (email, password) => req("/auth/login", { method: "POST", body: { email, password }, withAuth: false }),
  register: (email, password) => req("/auth/register", { method: "POST", body: { email, password }, withAuth: false }),
};
