/**
 * Typed same-origin client for the Phase 3 marketplace API.
 *
 * Every call carries the selected organization as a *hint*; the server resolves
 * the membership from the verified session and never trusts this header for
 * identity. No token or role is ever read from browser storage.
 */
import { api, type ApiResult } from "./api";
import type {
  AuditEventView,
  CategoryView,
  ProductDetailView,
  ProductSummaryView,
  SellerProfileView,
} from "@shared/marketplace";

export interface SellerDashboard {
  organization: { id: string; name: string };
  role: string;
  seller: SellerProfileView | null;
  productCounts: Record<
    "draft" | "submitted" | "approved" | "rejected" | "archived",
    number
  >;
  recentSellerActivity: AuditEventView[];
  permissions: { canManage: boolean; canWriteCatalogue: boolean };
}

export interface SellerProfileResponse {
  seller: SellerProfileView | null;
  audit: AuditEventView[];
}

export interface SellerInput {
  displayName: string;
  legalName: string;
  businessEmail: string;
  country: string;
  website?: string | null;
  description?: string | null;
}

export interface ProductInput {
  title: string;
  categoryId: string;
  summary?: string | null;
  description?: string | null;
}

export interface VariantInput {
  sku: string;
  title: string;
  size?: string | null;
  colour?: string | null;
  material?: string | null;
}

export interface MediaInput {
  kind?: "image" | "reference";
  url: string;
  altText?: string | null;
}

export interface AdminSeller extends SellerProfileView {
  orgName: string;
}

export interface AdminProduct extends ProductSummaryView {
  orgName: string;
  summary?: string | null;
  description?: string | null;
  submittedAt?: string | null;
  seller?: { id: string; displayName: string; status: string };
  variants?: Array<{
    id: string;
    sku: string;
    title: string;
    size: string | null;
    colour: string | null;
    material: string | null;
  }>;
  media?: Array<{ id: string; url: string; altText: string | null }>;
  attributes?: Array<{ key: string; label: string; value: string }>;
  revisions?: Array<{
    id: string;
    revisionNumber: number;
    decision: string;
    submittedAt: string;
    reviewedAt: string | null;
    reviewNote: string | null;
    snapshot?: unknown;
  }>;
  audit?: AuditEventView[];
  pendingRevision?: { id: string; revision_number: number } | null;
}

const q = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const marketplace = {
  dashboard: (org: string) =>
    api<SellerDashboard>("/seller/dashboard", { org }),
  profile: (org: string) =>
    api<SellerProfileResponse>("/seller/profile", { org }),
  saveProfile: (org: string, body: SellerInput) =>
    api<SellerProfileResponse>("/seller/profile", { method: "PUT", body, org }),
  submitProfile: (org: string) =>
    api<{ seller: SellerProfileView }>("/seller/profile/submit", {
      method: "POST",
      body: {},
      org,
    }),
  categories: (org?: string) =>
    api<{ categories: CategoryView[] }>("/categories", { org }),

  products: (org: string, status?: string) =>
    api<{ products: ProductSummaryView[] }>(
      `/seller/products${q({ status })}`,
      { org }
    ),
  product: (org: string, id: string) =>
    api<{ product: ProductDetailView }>(`/seller/products/${id}`, { org }),
  createProduct: (org: string, body: ProductInput) =>
    api<{ product: ProductSummaryView }>("/seller/products", {
      method: "POST",
      body,
      org,
    }),
  updateProduct: (org: string, id: string, body: Partial<ProductInput>) =>
    api<{ product: ProductSummaryView }>(`/seller/products/${id}`, {
      method: "PATCH",
      body,
      org,
    }),
  submitProduct: (org: string, id: string) =>
    api<{
      product: ProductSummaryView;
      revision: { id: string; revision_number: number };
    }>(`/seller/products/${id}/submit`, { method: "POST", body: {}, org }),
  archiveProduct: (org: string, id: string) =>
    api<{ product: ProductSummaryView }>(`/seller/products/${id}/archive`, {
      method: "POST",
      body: {},
      org,
    }),
  addVariant: (org: string, id: string, body: VariantInput) =>
    api(`/seller/products/${id}/variants`, { method: "POST", body, org }),
  deleteVariant: (org: string, id: string, variantId: string) =>
    api(`/seller/products/${id}/variants/${variantId}`, {
      method: "DELETE",
      org,
    }),
  addMedia: (org: string, id: string, body: MediaInput) =>
    api(`/seller/products/${id}/media`, { method: "POST", body, org }),
  deleteMedia: (org: string, id: string, mediaId: string) =>
    api(`/seller/products/${id}/media/${mediaId}`, { method: "DELETE", org }),
  setAttributes: (
    org: string,
    id: string,
    values: Array<{ attributeId: string; value: string }>
  ) =>
    api(`/seller/products/${id}/attributes`, {
      method: "PUT",
      body: { values },
      org,
    }),

  adminSellers: (status: string) =>
    api<{ sellers: AdminSeller[] }>(`/admin/sellers${q({ status })}`),
  adminSeller: (orgId: string) =>
    api<{
      organization: { id: string; name: string };
      seller: SellerProfileView;
      products: ProductSummaryView[];
    }>(`/admin/sellers/${orgId}`),
  approveSeller: (orgId: string) =>
    api<{ seller: SellerProfileView }>(`/admin/sellers/${orgId}/approve`, {
      method: "POST",
      body: {},
    }),
  rejectSeller: (orgId: string, note: string) =>
    api<{ seller: SellerProfileView }>(`/admin/sellers/${orgId}/reject`, {
      method: "POST",
      body: { note },
    }),
  suspendSeller: (orgId: string, note: string) =>
    api<{ seller: SellerProfileView }>(`/admin/sellers/${orgId}/suspend`, {
      method: "POST",
      body: { note },
    }),
  restoreSeller: (orgId: string) =>
    api<{ seller: SellerProfileView }>(`/admin/sellers/${orgId}/restore`, {
      method: "POST",
      body: {},
    }),
  adminProducts: (status: string) =>
    api<{ products: AdminProduct[] }>(`/admin/products${q({ status })}`),
  adminProduct: (id: string) =>
    api<{ product: AdminProduct }>(`/admin/products/${id}`),
  approveProduct: (id: string, note?: string) =>
    api<{ product: AdminProduct }>(`/admin/products/${id}/approve`, {
      method: "POST",
      body: note ? { note } : {},
    }),
  rejectProduct: (id: string, note: string) =>
    api<{ product: AdminProduct }>(`/admin/products/${id}/reject`, {
      method: "POST",
      body: { note },
    }),
};

/** Human-readable copy for the API error codes this phase can return. */
export const explain = (
  result: Pick<ApiResult<unknown>, "error">,
  fallback: string
) => {
  switch (result.error) {
    case "seller_not_approved":
      return "Your seller application must be approved before you can use the catalogue.";
    case "seller_profile_required":
      return "Create and submit a seller profile first.";
    case "seller_locked":
      return "Your seller profile is under review and cannot be changed.";
    case "seller_already_submitted":
      return "Your seller profile is already awaiting review.";
    case "seller_already_approved":
      return "Your seller profile is already approved.";
    case "product_locked":
      return "This product is under review and cannot be changed.";
    case "product_archived":
      return "This product is archived and read-only.";
    case "product_incomplete":
      return "Add at least one variant and every required attribute before submitting.";
    case "product_already_submitted":
      return "This product is already awaiting review.";
    case "product_slug_exists":
      return "That product address is already used in your catalogue.";
    case "sku_exists":
      return "That SKU already exists in your catalogue.";
    case "invalid_attribute_value":
      return "That attribute value is not one of the allowed options.";
    case "attribute_not_in_category":
      return "That attribute does not belong to the selected category.";
    case "invalid_media_url":
      return "Image references must be https URLs to an image file.";
    case "invalid_status_transition":
      return "That lifecycle transition is not allowed.";
    case "role_forbidden":
      return "Your organization role does not permit that action.";
    case "organization_forbidden":
      return "Your account is not a member of that organization.";
    case "email_unverified":
      return "Confirm your email address before using the seller tools.";
    case "invalid_request":
      return "Please check the values you entered.";
    case "review_separation_required":
      return "A reviewer who belongs to that organization cannot decide it (four-eyes).";
    case "suspension_note_required":
      return "A confidential suspension note is required.";
    case "seller_already_suspended":
      return "That seller is already suspended.";
    case "seller_not_suspended":
      return "That seller is not currently suspended.";
    case "seller_suspended":
      return "This seller is suspended; catalogue writes are frozen until restore.";
    case "suspension_must_be_atomic":
      return "A suspension decision cannot be combined with other changes.";
    default:
      return fallback;
  }
};
