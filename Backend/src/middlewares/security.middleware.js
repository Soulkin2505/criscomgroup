const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;
const security = require("../config/security");

const limiter = (options) => rateLimit({
  ...options,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: options.message || {
    success: false,
    message: "Demasiadas solicitudes. Espera unos minutos antes de intentarlo nuevamente.",
  },
  // Las pruebas de integración no deben compartir contadores entre casos.
  skip: () => process.env.NODE_ENV === "test",
});

const apiLimiter = limiter(security.api);
// Solo cuentan los intentos fallidos, salvo en las rutas que crean cuentas (register*): ahi cuentan todos.
const authRequestWasSuccessful = (req, res) => res.statusCode < 400 && !/register/.test(String(req.path || req.url || ""));
const authFailureMessage = { success: false, message: "Demasiados intentos de acceso. Intenta nuevamente en unos minutos." };

// Tope por IP (holgado: una oficina comparte IP) y tope por IP+correo en /login (frena la fuerza bruta sobre una cuenta).
const authIpLimiter = limiter({
  ...security.auth,
  max: security.auth.max * 3,
  skipSuccessfulRequests: true,
  requestWasSuccessful: authRequestWasSuccessful,
  message: authFailureMessage,
});
const authAccountLimiter = limiter({
  ...security.auth,
  skipSuccessfulRequests: true,
  requestWasSuccessful: authRequestWasSuccessful,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || "").trim().toLowerCase().slice(0, 180)}`,
  message: authFailureMessage,
});
const authLimiter = (req, res, next) => authIpLimiter(req, res, (error) => {
  if (error || !(req.method === "POST" && /\/login$/.test(String(req.path || "")))) return next(error);
  return authAccountLimiter(req, res, next);
});

// Verificacion de la clave actual de la cuenta maestra: tope estricto por cuenta (solo fallos).
const masterAccountLimiter = limiter({
  windowMs: security.auth.windowMs,
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `master-account:${req.user?.id || ipKeyGenerator(req.ip)}`,
  message: { message: "Demasiados intentos. Espera unos minutos antes de volver a intentarlo." },
});
const publicSubmissionLimiter = limiter(security.publicSubmission);
const webhookLimiter = limiter(security.webhook);

const requestId = (req, res, next) => {
  const incoming = req.get("x-request-id");
  const safeIncoming = incoming && /^[A-Za-z0-9._-]{8,80}$/.test(incoming) ? incoming : null;
  req.id = safeIncoming || crypto.randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
};

const secureHeaders = helmet({
  crossOriginResourcePolicy: { policy: "same-site" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

module.exports = { apiLimiter, authLimiter, masterAccountLimiter, authRequestWasSuccessful, publicSubmissionLimiter, webhookLimiter, requestId, secureHeaders };
