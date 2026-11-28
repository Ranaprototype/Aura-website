/**
 * Phase 3 marketplace contract shared by the API and the client.
 *
 * These are plain types and pure predicates: no database or browser capability
 * lives here, and nothing in this file is an authorization decision. The server
 * re-derives every rule from authoritative rows.
 */

export const SELLER_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

export const PRODUCT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "archived",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Organization roles that may create and edit catalogue content. */
export const CATALOG_WRITE_ROLES = ["owner", "admin", "member"] as const;
/** Roles that may submit a seller application or archive a product. */
export const CATALOG_MANAGE_ROLES = ["owner", "admin"] as const;

export interface SellerProfileView {
  id: string;
  orgId: string;
  displayName: string;
  legalName: string;
  businessEmail: string;
  country: string;
  website: string | null;
  description: string | null;
  status: SellerStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** Phase 4 (D-03): suspension state is visible to org members and admins. */
  suspendedAt: string | null;
  /** Confidential note — only ever populated for owner/admin/platform admin. */
  suspensionNote?: string | null;
}

export interface CategoryAttributeView {
  id: string;
  key: string;
  label: string;
  dataType: "text" | "number" | "boolean" | "select";
  options: string[] | null;
  isRequired: boolean;
  position: number;
}

export interface CategoryView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  attributes: CategoryAttributeView[];
}

export interface ProductVariantView {
  id: string;
  sku: string;
  title: string;
  size: string | null;
  colour: string | null;
  material: string | null;
  position: number;
}

export interface ProductMediaView {
  id: string;
  kind: "image" | "reference";
  url: string;
  altText: string | null;
  position: number;
}

export interface ProductAttributeValueView {
  attributeId: string;
  key: string;
  label: string;
  value: string;
}

export interface ProductSummaryView {
  id: string;
  slug: string;
  title: string;
  status: ProductStatus;
  pendingChanges: boolean;
  approvedRevisionId: string | null;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  variantCount: number;
  mediaCount: number;
  purchasable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRevisionView {
  id: string;
  revisionNumber: number;
  decision: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  snapshot?: unknown;
}

export interface AuditEventView {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  fromState: string | null;
  toState: string | null;
  detail: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
}

export interface ProductDetailView extends ProductSummaryView {
  summary: string | null;
  description: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  archivedAt: string | null;
  seller: { id: string; displayName: string; status: SellerStatus } | null;
  variants: ProductVariantView[];
  media: ProductMediaView[];
  attributes: ProductAttributeValueView[];
  revisions: ProductRevisionView[];
  audit: AuditEventView[];
  permissions: { canEdit: boolean; canSubmit: boolean; canArchive: boolean };
}

/**
 * The single purchasability predicate used by the UI. The database expresses
 * the same rule in `aura.storefront_products`; agreement is asserted in the
 * database suite. A later commerce phase may only sell rows that satisfy it.
 */
export const isPurchasable = (product: {
  status: string;
  pendingChanges: boolean;
  approvedRevisionId: string | null;
  /** An unapproved seller's catalogue is not sellable, whatever the row says. */
  sellerStatus: string;
}) =>
  product.status === "approved" &&
  product.pendingChanges === false &&
  Boolean(product.approvedRevisionId) &&
  product.sellerStatus === "approved";

/** Whether the working copy may be edited in its current lifecycle state. */
export const isEditable = (status: ProductStatus) =>
  status === "draft" || status === "rejected" || status === "approved";

export const statusLabel = (status: string) =>
  status.charAt(0).toUpperCase() + status.slice(1);
