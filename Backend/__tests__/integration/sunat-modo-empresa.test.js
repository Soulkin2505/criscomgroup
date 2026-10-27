'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const sunat = require('../../src/services/sunat.service');
const { RUC_DIR, markerFor } = require('../../src/services/ruc-sheet.service');

// Modo por empresa: el servidor es el techo; produccion llega sola con SOL + certificado + ficha RUC.
describe('Modo SUNAT por empresa', () => {
  const env = { mode: process.env.SUNAT_MODE, node: process.env.NODE_ENV };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sunat-modo-'));
  const certPath = path.join(tmp, 'cert.pem');
  const sheetPath = path.join(tmp, 'ficha.pdf');
  const company = (extra = {}) => ({ id_company: 987654, ruc: '10724147831', sol_user: 'USUARIO', sol_pass: 'clave', cert_path: certPath, sunat_config_key: 'RUC10', ...extra });
  const withSheet = () => { fs.mkdirSync(RUC_DIR, { recursive: true }); fs.writeFileSync(markerFor({ id_company: 987654 }), JSON.stringify({ path: sheetPath })); };
  const withoutSheet = () => fs.rmSync(markerFor({ id_company: 987654 }), { force: true });

  beforeAll(() => { fs.writeFileSync(certPath, 'x'); fs.writeFileSync(sheetPath, '%PDF'); });
  afterEach(() => {
    withoutSheet();
    if (env.mode === undefined) delete process.env.SUNAT_MODE; else process.env.SUNAT_MODE = env.mode;
    process.env.NODE_ENV = env.node;
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('sin SUNAT_MODE: produccion permitida solo con NODE_ENV=production', () => {
    delete process.env.SUNAT_MODE;
    process.env.NODE_ENV = 'test';
    expect(sunat.sunatMode()).toBe('sandbox');
    process.env.NODE_ENV = 'production';
    expect(sunat.sunatModeInfo()).toMatchObject({ mode: 'production', valid: true, warning: null });
  });

  it('pasa a produccion solo con SOL, certificado y ficha RUC', () => {
    process.env.SUNAT_MODE = 'production';
    expect(sunat.companyMode(company())).toMatchObject({ mode: 'sandbox', motivo: 'incompleto', pendientes: ['ficha RUC'] });
    withSheet();
    expect(sunat.companyMode(company())).toMatchObject({ mode: 'production', motivo: 'automatico', pendientes: [] });
  });

  it('SUNAT_MODE=sandbox fija pruebas aunque la empresa este completa', () => {
    process.env.SUNAT_MODE = 'sandbox';
    withSheet();
    expect(sunat.companyMode(company())).toMatchObject({ mode: 'sandbox', motivo: 'servidor' });
  });

  it('pruebas manuales: no envia a SUNAT aunque haya credenciales', async () => {
    process.env.SUNAT_MODE = 'production';
    withSheet();
    const c = company({ sunat_pruebas_manual: true });
    expect(sunat.companyMode(c)).toMatchObject({ mode: 'sandbox', motivo: 'manual' });
    const result = await sunat.sendBill({ fileName: 'x', signedXml: '<Invoice/>', company: c });
    expect(result).toMatchObject({ sandbox: true, code: '0', cdr: null });
  });

  it('una vez activada no vuelve sola a pruebas si luego falta la ficha', () => {
    process.env.SUNAT_MODE = 'production';
    expect(sunat.companyMode(company({ sunat_produccion_desde: new Date() }))).toMatchObject({ mode: 'production', activada: true });
  });

  it('activateIfReady registra la fecha una sola vez', async () => {
    process.env.SUNAT_MODE = 'production';
    withSheet();
    const updates = [];
    const c = company({ update: async data => { updates.push(data); Object.assign(c, data); } });
    expect(await sunat.activateIfReady(c)).toBe(true);
    expect(await sunat.activateIfReady(c)).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0].sunat_produccion_desde).toBeInstanceOf(Date);
  });
});
