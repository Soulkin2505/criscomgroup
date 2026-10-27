declare global {
  interface Window { CulqiCheckout?: new (publicKey: string, config: unknown) => CulqiCheckoutInstance }
}

interface CulqiCheckoutInstance {
  token?: { id?: string };
  order?: { id?: string } | string;
  error?: { user_message?: string };
  culqi: () => void;
  open: () => void;
  close: () => void;
}

let loadingPromise: Promise<void> | null = null;

export const loadCulqi = () => {
  if (window.CulqiCheckout) return Promise.resolve();
  if (loadingPromise) return loadingPromise;
  loadingPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-culqi-checkout]') as HTMLScriptElement | null;
    if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://js.culqi.com/checkout-js';
    script.async = true;
    script.dataset.culqiCheckout = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar el checkout seguro de Culqi'));
    document.head.appendChild(script);
  });
  return loadingPromise;
};

interface CulqiOrderInfo {
  total_final: number | string;
  cliente_email: string;
}

export interface CulqiPaymentResult {
  // 'token': tarjeta o Yape (cargo único) — hay que enviarlo a /pagar-culqi.
  // 'order': billetera digital (Plin, Yape QR, etc.) — la Orden ya fue creada
  // y confirmada por el backend antes de abrir el checkout; la confirmación
  // real del pago llega después, de forma asíncrona, por el webhook de Culqi.
  kind: 'token' | 'order';
  id: string;
}

// Métodos que exigen una Orden de Culqi ya creada y confirmada por el backend
// (en vez del token que tarjeta/Yape generan en el propio navegador).
export type CulqiOrderMetodo = 'billetera_digital' | 'pago_efectivo' | 'cuotealo';

// culqiOrderId: solo se pasa para métodos basados en Orden — es el id ("ord_...")
// que el backend ya creó y confirmó en Culqi para este pedido.
export const requestCulqiPayment = async (
  order: CulqiOrderInfo,
  publicKey?: string | null,
  culqiOrderId?: string | null,
  metodo?: CulqiOrderMetodo,
): Promise<CulqiPaymentResult> => {
  await loadCulqi();
  if (!window.CulqiCheckout || !publicKey) throw new Error('Culqi aún no está configurado');
  return new Promise<CulqiPaymentResult>((resolve, reject) => {
    let settled = false;
    let containerSeen = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      fn();
    };

    // Culqi Checkout no invoca el callback `culqi()` cuando el usuario cierra
    // el modal con la "X" (solo en éxito o error de la tarjeta). Detectamos ese
    // cierre observando la remoción de su contenedor (#culqi-js) del DOM.
    const observer = new MutationObserver(() => {
      const present = Boolean(document.getElementById('culqi-js'));
      if (present) { containerSeen = true; return; }
      if (containerSeen) settle(() => reject(new Error('Pago cancelado')));
    });

    const settings: Record<string, unknown> = {
      title: 'Criscom Group',
      currency: 'PEN',
      amount: Math.round(Number(order.total_final) * 100),
    };
    // Billetera digital, PagoEfectivo y Cuotéalo exigen una Orden ya creada;
    // sin ella Culqi solo muestra tarjeta/Yape.
    if (culqiOrderId) settings.order = culqiOrderId;
    const paymentMethods: Record<string, boolean> = { tarjeta: true, yape: true };
    if (culqiOrderId) {
      if (metodo === 'billetera_digital') paymentMethods.billetera = true;
      // PagoEfectivo se ve en el checkout como dos opciones ("Banca móvil o
      // Internet" y "Agentes o bodegas"); el cliente elige una de las dos.
      else if (metodo === 'pago_efectivo') { paymentMethods.bancaMovil = true; paymentMethods.agente = true; }
      else if (metodo === 'cuotealo') paymentMethods.cuotealo = true;
    }

    const checkout = new window.CulqiCheckout!(publicKey, {
      settings,
      client: { email: order.cliente_email },
      options: { lang: 'es', installments: true, modal: true, paymentMethods, paymentMethodsSort: Object.keys(paymentMethods) },
      appearance: { theme: 'default', menuType: 'sidebar', logo: `${window.location.origin}/logo.png`, defaultStyle: { bannerColor: '#071827', buttonBackground: '#06b6d4', menuColor: '#0891b2', linksColor: '#22d3ee', buttonTextColor: '#ffffff', priceColor: '#67e8f9' } }
    });

    checkout.culqi = () => {
      const tokenId = checkout.token?.id;
      const orderResult = checkout.order;
      const orderId = typeof orderResult === 'string' ? orderResult : orderResult?.id;
      const checkoutError = checkout.error;
      if (tokenId) settle(() => { checkout.close(); resolve({ kind: 'token', id: tokenId }); });
      else if (orderId) settle(() => { checkout.close(); resolve({ kind: 'order', id: orderId }); });
      else if (checkoutError) settle(() => { checkout.close(); reject(new Error(checkoutError.user_message || 'Culqi rechazó los datos de pago')); });
    };

    observer.observe(document.body, { childList: true, subtree: true });
    checkout.open();
  });
};
