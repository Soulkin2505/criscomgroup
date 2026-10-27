'use strict';
// GET /api/ecommerce/config-publica — datos públicos de la empresa para el ecommerce.
// Razon social/RUC/direccion son datos de registro publico (exigidos por Culqi e INDECOPI);
// sol_user/sol_pass, cert_path y client_id/secret jamas se exponen aqui.
const Company = require('../models/company.model');

// Mismos defaults de ERP que social_links.controller: ambos endpoints públicos
// deben decir lo mismo. El front nunca hardcodea; si un valor llega vacio, lo oculta.
const DEFAULT_REDES = Object.freeze({
  instagram_url: 'https://www.instagram.com/criscomgroup/',
  facebook_url: 'https://www.facebook.com/profile.php?id=61572916207328',
  tiktok_url: 'https://www.tiktok.com/@criscomgroup',
  youtube_url: '',
  whatsapp_number: '51904589554',
});

// Correo de soporte/ventas: fijo para el negocio, no depende de cual RUC se muestre.
const SOPORTE_EMAIL = 'ventas@criscomgroup.com.pe';

const findPrimaryCompany = () => Company.findOne({
  order: [['emisor_predeterminado', 'DESC'], ['id_company', 'ASC']],
});

// La empresa que se muestra en la web: la marcada con mostrar_en_web (una a la vez, elegida
// desde Redes y banners); si ninguna fue elegida aun, se cae a la emisora predeterminada.
const findPublicCompany = async () => (await Company.findOne({ where: { mostrar_en_web: true } })) || findPrimaryCompany();

exports.getConfigPublica = async (_req, res) => {
  try {
    const company = await findPublicCompany();
    const whatsapp = company?.whatsapp_number || DEFAULT_REDES.whatsapp_number;
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    return res.json({
      nombre_comercial: company?.razon_social || null,
      razon_social: company?.razon_social || null,
      ruc: company?.ruc || null,
      direccion: company?.direccion || null,
      correo: SOPORTE_EMAIL,
      horario: {
        inicio: company?.horario_inicio || null,
        fin: company?.horario_fin || null,
      },
      telefono: whatsapp || null,
      whatsapp_number: whatsapp || null,
      redes: {
        instagram_url: company?.instagram_url ?? DEFAULT_REDES.instagram_url,
        facebook_url: company?.facebook_url ?? DEFAULT_REDES.facebook_url,
        tiktok_url: company?.tiktok_url ?? DEFAULT_REDES.tiktok_url,
        youtube_url: company?.youtube_url ?? DEFAULT_REDES.youtube_url,
      },
    });
  } catch (error) {
    console.error('Error al obtener config pública de empresa:', error);
    return res.status(500).json({ message: 'No se pudo obtener la configuración pública' });
  }
};
