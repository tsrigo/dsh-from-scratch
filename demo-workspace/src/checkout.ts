export interface CheckoutInput {
  subtotal: number;
  shipping: number;
  orderDiscount: number;
  shippingDiscount: number;
}

/**
 * Calculate the amount charged after independent merchandise and shipping discounts.
 */
export function calculateTotal(input: CheckoutInput): number {
  const merchandise = Math.max(0, input.subtotal - input.orderDiscount);
  const shipping = Math.max(0, input.shipping - input.shippingDiscount);

  return merchandise + shipping - input.orderDiscount;
}
