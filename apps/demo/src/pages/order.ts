import { escapeHtml } from '../html.js';
import { renderLayout, type DemoPageConfig } from '../layout.js';
import { formatMoney, SHIPPING_OPTIONS, type Order } from '../shop.js';

/** Server-rendered confirmation so that reloading /orders/:id after a fixed-mode checkout still works. */
export function renderOrderPage(demo: DemoPageConfig, order: Order): string {
  const shipping = SHIPPING_OPTIONS.find((o) => o.id === order.shipping)?.label ?? order.shipping;
  const body = `
    <h1>Thank you, ${escapeHtml(order.fullName.split(' ')[0] ?? 'friend')}</h1>
    <p class="lede">We have emailed a receipt to ${escapeHtml(order.email)}.</p>
    <section data-testid="order-confirmation" role="status" class="confirmation">
      <h2>Order confirmed</h2>
      <p>Order <strong data-testid="order-id">${escapeHtml(order.id)}</strong> for <strong data-testid="order-total">${escapeHtml(order.totalFormatted)}</strong>.</p>
      <p>Shipping: ${escapeHtml(shipping)}. Estimated delivery ${escapeHtml(order.eta)}.</p>
    </section>
    <section class="summary" aria-labelledby="ship-heading">
      <h2 id="ship-heading">Ships to</h2>
      <p>${escapeHtml(order.address)}<br>${escapeHtml(order.city)} ${escapeHtml(order.postalCode)}</p>
      <ul class="totals">
        <li><span>Subtotal</span><span>${escapeHtml(formatMoney(order.subtotal))}</span></li>
        ${order.discount ? `<li><span>Promo ${escapeHtml(order.promoCode)}</span><span>-${escapeHtml(formatMoney(order.discount))}</span></li>` : ''}
        <li><span>Shipping</span><span>${escapeHtml(formatMoney(order.shippingCost))}</span></li>
        <li class="total"><span>Total</span><span>${escapeHtml(order.totalFormatted)}</span></li>
      </ul>
    </section>
    <p><a href="/checkout">Back to the shop</a></p>`;
  return renderLayout({ title: `Order ${order.id}`, page: 'order', body, demo });
}

export function renderNotFoundPage(demo: DemoPageConfig, message: string): string {
  const body = `
    <h1>Not found</h1>
    <p class="lede">${escapeHtml(message)}</p>
    <p><a href="/checkout">Back to checkout</a></p>`;
  return renderLayout({ title: 'Not found', page: 'error', body, demo });
}
