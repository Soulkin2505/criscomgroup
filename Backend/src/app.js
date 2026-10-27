require("dotenv").config()

const express = require("express")
const http = require("http")
const cors = require("cors")
const morgan = require("morgan")
const security = require("./config/security")
const { apiLimiter, authLimiter, requestId, secureHeaders } = require("./middlewares/security.middleware")

// Importación de rutas
const authRoutes = require("./routes/auth.routes")
const categoriaRoutes = require("./routes/categoria.routes")
const productoRoutes = require("./routes/producto.routes")
const companyRoutes = require("./routes/company.routes")
const affiliateRoutes = require('./routes/affiliate.routes')
const ventaRoutes = require("./routes/venta.routes")
const codigo_barrasRoutes = require("./routes/codigo_barras.routes")
const userRoutes = require("./routes/users.routes")
const rucReniecRoutes = require("./routes/ruc.routes")
const reniecRoutes = require("./routes/reniec.routes")
const cierreCajaRoutes = require("./routes/cierre_caja.routes")
const auditLogRoutes = require("./routes/audit_log.routes")
const ofertasDelDiaRoutes = require("./routes/ofertasDelDia.routes")
const ecommerceRoutes = require("./routes/ecommerce.routes")
const marketingRoutes = require("./routes/marketing.routes")
const libroReclamacionesRoutes = require("./routes/libro_reclamaciones.routes");
const solicitudImportacionRoutes = require("./routes/solicitudImportacion.routes");
const solicitudEnsambleRoutes = require("./routes/solicitudEnsamble.routes");
const features = require("./config/features");
const authMiddleware = require("./middlewares/auth.middleware");
const pedidoRoutes = require('./routes/pedido.routes');
const posRoutes = require('./routes/pos.routes');
const facturacionRoutes = require('./routes/facturacion.routes');
const adquisicionRoutes = require('./routes/adquisicion.routes');
const socialLinksRoutes = require('./routes/social_links.routes');
const importacionRoutes = require('./routes/importacion.routes');
const ordenServicioRoutes = require('./routes/ordenServicio.routes');
const activoTecnicoRoutes = require('./routes/activoTecnico.routes');
const gastoTallerRoutes = require('./routes/gastoTaller.routes');
const solicitudServicioRoutes = require('./routes/solicitudServicio.routes');
const carritoRoutes = require('./routes/carrito.routes');
const commercialRoutes = require('./routes/commercial.routes');
const accessRoutes = require('./routes/access.routes');
const paymentGatewayRoutes = require('./routes/payment-gateway.routes');
const blogRoutes = require('./routes/blog.routes');
const postventaRoutes = require('./routes/postventa.routes');
const communityRoutes = require('./routes/community.routes');

// Express 4 no captura las promesas rechazadas de handlers async: se encaminan a next(err)
// para que terminen en el manejador global (500 JSON) en vez de colgar la peticion.
const Layer = require("express/lib/router/layer")
if (!Layer.prototype.__asyncSafe) {
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle
    if (fn.length > 3) return next()
    try {
      const result = fn(req, res, next)
      if (result && typeof result.catch === "function") result.catch(next)
    } catch (error) {
      next(error)
    }
  }
  Layer.prototype.__asyncSafe = true
}

const app = express()

// Solo nginx habla directamente con Express en producción. Esto permite que
// req.ip y los rate limits usen el cliente reenviado, sin confiar una cadena
// arbitraria de proxies controlada desde Internet.
app.set("trust proxy", security.trustProxyHops)

// Middlewares
// S2: CORS whitelist desde FRONTEND_ORIGIN (env-driven, fail-secure en producción).
// La función se evalúa por request para poder ser testeable sin re-require del módulo.
app.use(cors({
  origin: function (origin, callback) {
    // Peticiones sin Origin (same-origin, curl, Postman, supertest sin header) → permitir
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.FRONTEND_ORIGIN
      ? process.env.FRONTEND_ORIGIN.split(',').map(function (o) { return o.trim(); })
      : (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173']);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(requestId)
app.use(secureHeaders)
app.use(express.json({ limit: security.jsonBodyLimit, strict: true }))
app.use(require("./middlewares/openai-conversions").middleware)
// S3: Uploads split público/privado (D1=A).
// /uploads/public → acceso libre (logos, imágenes de producto).
// /uploads/private → requiere token JWT (comprobantes, docs sensibles).
// /uploads → grace period para rutas legacy ya persistidas en DB.
app.use("/uploads/public", express.static("src/uploads/public"));
app.use("/uploads/private", authMiddleware, express.static("src/uploads/private"));
app.use("/uploads", express.static("src/uploads"));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))

// Rutas API
app.use("/api", apiLimiter)
app.use("/api/auth", authLimiter, authRoutes)
app.use("/api/categorias", categoriaRoutes)
app.use("/api/productos", productoRoutes)
app.use("/api/codigos-barras", codigo_barrasRoutes)
app.use("/api/companies", companyRoutes)
app.use('/api/affiliates', affiliateRoutes)
app.use("/api/social-links", socialLinksRoutes)
app.use("/api/cierre-caja", cierreCajaRoutes)
app.use("/api/ventas", ventaRoutes)
app.use("/api/users", userRoutes)
app.use("/api/ruc", rucReniecRoutes)
app.use("/api/dni", reniecRoutes)
app.use("/api/audit-logs", auditLogRoutes)

app.use("/api/ofertas-del-dia", ofertasDelDiaRoutes)
app.use('/api/pedidos', pedidoRoutes)
app.use('/api/pos', posRoutes)
app.use('/api/facturacion', facturacionRoutes)
app.use('/api/adquisiciones-usados', adquisicionRoutes)
app.use('/api/importaciones', importacionRoutes)
app.use('/api/ordenes-servicio', ordenServicioRoutes)
app.use('/api/servicio-tecnico', activoTecnicoRoutes)
app.use('/api/gastos-taller', gastoTallerRoutes)
app.use('/api/solicitudes-servicio', solicitudServicioRoutes)
app.use('/api/carrito', carritoRoutes)
app.use('/api/commercial', commercialRoutes)
app.use('/api/access', accessRoutes)
app.use('/api/payment-gateways', paymentGatewayRoutes)
app.use('/api/blog', blogRoutes)
app.use('/api/postventa', postventaRoutes)
app.use('/api/community', communityRoutes)

if (features.FEATURE_ECOMMERCE) {
  app.use("/api/ecommerce", ecommerceRoutes)
  // Endpoints admin de solicitudes de importación (hot-patch B).
  // authMiddleware aplicado en el propio router.
  app.use("/api/solicitudes-importacion", solicitudImportacionRoutes)
  // Endpoints admin de solicitudes de armado/ensamble de PC.
  app.use("/api/solicitudes-ensamble", solicitudEnsambleRoutes)
}

// Banners siempre disponibles; las tarjetas se registran dentro del router solo con FEATURE_MARKETING.
app.use("/api/marketing", marketingRoutes)

if (features.FEATURE_LIBRO_RECLAMACIONES) {
  app.use("/api/libro-reclamaciones", libroReclamacionesRoutes);
}

// Ruta básica para verificar que el servidor está funcionando
app.get("/", (req, res) => {
  res.json({ message: "API Backend con autenticación funcionando correctamente" })
})

// Manejador global de errores (siempre el ultimo middleware): nunca responde 500 sin cuerpo.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.writableEnded) {
    console.error("[error] fallo tras responder:", err)
    return
  }
  if (res.headersSent) return next(err)
  const status = Number(err && (err.status || err.statusCode))
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "El cuerpo de la petición no es un JSON válido" })
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ message: "La petición es demasiado grande" })
  }
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: err.expose === false ? "Solicitud inválida" : err.message || "Solicitud inválida" })
  }
  console.error("[error] no controlado:", req.method, String(req.originalUrl || "").split("?")[0], err)
  return res.status(500).json({ message: "Error interno del servidor" })
})

// Una promesa rechazada sin manejar se registra, pero no tumba el proceso.
if (!process.__criscomRejectionGuard) {
  process.__criscomRejectionGuard = true
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason)
  })
}

const server = http.createServer(app)

module.exports = {
  app,
  server,
}
