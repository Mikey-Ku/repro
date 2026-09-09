import { randomBytes } from 'node:crypto';

/** All money is handled in integer cents; formatting happens at the edge. */
export interface CartItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface ShippingOption {
  id: 'standard' | 'express';
  label: string;
  price: number;
}

export interface Cart {
  currency: 'USD';
  items: CartItem[];
  subtotal: number;
  shippingOptions: ShippingOption[];
}

export interface Order {
  id: string;
  fullName: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  shipping: ShippingOption['id'];
  promoCode: string;
  subtotal: number;
  shippingCost: number;
  discount: number;
  total: number;
  totalFormatted: string;
  currency: 'USD';
  eta: string;
  createdAt: string;
}

export const CART_ITEMS: CartItem[] = [
  { sku: 'NB-DOT-A5', name: 'Field notebook, dotted', quantity: 3, unitPrice: 1200 },
  { sku: 'PN-BRASS-07', name: 'Brass mechanical pencil', quantity: 1, unitPrice: 3800 },
];

export const SHIPPING_OPTIONS: ShippingOption[] = [
  { id: 'standard', label: 'Standard (free)', price: 0 },
  { id: 'express', label: 'Express ($9.00)', price: 900 },
];

/** Promo codes are deliberately simple; WELCOME10 takes 10% off the subtotal. */
const PROMO_CODES: Record<string, number> = { WELCOME10: 10 };

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function getCart(): Cart {
  const subtotal = CART_ITEMS.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return { currency: 'USD', items: CART_ITEMS, subtotal, shippingOptions: SHIPPING_OPTIONS };
}

export interface OrderInput {
  fullName: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  shipping: ShippingOption['id'];
  promoCode: string;
}

function randomOrderId(): string {
  // 6 lowercase alphanumerics, e.g. ord_k3x9pa
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(6);
  let id = '';
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return `ord_${id}`;
}

export function createOrder(input: OrderInput): Order {
  const cart = getCart();
  const option = SHIPPING_OPTIONS.find((o) => o.id === input.shipping) ?? SHIPPING_OPTIONS[0]!;
  const promo = input.promoCode.trim().toUpperCase();
  const percentOff = PROMO_CODES[promo] ?? 0;
  const discount = Math.round((cart.subtotal * percentOff) / 100);
  const total = cart.subtotal - discount + option.price;
  return {
    id: randomOrderId(),
    fullName: input.fullName,
    email: input.email,
    address: input.address,
    city: input.city,
    postalCode: input.postalCode,
    shipping: option.id,
    promoCode: percentOff ? promo : '',
    subtotal: cart.subtotal,
    shippingCost: option.price,
    discount,
    total,
    totalFormatted: formatMoney(total),
    currency: 'USD',
    eta: 'Thu 12 Sep',
    createdAt: new Date().toISOString(),
  };
}

/** In-memory order store. The demo is single-process and state resets on restart, which is what we want. */
export class OrderStore {
  private readonly orders = new Map<string, Order>();

  add(order: Order): void {
    this.orders.set(order.id, order);
  }

  get(id: string): Order | undefined {
    return this.orders.get(id);
  }
}
