// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccountPage from "../client/src/pages/AccountPage";
import {
  getWishlist,
  products,
  toggleWishlist,
} from "../client/src/lib/catalog";
const key = "holo-wishlist";
afterEach(() => localStorage.removeItem(key));
it.each(["{", "null", "{}", '"string"', "[null,12,{}]", '["stale-fixture"]'])(
  "shows empty state safely for %s without rewriting on read",
  raw => {
    localStorage.setItem(key, raw);
    expect(getWishlist()).toEqual([]);
    expect(
      renderToStaticMarkup(<AccountPage path="/account/wishlist" />)
    ).toContain("Nothing saved yet.");
    expect(localStorage.getItem(key)).toBe(raw);
  }
);
it("retains only existing unique products and safely toggles a valid selection", () => {
  const { slug, name } = products[0];
  localStorage.setItem(key, JSON.stringify([slug, 4, slug, "stale-fixture"]));
  expect(getWishlist()).toEqual([slug]);
  expect(
    renderToStaticMarkup(<AccountPage path="/account/wishlist" />)
  ).toContain(name);
  expect(toggleWishlist(slug)).toEqual([]);
  expect(toggleWishlist(slug)).toEqual([slug]);
});
it("does not report a saved item when storage refuses the write", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("unavailable");
  });
  expect(toggleWishlist(products[0].slug)).toEqual([]);
});
