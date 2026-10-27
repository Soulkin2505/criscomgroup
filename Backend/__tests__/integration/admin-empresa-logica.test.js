'use strict';
const request = require('supertest');
const fs = require('fs');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { Company, AreaGrant, AuditLog } = require('../../src/models');
const gatewayService = require('../../src/services/payment-gateway.service');
const sunat = require('../../src/services/sunat.service');
const hours = require('../../src/services/business-hours.service');

const SECRET = 'seed-adm-secret-value-123456';
const validRuc = prefix => {
  const base = `${prefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const sum = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((acc, w, i) => acc + w * Number(base[i]), 0);
  return `${base}${(11 - (sum % 11)) % 10}`;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('Administracion - Empresa, SUNAT y pagos (logica)', () => {
  let gerente; let master; let admin; let vendedor; let tokens;
  const as = (who, req) => req.set('Authorization', `Bearer ${tokens[who]}`);
  let company;

  beforeAll(async () => {
    await setupTestDb();
    master = await createUser({ name: 'Master', email: 'master-adm@test.local', password: 'Master123!', id_role: 1 });
    gerente = await createUser({ name: 'Gerente', email: 'gerente-adm@test.local', password: 'Gerente123!', id_role: 1 });
    admin = await createUser({ name: 'Admin', email: 'admin-adm@test.local', password: 'Admin123!', id_role: 2 });
    vendedor = await createUser({ name: 'Vend', email: 'vend-adm@test.local', password: 'Vend123!', id_role: 3 });
    await vendedor.update({ tipo_vendedor: 'fisico' });
    process.env.MASTER_ADMIN_EMAIL = master.email;
    tokens = { master: getAuthToken(master), gerente: getAuthToken(gerente), admin: getAuthToken(admin), vendedor: getAuthToken(vendedor) };
    company = await Company.create({
      razon_social: 'Empresa seed-adm', ruc: '10456789012', direccion: 'Av. Demo 123', sol_user: 'SOLUSR', sol_pass: SECRET,
      cert_path: '/nope/cert.pem', client_id: 'cid', client_secret: SECRET, tipo_ruc: '10', facturacion_habilitada: true, emisor_predeterminado: true, id_user: master.id_user,
    });
  });

  describe('unidades', () => {
    it('RUC: digito verificador modulo 11', () => {
      expect(Company.isValidRuc(validRuc('20'))).toBe(true);
      expect(Company.isValidRuc(validRuc('10'))).toBe(true);
      expect(Company.isValidRuc('10456789012')).toBe(false);
      expect(Company.isValidRucFormat('30456789012')).toBe(false);
    });
    it('SUNAT_MODE invalido cae a pruebas, jamas a produccion', () => {
      const original = process.env.SUNAT_MODE;
      try {
        for (const value of [undefined, '', 'prod', 'Production', ' production2']) {
          if (value === undefined) delete process.env.SUNAT_MODE; else process.env.SUNAT_MODE = value;
          expect(sunat.sunatMode()).toBe('sandbox');
          expect(sunat.sunatModeInfo().valid).toBe(false);
        }
        process.env.SUNAT_MODE = 'production';
        expect(sunat.sunatMode()).toBe('production');
      } finally { if (original === undefined) delete process.env.SUNAT_MODE; else process.env.SUNAT_MODE = original; }
    });
    it('horario: inicio==fin no bloquea, cruce de medianoche y zona Lima', () => {
      const at = iso => new Date(iso);
      expect(hours.evaluate({ horario_inicio: '09:00', horario_fin: '09:00', horario_restriccion_activa: true }).dentro).toBe(true);
      const night = { horario_inicio: '20:00', horario_fin: '04:00', horario_restriccion_activa: true };
      expect(hours.evaluate(night, at('2026-10-11T03:00:00Z')).dentro).toBe(true); // 22:00 Lima
      expect(hours.evaluate(night, at('2026-10-11T15:00:00Z')).dentro).toBe(false); // 10:00 Lima
      expect(hours.evaluate({ ...night, horario_restriccion_activa: false }, at('2026-10-11T15:00:00Z')).dentro).toBe(true);
    });
  });

  describe('empresa', () => {
    it('GET /companies no devuelve secretos y marca configurados', async () => {
      const res = await as('gerente', request(app).get('/api/companies'));
      expect(res.statusCode).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(SECRET);
      expect(res.body[0]).toMatchObject({ sol_configurado: true, client_secret_configurado: true, ruc_valido: false, production: false });
      expect(res.body[0]).not.toHaveProperty('sol_pass');
      expect(res.body[0]).not.toHaveProperty('cert_path');
    });
    it('roles 2 y 3 reciben solo la forma publica', async () => {
      const res = await as('vendedor', request(app).get('/api/companies'));
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.body[0]).sort()).toEqual(['direccion', 'id_company', 'logo_url', 'mostrar_en_web', 'razon_social', 'ruc', 'tipo_ruc']);
    });
    it('PUT sin secretos conserva sol_user, sol_pass y client_secret', async () => {
      const res = await as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', 'Empresa seed-adm 2').field('ruc', '10456789012').field('direccion', 'Av. Nueva 456').field('sol_user', '').field('sol_pass', '').field('client_secret', '');
      expect(res.statusCode).toBe(200);
      expect(res.body.avisos.join(' ')).toMatch(/dígito verificador/);
      const row = await Company.findByPk(company.id_company);
      expect(row.sol_user).toBe('SOLUSR');
      expect(row.sol_pass).toBe(SECRET);
      expect(row.client_secret).toBe(SECRET);
      expect(row.direccion).toBe('Av. Nueva 456');
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    });
    it('PUT ignora production y reporta el modo real', async () => {
      const res = await as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', 'Empresa seed-adm 2').field('ruc', '10456789012').field('direccion', 'Av. Nueva 456').field('production', 'true');
      expect(res.statusCode).toBe(200);
      expect(res.body.company.production).toBe(false);
      expect(res.body.avisos.join(' ')).toMatch(/SUNAT_MODE/);
      expect((await Company.findByPk(company.id_company)).production).toBeFalsy();
    });
    it('RUC cambiado sin digito valido exige marcar demo; con RUC valido deriva tipo_ruc', async () => {
      const bad = await as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', 'X seed-adm').field('ruc', '20456789012').field('direccion', 'Dir 12345');
      expect(bad.statusCode).toBe(422);
      expect(bad.body.errores.ruc).toMatch(/dígito verificador/);
      const demo = await as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', 'X seed-adm').field('ruc', '20456789012').field('direccion', 'Dir 12345').field('ruc_demo', 'true');
      expect(demo.statusCode).toBe(200);
      const row = await Company.findByPk(company.id_company);
      expect(row.tipo_ruc).toBe('20');
      expect(row.facturacion_habilitada).toBe(false);
      expect(row.emisor_predeterminado).toBe(false);
      await row.update({ ruc: '10456789012', tipo_ruc: '10', facturacion_habilitada: true, emisor_predeterminado: true });
    });
    it('validacion devuelve JSON con errores por campo (nunca 500)', async () => {
      const res = await as('gerente', request(app).put(`/api/companies/${company.id_company}`)).field('razon_social', '').field('ruc', 'abc');
      expect(res.statusCode).toBe(422);
      expect(res.body.errores).toHaveProperty('ruc');
      expect((await as('gerente', request(app).put('/api/companies/99999')).field('razon_social', 'x')).statusCode).toBe(404);
    });
    it('el logo SVG se rechaza con JSON 422', async () => {
      const res = await as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', 'Empresa seed-adm').field('ruc', '10456789012').field('direccion', 'Av. Nueva 456')
        .attach('logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), { filename: 'logo.svg', contentType: 'image/svg+xml' });
      expect(res.statusCode).toBe(422);
      expect(res.body.errores.logo).toMatch(/JPG, PNG o WebP/);
    });
    it('DELETE esta protegido para el emisor fiscal activo', async () => {
      const res = await as('gerente', request(app).delete(`/api/companies/${company.ruc}`));
      expect(res.statusCode).toBe(409);
      expect(await Company.findByPk(company.id_company)).not.toBeNull();
    });
    it('la auditoria de empresa no guarda secretos', async () => {
      await as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', 'Empresa seed-adm 3').field('ruc', '10456789012').field('direccion', 'Av. Nueva 456').field('sol_pass', 'otra-clave-seed-adm-999');
      await wait(400);
      const rows = await AuditLog.findAll({ where: { tabla: 'empresas' } });
      expect(rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows.map(r => r.datos_nuevos))).not.toContain('otra-clave-seed-adm-999');
      expect((await Company.findByPk(company.id_company)).sol_pass).toBe('otra-clave-seed-adm-999');
    });
  });

  describe('horario laboral', () => {
    const patch = (who, body) => as(who, request(app).patch('/api/companies/settings/business-hours')).send(body);
    it('inicio igual a fin es error de validacion', async () => {
      const res = await patch('gerente', { horario_inicio: '09:00', horario_fin: '09:00', horario_restriccion_activa: true });
      expect(res.statusCode).toBe(422);
      expect(res.body.errores.horario_fin).toBeDefined();
    });
    it('formato invalido y booleano invalido dan errores por campo', async () => {
      const res = await patch('gerente', { horario_inicio: '25:00', horario_fin: '10:00', horario_restriccion_activa: 'quizas' });
      expect(res.statusCode).toBe(422);
      expect(Object.keys(res.body.errores).sort()).toEqual(['horario_inicio', 'horario_restriccion_activa']);
    });
    it('campo restriccion ausente apaga la restriccion de forma explicita y avisa', async () => {
      const res = await patch('gerente', { horario_inicio: '08:00', horario_fin: '20:00' });
      expect(res.statusCode).toBe(200);
      expect(res.body.horario_restriccion_activa).toBe(false);
      expect(res.body.avisos.join(' ')).toMatch(/horario_restriccion_activa/);
      expect(res.body).toMatchObject({ zona_horaria: 'America/Lima' });
      expect(res.body.bloquea_a).toMatch(/vendedores fisicos/);
    });
    it('guarda valores validos y solo rol 1 puede cambiarlos', async () => {
      const ok = await patch('gerente', { horario_inicio: '08:50', horario_fin: '21:15', horario_restriccion_activa: true });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.horario_restriccion_activa).toBe(true);
      const denied = await patch('admin', { horario_inicio: '08:50', horario_fin: '21:15', horario_restriccion_activa: true });
      expect(denied.statusCode).toBe(403);
      expect(denied.body.message).toBeTruthy();
      expect((await as('vendedor', request(app).get('/api/companies/settings/business-hours'))).statusCode).toBe(200);
    });
  });

  describe('permisos coherentes con el menu', () => {
    it('rol 2 ve SUNAT pero no Culqi ni pagos', async () => {
      const res = await as('admin', request(app).get('/api/companies/settings/integrations'));
      expect(res.statusCode).toBe(200);
      expect(res.body.culqi).toBeNull();
      expect(typeof res.body.sunat.connected).toBe('boolean');
      expect((await as('admin', request(app).get('/api/payment-gateways'))).statusCode).toBe(403);
      expect((await as('admin', request(app).get('/api/facturacion/emisores'))).statusCode).toBe(200);
      expect((await as('admin', request(app).get('/api/companies/settings/ruc-sheet'))).statusCode).toBe(403);
    });
    it('rol 1: badge de Culqi es booleano real (no {})', async () => {
      const res = await as('gerente', request(app).get('/api/companies/settings/integrations'));
      expect(typeof res.body.culqi.connected).toBe('boolean');
    });
    it('area_grants empresa_sunat y pagos_pos se aplican en el backend con 403 claro', async () => {
      expect((await as('vendedor', request(app).get('/api/facturacion/emisores'))).statusCode).toBe(403);
      expect((await as('vendedor', request(app).get('/api/payment-gateways'))).body.message).toMatch(/permisos/);
      await AreaGrant.bulkCreate([{ user_id: vendedor.id_user, area: 'empresa_sunat', granted_by: master.id_user }, { user_id: vendedor.id_user, area: 'pagos_pos', granted_by: master.id_user }]);
      expect((await as('vendedor', request(app).get('/api/facturacion/emisores'))).statusCode).toBe(200);
      expect((await as('vendedor', request(app).get('/api/facturacion/documentos'))).statusCode).toBe(200);
      expect((await as('vendedor', request(app).get('/api/payment-gateways'))).statusCode).toBe(200);
      const integrations = await as('vendedor', request(app).get('/api/companies/settings/integrations'));
      expect(integrations.statusCode).toBe(200);
      expect(integrations.body.culqi).not.toBeNull();
      await AreaGrant.destroy({ where: { user_id: vendedor.id_user } });
    });
  });

  describe('facturacion', () => {
    it('GET /emisores no escribe en BD ni deshabilita RUC 20', async () => {
      const twenty = await Company.create({ razon_social: 'RUC20 seed-adm', ruc: validRuc('20'), direccion: 'Dir 12345', sol_user: 'u', sol_pass: 'p', cert_path: '/x', tipo_ruc: '20', facturacion_habilitada: true, emisor_predeterminado: false, id_user: master.id_user });
      const res = await as('gerente', request(app).get('/api/facturacion/emisores'));
      expect(res.statusCode).toBe(200);
      expect(res.body.ruc20_habilitados_pendientes).toBe(1);
      expect((await Company.findByPk(twenty.id_company)).facturacion_habilitada).toBe(true);
      const denied = await as('gerente', request(app).post('/api/facturacion/emisores/bloquear-ruc20'));
      expect(denied.statusCode).toBe(403);
      expect(denied.body.message).toMatch(/cuenta maestra/);
      expect((await as('master', request(app).post('/api/facturacion/emisores/bloquear-ruc20'))).body.success).toBe(true);
      expect((await Company.findByPk(twenty.id_company)).facturacion_habilitada).toBe(false);
    });
    it('informa permisos de edicion con motivo y el estado real del certificado', async () => {
      const plain = await as('gerente', request(app).get('/api/facturacion/emisores'));
      expect(plain.body.permisos).toMatchObject({ puede_editar: false });
      expect(plain.body.permisos.motivo).toMatch(/cuenta maestra/);
      const master1 = await as('master', request(app).get('/api/facturacion/emisores'));
      expect(master1.body.permisos.puede_editar).toBe(true);
      expect(master1.body.emisores[0].certificado_configurado).toBe(false);
    });
    it('editar series: valida, deja un solo predeterminado y queda auditado', async () => {
      const bad = await as('master', request(app).patch(`/api/facturacion/emisores/${company.id_company}`)).send({ razon_social: 'Empresa seed-adm', direccion: 'Av. Nueva 456', serie_factura: 'X001', serie_boleta: 'B002' });
      expect(bad.statusCode).toBe(422);
      expect(bad.body.errores.serie_factura).toBeDefined();
      const ok = await as('master', request(app).patch(`/api/facturacion/emisores/${company.id_company}`)).send({ razon_social: 'Empresa seed-adm', direccion: 'Av. Nueva 456', serie_factura: 'F002', serie_boleta: 'B002' });
      expect(ok.statusCode).toBe(200);
      expect(await Company.count({ where: { emisor_predeterminado: true } })).toBe(1);
      await wait(400);
      expect(await AuditLog.count({ where: { tabla: 'emisores_fiscales' } })).toBeGreaterThan(0);
    });
  });

  describe('pasarelas de pago', () => {
    const SK = 'sk_test_seedadm1234567890';
    const PK = 'pk_test_seedadm1234567890';
    const save = body => as('gerente', request(app).put('/api/payment-gateways/culqi')).send(body);
    afterEach(() => jest.restoreAllMocks());

    it('guarda cifrado, no devuelve secretos y valida entorno de las llaves', async () => {
      const wrong = await save({ mode: 'test', credentials: { public_key: 'pk_live_xxxxxxxxxxxxx', secret_key: SK } });
      expect(wrong.statusCode).toBe(422);
      expect(wrong.body.errores.public_key).toBeDefined();
      const missing = await save({ mode: 'test', credentials: { public_key: PK } });
      expect(missing.statusCode).toBe(422);
      const ok = await save({ mode: 'test', credentials: { public_key: PK, secret_key: SK } });
      expect(ok.statusCode).toBe(200);
      expect(JSON.stringify(ok.body)).not.toContain(SK);
      expect(ok.body.gateway).toMatchObject({ connection_status: 'saved', enabled: false, is_default: false, integrated: true, webhook_url: '/api/pedidos/webhooks/culqi' });
      const row = await require('../../src/models/payment_gateway.model').findOne({ where: { provider: 'culqi' } });
      expect(row.credentials_encrypted).not.toContain(SK);
      await wait(400);
      const logs = await AuditLog.findAll({ where: { tabla: 'pasarelas_pago' } });
      expect(logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs.map(l => l.datos_nuevos))).not.toContain(SK);
    });
    it('un guardado parcial fusiona con lo anterior', async () => {
      const res = await save({ mode: 'test', credentials: { public_key: 'pk_test_seedadm0987654321' } });
      expect(res.statusCode).toBe(200);
      const creds = gatewayService.decrypt((await require('../../src/models/payment_gateway.model').findOne({ where: { provider: 'culqi' } })).credentials_encrypted);
      expect(creds).toMatchObject({ public_key: 'pk_test_seedadm0987654321', secret_key: SK });
    });
    it('pasar a produccion exige escribir PRODUCCION', async () => {
      const live = { public_key: 'pk_live_seedadm1234567890', secret_key: 'sk_live_seedadm1234567890' };
      const denied = await save({ mode: 'production', credentials: live });
      expect(denied.statusCode).toBe(409);
      expect(denied.body.requiere_confirmacion).toBe(true);
      const ok = await save({ mode: 'production', credentials: live, confirmar_produccion: 'Producción' });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.gateway.mode).toBe('production');
      const back = await save({ mode: 'test', credentials: { public_key: PK, secret_key: SK } });
      expect(back.statusCode).toBe(200);
    });
    it('un fallo de red al probar NO desactiva la pasarela', async () => {
      const Gateway = require('../../src/models/payment_gateway.model');
      await Gateway.update({ enabled: true, is_default: true, connection_status: 'connected' }, { where: { provider: 'culqi' } });
      jest.spyOn(gatewayService, 'testConnection').mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
      const res = await as('gerente', request(app).post('/api/payment-gateways/culqi/test'));
      expect(res.statusCode).toBe(502);
      expect(res.body.transitorio).toBe(true);
      const row = await Gateway.findOne({ where: { provider: 'culqi' } });
      expect(row).toMatchObject({ enabled: true, is_default: true, connection_status: 'connected' });
    });
    it('un rechazo real de credenciales si la desactiva', async () => {
      const Gateway = require('../../src/models/payment_gateway.model');
      jest.spyOn(gatewayService, 'testConnection').mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401, data: { merchant_message: 'Llave invalida' } } }));
      const res = await as('gerente', request(app).post('/api/payment-gateways/culqi/test'));
      expect(res.statusCode).toBe(422);
      const row = await Gateway.findOne({ where: { provider: 'culqi' } });
      expect(row).toMatchObject({ enabled: false, is_default: false, connection_status: 'error' });
    });
    it('is_default es efectivo solo para pasarelas integradas; las demas estan en preparacion', async () => {
      const Gateway = require('../../src/models/payment_gateway.model');
      await Gateway.update({ connection_status: 'connected' }, { where: { provider: 'culqi' } });
      const on = await as('gerente', request(app).post('/api/payment-gateways/culqi/default'));
      expect(on.body.gateway).toMatchObject({ enabled: true, is_default: true, en_uso: true });
      const off = await as('gerente', request(app).delete('/api/payment-gateways/culqi/default'));
      expect(off.body.gateway).toMatchObject({ enabled: false, is_default: false, en_uso: false });
      const prep = await as('gerente', request(app).post('/api/payment-gateways/izipay/default'));
      expect(prep.statusCode).toBe(422);
      expect(prep.body.message).toMatch(/preparación/);
    });
    it('credenciales ilegibles no tumban el listado ni el proceso', async () => {
      const Gateway = require('../../src/models/payment_gateway.model');
      await Gateway.update({ credentials_encrypted: 'basura.invalida.datos' }, { where: { provider: 'culqi' } });
      const res = await as('gerente', request(app).get('/api/payment-gateways'));
      expect(res.statusCode).toBe(200);
      expect(res.body.gateways[0].credentials_error).toBe(true);
      const tested = await as('gerente', request(app).post('/api/payment-gateways/culqi/test'));
      expect(tested.statusCode).toBe(409);
      const resaved = await save({ mode: 'test', credentials: {} });
      expect(resaved.statusCode).toBe(409);
    });
  });

  describe('ficha RUC', () => {
    it('rechaza tipos y contenido invalidos con JSON y acepta PDF; ver/reemplazar/eliminar', async () => {
      const exe = await as('gerente', request(app).post('/api/companies/settings/ruc-sheet')).attach('ficha_ruc', Buffer.from('MZ-no-es-pdf'), { filename: 'ficha.pdf', contentType: 'application/pdf' });
      expect(exe.statusCode).toBe(422);
      expect(exe.body.message).toMatch(/PDF, JPG o PNG/);
      const noFile = await as('gerente', request(app).post('/api/companies/settings/ruc-sheet'));
      expect(noFile.statusCode).toBe(422);
      const ok = await as('gerente', request(app).post('/api/companies/settings/ruc-sheet')).attach('ficha_ruc', Buffer.from('%PDF-1.4 seed-adm'), { filename: 'ficha.pdf', contentType: 'application/pdf' });
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toMatchObject({ uploaded: true, original_name: 'ficha.pdf' });
      expect(JSON.stringify(ok.body)).not.toMatch(/uploads/);
      const first = fs.readdirSync(require('path').resolve(__dirname, '../../src/uploads/private/ruc')).filter(f => f.startsWith('ficha_ruc-'));
      const again = await as('gerente', request(app).post('/api/companies/settings/ruc-sheet')).attach('ficha_ruc', Buffer.from('%PDF-1.4 seed-adm 2'), { filename: 'ficha2.pdf', contentType: 'application/pdf' });
      expect(again.body.original_name).toBe('ficha2.pdf');
      const after = fs.readdirSync(require('path').resolve(__dirname, '../../src/uploads/private/ruc')).filter(f => f.startsWith('ficha_ruc-'));
      expect(after.length).toBeLessThanOrEqual(first.length);
      expect((await as('gerente', request(app).get('/api/companies/settings/ruc-sheet/download'))).statusCode).toBe(200);
      expect((await as('admin', request(app).get('/api/companies/settings/ruc-sheet/download'))).statusCode).toBe(403);
      expect((await as('gerente', request(app).delete('/api/companies/settings/ruc-sheet'))).body.uploaded).toBe(false);
      expect((await as('gerente', request(app).get('/api/companies/settings/ruc-sheet'))).body.uploaded).toBe(false);
    });
  });

  describe('certificado .p12/.pfx', () => {
    const forge = require('node-forge');
    const path = require('path');
    const CERT_DIR = path.resolve(__dirname, '../../src/uploads/private/certs');
    const PASS = 'clave-p12-seed-adm';
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const makeCert = (ruc, publicKey = keys.publicKey) => {
      const cert = forge.pki.createCertificate();
      cert.publicKey = publicKey;
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date(Date.now() - 86400000);
      cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
      const attrs = [{ name: 'organizationName', value: 'PRUEBA' }, { shortName: 'OU', value: ruc }, { name: 'commonName', value: `PRUEBA CDT ${ruc}` }];
      cert.setSubject(attrs); cert.setIssuer(attrs);
      cert.sign(keys.privateKey, forge.md.sha256.create());
      return cert;
    };
    const p12 = (ruc, password = PASS) => Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [makeCert(ruc)], password, { algorithm: '3des' })).getBytes(), 'binary');
    const put = async (attach, fields = {}) => {
      const row = await Company.findByPk(company.id_company);
      let req = as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', row.razon_social).field('ruc', row.ruc).field('direccion', row.direccion);
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
      return req.attach('cert', attach.buffer, { filename: attach.name, contentType: 'application/octet-stream' });
    };
    const ruc = async () => (await Company.findByPk(company.id_company)).ruc;

    it('sin contraseña o con contraseña incorrecta se rechaza sin guardar nada', async () => {
      const before = fs.existsSync(CERT_DIR) ? fs.readdirSync(CERT_DIR).length : 0;
      const sin = await put({ buffer: p12(await ruc()), name: 'certificado.p12' });
      expect(sin.statusCode).toBe(422);
      expect(sin.body.errores.cert).toMatch(/contraseña/);
      const mala = await put({ buffer: p12(await ruc()), name: 'certificado.pfx' }, { cert_password: 'otra' });
      expect(mala.statusCode).toBe(422);
      expect(mala.body.errores.cert).toMatch(/contraseña es incorrecta/);
      expect(fs.existsSync(CERT_DIR) ? fs.readdirSync(CERT_DIR).length : 0).toBe(before);
    });
    it('un .p12 de otro RUC se rechaza', async () => {
      const res = await put({ buffer: p12('20100070970'), name: 'certificado.p12' }, { cert_password: PASS });
      expect(res.statusCode).toBe(422);
      expect(res.body.errores.cert).toMatch(/no del RUC/);
    });
    it('con su contraseña se convierte a PEM, se guarda y la contraseña no queda en la auditoria', async () => {
      const res = await put({ buffer: p12(await ruc()), name: 'certificado.p12' }, { cert_password: PASS });
      expect(res.statusCode).toBe(200);
      expect(res.body.certificado.vence_en).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body.company.certificado_configurado).toBe(true);
      const row = await Company.findByPk(company.id_company);
      expect(row.cert_path).toMatch(/\.pem$/);
      const pem = fs.readFileSync(row.cert_path, 'utf8');
      expect(pem).toMatch(/-----BEGIN RSA PRIVATE KEY-----/);
      expect(pem).toMatch(/-----BEGIN CERTIFICATE-----/);
      expect(fs.readdirSync(CERT_DIR).filter(f => /\.(p12|pfx)$/i.test(f))).toHaveLength(0);
      await wait(300);
      const logs = await AuditLog.findAll({ where: { tabla: 'empresas' } });
      expect(logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs)).not.toContain(PASS);
    });
    it('un PEM cuya clave no corresponde al certificado se rechaza', async () => {
      const other = forge.pki.rsa.generateKeyPair(1024);
      const pem = forge.pki.privateKeyToPem(other.privateKey) + forge.pki.certificateToPem(makeCert(await ruc()));
      const res = await put({ buffer: Buffer.from(pem), name: 'certificado.pem' });
      expect(res.statusCode).toBe(422);
      expect(res.body.errores.cert).toMatch(/no corresponde/);
    });
  });

  describe('modo pruebas manual', () => {
    const url = '/api/companies/settings/sunat-mode';
    it('exige escribir la palabra de confirmacion y solo rol 1', async () => {
      expect((await as('admin', request(app).patch(url)).send({ pruebas: true, confirmacion: 'PRUEBAS' })).statusCode).toBe(403);
      const sin = await as('gerente', request(app).patch(url)).send({ pruebas: true });
      expect(sin.statusCode).toBe(409);
      expect(sin.body.message).toMatch(/Escribe PRUEBAS/);
      expect(sin.body.errores).toMatchObject({ requiere_confirmacion: true, confirmacion_esperada: 'PRUEBAS' });
      expect((await as('gerente', request(app).patch(url)).send({ pruebas: 'si', confirmacion: 'PRUEBAS' })).statusCode).toBe(422);
    });
    it('activa y desactiva las pruebas manuales', async () => {
      const on = await as('gerente', request(app).patch(url)).send({ pruebas: true, confirmacion: 'pruebas' });
      expect(on.statusCode).toBe(200);
      expect(on.body).toMatchObject({ mode: 'sandbox', motivo: expect.any(String), pruebas_manual: true });
      expect((await Company.findByPk(company.id_company)).sunat_pruebas_manual).toBe(true);
      const off = await as('gerente', request(app).patch(url)).send({ pruebas: false, confirmacion: 'Producción' });
      expect(off.statusCode).toBe(200);
      expect(off.body.pruebas_manual).toBe(false);
    });
    it('PUT de la empresa no puede cambiar las columnas de modo', async () => {
      await as('gerente', request(app).put(`/api/companies/${company.id_company}`))
        .field('razon_social', 'Empresa seed-adm 2').field('ruc', '10456789012').field('direccion', 'Av. Nueva 456')
        .field('sunat_pruebas_manual', 'true').field('sunat_produccion_desde', '2020-01-01');
      const row = await Company.findByPk(company.id_company);
      expect(row.sunat_pruebas_manual).toBe(false);
      expect(row.sunat_produccion_desde).toBeNull();
    });
  });
});
