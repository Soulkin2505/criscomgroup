interface CulqiCheckoutInstance {
  token?: { id?: string };
  error?: { user_message?: string };
  culqi: () => void;
  open: () => void;
  close: () => void;
}

declare global { interface Window { CulqiCheckout?: new (publicKey: string, config: unknown) => CulqiCheckoutInstance } }

let loading: Promise<void> | null = null
const load = () => {
  if (window.CulqiCheckout) return Promise.resolve()
  if (loading) return loading
  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-culqi-checkout]') as HTMLScriptElement | null;
    if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://js.culqi.com/checkout-js';
    script.async = true;
    script.dataset.culqiCheckout = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Culqi'));
    document.head.appendChild(script);
  })
  return loading
}

export const requestCardToken = async (amount: number, email: string, publicKey?: string | null) => {
  await load(); if (!window.CulqiCheckout || !publicKey) throw new Error('Culqi no está configurado')
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let containerSeen = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      fn();
    };

    // Culqi Checkout no invoca el callback `culqi()` cuando el usuario cierra
    // el modal con la "X" (solo en éxito o error de la tarjeta). Sin esto la
    // promesa nunca se resuelve y el botón de pago queda colgado en "Procesando…".
    const observer = new MutationObserver(() => {
      const present = Boolean(document.getElementById('culqi-js'));
      if (present) { containerSeen = true; return; }
      if (containerSeen) settle(() => reject(new Error('Pago cancelado')));
    });

    const checkout = new window.CulqiCheckout!(publicKey, { settings: { title: 'CRISCOM GROUP', currency: 'PEN', amount: Math.round(amount * 100) }, client: { email }, options: { lang: 'es', modal: true, paymentMethods: { tarjeta: true } } });

    checkout.culqi = () => {
      const tokenId = checkout.token?.id;
      const checkoutError = checkout.error;
      if (tokenId) settle(() => { checkout.close(); resolve(tokenId); });
      else if (checkoutError) settle(() => { checkout.close(); reject(new Error(checkoutError.user_message || 'Pago rechazado')); });
    };

    observer.observe(document.body, { childList: true, subtree: true });
    checkout.open();
  })
}
