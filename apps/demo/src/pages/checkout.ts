import { canaries } from '../canaries.js';
import { escapeHtml } from '../html.js';
import { renderLayout, type DemoPageConfig } from '../layout.js';
import { SHIPPING_OPTIONS } from '../shop.js';

export function renderCheckoutPage(demo: DemoPageConfig): string {
  const shippingOptions = SHIPPING_OPTIONS.map(
    (option) => `<option value="${escapeHtml(option.id)}" data-price="${option.price}">${escapeHtml(option.label)}</option>`,
  ).join('');

  const body = `
    <h1>Checkout</h1>
    <p class="lede">Review your order and enter your shipping and payment details.</p>

    <section class="summary" data-testid="order-summary" aria-labelledby="summary-heading">
      <div class="summary-head">
        <h2 id="summary-heading">Order summary</h2>
        <span class="account" data-repro-mask data-testid="account-label">Account ${escapeHtml(canaries.maskedText)}</span>
      </div>
      <ul id="summary-items"><li class="skeleton">Loading your cart…</li></ul>
      <ul class="totals">
        <li><span>Subtotal</span><span id="summary-subtotal" data-testid="subtotal">…</span></li>
        <li><span>Shipping</span><span id="summary-shipping" data-testid="shipping-cost">…</span></li>
        <li class="total"><span>Total</span><span id="summary-total" data-testid="total">…</span></li>
      </ul>
    </section>

    <div id="confirmation-slot"></div>
    <p class="alert" role="alert" data-testid="checkout-error" data-visible="false"></p>

    <form data-testid="checkout-form" id="checkout-form" method="post" action="/api/orders" novalidate>
      <fieldset>
        <legend>Contact</legend>
        <div class="field">
          <label for="full-name">Full name</label>
          <input type="text" name="fullName" id="full-name" autocomplete="name" required>
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input type="email" name="email" id="email" autocomplete="email" required>
        </div>
      </fieldset>

      <fieldset>
        <legend>Shipping address</legend>
        <div class="field">
          <label for="address">Address</label>
          <input type="text" name="address" id="address" autocomplete="street-address" required>
        </div>
        <div class="row">
          <div class="field">
            <label for="city">City</label>
            <input type="text" name="city" id="city" autocomplete="address-level2" required>
          </div>
          <div class="field">
            <label for="postal-code">Postal code</label>
            <input type="text" name="postalCode" id="postal-code" autocomplete="postal-code" required>
          </div>
        </div>
        <div class="field">
          <label for="shipping">Shipping method</label>
          <select name="shipping" id="shipping">${shippingOptions}</select>
        </div>
      </fieldset>

      <fieldset>
        <legend>Payment</legend>
        <div class="field">
          <label for="card-number">Card number</label>
          <input type="text" name="cardNumber" id="card-number" autocomplete="cc-number" inputmode="numeric" required>
        </div>
        <div class="row-3">
          <div class="field">
            <label for="expiry">Expiry</label>
            <input type="text" name="expiry" id="expiry" autocomplete="cc-exp" placeholder="MM/YY" required>
          </div>
          <div class="field">
            <label for="cvc">CVC</label>
            <input type="text" name="cvc" id="cvc" autocomplete="cc-csc" inputmode="numeric" required>
          </div>
          <div class="field">
            <label for="promo-code">Promo code</label>
            <input type="text" name="promoCode" id="promo-code" autocomplete="off">
          </div>
        </div>
        <div class="field check">
          <input type="checkbox" name="saveCard" id="save-card">
          <label for="save-card">Save card for next time</label>
        </div>
      </fieldset>

      <input type="hidden" name="apiKey" id="api-key" value="${escapeHtml(canaries.apiKey)}">
      <button class="btn" type="submit" data-testid="place-order">Place order</button>
    </form>`;

  const after = `
<aside class="support" data-repro-block data-testid="support-chat" aria-label="Support chat">
  <div class="support-head">Support chat</div>
  <div class="support-body">
    Questions about your order? Reference ${escapeHtml(canaries.blockedText)}.
    <div class="bubble">Hi Ada, this is Sam from Northwind. How can I help today?</div>
  </div>
</aside>`;

  return renderLayout({ title: 'Checkout', page: 'checkout', body, demo, after });
}
