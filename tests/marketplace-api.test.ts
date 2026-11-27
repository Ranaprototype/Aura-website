/**
 * Phase 3 HTTP contract verification.
 *
 * Runs the real Express application against a disposable PostgreSQL instance
 * and the loopback SMTP sink. Every allow/deny decision is asserted on the
 * response and, where it matters, on authoritative database state.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findMessage, tokenFromMessage } from "./support/smtp";
import { registerUser, startTestApp, type TestApp } from "./support/app";
import { isPurchasable } from "../shared/marketplace";

let app: TestApp;
let operator: Awaited<ReturnType<typeof registerUser>>;
let ownerA: Awaited<ReturnType<typeof registerUser>>;
let ownerB: Awaited<ReturnType<typeof registerUser>>;
let viewer: Awaited<ReturnType<typeof registerUser>>;

const password = "correct-horse-battery-9";

async function verifiedUser(email: string, displayName = "User") {
  const user = await registerUser(app, { email, password, displayName });
  const token = tokenFromMessage(
    findMessage(app.sink, { to: email, subject: "Confirm your AURA email" }),
    "/verify-email"
  );
  const verification = await user.client.post("/api/v1/auth/email/verify", {
    token,
  });
  expect(verification.status).toBe(200);
  return user;
}

const orgHeader = (orgId: string) => ({ headers: { "x-aura-org": orgId } });

interface SellerBody {
  seller: {
    id: string;
    status: string;
    displayName: string;
    reviewNote: string | null;
    businessEmail: string;
  } | null;
  audit?: Array<{ action: string }>;
}

const sellerInput = (name = "Aura Atelier") => ({
  displayName: name,
  legalName: `${name} Private Limited`,
  businessEmail: "studio@example.test",
  country: "IN",
  website: "https://example.test",
  description: "Independent studio.",
});

async function onboardSeller(user: typeof ownerA, name: string) {
  const saved = await user.client.put<SellerBody>(
    "/api/v1/seller/profile",
    sellerInput(name),
    {
      ...orgHeader(user.organizationId),
    }
  );
  expect(saved.status).toBeLessThan(300);
  const submitted = await user.client.post(
    "/api/v1/seller/profile/submit",
    {},
    orgHeader(user.organizationId)
  );
  expect(submitted.status).toBe(200);
  const approved = await operator.client.post<SellerBody>(
    `/api/v1/admin/sellers/${user.organizationId}/approve`,
    {}
  );
  expect(approved.status).toBe(200);
  expect(approved.body.seller?.status).toBe("approved");
}

interface CategoryResponse {
  categories: Array<{
    id: string;
    slug: string;
    attributes: Array<{
      id: string;
      key: string;
      dataType: string;
      options: string[] | null;
      isRequired: boolean;
    }>;
  }>;
}

interface ProductBody {
  product: {
    id: string;
    status: string;
    title: string;
    purchasable: boolean;
    pendingChanges: boolean;
    approvedRevisionId: string | null;
    variantCount: number;
    mediaCount: number;
    revisions?: Array<{
      id: string;
      decision: string;
      reviewNote: string | null;
      snapshot?: unknown;
    }>;
    audit?: Array<{ action: string }>;
    permissions?: { canEdit: boolean; canSubmit: boolean; canArchive: boolean };
    variants?: Array<{ id: string; sku: string }>;
    media?: Array<{ id: string; url: string }>;
    attributes?: Array<{ key: string; value: string }>;
    pendingRevision?: { id: string } | null;
  };
  revision?: { id: string; revision_number: number };
  audit?: Array<{ action: string }>;
}

const sneakers = async (user: typeof ownerA) => {
  const response = await user.client.get<CategoryResponse>(
    "/api/v1/categories",
    {
      ...orgHeader(user.organizationId),
    }
  );
  expect(response.status).toBe(200);
  const category = response.body.categories.find(
    entry => entry.slug === "sneakers"
  )!;
  return {
    id: category.id,
    required: category.attributes.find(
      entry => entry.key === "upper-material"
    )!,
  };
};

beforeAll(async () => {
  app = await startTestApp();
  operator = await verifiedUser(
    "phase3.operator@example.test",
    "Platform Operator"
  );
  await app.db.admin.query(
    `insert into aura.platform_admins (principal_id, note) values ($1, 'phase 3 fixture')`,
    [operator.principalId]
  );
  ownerA = await verifiedUser("phase3.owner-a@example.test", "Owner A");
  ownerB = await verifiedUser("phase3.owner-b@example.test", "Owner B");
  viewer = await verifiedUser("phase3.viewer@example.test", "Viewer");
});

afterAll(async () => {
  await app.close();
});

describe("seller onboarding and platform review", () => {
  it("walks a seller from draft to approved and exposes the dashboard", async () => {
    const empty = await ownerA.client.get<{
      seller: null;
      productCounts: Record<string, number>;
      permissions: { canManage: boolean };
    }>("/api/v1/seller/dashboard", orgHeader(ownerA.organizationId));
    expect(empty.status).toBe(200);
    expect(empty.body.seller).toBeNull();
    expect(empty.body.productCounts).toEqual({
      draft: 0,
      submitted: 0,
      approved: 0,
      rejected: 0,
      archived: 0,
    });
    expect(empty.body.permissions.canManage).toBe(true);

    const saved = await ownerA.client.put<SellerBody>(
      "/api/v1/seller/profile",
      sellerInput(),
      orgHeader(ownerA.organizationId)
    );
    expect(saved.status).toBe(201);
    expect(saved.body.seller?.status).toBe("draft");

    const submitted = await ownerA.client.post<SellerBody>(
      "/api/v1/seller/profile/submit",
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.seller?.status).toBe("submitted");

    const replay = await ownerA.client.post(
      "/api/v1/seller/profile/submit",
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ error: "seller_already_submitted" });

    // The queue is platform-only, and the seller cannot promote themselves.
    const forbiddenQueue = await ownerA.client.get("/api/v1/admin/sellers");
    expect(forbiddenQueue.status).toBe(403);
    const selfApprove = await ownerA.client.post(
      `/api/v1/admin/sellers/${ownerA.organizationId}/approve`,
      {}
    );
    expect(selfApprove.status).toBe(403);

    const queue = await operator.client.get<{
      sellers: Array<{ orgId: string; status: string; orgName: string }>;
    }>("/api/v1/admin/sellers?status=submitted");
    expect(queue.status).toBe(200);
    const entry = queue.body.sellers.find(
      seller => seller.orgId === ownerA.organizationId
    );
    expect(entry?.status).toBe("submitted");
    expect(entry?.orgName).toBeTruthy();

    const approved = await operator.client.post<SellerBody>(
      `/api/v1/admin/sellers/${ownerA.organizationId}/approve`,
      {}
    );
    expect(approved.status).toBe(200);
    expect(approved.body.seller?.status).toBe("approved");

    const dashboard = await ownerA.client.get<SellerBody>(
      "/api/v1/seller/dashboard",
      {
        ...orgHeader(ownerA.organizationId),
      }
    );
    expect(dashboard.body.seller?.status).toBe("approved");
    const activity = dashboard.body as unknown as {
      recentSellerActivity: Array<{ action: string }>;
    };
    expect(activity.recentSellerActivity.map(event => event.action)).toEqual(
      expect.arrayContaining([
        "seller.created",
        "seller.submitted",
        "seller.approved",
      ])
    );
  });

  it("validates onboarding input and rejects forged or missing identity", async () => {
    const unknownField = await ownerA.client.put(
      "/api/v1/seller/profile",
      { ...sellerInput(), status: "approved" },
      orgHeader(ownerA.organizationId)
    );
    expect(unknownField.status).toBe(400);
    expect(unknownField.body).toEqual({ error: "invalid_request" });

    const badCountry = await ownerA.client.put(
      "/api/v1/seller/profile",
      { ...sellerInput(), country: "India" },
      orgHeader(ownerA.organizationId)
    );
    expect(badCountry.status).toBe(400);
    expect(badCountry.body).toEqual({ error: "invalid_request" });

    const insecureSite = await ownerA.client.put(
      "/api/v1/seller/profile",
      { ...sellerInput(), website: "http://example.test" },
      orgHeader(ownerA.organizationId)
    );
    expect(insecureSite.status).toBe(400);

    const anonymous = await app.client().get("/api/v1/seller/dashboard");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: "authentication_required" });

    const noOrg = await ownerA.client.get("/api/v1/seller/dashboard");
    expect(noOrg.status).toBe(400);
    expect(noOrg.body).toEqual({ error: "organization_required" });

    const noCsrf = await ownerA.client.put(
      "/api/v1/seller/profile",
      sellerInput(),
      { ...orgHeader(ownerA.organizationId), csrf: false }
    );
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body).toEqual({ error: "csrf_failed" });
  });

  it("requires review before the catalogue is usable and honours organization roles", async () => {
    const invitation = await ownerB.client.post(
      `/api/v1/organizations/${ownerB.organizationId}/invitations`,
      { email: "phase3.viewer@example.test", role: "viewer" },
      orgHeader(ownerB.organizationId)
    );
    expect(invitation.status).toBe(201);
    const token = tokenFromMessage(
      findMessage(app.sink, {
        to: "phase3.viewer@example.test",
        subject: "invited you",
      }),
      "/accept-invitation"
    );
    expect(
      (await viewer.client.post("/api/v1/invitations/accept", { token })).status
    ).toBe(200);

    const category = await sneakers(ownerB);
    // The organization has a draft seller profile, but is not approved yet.
    const draft = await ownerB.client.put(
      "/api/v1/seller/profile",
      sellerInput("Tenant B Studio"),
      orgHeader(ownerB.organizationId)
    );
    expect(draft.status).toBe(201);
    const unapproved = await ownerB.client.post(
      "/api/v1/seller/products",
      { title: "Too Early Runner", categoryId: category.id },
      orgHeader(ownerB.organizationId)
    );
    expect(unapproved.status).toBe(409);
    expect(unapproved.body).toEqual({ error: "seller_not_approved" });

    // A viewer may read the catalogue but may not write it.
    const read = await viewer.client.get("/api/v1/seller/products", {
      headers: { "x-aura-org": ownerB.organizationId },
    });
    expect(read.status).toBe(200);
    const write = await viewer.client.post(
      "/api/v1/seller/products",
      { title: "Viewer Runner", categoryId: category.id },
      { headers: { "x-aura-org": ownerB.organizationId } }
    );
    expect(write.status).toBe(403);
    expect(write.body).toEqual({ error: "role_forbidden" });
    const profileWrite = await viewer.client.put(
      "/api/v1/seller/profile",
      sellerInput("Viewer Studio"),
      { headers: { "x-aura-org": ownerB.organizationId } }
    );
    expect(profileWrite.status).toBe(403);

    await onboardSeller(ownerB, "Tenant B Studio");
  });

  it("rejects a seller application with a note and allows rework", async () => {
    const applicant = await verifiedUser(
      "phase3.applicant@example.test",
      "Applicant"
    );
    const saved = await applicant.client.put(
      "/api/v1/seller/profile",
      sellerInput("Applicant Studio"),
      orgHeader(applicant.organizationId)
    );
    expect(saved.status).toBe(201);
    await applicant.client.post(
      "/api/v1/seller/profile/submit",
      {},
      orgHeader(applicant.organizationId)
    );

    const approveFirst = await operator.client.post(
      `/api/v1/admin/sellers/${applicant.organizationId}/approve`,
      {}
    );
    expect(approveFirst.status).toBe(200);

    // Business-information change sends an approved seller back for review.
    const edited = await applicant.client.put<SellerBody>(
      "/api/v1/seller/profile",
      sellerInput("Applicant Studio Renamed"),
      orgHeader(applicant.organizationId)
    );
    expect(edited.status).toBe(200);
    expect(edited.body.seller?.status).toBe("draft");

    await applicant.client.post(
      "/api/v1/seller/profile/submit",
      {},
      orgHeader(applicant.organizationId)
    );
    const withoutNote = await operator.client.post(
      `/api/v1/admin/sellers/${applicant.organizationId}/reject`,
      {}
    );
    expect(withoutNote.status).toBe(400);
    expect(withoutNote.body).toEqual({ error: "invalid_request" });

    const rejected = await operator.client.post<SellerBody>(
      `/api/v1/admin/sellers/${applicant.organizationId}/reject`,
      { note: "Trading name does not match the company register." }
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.seller?.status).toBe("rejected");
    expect(rejected.body.seller?.reviewNote).toContain("company register");

    const audit = await applicant.client.get<SellerBody>(
      "/api/v1/seller/profile",
      {
        ...orgHeader(applicant.organizationId),
      }
    );
    expect(audit.body.audit?.map(event => event.action)).toEqual(
      expect.arrayContaining(["seller.rejected", "seller.updated"])
    );
  });
});

describe("product catalogue and lifecycle", () => {
  let productId = "";

  it("creates a draft, validates it and builds variants, media and attributes", async () => {
    const category = await sneakers(ownerA);
    const created = await ownerA.client.post<ProductBody>(
      "/api/v1/seller/products",
      {
        title: "Phase Three Runner",
        summary: "A catalogue fixture.",
        description: "Created by the Phase 3 verification suite.",
        categoryId: category.id,
      },
      orgHeader(ownerA.organizationId)
    );
    expect(created.status).toBe(201);
    productId = created.body.product.id;
    expect(created.body.product.status).toBe("draft");
    expect(created.body.product.purchasable).toBe(false);

    const duplicate = await ownerA.client.post(
      "/api/v1/seller/products",
      {
        title: "Phase Three Runner",
        categoryId: category.id,
        slug: created.body.product.title,
      },
      orgHeader(ownerA.organizationId)
    );
    expect(duplicate.status).toBe(400);

    const forgedStatus = await ownerA.client.post(
      "/api/v1/seller/products",
      { title: "Forged Runner", categoryId: category.id, status: "approved" },
      orgHeader(ownerA.organizationId)
    );
    expect(forgedStatus.status).toBe(400);

    const updated = await ownerA.client.patch<ProductBody>(
      `/api/v1/seller/products/${productId}`,
      { title: "Phase Three Runner Mk II" },
      orgHeader(ownerA.organizationId)
    );
    expect(updated.status).toBe(200);
    expect(updated.body.product.title).toBe("Phase Three Runner Mk II");

    const emptyUpdate = await ownerA.client.patch(
      `/api/v1/seller/products/${productId}`,
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(emptyUpdate.status).toBe(400);

    // Submission is refused until a variant and the required attribute exist.
    const premature = await ownerA.client.post(
      `/api/v1/seller/products/${productId}/submit`,
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(premature.status).toBe(400);
    expect(premature.body).toEqual({ error: "product_incomplete" });

    const variant = await ownerA.client.post<{
      variants: Array<{ id: string; sku: string }>;
    }>(
      `/api/v1/seller/products/${productId}/variants`,
      {
        sku: "P3-RUNNER-42",
        title: "Size 42 / Cyan",
        size: "42",
        colour: "cyan",
      },
      orgHeader(ownerA.organizationId)
    );
    expect(variant.status).toBe(201);
    expect(variant.body.variants).toHaveLength(1);

    const duplicateSku = await ownerA.client.post(
      `/api/v1/seller/products/${productId}/variants`,
      { sku: "P3-RUNNER-42", title: "Duplicate" },
      orgHeader(ownerA.organizationId)
    );
    expect(duplicateSku.status).toBe(409);
    expect(duplicateSku.body).toEqual({ error: "sku_exists" });

    const badAttribute = await ownerA.client.put(
      `/api/v1/seller/products/${productId}/attributes`,
      { values: [{ attributeId: category.required.id, value: "unobtainium" }] },
      orgHeader(ownerA.organizationId)
    );
    expect(badAttribute.status).toBe(400);
    expect(badAttribute.body).toEqual({ error: "invalid_attribute_value" });

    const attributes = await ownerA.client.put<ProductBody>(
      `/api/v1/seller/products/${productId}/attributes`,
      { values: [{ attributeId: category.required.id, value: "knit" }] },
      orgHeader(ownerA.organizationId)
    );
    expect(attributes.status).toBe(200);
    expect(attributes.body.product).toBeUndefined();
    expect(
      (attributes.body as unknown as { attributes: Array<{ value: string }> })
        .attributes[0]?.value
    ).toBe("knit");

    const badMedia = await ownerA.client.post(
      `/api/v1/seller/products/${productId}/media`,
      { url: "http://cdn.example.test/image.png" },
      orgHeader(ownerA.organizationId)
    );
    expect(badMedia.status).toBe(400);
    const media = await ownerA.client.post<{
      media: Array<{ id: string; url: string }>;
    }>(
      `/api/v1/seller/products/${productId}/media`,
      { url: "https://cdn.example.test/runner.png", altText: "Front view" },
      orgHeader(ownerA.organizationId)
    );
    expect(media.status).toBe(201);
    expect(media.body.media?.[0]?.url).toBe(
      "https://cdn.example.test/runner.png"
    );

    const detail = await ownerA.client.get<ProductBody>(
      `/api/v1/seller/products/${productId}`,
      orgHeader(ownerA.organizationId)
    );
    expect(detail.status).toBe(200);
    expect(detail.body.product.variantCount).toBe(1);
    expect(detail.body.product.mediaCount).toBe(1);
    expect(detail.body.product.permissions).toEqual({
      canEdit: true,
      canSubmit: true,
      canArchive: true,
    });

    // A completely different role sees no catalogue write permission.
    const asViewer = await viewer.client.get(
      `/api/v1/seller/products/${productId}`,
      {
        headers: { "x-aura-org": ownerA.organizationId },
      }
    );
    expect(asViewer.status).toBe(403);
  });

  it("submits for review, locks the working copy and notifies no one prematurely", async () => {
    const submitted = await ownerA.client.post<ProductBody>(
      `/api/v1/seller/products/${productId}/submit`,
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.product.status).toBe("submitted");
    expect(submitted.body.revision?.revision_number).toBe(1);

    const edit = await ownerA.client.patch(
      `/api/v1/seller/products/${productId}`,
      { title: "Changed Under Review" },
      orgHeader(ownerA.organizationId)
    );
    expect(edit.status).toBe(409);
    expect(edit.body).toEqual({ error: "product_locked" });

    const resubmit = await ownerA.client.post(
      `/api/v1/seller/products/${productId}/submit`,
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(resubmit.status).toBe(409);
    expect(resubmit.body).toEqual({ error: "product_already_submitted" });

    const queue = await operator.client.get<{
      products: ProductBody["product"][];
    }>("/api/v1/admin/products?status=submitted");
    expect(queue.status).toBe(200);
    const queued = queue.body.products.find(
      product => product.id === productId
    );
    expect(queued?.status).toBe("submitted");
    expect(JSON.stringify(queue.body)).not.toContain("P3-RUNNER-42");

    const detail = await operator.client.get<ProductBody>(
      `/api/v1/admin/products/${productId}`
    );
    expect(detail.status).toBe(200);
    expect(detail.body.product.pendingRevision).toBeTruthy();
    const snapshot = JSON.stringify(
      detail.body.product.revisions?.[0]?.snapshot
    );
    expect(snapshot).toContain("P3-RUNNER-42");
    expect(detail.body.product.revisions?.[0]?.decision).toBe("pending");
  });

  it("approves only as a platform administrator and only then becomes purchasable", async () => {
    const denied = await ownerA.client.post(
      `/api/v1/admin/products/${productId}/approve`,
      {}
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "role_forbidden" });

    const approved = await operator.client.post<ProductBody>(
      `/api/v1/admin/products/${productId}/approve`,
      { note: "Catalogue entry is complete." }
    );
    expect(approved.status).toBe(200);
    expect(approved.body.product.status).toBe("approved");
    expect(approved.body.product.purchasable).toBe(true);
    expect(approved.body.product.approvedRevisionId).toBeTruthy();

    const published = await operator.client.get<{
      products: ProductBody["product"][];
    }>("/api/v1/admin/products?status=approved");
    expect(
      published.body.products.some(product => product.id === productId)
    ).toBe(true);

    const detail = await ownerA.client.get<ProductBody>(
      `/api/v1/seller/products/${productId}`,
      orgHeader(ownerA.organizationId)
    );
    expect(detail.body.product.purchasable).toBe(true);
    expect(detail.body.product.permissions?.canEdit).toBe(true);
  });

  it("drops the product out of publication when approved content is edited", async () => {
    const edited = await ownerA.client.patch<ProductBody>(
      `/api/v1/seller/products/${productId}`,
      { description: "Revised description after approval." },
      orgHeader(ownerA.organizationId)
    );
    expect(edited.status).toBe(200);
    expect(edited.body.product.status).toBe("approved");
    expect(edited.body.product.pendingChanges).toBe(true);
    expect(edited.body.product.purchasable).toBe(false);

    const archive = await ownerA.client.post<ProductBody>(
      `/api/v1/seller/products/${productId}/archive`,
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(archive.status).toBe(200);
    expect(archive.body.product.status).toBe("archived");

    const afterArchive = await ownerA.client.post(
      `/api/v1/seller/products/${productId}/submit`,
      {},
      orgHeader(ownerA.organizationId)
    );
    expect(afterArchive.status).toBe(409);
    expect(afterArchive.body).toEqual({ error: "product_archived" });

    const readOnly = await ownerA.client.patch(
      `/api/v1/seller/products/${productId}`,
      { title: "Archived Edit" },
      orgHeader(ownerA.organizationId)
    );
    expect(readOnly.status).toBe(409);
    expect(readOnly.body).toEqual({ error: "product_archived" });
  });

  it("carries a full revision and audit history", async () => {
    const detail = await ownerA.client.get<ProductBody>(
      `/api/v1/seller/products/${productId}`,
      orgHeader(ownerA.organizationId)
    );
    const actions = (detail.body.product.audit ?? []).map(
      event => event.action
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "product.created",
        "product.updated",
        "product.submitted",
        "product.approved",
        "product.archived",
      ])
    );
    expect(detail.body.product.revisions?.[0]?.decision).toBe("approved");
  });

  it("reviews and rejects a resubmission, then re-approves the improved copy", async () => {
    const category = await sneakers(ownerB);
    const created = await ownerB.client.post<ProductBody>(
      "/api/v1/seller/products",
      { title: "Tenant B Trainer", categoryId: category.id },
      orgHeader(ownerB.organizationId)
    );
    expect(created.status).toBe(201);
    const id = created.body.product.id;

    await ownerB.client.post(
      `/api/v1/seller/products/${id}/variants`,
      { sku: `B-TRAINER-${Date.now()}`, title: "One size" },
      orgHeader(ownerB.organizationId)
    );
    await ownerB.client.put(
      `/api/v1/seller/products/${id}/attributes`,
      { values: [{ attributeId: category.required.id, value: "mesh" }] },
      orgHeader(ownerB.organizationId)
    );
    const submitted = await ownerB.client.post<ProductBody>(
      `/api/v1/seller/products/${id}/submit`,
      {},
      orgHeader(ownerB.organizationId)
    );
    expect(submitted.status).toBe(201);

    // A frozen product cannot receive new catalogue content either.
    const lockedVariant = await ownerB.client.post(
      `/api/v1/seller/products/${id}/variants`,
      { sku: `B-LOCKED-${Date.now()}`, title: "Too late" },
      orgHeader(ownerB.organizationId)
    );
    expect(lockedVariant.status).toBe(409);
    expect(lockedVariant.body).toEqual({ error: "product_locked" });

    const missingNote = await operator.client.post(
      `/api/v1/admin/products/${id}/reject`,
      {}
    );
    expect(missingNote.status).toBe(400);

    const rejected = await operator.client.post<ProductBody>(
      `/api/v1/admin/products/${id}/reject`,
      { note: "Please add the sole specification." }
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.product.status).toBe("rejected");
    expect(rejected.body.product.purchasable).toBe(false);
    const revision = rejected.body.product.revisions?.[0];
    expect(revision?.decision).toBe("rejected");
    expect(revision?.reviewNote).toContain("sole specification");

    // Rework is allowed after rejection, and the product can be resubmitted.
    const reworked = await ownerB.client.patch(
      `/api/v1/seller/products/${id}`,
      { description: "Now includes the sole specification." },
      orgHeader(ownerB.organizationId)
    );
    expect(reworked.status).toBe(200);
    const resubmitted = await ownerB.client.post<ProductBody>(
      `/api/v1/seller/products/${id}/submit`,
      {},
      orgHeader(ownerB.organizationId)
    );
    expect(resubmitted.status).toBe(201);
    expect(resubmitted.body.revision?.revision_number).toBe(2);

    const approved = await operator.client.post<ProductBody>(
      `/api/v1/admin/products/${id}/approve`,
      {}
    );
    expect(approved.status).toBe(200);
    expect(approved.body.product.purchasable).toBe(true);

    // Adding catalogue content after approval withdraws purchasability and
    // requires a fresh review, even though the product row stays approved.
    const lateVariant = await ownerB.client.post<ProductBody>(
      `/api/v1/seller/products/${id}/variants`,
      { sku: `B-LATE-${Date.now()}`, title: "Late addition" },
      orgHeader(ownerB.organizationId)
    );
    expect(lateVariant.status).toBe(201);
    const afterLateEdit = await ownerB.client.get<ProductBody>(
      `/api/v1/seller/products/${id}`,
      orgHeader(ownerB.organizationId)
    );
    expect(afterLateEdit.body.product.status).toBe("approved");
    expect(afterLateEdit.body.product.pendingChanges).toBe(true);
    expect(afterLateEdit.body.product.purchasable).toBe(false);
    const lateAudit = (afterLateEdit.body.product.audit ?? []).map(
      event => event.action
    );
    expect(lateAudit).toContain("product.revised");
  });
});

describe("tenant isolation and request hardening", () => {
  it("never exposes one seller's catalogue to another tenant", async () => {
    const listB = await ownerB.client.get<{
      products: Array<{ id: string; title: string }>;
    }>("/api/v1/seller/products", orgHeader(ownerB.organizationId));
    expect(listB.status).toBe(200);
    const listA = await ownerA.client.get<{ products: Array<{ id: string }> }>(
      "/api/v1/seller/products",
      orgHeader(ownerA.organizationId)
    );
    const idsB = new Set(listB.body.products.map(product => product.id));
    expect(listA.body.products.every(product => !idsB.has(product.id))).toBe(
      true
    );

    const foreign = listA.body.products[0]!.id;
    const read = await ownerB.client.get(`/api/v1/seller/products/${foreign}`, {
      ...orgHeader(ownerB.organizationId),
    });
    expect(read.status).toBe(404);
    const write = await ownerB.client.patch(
      `/api/v1/seller/products/${foreign}`,
      { title: "Hijacked" },
      orgHeader(ownerB.organizationId)
    );
    expect(write.status).toBe(404);
    const remove = await ownerB.client.post(
      `/api/v1/seller/products/${foreign}/archive`,
      {},
      orgHeader(ownerB.organizationId)
    );
    expect(remove.status).toBe(404);

    // Claiming another organization's id in the header proves nothing.
    const forged = await ownerB.client.get("/api/v1/seller/products", {
      headers: { "x-aura-org": ownerA.organizationId },
    });
    expect(forged.status).toBe(403);
    expect(forged.body).toEqual({ error: "organization_forbidden" });
  });

  it("keeps platform review closed to ordinary sellers", async () => {
    for (const path of [
      "/api/v1/admin/sellers",
      "/api/v1/admin/products",
      "/api/v1/admin/products/11111111-1111-4111-8111-111111111111",
    ]) {
      const response = await ownerA.client.get(path);
      expect(response.status, path).toBe(403);
      expect(response.body).toEqual({ error: "role_forbidden" });
    }
    const approve = await ownerA.client.post(
      "/api/v1/admin/products/11111111-1111-4111-8111-111111111111/approve",
      {}
    );
    expect(approve.status).toBe(403);

    // The reverse boundary holds too: the platform grant is not a membership,
    // so it cannot be used to read or write a seller's organization.
    const foreignSellerList = await operator.client.get(
      "/api/v1/seller/products",
      orgHeader(ownerA.organizationId)
    );
    expect(foreignSellerList.status).toBe(403);
    expect(foreignSellerList.body).toEqual({ error: "organization_forbidden" });

    const foreignCreate = await operator.client.post(
      "/api/v1/seller/products",
      {
        title: "Platform Write",
        categoryId: "00000000-0000-4000-8000-000000000000",
      },
      orgHeader(ownerA.organizationId)
    );
    expect(foreignCreate.status).toBe(403);
    expect(foreignCreate.body).toEqual({ error: "organization_forbidden" });
  });

  it("rejects malformed identifiers and oversized payloads", async () => {
    const badId = await ownerA.client.get(
      "/api/v1/seller/products/not-a-uuid",
      {
        ...orgHeader(ownerA.organizationId),
      }
    );
    expect(badId.status).toBe(400);
    expect(badId.body).toEqual({ error: "invalid_request" });

    const oversized = await ownerA.client.post(
      "/api/v1/seller/products",
      {
        title: "x".repeat(40_000),
        categoryId: "11111111-1111-4111-8111-111111111111",
      },
      orgHeader(ownerA.organizationId)
    );
    expect(oversized.status).toBe(413);
    expect(oversized.body).toEqual({ error: "payload_too_large" });

    const anonymous = await app.client().get("/api/v1/categories");
    expect(anonymous.status).toBe(401);
  });

  it("shows the platform flag on the session only as presentation data", async () => {
    const session = await operator.client.get<{ platformAdmin: boolean }>(
      "/api/v1/auth/session"
    );
    expect(session.body.platformAdmin).toBe(true);
    const ownerSession = await ownerA.client.get<{ platformAdmin: boolean }>(
      "/api/v1/auth/session"
    );
    expect(ownerSession.body.platformAdmin).toBe(false);
  });

  it("rejects a cross-site origin before any catalogue work happens", async () => {
    const foreignOrigin = await ownerA.client.post(
      "/api/v1/seller/products",
      {
        title: "Cross Site",
        categoryId: "00000000-0000-4000-8000-000000000000",
      },
      {
        headers: {
          "x-aura-org": ownerA.organizationId,
          origin: "https://evil.example",
        },
      }
    );
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.body).toEqual({ error: "origin_rejected" });

    const crossSite = await ownerA.client.post(
      "/api/v1/seller/products",
      {
        title: "Cross Site",
        categoryId: "00000000-0000-4000-8000-000000000000",
      },
      {
        headers: {
          "x-aura-org": ownerA.organizationId,
          "sec-fetch-site": "cross-site",
        },
      }
    );
    expect(crossSite.status).toBe(403);
    expect(crossSite.body).toEqual({ error: "origin_rejected" });
  });

  it("derives purchasability from product and seller approval", () => {
    const purchasable = {
      status: "approved",
      pendingChanges: false,
      approvedRevisionId: "revision",
      sellerStatus: "approved",
    };
    expect(isPurchasable(purchasable)).toBe(true);
    expect(isPurchasable({ ...purchasable, sellerStatus: "draft" })).toBe(
      false
    );
    expect(isPurchasable({ ...purchasable, sellerStatus: "submitted" })).toBe(
      false
    );
    expect(isPurchasable({ ...purchasable, pendingChanges: true })).toBe(false);
    expect(isPurchasable({ ...purchasable, status: "submitted" })).toBe(false);
    expect(isPurchasable({ ...purchasable, approvedRevisionId: null })).toBe(
      false
    );
  });
});
