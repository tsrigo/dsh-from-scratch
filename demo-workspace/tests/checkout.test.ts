import { describe, expect, it } from "vitest";
import { calculateTotal } from "../src/checkout.js";

describe("calculateTotal", () => {
  it("keeps an ordinary basket unchanged", () => {
    expect(calculateTotal({
      subtotal: 120,
      shipping: 10,
      orderDiscount: 0,
      shippingDiscount: 0,
    })).toBe(130);
  });

  it("applies order and shipping discounts exactly once", () => {
    expect(calculateTotal({
      subtotal: 120,
      shipping: 10,
      orderDiscount: 20,
      shippingDiscount: 10,
    })).toBe(100);
  });
});
