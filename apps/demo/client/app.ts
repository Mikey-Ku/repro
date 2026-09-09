// Northwind Supply browser bundle. Built by scripts/build-client.mjs into public/app.js (not minified).
import canaries from '../canaries.json';

// ---- Repro SDK surface (mirrors packages/browser-sdk, loaded as an IIFE from /vendor/repro.iife.js) ----
interface ReproOptions {
  projectKey: string;
  endpoint: string;
  release?: string;
  environment?: string;
}
interface ReproClient {
  start(): void;
  stop(): void;
  captureException(error: unknown, context?: Record<string, string | number | boolean>): void;
  identify(userId: string, traits?: Record<string, string | number | boolean>): void;
  annotate(name: string, data?: Record<string, string | number | boolean>): void;
  flush(): Promise<void>;
  getSessionId(): string | null;
  isRecording(): boolean;
}
interface DemoConfig {
  projectKey: string;
  endpoint: string;
  mode: 'broken' | 'fixed';
  release: string;
}
declare global {
  interface Window {
    Repro: { init(options: ReproOptions): ReproClient };
    __DEMO__: DemoConfig;
  }
}

// ---- API shapes ----
interface CartItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}
interface ShippingOption {
  id: 'standard' | 'express';
  label: string;
  price: number;
}
interface Cart {
  currency: string;
  items: CartItem[];
  subtotal: number;
  shippingOptions: ShippingOption[];
}
interface LoginResponse {
  ok: boolean;
  token?: string;
  user?: { id: string; name: string };
  error?: string;
}
/** What POST /api/orders returns since release 1.4: the order details are nested under `order`. */
interface OrderResponse {
  ok: boolean;
  order: { id: string; total: number; totalFormatted: string; currency: string; eta: string };
  meta: { apiKey: string };
  error?: string;
}
/** The shape the checkout was originally written against (release 1.3). It no longer exists. */
interface LegacyOrderResponse {
  ok: boolean;
  orderId: string;
  total: string;
}

const demo = window.__DEMO__;
const repro = window.Repro.init({
  projectKey: demo.projectKey,
  endpoint: demo.endpoint,
  release: demo.release,
  environment: 'demo',
});

const TOKEN_KEY = 'demo_token';
const USER_KEY = 'demo_user';

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function showAlert(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.dataset.visible = 'true';
}

function hideAlert(element: HTMLElement): void {
  element.textContent = '';
  element.dataset.visible = 'false';
}

// ---- Login page ----
function initLogin(): void {
  const form = byId<HTMLFormElement>('login-form');
  const error = document.querySelector<HTMLElement>('[data-testid="login-error"]')!;
  const button = document.querySelector<HTMLButtonElement>('[data-testid="sign-in"]')!;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void signIn();
  });

  async function signIn(): Promise<void> {
    hideAlert(error);
    button.disabled = true;
    const email = byId<HTMLInputElement>('email').value.trim();
    const password = byId<HTMLInputElement>('password').value;
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as LoginResponse;
      if (!response.ok || !data.ok || !data.token || !data.user) {
        showAlert(error, data.error ?? 'Could not sign you in. Please try again.');
        button.disabled = false;
        return;
      }
      localStorage.setItem(TOKEN_KEY, data.token);
      sessionStorage.setItem(USER_KEY, JSON.stringify({ id: data.user.id, name: data.user.name, email }));
      repro.annotate('login:success');
      // Magic-link style redirect. The SDK must strip the token from the recorded URL.
      location.assign(`/checkout?ref=email&token=${encodeURIComponent(canaries.queryToken)}`);
    } catch (cause) {
      showAlert(error, 'Network error while signing in.');
      button.disabled = false;
      repro.captureException(cause, { where: 'login' });
    }
  }
}

// ---- Checkout page ----
function initCheckout(): void {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    location.replace('/login');
    return;
  }
  const authHeaders = { authorization: `Bearer ${token}` };

  const form = byId<HTMLFormElement>('checkout-form');
  const button = document.querySelector<HTMLButtonElement>('[data-testid="place-order"]')!;
  const error = document.querySelector<HTMLElement>('[data-testid="checkout-error"]')!;
  const shippingSelect = byId<HTMLSelectElement>('shipping');
  const itemsList = byId<HTMLUListElement>('summary-items');
  const subtotalEl = byId<HTMLElement>('summary-subtotal');
  const shippingEl = byId<HTMLElement>('summary-shipping');
  const totalEl = byId<HTMLElement>('summary-total');
  let cart: Cart | null = null;

  prefillContact();
  void loadCart();
  shippingSelect.addEventListener('change', updateTotals);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void placeOrder();
  });

  function prefillContact(): void {
    try {
      const raw = sessionStorage.getItem(USER_KEY);
      if (!raw) return;
      const user = JSON.parse(raw) as { id: string; name: string; email: string };
      byId<HTMLInputElement>('full-name').value = user.name;
      byId<HTMLInputElement>('email').value = user.email;
      repro.identify(user.id, { plan: 'retail' });
    } catch {
      // A malformed session entry is not worth breaking checkout over.
    }
  }

  async function loadCart(): Promise<void> {
    try {
      const response = await fetch('/api/cart', { headers: authHeaders });
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        location.replace('/login');
        return;
      }
      cart = (await response.json()) as Cart;
      itemsList.innerHTML = '';
      for (const item of cart.items) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = item.name;
        const qty = document.createElement('span');
        qty.className = 'qty';
        qty.textContent = `x ${item.quantity}`;
        name.appendChild(qty);
        const price = document.createElement('span');
        price.textContent = formatMoney(item.quantity * item.unitPrice);
        li.append(name, price);
        itemsList.appendChild(li);
      }
      updateTotals();
      repro.annotate('checkout:viewed', { items: cart.items.length });
    } catch (cause) {
      showAlert(error, 'We could not load your cart. Please refresh the page.');
      repro.captureException(cause, { where: 'loadCart' });
    }
  }

  function selectedShippingPrice(): number {
    const option = shippingSelect.selectedOptions[0];
    return option ? Number(option.dataset.price ?? 0) : 0;
  }

  function updateTotals(): void {
    if (!cart) return;
    const shipping = selectedShippingPrice();
    subtotalEl.textContent = formatMoney(cart.subtotal);
    shippingEl.textContent = shipping === 0 ? 'Free' : formatMoney(shipping);
    totalEl.textContent = formatMoney(cart.subtotal + shipping);
  }

  function readForm(): Record<string, string | boolean> {
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? '');
    return {
      fullName: value('fullName'),
      email: value('email'),
      address: value('address'),
      city: value('city'),
      postalCode: value('postalCode'),
      shipping: value('shipping'),
      cardNumber: value('cardNumber'),
      expiry: value('expiry'),
      cvc: value('cvc'),
      promoCode: value('promoCode'),
      saveCard: data.get('saveCard') === 'on',
      apiKey: value('apiKey'),
    };
  }

  async function placeOrder(): Promise<void> {
    hideAlert(error);
    button.disabled = true;
    button.textContent = 'Placing order…';

    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify(readForm()),
    });
    const payload = (await response.json()) as OrderResponse;
    if (!response.ok || !payload.ok) {
      showAlert(error, payload.error ?? 'We could not place your order.');
      button.disabled = false;
      button.textContent = 'Place order';
      return;
    }
    repro.annotate('order:placed');
    showConfirmation(payload);
  }

  /**
   * Renders the confirmation. Both code paths live here on purpose so the difference is one line.
   * Release 1.4 moved the order id from a flat `orderId` to `order.id`; the checkout was never updated.
   */
  function showConfirmation(payload: OrderResponse): void {
    try {
      if (demo.mode === 'broken') {
        // BUG (broken mode): the API now returns { order: { id } } but this still reads the old flat
        // `orderId`, which is undefined, so `.toUpperCase()` throws and the button stays stuck.
        const data = payload as unknown as LegacyOrderResponse;
        const orderId = data.orderId.toUpperCase();
        renderConfirmation(orderId, data.total);
      } else {
        // FIX: read the nested order object the API actually returns.
        const orderId = payload.order.id;
        renderConfirmation(orderId, payload.order.totalFormatted);
        history.pushState({ orderId }, '', `/orders/${orderId}`);
      }
    } catch (cause) {
      console.error('Order confirmation failed', cause);
      throw cause;
    }
  }

  function renderConfirmation(orderId: string, total: string): void {
    const slot = byId<HTMLElement>('confirmation-slot');
    const section = document.createElement('section');
    section.className = 'confirmation';
    section.dataset.testid = 'order-confirmation';
    section.setAttribute('role', 'status');

    const heading = document.createElement('h2');
    heading.textContent = 'Order confirmed';
    const detail = document.createElement('p');
    detail.append('Order ');
    const idEl = document.createElement('strong');
    idEl.dataset.testid = 'order-id';
    idEl.textContent = orderId;
    detail.append(idEl, ' for ');
    const totalStrong = document.createElement('strong');
    totalStrong.dataset.testid = 'order-total';
    totalStrong.textContent = total;
    detail.append(totalStrong, '. A receipt is on its way to your inbox.');

    section.append(heading, detail);
    slot.replaceChildren(section);
    form.hidden = true;
    section.focus();
  }
}

const page = document.body.dataset.page;
if (page === 'login') initLogin();
else if (page === 'checkout') initCheckout();
