'use strict';
// ecom-logica T1: GET /api/ecommerce/config-publica — campos públicos y 0 secretos.
const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser, createEmpresa } = require('../helpers/seed');

describe('config-publica (ecom T1)', () => {
  beforeAll(async () => {
    await setupTestDb();
    const admin = await createUser({ name: 'seed-ecom Admin', email: 'seed-ecom-config@test.local', password: 'Clave123!', id_role: 1 });
    const empresa = await createEmpresa(admin.id_user);
    await empresa.update({
      razon_social: 'seed-ecom Comercial S.A.C.',
      direccion: 'Av. seed-ecom 456, Arequipa',
      whatsapp_number: '51999888777',
      instagram_url: 'https://www.instagram.com/seed-ecom/',
    });
  });

  it('200 con los campos públicos de la empresa marcada para la web (razón social, RUC, dirección y correo de soporte)', async () => {
    const res = await request(app).get('/api/ecommerce/config-publica');
    expect(res.statusCode).toBe(200);
    expect(res.body.nombre_comercial).toBe('seed-ecom Comercial S.A.C.');
    expect(res.body.razon_social).toBe('seed-ecom Comercial S.A.C.');
    expect(res.body.ruc).toBe('20000000001');
    expect(res.body.direccion).toBe('Av. seed-ecom 456, Arequipa');
    expect(res.body.correo).toBe('ventas@criscomgroup.com.pe');
    expect(res.body.horario).toEqual({ inicio: expect.any(String), fin: expect.any(String) });
    expect(res.body.whatsapp_number).toBe('51999888777');
    expect(res.body.telefono).toBe('51999888777');
    expect(res.body.redes.instagram_url).toBe('https://www.instagram.com/seed-ecom/');
    expect(res.body.redes).toHaveProperty('facebook_url');
    expect(res.body.redes).toHaveProperty('tiktok_url');
    expect(res.body.redes).toHaveProperty('youtube_url');
  });

  // Razón social/RUC/dirección son datos públicos de registro (exigidos por Culqi e INDECOPI),
  // por eso ya no están en la lista de prohibidos; lo que nunca debe salir son las credenciales SUNAT/Culqi.
  it('no expone secretos SUNAT/Culqi/credenciales', async () => {
    const res = await request(app).get('/api/ecommerce/config-publica');
    const raw = JSON.stringify(res.body);
    for (const prohibido of ['sol_user', 'sol_pass', 'TESTUSR', 'TESTPASS', 'cert_path', 'client_id', 'client_secret', 'serie_factura', 'serie_boleta', 'sunat', 'culqi', 'id_user', 'production']) {
      expect(raw.toLowerCase()).not.toContain(prohibido.toLowerCase());
    }
  });
});
