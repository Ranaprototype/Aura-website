/**
 * Phase 4 public storefront HTTP contract verification.
 *
 * Runs the real Express application against a disposable PostgreSQL instance.
 * Anonymous discovery reads run on the restricted aura_public pool through the
 * SECURITY DEFINER views; admin suspension reuses the four-eyes review guard.
 * Every allow/deny decision is asserted on the response and, where it matters,
 * on authoritative database state. Owner-approved D-01/D-02/D-03/D-22..D-25.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findMessage, tokenFromMessage } from "./support/smtp";
import { registerUser, startTestApp, type TestApp } from "./support/app";
import { PgDatabase } from "../server/db/database";

let app: TestApp;
let operator: Awaited<ReturnType<typeof registerUser>>;
let ownerA: Awaited<ReturnType<typeof registerUser>>;
let ownerB: Awaited<ReturnType<typeof registerUser>>;
let memberA: Awaited<ReturnType<typeof registerUser>>;

const password = "correct-horse-battery-9";
const orgHeader = (orgId: string) => ({ headers: { "x-aura-org": orgId } });

async function verifiedUser(email: string, displayName = "User") {
  const user = await registerUser(app, { email, password, displayName });
  const token = tokenFromMessage(
    findMessage(app.sink, { to: email, subject: "Confirm your AURA email" }),
    "/verify-email"
  );
  const verification = await user.client.post("/api/v1/auth/email/verify", { token });
  expect(verification.status).toBe(200);
  return user;
}

const sellerInput = (name: string) => ({
  displayName: name,
  legalName: `${name} Private Limited`,
  businessEmail: "studio@example.test",
  country: "IN",
  website: "https://example.test",
  description: "Independent studio.",
});

async function onboardSeller(user: typeof ownerA, name: string) {
  const saved = await user.client.put("/api/v1/seller/profile", sellerInput(name), orgHeader(user.organizationId));
  expect(saved.status).toBeLessThan(300);
  const submitted = await user.client.post("/api/v1/seller/profile/submit", {}, orgHeader(user.organizationId));
  expect(submitted.status).toBe(200);
  const approved = await operator.client.post(`/api/v1/admin/sellers/${user.organizationId}/approve`, {});
  expect(approved.status).toBe(200);
}

interface CategoryResponse {
  categories: Array<{
    id: string;
    slug: string;
    attributes: Array<{ id: string; key: string; options: string[] | null; isRequired: boolean }>;
  }>;
}

interface PublishOptions {
  title: string;
  slug: string;
  categorySlug: string;
  attrKey: string;
  attrValue: string;
  sku: string;
  summary?: string;
  description?: string;
}

/** Create a complete product and walk it to approved (published). */
async function publishProduct(user: typeof ownerA, opts: PublishOptions) {
  const cats = await user.client.get<CategoryResponse>("/api/v1/categories", orgHeader(user.organizationId));
  expect(cats.status).toBe(200);
  const category = cats.body.categories.find(c => c.slug === opts.categorySlug)!;
  const required = category.attributes.find(a => a.key === opts.attrKey)!;
  const created = await user.client.post<{ product: { id: string } }>(
    "/api/v1/seller/products",
    {
      title: opts.title,
      slug: opts.slug,
      categoryId: category.id,
      summary: opts.summary ?? null,
      description: opts.description ?? null,
    },
    orgHeader(user.organizationId)
  );
  expect(created.status).toBe(201);
  const productId = created.body.product.id;
  const variant = await user.client.post(
    `/api/v1/seller/products/${productId}/variants`,
    { sku: opts.sku, title: "Default", size: "42", colour: "black" },
    orgHeader(user.organizationId)
  );
  expect(variant.status).toBe(201);
  const attribute = await user.client.put(
    `/api/v1/seller/products/${productId}/attributes`,
    { values: [{ attributeId: required.id, value: opts.attrValue }] },
    orgHeader(user.organizationId)
  );
  expect(attribute.status).toBe(200);
  const media = await user.client.post(
    `/api/v1/seller/products/${productId}/media`,
    { url: `https://cdn.example.test/${opts.slug}.png`, altText: "Hero" },
    orgHeader(user.organizationId)
  );
  expect(media.status).toBe(201);
  const submitted = await user.client.post(
    `/api/v1/seller/products/${productId}/submit`,
    {},
    orgHeader(user.organizationId)
  );
  expect(submitted.status).toBe(201);
  const approved = await operator.client.post(
    `/api/v1/admin/products/${productId}/approve`,
    { note: "Complete." }
  );
  expect(approved.status).toBe(200);
  return { productId, slug: opts.slug };
}

/** Anonymous public GET (no cookies, no session). */
const pub = (path: string) => fetch(`${app.baseUrl}/api/v1/storefront${path}`);
const pubJson = async <T = Record<string, unknown>>(path: string) => {
  const response = await pub(path);
  return { status: response.status, headers: response.headers, body: (await response.json()) as T };
};

interface ListBody {
  items: Array<{
    slug: string;
    title: string;
    summary: string | null;
    category: { slug: string; name: string };
    approvedAt: string;
    heroImage: string | null;
  }>;
  nextCursor: string | null;
}

beforeAll(async () => {
  // A high public budget keeps the functional tests clear of the limiter; the
  // limiter itself is asserted with a low value in its own case.
  app = await startTestApp({ config: { PUBLIC_READ_IP_LIMIT: "100000" } });
  operator = await verifiedUser("p4.operator@example.test", "Platform Operator");
  await app.db.admin.query(
    `insert into aura.platform_admins (principal_id, note) values ($1, 'phase 4 fixture')`,
    [operator.principalId]
  );
  ownerA = await verifiedUser("p4.owner-a@example.test", "Owner A");
  ownerB = await verifiedUser("p4.owner-b@example.test", "Owner B");
  memberA = await verifiedUser("p4.viewer-a@example.test", "Viewer A");
  await app.db.admin.query(
    `insert into aura.memberships (org_id, principal_id, role) values ($1, $2, 'viewer')`,
    [ownerA.organizationId, memberA.principalId]
  );
  await onboardSeller(ownerA, "Studio A");
  await onboardSeller(ownerB, "Studio B");

  await publishProduct(ownerA, {
    title: "Aurora Runner", slug: "aurora-runner", categorySlug: "sneakers",
    attrKey: "upper-material", attrValue: "knit", sku: "P4-AURORA-42",
    summary: "Lightweight knit trainer for daily runs.",
    description: "A breathable everyday runner.",
  });
  await publishProduct(ownerA, {
    title: "Borealis Classic", slug: "borealis-classic", categorySlug: "sneakers",
    attrKey: "upper-material", attrValue: "leather", sku: "P4-BOREALIS-42",
    summary: "Heritage leather silhouette.",
  });
  await publishProduct(ownerA, {
    title: "Zephyr Tee", slug: "zephyr-tee", categorySlug: "apparel",
    attrKey: "fabric", attrValue: "organic-cotton", sku: "P4-ZEPHYR-M",
    summary: "Breathable organic cotton tee.",
  });
  await publishProduct(ownerB, {
    title: "Meridian Runner", slug: "meridian-runner", categorySlug: "sneakers",
    attrKey: "upper-material", attrValue: "mesh", sku: "P4-MERIDIAN-42",
    summary: "Mesh runner from another studio.",
  });
}, 120_000);

afterAll(async () => {
  await app.close();
});

describe("public discovery list", () => {
  it("returns the published catalogue anonymously with only allowlisted fields", async () => {
    const { status, headers, body } = await pubJson<ListBody>("/products");
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(body.items.map(i => i.slug).sort()).toEqual([
      "aurora-runner", "borealis-classic", "meridian-runner", "zephyr-tee",
    ]);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual([
        "approvedAt", "category", "heroImage", "slug", "summary", "title",
      ]);
      expect(Object.keys(item.category).sort()).toEqual(["name", "slug"]);
    }
    // No internal identifiers or seller identity anywhere in the payload.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ownerA.organizationId);
    expect(serialized).not.toContain(ownerB.organizationId);
    expect(serialized).not.toContain("businessEmail");
    expect(serialized).not.toContain("legalName");
    expect(serialized).not.toContain("Studio A");
  });

  it("defaults to newest-first ordering (approved_at DESC, slug DESC)", async () => {
    const { body } = await pubJson<ListBody>("/products");
    const times = body.items.map(i => Date.parse(i.approvedAt));
    for (let i = 1; i < times.length; i++) expect(times[i - 1]!).toBeGreaterThanOrEqual(times[i]!);
  });

  it("sorts title A–Z with a stable slug tiebreak (D-24)", async () => {
    const { body } = await pubJson<ListBody>("/products?sort=title");
    expect(body.items.map(i => i.title)).toEqual([
      "Aurora Runner", "Borealis Classic", "Meridian Runner", "Zephyr Tee",
    ]);
  });

  it("matches words across title and summary (D-23)", async () => {
    const byTitle = await pubJson<ListBody>("/products?q=runner");
    expect(byTitle.body.items.map(i => i.slug).sort()).toEqual(["aurora-runner", "meridian-runner"]);
    const bySummary = await pubJson<ListBody>("/products?q=leather");
    expect(bySummary.body.items.map(i => i.slug)).toEqual(["borealis-classic"]);
    const noMatch = await pubJson<ListBody>("/products?q=unobtainium");
    expect(noMatch.body.items).toEqual([]);
    expect(noMatch.body.nextCursor).toBeNull();
  });

  it("filters by category slug (D-25)", async () => {
    const apparel = await pubJson<ListBody>("/products?category=apparel");
    expect(apparel.body.items.map(i => i.slug)).toEqual(["zephyr-tee"]);
    const sneakers = await pubJson<ListBody>("/products?category=sneakers");
    expect(sneakers.body.items).toHaveLength(3);
  });

  it("filters by curated product attributes (D-25)", async () => {
    const knit = await pubJson<ListBody>("/products?attr=upper-material:knit");
    expect(knit.body.items.map(i => i.slug)).toEqual(["aurora-runner"]);
    const fabric = await pubJson<ListBody>("/products?attr=fabric:organic-cotton");
    expect(fabric.body.items.map(i => i.slug)).toEqual(["zephyr-tee"]);
    // Two attribute filters AND together.
    const both = await pubJson<ListBody>("/products?attr=upper-material:knit&attr=fabric:organic-cotton");
    expect(both.body.items).toEqual([]);
  });

  it("rejects non-curated attribute keys and malformed filters", async () => {
    for (const query of [
      "/products?attr=fit:relaxed", // curated set excludes fit
      "/products?attr=upper-material", // missing value
      "/products?attr=:knit", // missing key
      "/products?limit=0",
      "/products?limit=61",
      "/products?limit=abc",
      "/products?sort=price",
      "/products?category=Not%20A%20Slug",
    ]) {
      const { status, body, headers } = await pubJson(query);
      expect(status, query).toBe(400);
      expect(body, query).toEqual({ error: "invalid_request" });
      expect(headers.get("cache-control"), query).toBe("no-store");
    }
  });

  it("paginates with a bound signed cursor and no duplicates or omissions", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const path: string = `/products?sort=title&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const { status, body } = await pubJson<ListBody>(path);
      expect(status).toBe(200);
      seen.push(...body.items.map(i => i.slug));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(["aurora-runner", "borealis-classic", "meridian-runner", "zephyr-tee"]);
    expect(new Set(seen).size).toBe(4);
  });

  it("rejects a cursor reused under a different binding", async () => {
    const first = await pubJson<ListBody>("/products?sort=title&limit=2");
    const cursor = first.body.nextCursor!;
    expect(cursor).toBeTruthy();
    // Same signature, different sort => binding mismatch.
    const wrongSort = await pubJson(`/products?sort=newest&limit=2&cursor=${encodeURIComponent(cursor)}`);
    expect(wrongSort.status).toBe(400);
    expect(wrongSort.body).toEqual({ error: "invalid_cursor" });
    // Different limit => binding mismatch.
    const wrongLimit = await pubJson(`/products?sort=title&limit=3&cursor=${encodeURIComponent(cursor)}`);
    expect(wrongLimit.status).toBe(400);
    expect(wrongLimit.body).toEqual({ error: "invalid_cursor" });
  });

  it("rejects a tampered cursor", async () => {
    const first = await pubJson<ListBody>("/products?limit=2");
    const cursor = first.body.nextCursor!;
    const [payload, sig] = cursor.split(".");
    const tampered = `${payload}.${sig!.slice(0, -2)}xx`;
    const { status, body } = await pubJson(`/products?limit=2&cursor=${encodeURIComponent(tampered)}`);
    expect(status).toBe(400);
    expect(body).toEqual({ error: "invalid_cursor" });
    const malformed = await pubJson("/products?limit=2&cursor=not-a-cursor");
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: "invalid_cursor" });
  });
});

describe("public product detail", () => {
  it("returns the allowlisted detail with children and no internal ids", async () => {
    const { status, headers, body } = await pubJson<Record<string, unknown>>("/products/aurora-runner");
    expect(status).toBe(200);
    expect(headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual([
      "approvedAt", "attributes", "category", "description", "media", "slug", "summary", "title", "variants",
    ]);
    expect(body.slug).toBe("aurora-runner");
    expect(body.title).toBe("Aurora Runner");
    const variants = body.variants as Array<Record<string, unknown>>;
    expect(variants).toHaveLength(1);
    expect(Object.keys(variants[0]!).sort()).toEqual(["colour", "material", "position", "size", "title"]);
    const media = body.media as Array<Record<string, unknown>>;
    expect(media[0]!.kind).toBe("image");
    expect(Object.keys(media[0]!).sort()).toEqual(["altText", "kind", "position", "url"]);
    const attributes = body.attributes as Array<Record<string, unknown>>;
    expect(attributes.some(a => a.key === "upper-material" && a.value === "knit")).toBe(true);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ownerA.organizationId);
    expect(serialized).not.toContain("P4-AURORA-42"); // SKU is not public
    expect(serialized).not.toContain("businessEmail");
  });

  it("returns a uniform 404 for every non-published or unknown slug", async () => {
    // Unknown slug, malformed slug, and a draft product all look identical.
    const draft = await ownerA.client.post<{ product: { id: string } }>(
      "/api/v1/seller/products",
      { title: "Hidden Draft", slug: "hidden-draft", categoryId: (await ownerA.client.get<CategoryResponse>("/api/v1/categories", orgHeader(ownerA.organizationId))).body.categories.find(c => c.slug === "sneakers")!.id },
      orgHeader(ownerA.organizationId)
    );
    expect(draft.status).toBe(201);
    for (const slug of ["does-not-exist", "hidden-draft", "INVALID SLUG", "a"]) {
      const { status, body, headers } = await pubJson(`/products/${encodeURIComponent(slug)}`);
      expect(status, slug).toBe(404);
      expect(body, slug).toEqual({ error: "not_found" });
      expect(headers.get("cache-control"), slug).toBe("no-store");
    }
  });

  it("resolves a redirect live-first and reports the canonical slug", async () => {
    // Record a legacy slug redirect for a live product, then resolve it.
    const live = await app.db.admin.query<{ id: string; org_id: string; slug: string }>(
      `select id, org_id, slug from aura.products where slug = 'aurora-runner'`
    );
    await app.db.admin.query(
      `insert into aura.slug_redirects (org_id, product_id, slug, replacement_slug, reason)
       values ($1, $2, 'aurora-runner-legacy', $3, 'global_collision')`,
      [live[0]!.org_id, live[0]!.id, live[0]!.slug]
    );
    const { status, body } = await pubJson<Record<string, unknown>>("/products/aurora-runner-legacy");
    expect(status).toBe(200);
    expect(body.slug).toBe("aurora-runner");
    expect(body.canonicalSlug).toBe("aurora-runner");
    expect(body.redirectedFrom).toBe("aurora-runner-legacy");
    // A live slug always wins over any redirect row.
    const direct = await pubJson<Record<string, unknown>>("/products/aurora-runner");
    expect(direct.status).toBe(200);
    expect(direct.body.redirectedFrom).toBeUndefined();
  });

  it("hides a redirect whose target is not published", async () => {
    const draft = await app.db.admin.query<{ id: string; org_id: string }>(
      `select id, org_id from aura.products where slug = 'hidden-draft'`
    );
    await app.db.admin.query(
      `insert into aura.slug_redirects (org_id, product_id, slug, replacement_slug, reason)
       values ($1, $2, 'hidden-draft-legacy', 'hidden-draft', 'global_collision')`,
      [draft[0]!.org_id, draft[0]!.id]
    );
    const { status, body } = await pubJson("/products/hidden-draft-legacy");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
  });
});

describe("suspension (D-03) and publication boundary", () => {
  it("requires a note, four-eyes separation and platform-admin authority", async () => {
    // Anonymous and ordinary sellers cannot suspend.
    const anon = await app.client().post(`/api/v1/admin/sellers/${ownerB.organizationId}/suspend`, { note: "x" });
    expect(anon.status).toBe(401);
    const seller = await ownerA.client.post(`/api/v1/admin/sellers/${ownerB.organizationId}/suspend`, { note: "x" });
    expect(seller.status).toBe(403);
    // Missing note is rejected.
    const noNote = await operator.client.post(`/api/v1/admin/sellers/${ownerB.organizationId}/suspend`, {});
    expect(noNote.status).toBe(400);
    // Four-eyes: an admin who is a member of the target org cannot decide it.
    await app.db.admin.query(
      `insert into aura.platform_admins (principal_id, note) values ($1, 'insider')`,
      [ownerB.principalId]
    );
    const insider = await ownerB.client.post(`/api/v1/admin/sellers/${ownerB.organizationId}/suspend`, { note: "self" });
    expect(insider.status).toBe(403);
    expect(insider.body).toEqual({ error: "review_separation_required" });
    await app.db.admin.query(`delete from aura.platform_admins where principal_id = $1`, [ownerB.principalId]);
  });

  it("suspends atomically, hides the seller's products, and audits without the note text", async () => {
    const before = await pubJson<ListBody>("/products");
    expect(before.body.items.some(i => i.slug === "meridian-runner")).toBe(true);

    const suspended = await operator.client.post<{ seller: { suspendedAt: string | null; suspensionNote?: string | null }; audit: Array<{ action: string; detail?: Record<string, unknown> }> }>(
      `/api/v1/admin/sellers/${ownerB.organizationId}/suspend`,
      { note: "Repeated policy violations." }
    );
    expect(suspended.status).toBe(200);
    expect(suspended.body.seller.suspendedAt).toBeTruthy();
    expect(suspended.body.seller.suspensionNote).toBe("Repeated policy violations.");
    const event = suspended.body.audit.find(e => e.action === "seller.suspended");
    expect(event).toBeTruthy();
    expect(JSON.stringify(event)).not.toContain("Repeated policy violations.");
    expect(event?.detail?.noteRecorded).toBe(true);

    // The suspended seller's product vanishes from list and detail.
    const list = await pubJson<ListBody>("/products");
    expect(list.body.items.some(i => i.slug === "meridian-runner")).toBe(false);
    const detail = await pubJson("/products/meridian-runner");
    expect(detail.status).toBe(404);
    // Other sellers are unaffected.
    expect(list.body.items.some(i => i.slug === "aurora-runner")).toBe(true);

    // Re-suspending is a conflict.
    const again = await operator.client.post(`/api/v1/admin/sellers/${ownerB.organizationId}/suspend`, { note: "again" });
    expect(again.status).toBe(409);
  });

  it("restricts the confidential note to owner/admin and platform admins", async () => {
    // Owner of the suspended org sees the note.
    const asOwner = await ownerB.client.get<{ suspendedAt: string | null; note: string | null }>(
      "/api/v1/seller/suspension", orgHeader(ownerB.organizationId)
    );
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.note).toBe("Repeated policy violations.");
    // A platform admin reads it through the admin detail surface.
    const adminDetail = await operator.client.get<{ seller: { suspensionNote?: string | null } }>(
      `/api/v1/admin/sellers/${ownerB.organizationId}`
    );
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.seller.suspensionNote).toBe("Repeated policy violations.");
    // The note never appears in the member-readable audit trail.
    const audit = await app.db.admin.query<{ detail: Record<string, unknown> }>(
      `select detail from aura.audit_events where org_id = $1 and action = 'seller.suspended'`,
      [ownerB.organizationId]
    );
    expect(JSON.stringify(audit)).not.toContain("Repeated policy violations.");
  });

  it("denies ordinary members the confidential note", async () => {
    // memberA is a viewer in orgA (not suspended): the route still gates the note.
    const denied = await memberA.client.get("/api/v1/seller/suspension", orgHeader(ownerA.organizationId));
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "role_forbidden" });
    // The dashboard/profile serializers omit the note for a viewer.
    const dashboard = await memberA.client.get<{ seller: Record<string, unknown> | null }>(
      "/api/v1/seller/dashboard", orgHeader(ownerA.organizationId)
    );
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.seller?.suspensionNote).toBeUndefined();
    expect(dashboard.body.seller?.suspendedAt).toBeNull();
  });

  it("restores the seller, clears the overlay and re-publishes the products", async () => {
    const restored = await operator.client.post<{ seller: { suspendedAt: string | null; suspensionNote?: string | null }; audit: Array<{ action: string }> }>(
      `/api/v1/admin/sellers/${ownerB.organizationId}/restore`,
      {}
    );
    expect(restored.status).toBe(200);
    expect(restored.body.seller.suspendedAt).toBeNull();
    expect(restored.body.seller.suspensionNote).toBeUndefined();
    expect(restored.body.audit.some(e => e.action === "seller.restored")).toBe(true);
    const list = await pubJson<ListBody>("/products");
    expect(list.body.items.some(i => i.slug === "meridian-runner")).toBe(true);
    const detail = await pubJson("/products/meridian-runner");
    expect(detail.status).toBe(200);
    // Restoring a seller that is not suspended is a conflict.
    const again = await operator.client.post(`/api/v1/admin/sellers/${ownerB.organizationId}/restore`, {});
    expect(again.status).toBe(409);
  });

  it("freezes seller-side writes while suspended", async () => {
    await operator.client.post(`/api/v1/admin/sellers/${ownerB.organizationId}/suspend`, { note: "freeze" });
    const edit = await ownerB.client.patch(
      `/api/v1/seller/products/${(await app.db.admin.query<{ id: string }>(`select id from aura.products where slug = 'meridian-runner'`))[0]!.id}`,
      { title: "Changed While Suspended" },
      orgHeader(ownerB.organizationId)
    );
    expect(edit.status).toBe(409);
    expect(edit.body).toEqual({ error: "seller_suspended" });
    await operator.client.post(`/api/v1/admin/sellers/${ownerB.organizationId}/restore`, {});
  });
});

describe("public availability and isolated rate limiting", () => {
  it("fails closed with 503 when the public pool is unconfigured", async () => {
    const isolated = await startTestApp({ services: { publicDb: undefined } });
    try {
      const response = await fetch(`${isolated.baseUrl}/api/v1/storefront/products`);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "storefront_unavailable" });
    } finally {
      await isolated.close();
    }
  });

  it("fails closed with 503 when the public pool cannot be reached", async () => {
    // A pool aimed at a port with nothing listening refuses the connection; the
    // storefront must fail closed (503), never fall back to the app pool.
    const deadPool = new PgDatabase({
      url: "postgres://postgres@127.0.0.1:1/postgres",
      role: "aura_public",
      max: 1,
    });
    const isolated = await startTestApp({ services: { publicDb: deadPool } });
    try {
      const response = await fetch(`${isolated.baseUrl}/api/v1/storefront/products`);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "storefront_unavailable" });
    } finally {
      await isolated.close();
    }
  });

  it("throttles anonymous reads per IP with Retry-After, isolated from auth limits", async () => {
    const isolated = await startTestApp({ config: { PUBLIC_READ_IP_LIMIT: "3" } });
    try {
      const statuses: number[] = [];
      let retryAfter: string | null = null;
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${isolated.baseUrl}/api/v1/storefront/products`);
        statuses.push(response.status);
        if (response.status === 429) retryAfter = response.headers.get("retry-after");
      }
      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statuses.slice(3)).toEqual([429, 429]);
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
      // The auth surface is unaffected by the public budget exhaustion.
      const session = await fetch(`${isolated.baseUrl}/api/v1/auth/session`);
      expect(session.status).toBe(200);
    } finally {
      await isolated.close();
    }
  });

  it("carries no-store on every public response code", async () => {
    const ok = await pub("/products");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const missing = await pub("/products/nope");
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const bad = await pub("/products?limit=0");
    expect(bad.headers.get("cache-control")).toBe("no-store");
  });
});
