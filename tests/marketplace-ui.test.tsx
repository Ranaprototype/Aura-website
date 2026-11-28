// @vitest-environment jsdom
/**
 * Phase 3 interface verification without a browser engine.
 *
 * The pages are rendered in jsdom against a mocked same-origin API. The tests
 * assert what the interface shows and which request it sends — never that the
 * interface is an authorization decision, because it never is.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SellerDashboardPage from "../client/src/pages/SellerDashboardPage";
import SellerProductsPage from "../client/src/pages/SellerProductsPage";
import SellerProductPage from "../client/src/pages/SellerProductPage";
import AdminReviewPage from "../client/src/pages/AdminReviewPage";
import App from "../client/src/App";
import type { ProductDetailView, SellerProfileView } from "@shared/marketplace";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ORG = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seller = (
  overrides: Partial<SellerProfileView> = {}
): SellerProfileView => ({
  id: "33333333-3333-4333-8333-333333333333",
  orgId: ORG,
  displayName: "Aura Atelier",
  legalName: "Aura Atelier Private Limited",
  businessEmail: "studio@example.test",
  country: "IN",
  website: "https://example.test",
  description: "Independent studio.",
  status: "draft",
  submittedAt: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  suspendedAt: null,
  ...overrides,
});

const session = (platformAdmin = false, role = "owner") => ({
  authenticated: true,
  platformAdmin,
  principal: {
    id: "44444444-4444-4444-8444-444444444444",
    email: "owner@example.test",
    displayName: "Owner",
    emailVerified: true,
  },
  organizations: [{ id: ORG, name: "Aura Studio", slug: "aura-studio", role }],
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Route {
  method: string;
  path: string;
  body: unknown;
  status?: number;
}

type Handler = (request: { method: string; body: unknown }) => Response;

/**
 * Minimal same-origin API used by the pages. Routes are matched by path prefix
 * so the test reads like the requests the interface really makes.
 */
function stubApi(handlers: Array<[string, Handler]>) {
  const requests: Array<{
    method: string;
    path: string;
    body: unknown;
    headers: Headers;
  }> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({
        method,
        path,
        body,
        headers: new Headers(init?.headers),
      });
      const match = handlers.find(([prefix]) => path.startsWith(prefix));
      if (!match) return json({ error: "not_found" }, 404);
      return match[1]({ method, body });
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return requests;
}

async function flush(times = 3) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
}

async function mount(element: React.ReactElement) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  await flush();
}

const setValue = (
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
) => {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const setSelect = (element: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value"
  )!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const click = async (label: string, { exact = false } = {}) => {
  const candidates = Array.from(document.querySelectorAll("button,a"));
  const target = candidates.find(element =>
    exact
      ? element.textContent?.trim() === label
      : element.textContent?.includes(label)
  );
  if (!target) throw new Error(`no control labelled ${label}`);
  await act(async () => {
    (target as HTMLElement).click();
  });
  await flush();
};

beforeEach(() => {
  history.replaceState({}, "", "/seller");
});

it("renders seller onboarding from the API and submits the form with the selected organization", async () => {
  let state: SellerProfileView | null = null;
  const requests = stubApi([
    ["/api/v1/auth/session", () => json(session())],
    [
      "/api/v1/seller/dashboard",
      () =>
        json({
          organization: { id: ORG, name: "Aura Studio" },
          role: "owner",
          seller: state,
          productCounts: {
            draft: 0,
            submitted: 0,
            approved: 0,
            rejected: 0,
            archived: 0,
          },
          recentSellerActivity: [],
          permissions: { canManage: true, canWriteCatalogue: true },
        }),
    ],
    // The submit route is matched before the profile prefix on purpose.
    [
      "/api/v1/seller/profile/submit",
      () => {
        state = seller({
          status: "submitted",
          submittedAt: "2026-11-02T10:00:00.000Z",
        });
        return json({ seller: state });
      },
    ],
    [
      "/api/v1/seller/profile",
      ({ method, body }) => {
        if (method === "PUT") {
          state = seller(body as Partial<SellerProfileView>);
          return json({ seller: state, audit: [] }, 201);
        }
        return json({ seller: state, audit: [] });
      },
    ],
  ]);

  await mount(<SellerDashboardPage />);

  expect(document.body.textContent).toContain("Seller studio");
  expect(
    document.querySelector('[data-testid="seller-status"]')?.textContent
  ).toContain("Not started");
  expect(
    document.querySelector('[data-testid="product-count-approved"]')
      ?.textContent
  ).toBe("0");

  setValue(
    document.querySelector("#displayName") as HTMLInputElement,
    "Aura Atelier"
  );
  setValue(
    document.querySelector("#legalName") as HTMLInputElement,
    "Aura Atelier Private Limited"
  );
  setValue(
    document.querySelector("#businessEmail") as HTMLInputElement,
    "studio@example.test"
  );
  await click("Create seller profile");

  const save = requests.find(request => request.method === "PUT");
  expect(save?.path).toBe("/api/v1/seller/profile");
  expect(save?.headers.get("x-aura-org")).toBe(ORG);
  expect(save?.body).toMatchObject({
    displayName: "Aura Atelier",
    legalName: "Aura Atelier Private Limited",
    businessEmail: "studio@example.test",
    country: "IN",
    website: null,
  });
  expect(document.body.textContent).toContain(
    "Saved. Submit the profile for platform review when it is complete."
  );

  await click("Submit for review");
  expect(
    requests.some(request => request.path.endsWith("/seller/profile/submit"))
  ).toBe(true);
  expect(
    document.querySelector('[data-testid="seller-status"]')?.textContent
  ).toContain("submitted");
});

it("shows a submitted product as locked and read-only", async () => {
  const detail: ProductDetailView = {
    id: PRODUCT,
    slug: "phase-three-runner",
    title: "Phase Three Runner",
    status: "submitted",
    pendingChanges: false,
    approvedRevisionId: null,
    categoryId: "55555555-5555-4555-8555-555555555555",
    categoryName: "Sneakers",
    categorySlug: "sneakers",
    variantCount: 1,
    mediaCount: 0,
    purchasable: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    summary: "A fixture.",
    description: "Awaiting review.",
    submittedAt: "2026-11-02T10:00:00.000Z",
    approvedAt: null,
    archivedAt: null,
    seller: {
      id: "33333333-3333-4333-8333-333333333333",
      displayName: "Aura Atelier",
      status: "approved",
    },
    variants: [
      {
        id: "v1",
        sku: "P3-RUNNER-42",
        title: "Size 42",
        size: "42",
        colour: "cyan",
        material: null,
        position: 1,
      },
    ],
    media: [],
    attributes: [
      {
        attributeId: "a1",
        key: "upper-material",
        label: "Upper material",
        value: "knit",
      },
    ],
    revisions: [
      {
        id: "r1",
        revisionNumber: 1,
        decision: "pending",
        submittedAt: "2026-11-02T10:00:00.000Z",
        reviewedAt: null,
        reviewedByName: null,
        reviewNote: null,
      },
    ],
    audit: [
      {
        id: "e1",
        action: "product.submitted",
        entityType: "product",
        entityId: PRODUCT,
        fromState: "draft",
        toState: "submitted",
        detail: {},
        actorName: "Owner",
        createdAt: "2026-11-02T10:00:00.000Z",
      },
    ],
    permissions: { canEdit: false, canSubmit: false, canArchive: false },
  };

  stubApi([
    ["/api/v1/auth/session", () => json(session())],
    ["/api/v1/categories", () => json({ categories: [] })],
    ["/api/v1/seller/products/", () => json({ product: detail })],
  ]);

  await mount(<SellerProductPage productId={PRODUCT} />);

  expect(
    document.querySelector('[data-testid="product-status"]')?.textContent
  ).toContain("submitted");
  expect(
    document.querySelector('[data-testid="purchasable"]')?.textContent
  ).toBe("no");
  expect(document.querySelector("#edit-title")).toHaveProperty(
    "disabled",
    true
  );
  expect(document.querySelector('[data-testid="submit-product"]')).toBeNull();
  expect(document.querySelector('[data-testid="archive-product"]')).toBeNull();
  expect(
    document.querySelector('[data-testid="variant-list"]')?.textContent
  ).toContain("P3-RUNNER-42");
  expect(
    document.querySelector('[data-testid="audit-list"]')?.textContent
  ).toContain("product.submitted");
  expect(document.body.textContent).toContain(
    "Editing is disabled while this product is submitted"
  );
});

it("submits an editable product for review", async () => {
  const detail: ProductDetailView = {
    id: PRODUCT,
    slug: "phase-three-runner",
    title: "Phase Three Runner",
    status: "draft",
    pendingChanges: false,
    approvedRevisionId: null,
    categoryId: "55555555-5555-4555-8555-555555555555",
    categoryName: "Sneakers",
    categorySlug: "sneakers",
    variantCount: 1,
    mediaCount: 0,
    purchasable: false,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    summary: null,
    description: null,
    submittedAt: null,
    approvedAt: null,
    archivedAt: null,
    seller: {
      id: "33333333-3333-4333-8333-333333333333",
      displayName: "Aura Atelier",
      status: "approved",
    },
    variants: [],
    media: [],
    attributes: [],
    revisions: [],
    audit: [],
    permissions: { canEdit: true, canSubmit: true, canArchive: true },
  };
  const requests = stubApi([
    ["/api/v1/auth/session", () => json(session())],
    ["/api/v1/categories", () => json({ categories: [] })],
    [
      "/api/v1/seller/products/",
      ({ method }) =>
        method === "POST"
          ? json(
              { product: detail, revision: { id: "r1", revision_number: 1 } },
              201
            )
          : json({ product: detail }),
    ],
  ]);

  await mount(<SellerProductPage productId={PRODUCT} />);
  expect(document.querySelector("#edit-title")).toHaveProperty(
    "disabled",
    false
  );
  expect(
    document.querySelector('[data-testid="archive-product"]')
  ).not.toBeNull();

  await click("Submit for review");
  const submitRequest = requests.find(request =>
    request.path.endsWith("/submit")
  );
  expect(submitRequest?.method).toBe("POST");
  expect(submitRequest?.headers.get("x-aura-org")).toBe(ORG);
});

it("renders the seller product list and creates a draft through the API", async () => {
  const requests = stubApi([
    ["/api/v1/auth/session", () => json(session())],
    [
      "/api/v1/seller/profile",
      () => json({ seller: seller({ status: "approved" }), audit: [] }),
    ],
    [
      "/api/v1/categories",
      () =>
        json({
          categories: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              slug: "sneakers",
              name: "Sneakers",
              description: null,
              attributes: [],
            },
          ],
        }),
    ],
    [
      "/api/v1/seller/products",
      ({ method, body }) =>
        method === "POST"
          ? json({ product: { id: PRODUCT, title: "New Runner" } }, 201)
          : json({
              products: [
                {
                  id: PRODUCT,
                  slug: "phase-three-runner",
                  title: "Phase Three Runner",
                  status: "approved",
                  pendingChanges: false,
                  approvedRevisionId: "r1",
                  categoryId: "55555555-5555-4555-8555-555555555555",
                  categoryName: "Sneakers",
                  categorySlug: "sneakers",
                  variantCount: 2,
                  mediaCount: 1,
                  purchasable: true,
                  createdAt: "2026-11-01T10:00:00.000Z",
                  updatedAt: "2026-11-01T10:00:00.000Z",
                },
              ],
            }),
    ],
  ]);

  await mount(<SellerProductsPage />);
  expect(
    document.querySelector('[data-testid="product-list"]')?.textContent
  ).toContain("Phase Three Runner");
  expect(document.body.textContent).toContain("approved & current");

  setValue(
    document.querySelector("#product-title") as HTMLInputElement,
    "New Runner"
  );
  await click("Create draft", { exact: true });

  const create = requests.find(
    request =>
      request.method === "POST" && request.path === "/api/v1/seller/products"
  );
  expect(create?.body).toMatchObject({ title: "New Runner" });
  expect(create?.headers.get("x-aura-org")).toBe(ORG);
  expect(window.location.pathname).toBe(`/seller/products/${PRODUCT}`);
});

it("shows the catalogue to a viewer without offering writes", async () => {
  stubApi([
    ["/api/v1/auth/session", () => json(session(false, "viewer"))],
    [
      "/api/v1/seller/profile",
      () => json({ seller: seller({ status: "approved" }), audit: [] }),
    ],
    ["/api/v1/categories", () => json({ categories: [] })],
    ["/api/v1/seller/products", () => json({ products: [] })],
  ]);

  await mount(<SellerProductsPage />);
  expect(document.body.textContent).toContain(
    "can view the catalogue but not create products"
  );
  expect(document.querySelector('[data-testid="create-product"]')).toBeNull();
});

it("keeps review queues closed without the platform grant and open with it", async () => {
  stubApi([["/api/v1/auth/session", () => json(session(false))]]);
  await mount(<AdminReviewPage />);
  expect(document.body.textContent).toContain(
    "Platform administrator access is required"
  );

  if (root) act(() => root!.unmount());
  document.body.replaceChildren();
  root = undefined;

  const requests = stubApi([
    ["/api/v1/auth/session", () => json(session(true))],
    [
      "/api/v1/admin/sellers",
      () =>
        json({
          sellers: [
            {
              ...seller({ status: "submitted" }),
              orgName: "Aura Studio",
            },
          ],
        }),
    ],
    [
      "/api/v1/admin/products",
      () =>
        json({
          products: [
            {
              id: PRODUCT,
              slug: "phase-three-runner",
              title: "Phase Three Runner",
              status: "submitted",
              pendingChanges: false,
              approvedRevisionId: null,
              categoryId: "55555555-5555-4555-8555-555555555555",
              categoryName: "Sneakers",
              categorySlug: "sneakers",
              variantCount: 1,
              mediaCount: 0,
              purchasable: false,
              createdAt: "2026-11-01T10:00:00.000Z",
              updatedAt: "2026-11-01T10:00:00.000Z",
              orgName: "Aura Studio",
            },
          ],
        }),
    ],
    [
      "/api/v1/admin/sellers/",
      () => json({ seller: seller({ status: "approved" }) }),
    ],
  ]);

  await mount(<AdminReviewPage />);
  expect(
    document.querySelector('[data-testid="seller-queue-count"]')?.textContent
  ).toBe("1");
  expect(
    document.querySelector('[data-testid="product-queue-count"]')?.textContent
  ).toBe("1");
  expect(
    document.querySelector('[data-testid="seller-queue"]')?.textContent
  ).toContain("Aura Studio");

  const rejectButton = Array.from(document.querySelectorAll("button")).find(
    button => button.textContent?.includes("Reject")
  ) as HTMLButtonElement;
  expect(rejectButton.disabled).toBe(true);

  await click("Approve seller");
  expect(requests.some(request => request.path.endsWith("/approve"))).toBe(
    true
  );
});

it.each([
  "/seller",
  "/seller/products",
  `/seller/products/${PRODUCT}`,
  "/admin/review",
])("mounts the Phase 3 route %s and asks for sign-in", async path => {
  stubApi([["/api/v1/auth/session", () => json({ authenticated: false })]]);
  history.replaceState({}, "", path);
  await mount(<App />);
  expect(document.body.textContent).toContain("Sign in to continue.");
  // No seller form is exposed before the server confirms a session.
  expect(document.querySelector("input,textarea")).toBeNull();
});
