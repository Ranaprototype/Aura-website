// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../client/src/App";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it.each([
  ["/checkout", "Checkout is unavailable."],
  ["/order-confirmation?order=untrusted", "Order verification unavailable."],
  ["/order/untrusted", "Order verification unavailable."],
  ["/account", "Accounts are unavailable."],
  ["/account/orders/untrusted", "Accounts are unavailable."],
  ["/account/addresses", "Accounts are unavailable."],
])(
  "contains the direct route %s without trusting browser data",
  (path, title) => {
    history.replaceState({}, "", path);
    const storage = ["getItem", "setItem", "removeItem", "clear", "key"].map(
      method => vi.spyOn(Storage.prototype, method as "getItem")
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root.render(<App />));
    expect(document.querySelector("h1")?.textContent).toBe(title);
    expect(document.querySelector("input,form,iframe,textarea")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /untrusted|order confirmed|total paid|signed in/i
    );
    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  }
);
