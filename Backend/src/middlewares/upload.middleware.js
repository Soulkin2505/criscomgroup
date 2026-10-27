// middlewares/upload.js
const fs = require("fs");
const multer = require("multer");
const path = require("path");

// Mapa fieldname → subdirectorio bajo src/uploads/
// Si en el futuro se migra a uploads/public/<tipo> o uploads/private/<tipo>
// (HC8 pleno para fix-wave-2), solo cambia este mapa.
const SUBDIR_BY_FIELDNAME = {
  logo: "logos",
  // H7: certificados tratados como secretos en la API (company.model.js los
  // excluye del JSON de respuesta) pero antes se guardaban bajo `src/uploads/certs`,
  // servido públicamente sin auth por el catch-all legacy de app.js. Van a
  // `private/certs`, que sí exige JWT (`/uploads/private` en app.js).
  cert: "private/certs",
  ficha_ruc: "private/ruc",
  imagen: "productos",
  imagen_categoria: "categorias",
  imagen_banner: "banner",
  imagen_tarjeta: "tarjetas",
  evidencia_servicio: "private/service-evidence",
  openclaw_media: "private/service-evidence",
  affiliate_logo: "affiliate-logos",
};

// Extension forzada por MIME para los tipos de media aceptados
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};
const BANNER_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm"];
const BANNER_FORMAT_MESSAGE = "Formato no permitido. Usa JPG, PNG, WebP, AVIF, MP4 o WebM";

// Configuración de almacenamiento
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subdir = SUBDIR_BY_FIELDNAME[file.fieldname];
    if (!subdir) {
      return cb(new Error("Tipo de archivo no permitido"), null);
    }
    const dest = path.join(__dirname, "../uploads", subdir);
    // Self-healing: garantizar que el dir exista antes de escribir.
    // Multer NO crea dirs automáticamente y el named volume
    // `erpcomp_backend_uploads` puede estar vacío tras `docker compose down -v`
    // o un build sin seed inicial. mkdirSync recursive es idempotente y barato.
    // (fix-wave-1.1 / HC8 hot-patch)
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // Generar un nombre único para el archivo
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    // La extension sale del MIME validado, no del nombre original (evita .html/.svg disfrazados).
    const forced = EXT_BY_MIME[file.mimetype];
    const extension = forced || path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
    cb(null, file.fieldname + "-" + uniqueSuffix + extension);
  },
});

// Opciones adicionales, si lo necesitas
const fileFilter = (req, file, cb) => {
  // Por ejemplo, para permitir solo imágenes en el logo y .pem o .txt en cert
  if (file.fieldname === "logo" || file.fieldname === "affiliate_logo") {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes para el logo"));
    }
  } else if (file.fieldname === "ficha_ruc") {
    if (file.mimetype === "application/pdf" || file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("La ficha RUC debe ser PDF o imagen"));
  } else if (file.fieldname === "cert") {
    // Por extension, no por MIME: Windows no registra MIME para .pem ni .p12 (llegan vacios u
    // octet-stream). El contenido real (PEM o PKCS#12) lo valida company.controller.
    if (/\.(pem|txt|crt|cer|cert|p12|pfx)$/i.test(file.originalname || "")) {
      cb(null, true);
    } else {
      cb(new Error("El certificado debe ser un archivo .pem, .txt, .crt, .cer, .cert, .p12 o .pfx"));
    }
  } else if (file.fieldname === "imagen") {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes para el producto"));
    }
  } else if (file.fieldname === "imagen_categoria") {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes para la categoría"));
    }
  } else if (file.fieldname === "imagen_banner") {
    if (BANNER_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(BANNER_FORMAT_MESSAGE));
    }
  } else if (file.fieldname === "imagen_tarjeta") {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes para la tarjeta"));
    }
  } else if (file.fieldname === "evidencia_servicio" || file.fieldname === "openclaw_media") {
    const allowed =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "application/pdf";
    if (allowed) cb(null, true);
    else cb(new Error("Solo se permiten imágenes, audio o PDF como evidencia"));
  } else {
    cb(null, false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 30 * 1024 * 1024 },
});

// Verifica la firma real del archivo (magic bytes) contra el MIME declarado.
const hasMagic = (buf, mimetype) => {
  const ascii = (a, b) => buf.slice(a, b).toString("latin1");
  switch (mimetype) {
    case "image/jpeg": return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png": return buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/avif": return ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 32));
    case "video/mp4": return ascii(4, 8) === "ftyp";
    case "video/webm": return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    default: return false;
  }
};

const fileMatchesMime = (filePath, mimetype) => {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(32);
    const n = fs.readSync(fd, buf, 0, 32, 0);
    return hasMagic(buf.slice(0, n), mimetype);
  } finally {
    fs.closeSync(fd);
  }
};

// Middleware de banner: multer con errores en JSON 400 + verificacion de magic bytes.
const bannerUpload = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE"
        ? "El archivo supera el máximo de 30 MB"
        : err instanceof multer.MulterError
          ? "No se pudo procesar el archivo enviado"
          : err.message || "Archivo no válido";
      return res.status(400).json({ message });
    }
    if (req.file) {
      let valid = false;
      try { valid = fileMatchesMime(req.file.path, req.file.mimetype); } catch { valid = false; }
      if (!valid) {
        fs.rmSync(req.file.path, { force: true });
        return res.status(400).json({ message: "El contenido del archivo no coincide con su formato" });
      }
    }
    next();
  });
};

module.exports = upload;
module.exports.bannerUpload = bannerUpload;
module.exports.hasMagic = hasMagic;
