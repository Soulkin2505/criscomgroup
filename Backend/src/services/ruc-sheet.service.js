// Ficha RUC: un archivo por empresa en uploads/private/ruc, descrito por un marcador JSON.
const fs = require('fs');
const path = require('path');

const RUC_DIR = path.resolve(__dirname, '../uploads/private/ruc');
const markerFor = company => path.join(RUC_DIR, `company-${company.id_company}.json`);

const readSheet = company => {
  if (!company) return null;
  for (const file of [markerFor(company), path.join(RUC_DIR, 'current.json')]) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.path && fs.existsSync(data.path)) return { ...data, marker: file };
    } catch (error) { console.warn('[company] ficha RUC ilegible:', error.message); }
  }
  return null;
};

module.exports = { RUC_DIR, markerFor, readSheet };
