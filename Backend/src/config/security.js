const numberFromEnv = (name, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
};

// Política central de seguridad HTTP. Los valores pueden ajustarse por entorno
// sin editar rutas ni controladores. Los límites son por instancia de backend;
// nginx y Cloudflare constituyen las capas externas contra abuso volumétrico.
module.exports = Object.freeze({
  trustProxyHops: numberFromEnv("TRUST_PROXY_HOPS", 1, 1, 3),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "256kb",
  api: {
    windowMs: numberFromEnv("API_RATE_WINDOW_MS", 60_000, 10_000, 3_600_000),
    max: numberFromEnv("API_RATE_MAX", 300, 30, 10_000),
  },
  auth: {
    windowMs: numberFromEnv("AUTH_RATE_WINDOW_MS", 15 * 60_000, 60_000, 3_600_000),
    max: numberFromEnv("AUTH_RATE_MAX", 10, 3, 100),
  },
  publicSubmission: {
    windowMs: numberFromEnv("PUBLIC_FORM_RATE_WINDOW_MS", 15 * 60_000, 60_000, 3_600_000),
    max: numberFromEnv("PUBLIC_FORM_RATE_MAX", 8, 2, 100),
  },
  // Culqi no firma sus webhooks, así que cada petición entrante dispara una
  // llamada saliente a la API de Culqi (retrieveCharge) para verificarla. Un
  // límite propio, más estricto que el de /api en general, evita que alguien
  // use este endpoint público para forzar tráfico saliente hacia Culqi.
  webhook: {
    windowMs: numberFromEnv("WEBHOOK_RATE_WINDOW_MS", 60_000, 10_000, 3_600_000),
    max: numberFromEnv("WEBHOOK_RATE_MAX", 60, 10, 1_000),
  },
});
