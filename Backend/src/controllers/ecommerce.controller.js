const { Op } = require("sequelize");
const { Producto, Categoria, Banner, Tarjeta, Venta, User, SolicitudImportacion, SolicitudEnsamble, SolicitudServicio, sequelize } = require("../models");

// Mismo patrón que pedido.controller (optionalUser): JWT de cliente, sin middleware de roles.
const verificarTokenCliente = (req) => {
  try {
    const jwt = require('jsonwebtoken');
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    return token ? jwt.verify(token, process.env.JWT_SECRET) : null;
  } catch { return null; }
};

// WHERE LOWER(campo) = email (normalizado) para vincular solicitudes creadas sin auth.
const sequelizeWhereEmailLower = (campo, email) =>
  sequelize.where(sequelize.fn('LOWER', sequelize.col(campo)), email);

// T2: write-through "al vencer/iniciar" — el caché es_oferta/precio_oferta solo refleja ofertas vigentes.
const { sincronizarVigenciaOfertas } = require('../services/ofertas.service');

// Función helper para generar URLs completas de imágenes
const generarUrlCompleta = (imagen_url, req, tipo = 'productos') => {
  if (!imagen_url) return null;

  // Si ya es una URL completa (http/https), devolverla tal como está
  if (imagen_url.startsWith('http')) {
    return imagen_url;
  }

  // Obtener el protocolo y host, manejando proxies y configuraciones del servidor
  const protocol = req.get('X-Forwarded-Proto') || req.protocol || 'https';
  let host = req.get('X-Forwarded-Host') || req.get('Host') || req.get('host');

  // Limpiar el host para evitar duplicaciones y problemas con proxies
  if (host && host.includes(',')) {
    host = host.split(',')[0].trim();
  }

  // Construir la URL base usando PUBLIC_BASE_URL si está configurado
  const baseUrl = process.env.PUBLIC_BASE_URL || `${protocol}://${host}`;

  // Si imagen_url ya incluye '/uploads/', usar tal como está
  if (imagen_url.startsWith('/uploads/')) {
    return `${baseUrl}${imagen_url}`;
  }

  // Si es solo el nombre del archivo o una ruta relativa, agregarlo a la ruta según tipo
  const filename = imagen_url.split(/[\\\/]/).pop() || imagen_url;
  return `${baseUrl}/uploads/${tipo}/${filename}`;
};

const ecommerceController = {
  getPublicStats: async (_req, res) => {
    try {
      const [productosDisponibles, sales] = await Promise.all([
        // Disponible = stock físico - reservado por pedidos web pagados aún
        // no entregados; no solo stock físico > 0.
        Producto.scope('allBusinesses').count({ where: sequelize.literal('stock > stock_reservado') }),
        Venta.scope('allBusinesses').findAll({
          attributes: ['cliente_email', 'cliente_numero_documento', 'cliente_nombre'],
          raw: true,
        }),
      ]);

      const customerKeys = new Set();
      for (const sale of sales) {
        const key = String(sale.cliente_email || sale.cliente_numero_documento || sale.cliente_nombre || '').trim().toLowerCase();
        if (key) customerKeys.add(key);
      }

      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
      return res.json({
        productos_disponibles: Number(productosDisponibles || 0),
        clientes_atendidos: customerKeys.size,
        actualizado_en: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error al calcular estadísticas públicas:', error);
      return res.status(500).json({ message: 'No se pudieron obtener las estadísticas' });
    }
  },

  // Obtener productos para ecommerce (API pública)
  getProducts: async (req, res) => {
    try {
      await sincronizarVigenciaOfertas();
      const productos = await Producto.scope('allBusinesses').findAll({
        include: [
          {
            model: Categoria,
            as: "categoria",
            attributes: ["nombre"],
          },
        ],
        order: [["nombre", "ASC"]],
      });

      // Mapear los productos al formato requerido para ecommerce
      const productosEcommerce = productos.map(producto => ({
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        precio: producto.precio_unitario_con_igv, // Cambiar nombre a 'precio'
        es_oferta: producto.es_oferta,
        precio_oferta: producto.precio_oferta_con_igv, // Cambiar nombre a 'precio_oferta'
        stock: Math.max(0, Number(producto.stock || 0) - Number(producto.stock_reservado || 0)), // disponible, no stock físico bruto
        condicion: producto.condicion || 'nuevo',
        garantia_meses: producto.garantia_meses ?? (producto.condicion === 'segunda_mano' ? 3 : 12),
        estado_observaciones: producto.estado_observaciones,
        imagen_url: generarUrlCompleta(producto.imagen_url, req),
        id_categoria: producto.id_categoria,
        affiliate_business_id: producto.affiliate_business_id,
        propietario_id: producto.propietario_id,
        categoria: {
          nombre: producto.categoria ? producto.categoria.nombre : null
        }
      }));

      return res.status(200).json(productosEcommerce);
    } catch (error) {
      console.error("Error al obtener productos para ecommerce:", error);
      return res.status(500).json({
        message: "Error al obtener productos",
        error: error.message,
      });
    }
  },

  // Obtener categorías para ecommerce (API pública)
  getCategories: async (req, res) => {
    try {
      const categorias = await Categoria.findAll({
        attributes: ['id_categoria', 'nombre', 'descripcion', 'imagen_url'],
        order: [['nombre', 'ASC']]
      });

      // Generar URLs completas para las imágenes de cada categoría
      const categoriasConImagenes = categorias.map(categoria => {
        const categoriaData = categoria.toJSON();
        if (categoriaData.imagen_url) {
          categoriaData.imagen_url = generarUrlCompleta(categoriaData.imagen_url, req, 'categorias');
        }
        return categoriaData;
      });

      return res.status(200).json(categoriasConImagenes);
    } catch (error) {
      console.error("Error al obtener categorías para ecommerce:", error);
      return res.status(500).json({
        message: "Error al obtener categorías",
        error: error.message,
      });
    }
  },

  // Obtener productos por categoría para ecommerce (API pública)
  getProductsByCategory: async (req, res) => {
    try {
      const { id_categoria } = req.params;

      // Verificar que la categoría existe
      const categoriaExiste = await Categoria.findByPk(id_categoria);
      if (!categoriaExiste) {
        return res.status(404).json({ message: "La categoría especificada no existe" });
      }

      await sincronizarVigenciaOfertas();
      const productos = await Producto.scope('allBusinesses').findAll({
        where: { id_categoria },
        include: [
          {
            model: Categoria,
            as: "categoria",
            attributes: ["nombre"],
          },
        ],
        order: [["nombre", "ASC"]],
      });

      // Mapear los productos al formato requerido para ecommerce
      const productosEcommerce = productos.map(producto => ({
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        precio: producto.precio_unitario_con_igv, // Cambiar nombre a 'precio'
        es_oferta: producto.es_oferta,
        precio_oferta: producto.precio_oferta_con_igv, // Cambiar nombre a 'precio_oferta'
        stock: Math.max(0, Number(producto.stock || 0) - Number(producto.stock_reservado || 0)), // disponible, no stock físico bruto
        condicion: producto.condicion || 'nuevo',
        garantia_meses: producto.garantia_meses ?? (producto.condicion === 'segunda_mano' ? 3 : 12),
        estado_observaciones: producto.estado_observaciones,
        imagen_url: generarUrlCompleta(producto.imagen_url, req),
        id_categoria: producto.id_categoria,
        affiliate_business_id: producto.affiliate_business_id,
        propietario_id: producto.propietario_id,
        categoria: {
          nombre: producto.categoria ? producto.categoria.nombre : null
        }
      }));

      return res.status(200).json(productosEcommerce);
    } catch (error) {
      console.error("Error al obtener productos por categoría para ecommerce:", error);
      return res.status(500).json({
        message: "Error al obtener productos por categoría",
        error: error.message,
      });
    }
  },

  // Obtener un producto específico para ecommerce (API pública)
  getProductById: async (req, res) => {
    try {
      const { id } = req.params;

      await sincronizarVigenciaOfertas();
      const producto = await Producto.scope('allBusinesses').findByPk(id, {
        include: {
          model: Categoria,
          as: "categoria",
          attributes: ["nombre"],
        },
      });

      if (!producto) {
        return res.status(404).json({ message: "Producto no encontrado" });
      }

      // Mapear el producto al formato requerido para ecommerce
      const productoEcommerce = {
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        precio: producto.precio_unitario_con_igv, // Cambiar nombre a 'precio'
        es_oferta: producto.es_oferta,
        precio_oferta: producto.precio_oferta_con_igv, // Cambiar nombre a 'precio_oferta'
        stock: Math.max(0, Number(producto.stock || 0) - Number(producto.stock_reservado || 0)), // disponible, no stock físico bruto
        condicion: producto.condicion || 'nuevo',
        garantia_meses: producto.garantia_meses ?? (producto.condicion === 'segunda_mano' ? 3 : 12),
        estado_observaciones: producto.estado_observaciones,
        imagen_url: generarUrlCompleta(producto.imagen_url, req),
        id_categoria: producto.id_categoria,
        affiliate_business_id: producto.affiliate_business_id,
        propietario_id: producto.propietario_id,
        categoria: {
          nombre: producto.categoria ? producto.categoria.nombre : null
        }
      };

      return res.status(200).json(productoEcommerce);
    } catch (error) {
      console.error("Error al obtener el producto para ecommerce:", error);
      return res.status(500).json({
        message: "Error al obtener el producto",
        error: error.message,
      });
    }
  },

  // Obtener productos en oferta para ecommerce (API pública)
  getOffersProducts: async (req, res) => {
    try {
      await sincronizarVigenciaOfertas();
      const productos = await Producto.scope('allBusinesses').findAll({
        where: { es_oferta: true },
        include: [
          {
            model: Categoria,
            as: "categoria",
            attributes: ["nombre"],
          },
        ],
        order: [["nombre", "ASC"]],
      });

      // Mapear los productos al formato requerido para ecommerce
      const productosEcommerce = productos.map(producto => ({
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        descripcion: producto.descripcion,
        precio: producto.precio_unitario_con_igv, // Cambiar nombre a 'precio'
        es_oferta: producto.es_oferta,
        precio_oferta: producto.precio_oferta_con_igv, // Cambiar nombre a 'precio_oferta'
        stock: Math.max(0, Number(producto.stock || 0) - Number(producto.stock_reservado || 0)), // disponible, no stock físico bruto
        imagen_url: generarUrlCompleta(producto.imagen_url, req),
        id_categoria: producto.id_categoria,
        affiliate_business_id: producto.affiliate_business_id,
        propietario_id: producto.propietario_id,
        categoria: {
          nombre: producto.categoria ? producto.categoria.nombre : null
        }
      }));

      return res.status(200).json(productosEcommerce);
    } catch (error) {
      console.error("Error al obtener productos en oferta para ecommerce:", error);
      return res.status(500).json({
        message: "Error al obtener productos en oferta",
        error: error.message,
      });
    }
  },

  // Obtener el banner público para ecommerce
  getBannerPublic: async (req, res) => {
    try {
      const banner = await Banner.findOne({
        where: { activo: true },
        order: [['orden', 'ASC'], ['creado_en', 'DESC']]
      });

      if (!banner || !banner.imagen_url) {
        return res.status(404).json({ message: 'No hay banner disponible' });
      }

      // Generar URL completa para la imagen
      const bannerData = banner.toJSON();
      if (bannerData.imagen_url) {
        bannerData.imagen_url = generarUrlCompleta(bannerData.imagen_url, req, 'banner');
      }

      return res.status(200).json(bannerData);
    } catch (error) {
      console.error('Error al obtener el banner para ecommerce:', error);
      return res.status(500).json({
        message: 'Error al obtener el banner',
        error: error.message
      });
    }
  },

  // Obtener todas las tarjetas públicas para ecommerce
  getTarjetasPublic: async (req, res) => {
    try {
      const tarjetas = await Tarjeta.findAll({
        order: [['creado_en', 'DESC']]
      });

      // Generar URLs completas para las imágenes de cada tarjeta
      const tarjetasConImagenes = tarjetas.map(tarjeta => {
        const tarjetaData = tarjeta.toJSON();
        if (tarjetaData.imagen_url) {
          tarjetaData.imagen_url = generarUrlCompleta(tarjetaData.imagen_url, req, 'tarjetas');
        }
        return tarjetaData;
      });

      return res.status(200).json(tarjetasConImagenes);
    } catch (error) {
      console.error('Error al obtener tarjetas para ecommerce:', error);
      return res.status(500).json({
        message: 'Error al obtener tarjetas',
        error: error.message
      });
    }
  },

  // Obtener una tarjeta específica por ID para ecommerce
  getTarjetaByIdPublic: async (req, res) => {
    try {
      const { id } = req.params;

      const tarjeta = await Tarjeta.findOne({
        where: {
          id_tarjeta: id
        }
      });

      if (!tarjeta) {
        return res.status(404).json({ message: 'Tarjeta no encontrada' });
      }

      // Generar URL completa para la imagen
      const tarjetaData = tarjeta.toJSON();
      if (tarjetaData.imagen_url) {
        tarjetaData.imagen_url = generarUrlCompleta(tarjetaData.imagen_url, req, 'tarjetas');
      }

      return res.status(200).json(tarjetaData);
    } catch (error) {
      console.error('Error al obtener la tarjeta para ecommerce:', error);
      return res.status(500).json({
        message: 'Error al obtener la tarjeta',
        error: error.message
      });
    }
  },

  // Obtener todos los banners públicos para ecommerce (carrusel)
  getBannersPublic: async (req, res) => {
    try {
      const banners = await Banner.findAll({
        where: { activo: true },
        order: [['orden', 'ASC'], ['creado_en', 'DESC']]
      });
      const bannersConImagen = banners.map(banner => {
        const data = banner.toJSON();
        if (data.imagen_url) {
          data.imagen_url = generarUrlCompleta(data.imagen_url, req, 'banner');
        }
        return data;
      });
      return res.status(200).json(bannersConImagen);
    } catch (error) {
      console.error('Error al obtener banners para ecommerce:', error);
      return res.status(500).json({
        message: 'Error al obtener banners',
        error: error.message
      });
    }
  },

  // GET /api/ecommerce/mis-solicitudes (auth cliente JWT).
  // Agrega solicitudes de importación, ensamble y servicio técnico DEL cliente.
  // Vínculo: email del usuario autenticado (las solicitudes se crean sin auth,
  // id_usuario casi siempre NULL) + id_usuario cuando exista.
  misSolicitudes: async (req, res) => {
    try {
      const payload = verificarTokenCliente(req);
      if (!payload) return res.status(401).json({ success: false, message: 'No autorizado' });
      const userId = payload.id_user || payload.id;
      const usuario = await User.findByPk(userId, { attributes: ['id_user', 'email'] });
      if (!usuario) return res.status(401).json({ success: false, message: 'No autorizado' });
      const email = String(usuario.email || '').trim().toLowerCase();

      const pagina = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limite = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));

      const porEmail = (campo, conIdUsuario) => ({
        [Op.or]: [
          ...(conIdUsuario ? [{ id_usuario: userId }] : []),
          sequelizeWhereEmailLower(campo, email),
        ],
      });
      const [importaciones, ensambles, servicios] = email ? await Promise.all([
        SolicitudImportacion.findAll({ where: porEmail('email_solicitante', true), attributes: ['id_solicitud', 'codigo_seguimiento', 'estado', 'createdAt'] }),
        SolicitudEnsamble.findAll({ where: porEmail('email_solicitante', true), attributes: ['id_solicitud', 'codigo_seguimiento', 'estado', 'createdAt'] }),
        SolicitudServicio.findAll({ where: porEmail('email', false), attributes: ['id_solicitud_servicio', 'codigo', 'estado', 'creado_en'] }),
      ]) : [[], [], []];

      const items = [
        ...importaciones.map(s => ({ tipo: 'importacion', codigo: s.codigo_seguimiento, estado: s.estado, fecha: s.createdAt })),
        ...ensambles.map(s => ({ tipo: 'ensamble', codigo: s.codigo_seguimiento, estado: s.estado, fecha: s.createdAt })),
        ...servicios.map(s => ({ tipo: 'servicio', codigo: s.codigo, estado: s.estado, fecha: s.creado_en })),
      ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

      const total = items.length;
      const data = items.slice((pagina - 1) * limite, pagina * limite);
      return res.json({
        success: true,
        data,
        paginacion: { pagina, limite, total, paginas: Math.max(1, Math.ceil(total / limite)) },
      });
    } catch (error) {
      console.error('Error al obtener mis-solicitudes:', error);
      return res.status(500).json({ success: false, message: 'Error al obtener las solicitudes' });
    }
  }
};

module.exports = ecommerceController;
