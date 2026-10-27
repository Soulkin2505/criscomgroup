import axios from 'axios';
import { API_URL } from '../config/constants';
import { ECOMMERCE_API_URL } from '../config/constants';
import { ecommerceAuthService } from './ecommerceApi';

export interface CreateOrderRequest {
  items?: Array<{ productId: number; quantity: number }>; // For guest checkout
  cliente_email: string;
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_documento_tipo?: 'DNI' | 'RUC' | 'CE';
  cliente_documento_numero?: string;
  tipo_entrega: 'domicilio' | 'recojo_tienda';
  direccion_envio?: string;
  direccion_departamento?: string;
  direccion_provincia?: string;
  direccion_distrito?: string;
  direccion_referencia?: string;
  metodo_pago: 'yape' | 'billetera_digital' | 'pago_efectivo' | 'cuotealo' | 'plin' | 'transferencia' | 'tarjeta' | 'mercadopago' | 'niubiz' | 'contraentrega';
  notas_cliente?: string;
  requiere_factura?: boolean;
  tipo_comprobante?: 'boleta' | 'factura';
  razon_social?: string;
}

export interface OrderDetail {
  id_detalle: number;
  producto_nombre: string;
  producto_imagen_url?: string;
  cantidad: number;
  precio_unitario_con_igv: number;
  subtotal_con_igv: number;
}

export interface Order {
  id_pedido: number;
  numero_pedido: string;
  estado: string;
  estado_pago: string;
  metodo_pago: string;
  cliente_email: string;
  total_final: number;
  fecha_creacion: string;
  tipo_entrega: string;
  tracking_code?: string;
  tracking_url?: string;
  detalles: OrderDetail[];
}

class OrderService {

  private getHeaders() {
    const token = ecommerceAuthService.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Create order (guest or authenticated)
  async createOrder(data: CreateOrderRequest) {
    const response = await axios.post(`${API_URL}/pedidos`, data, {
      headers: this.getHeaders()
    });
    return response.data;
  }

  async getShippingQuote(data: Pick<CreateOrderRequest, 'tipo_entrega' | 'direccion_envio' | 'direccion_departamento' | 'direccion_provincia' | 'direccion_distrito'>) {
    const response = await axios.post(`${ECOMMERCE_API_URL}/shipping-quote`, data);
    return response.data as { success: boolean; amount: number; zone: string; distance_km: number | null };
  }

  async payWithCulqi(idPedido: number, token: string, paymentToken: string) {
    const response = await axios.post(`${API_URL}/pedidos/${idPedido}/pagar-culqi`, { token }, {
      headers: { ...this.getHeaders(), 'X-Order-Payment-Token': paymentToken }
    });
    return response.data;
  }

  // Reissue a payment token for a pending card order (retry payment)
  async reissuePaymentToken(idPedido: number) {
    const response = await axios.post(`${API_URL}/pedidos/${idPedido}/reintentar-pago`, {}, {
      headers: this.getHeaders()
    });
    return response.data;
  }

  // Track order by number (public)
  async trackOrder(numeroPedido: string) {
    const response = await axios.get(`${API_URL}/pedidos/seguimiento/${numeroPedido}`);
    return response.data;
  }

  // Get my orders (authenticated only)
  async getMyOrders(): Promise<{ success: boolean; pedidos: Order[] }> {
    const response = await axios.get(`${API_URL}/pedidos/mis-pedidos`, {
      headers: this.getHeaders()
    });
    return response.data;
  }

  // Get order by ID (authenticated only)
  async getOrderById(idPedido: number) {
    const response = await axios.get(`${API_URL}/pedidos/${idPedido}`, {
      headers: this.getHeaders()
    });
    return response.data;
  }
}

export const orderService = new OrderService();
