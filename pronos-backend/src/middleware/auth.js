import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { resolveApiKey } from "../services/account.js";

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.JWT_SECRET, { expiresIn: "30d" });
}

// Accepte un JWT (Bearer) OU une cle API privee (header x-api-key).
export async function authenticate(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) {
      const payload = jwt.verify(auth.slice(7), config.JWT_SECRET);
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
      return next();
    }
    const apiKey = req.headers["x-api-key"];
    if (apiKey) {
      const r = await resolveApiKey(apiKey);
      if (r) { req.user = { id: r.userId, viaApiKey: true }; return next(); }
    }
    return res.status(401).json({ error: "Authentification requise" });
  } catch (e) {
    return res.status(401).json({ error: "Token invalide" });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Acces admin requis" });
  next();
}
