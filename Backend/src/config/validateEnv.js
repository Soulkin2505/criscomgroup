'use strict';
/**
 * validateEnv — Fail-fast para variables de entorno críticas.
 * Llamar al inicio de index.js, antes de conectar a la base de datos.
 * En entornos distintos de 'production', la función retorna sin hacer nada.
 */
const validateEnv = () => {
  if (process.env.NODE_ENV !== 'production') return;

  const requeridas = [
    { key: 'FRONTEND_ORIGIN', mensaje: 'FATAL: FRONTEND_ORIGIN debe estar definido en producción (whitelist CORS).' },
    { key: 'JWT_SECRET',      mensaje: 'FATAL: JWT_SECRET debe estar definido en producción.' },
  ];

  for (const { key, mensaje } of requeridas) {
    if (!process.env[key]) {
      console.error(mensaje);
      process.exit(1);
    }
  }
  if (process.env.PAYMENTS_MODE === 'production' && (!process.env.CULQI_PUBLIC_KEY || !process.env.CULQI_SECRET_KEY)) {
    console.error('FATAL: Culqi producción requiere llave pública y secreta.');
    process.exit(1);
  }
  if (process.env.SUNAT_MODE === 'production') {
    const ruc = process.env.SUNAT_RUC || process.env.SUNAT_RUC10_RUC;
    const user = process.env.SUNAT_SOL_USER || process.env.SUNAT_RUC10_SOL_USER;
    const password = process.env.SUNAT_SOL_PASSWORD || process.env.SUNAT_RUC10_SOL_PASSWORD;
    const pfxReady = Boolean(process.env.SUNAT_RUC10_PFX_PATH && (process.env.SUNAT_RUC10_PFX_PASSWORD_B64 || process.env.SUNAT_RUC10_PFX_PASSWORD));
    const pemReady = Boolean((process.env.SUNAT_PRIVATE_KEY_PATH || process.env.SUNAT_RUC10_PRIVATE_KEY_PATH) && (process.env.SUNAT_CERTIFICATE_PATH || process.env.SUNAT_RUC10_CERTIFICATE_PATH));
    // Las credenciales pueden venir del ERP (Empresa > Acceso SOL y Certificado): cada empresa solo pasa a
    // produccion cuando su configuracion esta completa (sunat.companyMode), asi que aqui solo se avisa.
    if (!ruc || !user || !password || (!pfxReady && !pemReady)) {
      console.warn('[sunat] SUNAT_MODE=production sin credenciales en el servidor: se usarán las configuradas en el ERP por cada empresa.');
    }
  }
};

module.exports = { validateEnv };
