import { expect, it } from "vitest";
import { cartPreview, type CartItem } from "../client/src/lib/cart";
const item: CartItem = {
  id: "fixture",
  slug: "fixture",
  name: "fixture",
  category: "fixture",
  price: 0,
  quantity: 1,
  tone: "fixture",
};
it.each([
  [149.99, 1800],
  [150, 0],
  [150.01, 0],
])("uses the existing standard estimate at subtotal %s", (price, shipping) => {
  expect(
    cartPreview({ version: 1, items: [{ ...item, price }] }).shipping
  ).toBe(shipping);
});
it("uses the discounted subtotal for shipping and includes wrap in tax", () => {
  expect(
    cartPreview({
      version: 1,
      items: [{ ...item, price: 75, quantity: 2, giftWrap: true }],
      promo: "HOLO10",
    })
  ).toEqual({
    subtotal: 15000,
    discount: 1500,
    wrap: 1000,
    shipping: 1800,
    tax: 1160,
    total: 17460,
  });
});
it("keeps an empty preview at zero", () =>
  expect(cartPreview({ items: [], version: 1 }).total).toBe(0));
