const Company = require('../models/company.model');

const DEFAULT_LINKS = Object.freeze({
  instagram_url: 'https://www.instagram.com/criscomgroup/',
  facebook_url: 'https://www.facebook.com/profile.php?id=61572916207328',
  tiktok_url: 'https://www.tiktok.com/@criscomgroup',
  youtube_url: '',
  whatsapp_number: '51904589554',
});

// Correo de soporte/ventas visible en la web (no vive en Company: es fijo para el negocio,
// no depende de cual RUC se muestre como emisor publico).
const SOPORTE_EMAIL = 'ventas@criscomgroup.com.pe';

const allowedHosts = {
  instagram_url: ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am'],
  facebook_url: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com', 'fb.me'],
  tiktok_url: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  youtube_url: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'],
};

const fail = (res, status, message) => res.status(status).json({ message, error: message });

const findPrimaryCompany = () => Company.findOne({
  order: [['emisor_predeterminado', 'DESC'], ['id_company', 'ASC']],
});

// La empresa cuyo RUC/razon social se muestra en la web: la marcada explicitamente con
// mostrar_en_web (una sola a la vez); si ninguna fue elegida aun, se cae a la emisora
// predeterminada para no dejar la web sin datos de contacto.
const findPublicCompany = async () => (await Company.findOne({ where: { mostrar_en_web: true } })) || findPrimaryCompany();

// Las URLs usan ?? para que un valor vacio guardado (red borrada) no vuelva al valor por defecto;
// solo null/undefined (nunca configurado) cae al default. WhatsApp siempre necesita un numero.
// Razon social/RUC/direccion son datos publicos de registro (exigidos por Culqi e INDECOPI),
// no secretos: nunca se incluyen sol_user/sol_pass/cert_path/client_*, eso sigue vedado.
const serialize = (company) => ({
  instagram_url: company?.instagram_url ?? DEFAULT_LINKS.instagram_url,
  facebook_url: company?.facebook_url ?? DEFAULT_LINKS.facebook_url,
  tiktok_url: company?.tiktok_url ?? DEFAULT_LINKS.tiktok_url,
  youtube_url: company?.youtube_url ?? DEFAULT_LINKS.youtube_url,
  whatsapp_number: company?.whatsapp_number || DEFAULT_LINKS.whatsapp_number,
  razon_social: company?.razon_social || null,
  ruc: company?.ruc || null,
  direccion: company?.direccion || null,
  correo: SOPORTE_EMAIL,
});

const normalizeWhatsapp = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (/^9\d{8}$/.test(digits)) return `51${digits}`;
  if (!/^\d{8,15}$/.test(digits)) throw new Error('El número de WhatsApp no es válido');
  return digits;
};

const validateLink = (field, value) => {
  if (value === '' || value === null || value === undefined) return '';
  if (typeof value !== 'string' || value.length > 255) throw new Error(`${field} no es válido`);
  let parsed;
  try { parsed = new URL(value.trim()); } catch { throw new Error(`${field} debe ser una URL válida`); }
  if (parsed.protocol !== 'https:' || !allowedHosts[field].includes(parsed.hostname.toLowerCase())) {
    throw new Error(`${field} debe usar HTTPS y pertenecer a la red social indicada`);
  }
  return parsed.toString();
};

const getPublicSocialLinks = async (_req, res) => {
  try {
    return res.json(serialize(await findPublicCompany()));
  } catch (error) {
    console.error('Error al obtener redes sociales:', error);
    return res.json({ ...DEFAULT_LINKS, razon_social: null, ruc: null, direccion: null, correo: SOPORTE_EMAIL });
  }
};

const getAdminSocialLinks = async (_req, res) => {
  try {
    const company = await findPublicCompany();
    const companias = await Company.findAll({ order: [['emisor_predeterminado', 'DESC'], ['id_company', 'ASC']] });
    return res.json({
      company_id: company?.id_company || null,
      ...serialize(company),
      empresas: companias.map(c => ({ id_company: c.id_company, razon_social: c.razon_social, ruc: c.ruc, mostrar_en_web: c.mostrar_en_web })),
    });
  } catch (error) {
    console.error('Error al obtener redes sociales del ERP:', error);
    return fail(res, 500, 'No se pudo obtener la configuración');
  }
};

const updateSocialLinks = async (req, res) => {
  try {
    const company = await findPublicCompany();
    if (!company) return fail(res, 404, 'Primero debes registrar una empresa emisora');

    const updates = {};
    for (const field of Object.keys(allowedHosts)) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = validateLink(field, req.body[field]);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'whatsapp_number')) {
      updates.whatsapp_number = normalizeWhatsapp(req.body.whatsapp_number);
    }
    if (!Object.keys(updates).length) return fail(res, 422, 'No se enviaron campos válidos');

    await company.update(updates);
    return res.json({ message: 'Redes sociales actualizadas', ...serialize(company) });
  } catch (error) {
    if (error.message?.includes('debe') || error.message?.includes('válido')) return fail(res, 422, error.message);
    console.error('Error al actualizar redes sociales:', error);
    return fail(res, 500, 'No se pudo actualizar la configuración');
  }
};

module.exports = { getPublicSocialLinks, getAdminSocialLinks, updateSocialLinks };
