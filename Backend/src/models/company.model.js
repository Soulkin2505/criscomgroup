const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const moment = require('moment-timezone');


const Company = sequelize.define('Company', {
    id_company: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    razon_social: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true
        }
    },
    ruc: {
        type: DataTypes.STRING(11),
        allowNull: false,
        unique: true,
        validate: {
            notEmpty: true
        }
    },
    direccion: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    logo_url: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    instagram_url: { type: DataTypes.STRING(255), allowNull: true },
    facebook_url: { type: DataTypes.STRING(255), allowNull: true },
    tiktok_url: { type: DataTypes.STRING(255), allowNull: true },
    youtube_url: { type: DataTypes.STRING(255), allowNull: true },
    whatsapp_number: { type: DataTypes.STRING(20), allowNull: true },
    horario_inicio: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '08:50' },
    horario_fin: { type: DataTypes.STRING(5), allowNull: false, defaultValue: '21:15' },
    horario_restriccion_activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Cual empresa (de las que tengan RUC registrado) muestra su razon social/RUC/direccion
    // en la web publica. Solo una a la vez; se controla desde Redes y banners.
    mostrar_en_web: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sol_user: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    sol_pass: {
        type: DataTypes.STRING(50),
        allowNull: false
    },
    cert_path: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    client_id: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    client_secret: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    production: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false
    },
    tipo_ruc: {
        type: DataTypes.ENUM('10', '20'),
        allowNull: false,
        defaultValue: '10'
    },
    facturacion_habilitada: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    emisor_predeterminado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    serie_factura: {
        type: DataTypes.STRING(4),
        allowNull: false,
        defaultValue: 'F001'
    },
    serie_boleta: {
        type: DataTypes.STRING(4),
        allowNull: false,
        defaultValue: 'B001'
    },
    sunat_config_key: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'RUC10'
    },
    // Pruebas manuales: el envio a SUNAT queda desactivado aunque la empresa este lista para produccion.
    sunat_pruebas_manual: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Momento en que la empresa paso sola a produccion (SOL + certificado + ficha RUC). Null = aun no.
    sunat_produccion_desde: { type: DataTypes.DATE, allowNull: true },
    id_user: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id_user'
        },
        onDelete: 'CASCADE',
    }
}, {
    tableName: 'companies',
    timestamps: true,
    createdAt: 'creado_en',
    updatedAt: 'actualizado_en'
}
)




// RUC peruano: 11 digitos, prefijo 10 (persona natural) o 20 (persona juridica) y
// digito verificador modulo 11 (pesos 5,4,3,2,7,6,5,4,3,2).
const RUC_FORMAT = /^(10|20)\d{9}$/;
const rucCheckDigit = base => {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + weight * Number(base[index]), 0);
  return (11 - (sum % 11)) % 10;
};
Company.isValidRucFormat = value => RUC_FORMAT.test(String(value || ''));
Company.isValidRuc = value => {
  const ruc = String(value || '');
  return RUC_FORMAT.test(ruc) && rucCheckDigit(ruc) === Number(ruc[10]);
};

// Serializacion publica: nunca expone sol_user, sol_pass, cert_path ni client_secret;
// solo indica si estan configurados.
Company.prototype.toJSON = function() {
  const sunat = require('../services/sunat.service');
  const fs = require('fs');
  const values = Object.assign({}, this.get());
  values.sol_configurado = Boolean(values.sol_user && values.sol_pass);
  values.certificado_configurado = Boolean(values.cert_path) && (() => { try { return fs.existsSync(values.cert_path); } catch { return false; } })();
  values.client_secret_configurado = Boolean(values.client_secret);
  values.ruc_valido = Company.isValidRuc(values.ruc);
  // `production` no es un interruptor propio: refleja el modo real de esta empresa (servidor + configuracion + pruebas manuales).
  const modo = sunat.companyMode(this);
  values.modo_sunat = modo.mode;
  values.production = modo.mode === 'production';
  values.modo_sunat_estado = { motivo: modo.motivo, pendientes: modo.pendientes, activada: modo.activada, servidor: modo.servidor, aviso_servidor: modo.aviso_servidor };
  delete values.sol_user;
  delete values.sol_pass;
  delete values.cert_path;
  delete values.client_secret;
  if (values.creado_en) {
    values.creado_en = moment(values.creado_en)
      .tz('America/Lima')
      .format('YYYY-MM-DD HH:mm:ss');
  }
  if (values.actualizado_en) {
    values.actualizado_en = moment(values.actualizado_en)
      .tz('America/Lima')
      .format('YYYY-MM-DD HH:mm:ss');
  }
  return values;
};

module.exports = Company;
