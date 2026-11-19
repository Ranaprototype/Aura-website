// Only document routes can fall back to the SPA. Never send HTML for a missing asset.
export const isStorefrontPath = (path: string) =>
  /^(?:\/|\/(?:catalog|cart|compare|checkout|order-confirmation|test-supabase|product\/sneaker|account(?:\/[\w-]+)*|(?:products|category|order)\/[\w-]+)\/?)$/.test(
    path
  );
export const isRetiredPath = (path: string) =>
  /^\/(?:__manus__|manus-storage)(?:\/|$)/i.test(path);
