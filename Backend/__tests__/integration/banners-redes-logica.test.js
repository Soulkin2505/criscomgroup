'use strict';
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../src/app');
const { Banner } = require('../../src/models');
const { setupTestDb } = require('../helpers/db');
const { createUser, createEmpresa } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { gerente } = require('../fixtures/users.fixture');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415408d763f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082', 'hex');
const UPLOAD_DIR = path.join(__dirname, '../../src/uploads/banner');

describe('Redes y banners - logica', () => {
  let token;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const createBanner = (fields = {}, file = { buffer: PNG, filename: 'x.png', contentType: 'image/png' }) => {
    let req = request(app).post('/api/marketing/banners').set(auth());
    Object.entries(fields).forEach(([k, v]) => { req = req.field(k, String(v)); });
    return req.attach('imagen_banner', file.buffer, { filename: file.filename, contentType: file.contentType });
  };

  beforeAll(async () => {
    await setupTestDb();
    const user = await createUser(gerente);
    await createEmpresa(user.id_user);
    token = getAuthToken(user);
  });

  afterAll(async () => {
    const rows = await Banner.findAll();
    rows.forEach(b => fs.rmSync(path.join(UPLOAD_DIR, path.basename(b.imagen_url || '')), { force: true }));
    await Banner.destroy({ where: {} });
  });

  it('crea con titulo, orden y activo=false', async () => {
    const res = await createBanner({ titulo: 'Oferta', orden: 3, activo: 'false' });
    expect(res.statusCode).toBe(201);
    expect(res.body.banner).toMatchObject({ titulo: 'Oferta', orden: 3, activo: false, media_type: 'image' });
  });

  it('fuerza la extension segun el MIME, no el nombre original', async () => {
    const res = await createBanner({}, { buffer: PNG, filename: 'evil.html', contentType: 'image/png' });
    expect(res.statusCode).toBe(201);
    expect(res.body.banner.imagen_url).toMatch(/\.png$/);
  });

  it('rechaza un archivo cuyo contenido no coincide con el MIME (JSON 400, sin archivo huerfano)', async () => {
    const before = fs.readdirSync(UPLOAD_DIR).length;
    const res = await createBanner({}, { buffer: Buffer.from('<html>no soy png</html>'), filename: 'a.png', contentType: 'image/png' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/no coincide/i);
    expect(fs.readdirSync(UPLOAD_DIR).length).toBe(before);
  });

  it('rechaza un formato no permitido como JSON 400 con mensaje claro', async () => {
    const res = await createBanner({}, { buffer: Buffer.from('GIF89a'), filename: 'a.gif', contentType: 'image/gif' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Formato no permitido/);
    expect(res.body.message).toMatch(/MP4/);
  });

  it('reordena en bloque y alterna activo; valida la entrada', async () => {
    const a = (await createBanner({ titulo: 'A', orden: 10 })).body.banner;
    const b = (await createBanner({ titulo: 'B', orden: 11 })).body.banner;
    const reorder = await request(app).patch('/api/marketing/banners/reordenar').set(auth())
      .send({ orden: [{ id: a.id_banner, orden: 21 }, { id: b.id_banner, orden: 20 }] });
    expect(reorder.statusCode).toBe(200);
    const ids = reorder.body.banners.map(x => x.id_banner);
    expect(ids.indexOf(b.id_banner)).toBeLessThan(ids.indexOf(a.id_banner));
    const bad = await request(app).patch('/api/marketing/banners/reordenar').set(auth()).send({ orden: [{ id: 999999, orden: 1 }] });
    expect(bad.statusCode).toBe(404);
    const invalid = await request(app).patch('/api/marketing/banners/reordenar').set(auth()).send({ orden: 'x' });
    expect(invalid.statusCode).toBe(400);
    const off = await request(app).patch(`/api/marketing/banners/${a.id_banner}/activo`).set(auth()).send({ activo: false });
    expect(off.statusCode).toBe(200);
    expect(off.body.banner.activo).toBe(false);
    const wrong = await request(app).patch(`/api/marketing/banners/${a.id_banner}/activo`).set(auth()).send({ activo: 'quizas' });
    expect(wrong.statusCode).toBe(400);
  });

  it('contrato publico /ecommerce/banners: solo activos, ordenados, URL absoluta', async () => {
    const res = await request(app).get('/api/ecommerce/banners');
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    res.body.forEach(item => {
      expect(Object.keys(item)).toEqual(expect.arrayContaining(['id_banner', 'titulo', 'imagen_url', 'media_type', 'activo', 'orden', 'creado_en']));
      expect(item.activo).toBe(true);
      expect(item.imagen_url).toMatch(/^https?:\/\//);
    });
    const ordenes = res.body.map(x => x.orden);
    expect(ordenes).toEqual([...ordenes].sort((x, y) => x - y));
  });

  it('el banner singular publico ignora los inactivos', async () => {
    await Banner.update({ activo: false }, { where: {} });
    const res = await request(app).get('/api/ecommerce/banner');
    expect(res.statusCode).toBe(404);
  });

  it('elimina un banner y su archivo', async () => {
    const created = (await createBanner({ titulo: 'Borrar' })).body.banner;
    const file = path.join(UPLOAD_DIR, path.basename(created.imagen_url));
    expect(fs.existsSync(file)).toBe(true);
    const res = await request(app).delete(`/api/marketing/banners/${created.id_banner}`).set(auth());
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('redes: permite vaciar una red, normaliza WhatsApp y mantiene el contrato publico', async () => {
    const res = await request(app).patch('/api/social-links/admin').set(auth())
      .send({ tiktok_url: '', whatsapp_number: '904 589 554', facebook_url: 'https://web.facebook.com/criscom' });
    expect(res.statusCode).toBe(200);
    expect(res.body.tiktok_url).toBe('');
    expect(res.body.whatsapp_number).toBe('51904589554');
    const pub = await request(app).get('/api/social-links');
    expect(Object.keys(pub.body).sort()).toEqual(['correo', 'direccion', 'facebook_url', 'instagram_url', 'razon_social', 'ruc', 'tiktok_url', 'whatsapp_number', 'youtube_url']);
    expect(pub.body.correo).toBe('ventas@criscomgroup.com.pe');
    expect(pub.body.tiktok_url).toBe('');
    expect(pub.body.facebook_url).toBe('https://web.facebook.com/criscom');
    const http = await request(app).patch('/api/social-links/admin').set(auth()).send({ instagram_url: 'http://instagram.com/x' });
    expect(http.statusCode).toBe(422);
    expect(http.body.message).toMatch(/HTTPS/);
  });
});
