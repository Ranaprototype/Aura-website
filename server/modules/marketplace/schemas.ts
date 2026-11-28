import { z } from "zod";
import { AccessError } from "../../db/database";
import { RequestError } from "../../http/errors";

/**
 * Input validation for the marketplace API. Schemas are strict: an unexpected
 * field is a rejection, not something that is silently ignored, so a browser
 * cannot smuggle seller, tenant or lifecycle fields into a write.
 */
export const uuidField = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const slugField = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{2,80}$/);

const countryField = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/);

const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .refine(value => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        Boolean(url.hostname) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "invalid_url");

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);

export const sellerProfileBody = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    legalName: z.string().trim().min(1).max(200),
    businessEmail: emailField,
    country: countryField,
    website: httpsUrl.nullish(),
    description: z.string().trim().max(2000).nullish(),
  })
  .strict();

export const reviewNoteBody = z
  .object({ note: z.string().trim().min(1).max(1000) })
  .strict();

export const optionalReviewNoteBody = z
  .object({ note: z.string().trim().max(1000).optional() })
  .strict();

export const productCreateBody = z
  .object({
    title: z.string().trim().min(3).max(140),
    categoryId: uuidField,
    slug: slugField.optional(),
    summary: z.string().trim().max(300).nullish(),
    description: z.string().trim().max(5000).nullish(),
  })
  .strict();

export const productUpdateBody = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    summary: z.string().trim().max(300).nullish(),
    description: z.string().trim().max(5000).nullish(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 0, "empty_update");

export const variantBody = z
  .object({
    sku: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/),
    title: z.string().trim().min(1).max(140),
    size: z.string().trim().min(1).max(60).nullish(),
    colour: z.string().trim().min(1).max(60).nullish(),
    material: z.string().trim().min(1).max(60).nullish(),
    position: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const variantUpdateBody = variantBody.partial().strict();

export const mediaBody = z
  .object({
    kind: z.enum(["image", "reference"]).default("image"),
    url: httpsUrl,
    altText: z.string().trim().max(200).nullish(),
    position: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const mediaUpdateBody = mediaBody.partial().strict();

export const attributeValuesBody = z
  .object({
    values: z
      .array(
        z
          .object({
            attributeId: uuidField,
            value: z.string().trim().min(1).max(500),
          })
          .strict()
      )
      .max(60),
  })
  .strict();

export const listQuery = z
  .object({
    status: z.string().trim().max(30).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

/** Maps a database rejection onto the API contract, never leaking SQL text. */
export function mapDatabaseError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const message = String((error as { message?: string }).message ?? "");

  if (code === "42501") {
    // Four-eyes: the database refused a platform decision on the reviewer's own
    // seller organization (see `aura.review_separation_guard`).
    if (message.includes("review_separation_required"))
      throw new RequestError(403, "review_separation_required");
    throw new AccessError("role_forbidden");
  }
  if (code === "28000") throw new AccessError("identity_required");
  if (code === "P0002") throw new RequestError(404, "not_found");
  if (code === "23505") {
    if (message.includes("product_variants"))
      throw new RequestError(409, "sku_exists");
    if (message.includes("products_org_slug_key"))
      throw new RequestError(409, "product_slug_exists");
    if (message.includes("seller_profiles"))
      throw new RequestError(409, "seller_exists");
    if (message.includes("product_revisions"))
      throw new RequestError(409, "revision_exists");
    throw new RequestError(409, "conflict");
  }
  if (code === "23503") {
    if (message.includes("attribute_not_in_category"))
      throw new RequestError(400, "attribute_not_in_category");
    throw new RequestError(400, "invalid_reference");
  }
  if (code === "22023") {
    const known = [
      "review_note_required",
      "suspension_note_required",
      "invalid_organization_name",
      "invalid_organization_slug",
    ];
    throw new RequestError(
      400,
      known.find(entry => message.includes(entry)) ?? "invalid_request"
    );
  }
  if (code === "23514") {
    const known: Array<[string, number]> = [
      ["product_incomplete", 400],
      ["review_note_required", 400],
      ["attribute_not_in_category", 400],
      ["invalid_attribute_value", 400],
      ["product_locked", 409],
      ["seller_locked", 409],
      ["seller_suspended", 409],
      ["suspension_must_be_atomic", 409],
      ["seller_not_approved", 409],
      ["invalid_status_transition", 409],
      ["revision_not_approved", 409],
      ["revision_required", 409],
      ["invalid_pending_changes", 409],
      ["append_only", 409],
    ];
    const match = known.find(([needle]) => message.includes(needle));
    if (match) throw new RequestError(match[1], match[0]);
    if (message.includes("violates check constraint"))
      throw new RequestError(400, "invalid_request");
    throw new RequestError(400, "invalid_request");
  }
  throw error;
}
