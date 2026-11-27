import type { Transaction } from "../../db/database";
import { RequestError } from "../../http/errors";
import { isPurchasable, type ProductStatus } from "../../../shared/marketplace";
import type {
  AuditEventView,
  CategoryView,
  ProductAttributeValueView,
  ProductMediaView,
  ProductRevisionView,
  ProductVariantView,
  SellerProfileView,
  SellerStatus,
} from "../../../shared/marketplace";

/** Row shape returned by the seller profile queries. */
export interface SellerRow {
  id: string;
  org_id: string;
  display_name: string;
  legal_name: string;
  business_email: string;
  country: string;
  website: string | null;
  description: string | null;
  status: SellerStatus;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
  updated_at: Date;
}

const iso = (value: Date | null | undefined) =>
  value ? new Date(value).toISOString() : null;

export const serializeSeller = (row: SellerRow): SellerProfileView => ({
  id: row.id,
  orgId: row.org_id,
  displayName: row.display_name,
  legalName: row.legal_name,
  businessEmail: row.business_email,
  country: row.country,
  website: row.website,
  description: row.description,
  status: row.status,
  submittedAt: iso(row.submitted_at),
  reviewedAt: iso(row.reviewed_at),
  reviewNote: row.review_note,
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!,
});

export const loadSeller = async (tx: Transaction, orgId: string) => {
  const rows = await tx.query<SellerRow>(
    `select id, org_id, display_name, legal_name, business_email, country, website,
            description, status, submitted_at, reviewed_at, review_note,
            created_at, updated_at
       from aura.seller_profiles
      where org_id = $1`,
    [orgId]
  );
  return rows[0];
};

export const requireSeller = async (tx: Transaction, orgId: string) => {
  const seller = await loadSeller(tx, orgId);
  if (!seller) throw new RequestError(404, "seller_not_found");
  return seller;
};

export const SELLER_COLUMNS = `id, org_id, display_name, legal_name, business_email, country,
  website, description, status, submitted_at, reviewed_at, review_note, created_at, updated_at`;

export interface CategoryAttributeRow {
  id: string;
  key: string;
  label: string;
  data_type: "text" | "number" | "boolean" | "select";
  options: string[] | null;
  is_required: boolean;
  position: number;
}

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export const loadCategories = async (
  tx: Transaction
): Promise<CategoryView[]> => {
  const categories = await tx.query<CategoryRow>(
    `select id, slug, name, description
       from aura.categories where is_active order by position, slug`
  );
  const attributes = await tx.query<
    CategoryAttributeRow & { category_id: string }
  >(
    `select id, category_id, key, label, data_type, options, is_required, position
       from aura.category_attributes order by position, key`
  );
  return categories.map(category => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    attributes: attributes
      .filter(attribute => attribute.category_id === category.id)
      .map(attribute => ({
        id: attribute.id,
        key: attribute.key,
        label: attribute.label,
        dataType: attribute.data_type,
        options: attribute.options,
        isRequired: attribute.is_required,
        position: attribute.position,
      })),
  }));
};

export const loadAudit = async (
  tx: Transaction,
  entityType: "seller_profile" | "product",
  entityId: string
): Promise<AuditEventView[]> => {
  const rows = await tx.query<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    from_state: string | null;
    to_state: string | null;
    detail: Record<string, unknown>;
    actor_name: string | null;
    created_at: Date;
  }>(
    `select e.id, e.action, e.entity_type, e.entity_id, e.from_state, e.to_state,
            e.detail,
            coalesce(p.display_name, p.email) as actor_name,
            e.created_at
       from aura.audit_events e
       join aura.principals p on p.id = e.actor_principal_id
      where e.entity_type = $1 and e.entity_id = $2
      order by e.created_at, e.id
      limit 100`,
    [entityType, entityId]
  );
  return rows.map(row => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fromState: row.from_state,
    toState: row.to_state,
    detail: row.detail,
    actorName: row.actor_name,
    createdAt: iso(row.created_at)!,
  }));
};

export const loadVariants = async (tx: Transaction, productId: string) => {
  const rows = await tx.query<{
    id: string;
    sku: string;
    title: string;
    size: string | null;
    colour: string | null;
    material: string | null;
    position: number;
  }>(
    `select id, sku, title, size, colour, material, position
       from aura.product_variants where product_id = $1 order by position, id`,
    [productId]
  );
  return rows satisfies ProductVariantView[];
};

export const loadMedia = async (tx: Transaction, productId: string) => {
  const rows = await tx.query<{
    id: string;
    kind: "image" | "reference";
    url: string;
    altText: string | null;
    position: number;
  }>(
    `select id, kind, url, alt_text as "altText", position
       from aura.product_media where product_id = $1 order by position, id`,
    [productId]
  );
  return rows satisfies ProductMediaView[];
};

export const loadAttributeValues = async (
  tx: Transaction,
  productId: string
) => {
  const rows = await tx.query<{
    attributeId: string;
    key: string;
    label: string;
    value: string;
  }>(
    `select v.attribute_id as "attributeId", a.key, a.label, v.value
       from aura.product_attribute_values v
       join aura.category_attributes a on a.id = v.attribute_id
      where v.product_id = $1 order by a.position, a.key`,
    [productId]
  );
  return rows satisfies ProductAttributeValueView[];
};

export const loadRevisions = async (
  tx: Transaction,
  productId: string,
  { withSnapshot = false } = {}
): Promise<ProductRevisionView[]> => {
  const rows = await tx.query<{
    id: string;
    revision_number: number;
    decision: "pending" | "approved" | "rejected";
    submitted_at: Date;
    reviewed_at: Date | null;
    review_note: string | null;
    reviewer_name: string | null;
    snapshot?: unknown;
  }>(
    `select r.id, r.revision_number, r.decision, r.submitted_at, r.reviewed_at,
            r.review_note,
            coalesce(p.display_name, p.email) as reviewer_name
            ${withSnapshot ? ", r.snapshot" : ""}
       from aura.product_revisions r
       left join aura.principals p on p.id = r.reviewed_by
      where r.product_id = $1
      order by r.revision_number desc
      limit 50`,
    [productId]
  );
  return rows.map(row => ({
    id: row.id,
    revisionNumber: row.revision_number,
    decision: row.decision,
    submittedAt: iso(row.submitted_at)!,
    reviewedAt: iso(row.reviewed_at),
    reviewNote: row.review_note,
    reviewedByName: row.reviewer_name,
    ...(withSnapshot ? { snapshot: row.snapshot } : {}),
  }));
};

/** Lifecycle states in which the working copy is frozen. */
export const lockedStatuses = new Set(["submitted", "archived"]);

export const requireEditable = (status: string) => {
  if (status === "submitted") throw new RequestError(409, "product_locked");
  if (status === "archived") throw new RequestError(409, "product_archived");
};

export interface ProductRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  status: ProductStatus;
  pending_changes: boolean;
  approved_revision_id: string | null;
  category_id: string;
  category_name: string;
  category_slug: string;
  variant_count: number;
  media_count: number;
  submitted_at: Date | null;
  approved_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  seller_id: string;
  seller_display_name: string;
  seller_status: SellerStatus;
  org_name: string;
}

export const PRODUCT_SELECT = `
  select p.id, p.slug, p.title, p.summary, p.description, p.status,
         p.pending_changes, p.approved_revision_id,
         p.category_id, c.name as category_name, c.slug as category_slug,
         p.submitted_at, p.approved_at, p.archived_at, p.created_at, p.updated_at,
         s.id as seller_id, s.display_name as seller_display_name, s.status as seller_status,
         o.name as org_name,
         (select count(*)::int from aura.product_variants v where v.product_id = p.id)
           as variant_count,
         (select count(*)::int from aura.product_media m where m.product_id = p.id)
           as media_count
    from aura.products p
    join aura.categories c on c.id = p.category_id
    join aura.seller_profiles s on s.id = p.seller_profile_id
    left join aura.organizations o on o.id = p.org_id`;

export const summarizeProduct = (row: ProductRow) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  status: row.status,
  pendingChanges: row.pending_changes,
  approvedRevisionId: row.approved_revision_id,
  categoryId: row.category_id,
  categoryName: row.category_name,
  categorySlug: row.category_slug,
  variantCount: row.variant_count,
  mediaCount: row.media_count,
  purchasable: isPurchasable({
    status: row.status,
    pendingChanges: row.pending_changes,
    approvedRevisionId: row.approved_revision_id,
    sellerStatus: row.seller_status,
  }),
  createdAt: iso(row.created_at)!,
  updatedAt: iso(row.updated_at)!,
});

export const loadProductRow = async (
  tx: Transaction,
  productId: string,
  orgId?: string
) => {
  // Seller paths pass their organization explicitly; the platform review path
  // omits it and relies on its own grant plus RLS.
  const rows = await tx.query<ProductRow>(
    `${PRODUCT_SELECT} where p.id = $1${orgId ? " and p.org_id = $2" : ""}`,
    orgId ? [productId, orgId] : [productId]
  );
  const row = rows[0];
  if (!row) throw new RequestError(404, "product_not_found");
  return row;
};

export const countStatuses = async (tx: Transaction, orgId: string) => {
  const rows = await tx.query<{ status: string; count: number }>(
    `select status, count(*)::int as count
       from aura.products where org_id = $1 group by status`,
    [orgId]
  );
  const counts: Record<string, number> = {
    draft: 0,
    submitted: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
  };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
};
