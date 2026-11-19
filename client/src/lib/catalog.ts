export type Product = {
  slug: string;
  name: string;
  category: string;
  categorySlug: string;
  price: number;
  tone: string;
  kind: string;
  index: string;
  description: string;
  details: string[];
};

export type CatalogCategory = {
  name: string;
  slug: string;
  count: string;
  tone: string;
  kind: string;
  tag: string;
  products: Product[];
};

const product = (data: Product): Product => data;

export const products: Product[] = [
  product({
    slug: "aether-runner-01",
    name: "Aether Runner 01",
    category: "Sneakers",
    categorySlug: "sneakers",
    price: 280,
    tone: "cyan",
    kind: "shoe",
    index: "01 / 02",
    description:
      "A responsive daily silhouette engineered for the pace of tomorrow.",
    details: [
      "Recycled knit upper",
      "Lightweight carbon sole",
      "Designed in light",
    ],
  }),
  product({
    slug: "aether-runner-02",
    name: "Aether Runner 02",
    category: "Sneakers",
    categorySlug: "sneakers",
    price: 340,
    tone: "violet",
    kind: "shoe",
    index: "02 / 02",
    description:
      "A sharper expression of motion with a sculpted holographic finish.",
    details: [
      "Adaptive mesh construction",
      "Reactive foam platform",
      "Limited 2026 edition",
    ],
  }),
  product({
    slug: "lumen-phone-x",
    name: "Lumen Phone X",
    category: "Smartphones",
    categorySlug: "smartphones",
    price: 1190,
    tone: "violet",
    kind: "phone",
    index: "01 / 02",
    description:
      "A quiet, powerful interface between you and the world around you.",
    details: [
      "Titanium light-frame",
      "Pro-grade optical array",
      "72-hour luminous battery",
    ],
  }),
  product({
    slug: "lumen-phone-air",
    name: "Lumen Phone Air",
    category: "Smartphones",
    categorySlug: "smartphones",
    price: 890,
    tone: "blue",
    kind: "phone",
    index: "02 / 02",
    description: "Everything essential, reduced to its most elegant form.",
    details: [
      "Recycled glass body",
      "Edge-to-edge light display",
      "All-day adaptive battery",
    ],
  }),
  product({
    slug: "orbit-studio-16",
    name: "Orbit Studio 16",
    category: "Laptops",
    categorySlug: "laptops",
    price: 2490,
    tone: "gold",
    kind: "laptop",
    index: "01 / 02",
    description:
      "A cinematic workspace for building worlds at the speed of thought.",
    details: [
      "16-inch high-density display",
      "Pro neural engine",
      "Machined aluminum chassis",
    ],
  }),
  product({
    slug: "orbit-field-13",
    name: "Orbit Field 13",
    category: "Laptops",
    categorySlug: "laptops",
    price: 1690,
    tone: "cyan",
    kind: "laptop",
    index: "02 / 02",
    description: "Portable power with the restraint of a gallery object.",
    details: [
      "13-inch studio display",
      "18-hour field battery",
      "Silent thermal architecture",
    ],
  }),
  product({
    slug: "sonic-halo-pro",
    name: "Sonic Halo Pro",
    category: "Headphones",
    categorySlug: "headphones",
    price: 420,
    tone: "pink",
    kind: "headphones",
    index: "01 / 02",
    description:
      "An immersive listening field shaped around your own frequency.",
    details: [
      "Spatial audio engine",
      "Adaptive noise cancellation",
      "Memory foam cloud pads",
    ],
  }),
  product({
    slug: "sonic-halo-mini",
    name: "Sonic Halo Mini",
    category: "Headphones",
    categorySlug: "headphones",
    price: 220,
    tone: "violet",
    kind: "headphones",
    index: "02 / 02",
    description: "Small footprint. Wide atmosphere. A personal room for sound.",
    details: [
      "Pocket spatial audio",
      "24-hour battery",
      "Recycled polymer shell",
    ],
  }),
  product({
    slug: "chrono-vector-01",
    name: "Chrono Vector 01",
    category: "Watches",
    categorySlug: "watches",
    price: 560,
    tone: "blue",
    kind: "watch",
    index: "01 / 02",
    description: "Time, reduced to a luminous gesture on the wrist.",
    details: [
      "Sapphire crystal lens",
      "Ceramic light-body",
      "Precision kinetic movement",
    ],
  }),
  product({
    slug: "chrono-vector-02",
    name: "Chrono Vector 02",
    category: "Watches",
    categorySlug: "watches",
    price: 740,
    tone: "gold",
    kind: "watch",
    index: "02 / 02",
    description: "A warmer take on the future of personal timekeeping.",
    details: [
      "Brushed champagne alloy",
      "Dual timezone display",
      "Water resistant to 100m",
    ],
  }),
  product({
    slug: "prism-frame-01",
    name: "Prism Frame 01",
    category: "Eyewear",
    categorySlug: "eyewear",
    price: 260,
    tone: "lime",
    kind: "glasses",
    index: "01 / 02",
    description:
      "Optical clarity with an architectural frame for open horizons.",
    details: [
      "Polarized prism lenses",
      "Ultralight titanium bridge",
      "Hand-finished acetate arms",
    ],
  }),
  product({
    slug: "prism-frame-02",
    name: "Prism Frame 02",
    category: "Eyewear",
    categorySlug: "eyewear",
    price: 310,
    tone: "cyan",
    kind: "glasses",
    index: "02 / 02",
    description: "A bolder lens for seeing the familiar at a different angle.",
    details: [
      "Anti-glare optical lenses",
      "Flexible memory alloy",
      "UV400 protection",
    ],
  }),
  product({
    slug: "arc-throne",
    name: "Arc Throne",
    category: "Gaming Chairs",
    categorySlug: "gaming-chairs",
    price: 980,
    tone: "orange",
    kind: "chair",
    index: "01 / 02",
    description: "Ergonomics designed like a cockpit, finished like sculpture.",
    details: [
      "Adaptive lumbar system",
      "Recycled performance textile",
      "Aluminum kinetic base",
    ],
  }),
  product({
    slug: "arc-throne-lite",
    name: "Arc Throne Lite",
    category: "Gaming Chairs",
    categorySlug: "gaming-chairs",
    price: 720,
    tone: "violet",
    kind: "chair",
    index: "02 / 02",
    description: "A lighter landing point for long sessions and larger ideas.",
    details: [
      "Breathable mesh shell",
      "Four-axis arm support",
      "Quiet glide casters",
    ],
  }),
  product({
    slug: "afterlight-no-01",
    name: "Afterlight No. 01",
    category: "Perfume",
    categorySlug: "perfume",
    price: 180,
    tone: "rose",
    kind: "bottle",
    index: "01 / 02",
    description: "Violet smoke, mineral air, and the trace of warm skin.",
    details: [
      "Eau de parfum · 50ml",
      "Violet leaf and iris",
      "Vegan and cruelty-free",
    ],
  }),
  product({
    slug: "afterlight-no-02",
    name: "Afterlight No. 02",
    category: "Perfume",
    categorySlug: "perfume",
    price: 180,
    tone: "gold",
    kind: "bottle",
    index: "02 / 02",
    description: "Amber light caught in a glass room after midnight.",
    details: [
      "Eau de parfum · 50ml",
      "Saffron and pale woods",
      "Vegan and cruelty-free",
    ],
  }),
];

export const categories: CatalogCategory[] = [
  {
    name: "Sneakers",
    slug: "sneakers",
    count: "02 ITEMS",
    tone: "cyan",
    kind: "shoe",
    tag: "01 / 08",
    products: products.slice(0, 2),
  },
  {
    name: "Smartphones",
    slug: "smartphones",
    count: "02 ITEMS",
    tone: "violet",
    kind: "phone",
    tag: "02 / 08",
    products: products.slice(2, 4),
  },
  {
    name: "Laptops",
    slug: "laptops",
    count: "02 ITEMS",
    tone: "gold",
    kind: "laptop",
    tag: "03 / 08",
    products: products.slice(4, 6),
  },
  {
    name: "Headphones",
    slug: "headphones",
    count: "02 ITEMS",
    tone: "pink",
    kind: "headphones",
    tag: "04 / 08",
    products: products.slice(6, 8),
  },
  {
    name: "Watches",
    slug: "watches",
    count: "02 ITEMS",
    tone: "blue",
    kind: "watch",
    tag: "05 / 08",
    products: products.slice(8, 10),
  },
  {
    name: "Eyewear",
    slug: "eyewear",
    count: "02 ITEMS",
    tone: "lime",
    kind: "glasses",
    tag: "06 / 08",
    products: products.slice(10, 12),
  },
  {
    name: "Gaming Chairs",
    slug: "gaming-chairs",
    count: "02 ITEMS",
    tone: "orange",
    kind: "chair",
    tag: "07 / 08",
    products: products.slice(12, 14),
  },
  {
    name: "Perfume",
    slug: "perfume",
    count: "02 ITEMS",
    tone: "rose",
    kind: "bottle",
    tag: "08 / 08",
    products: products.slice(14, 16),
  },
];

export const getProduct = (slug: string) =>
  products.find(item => item.slug === slug);
export const getCategory = (slug: string) =>
  categories.find(item => item.slug === slug);
export const formatPrice = (price: number) =>
  `$${price.toLocaleString("en-US")}`;

export type ProductPartConfig = {
  id: string;
  label: string;
  price: number;
  materials: { id: string; label: string; price: number }[];
  colors: string[];
  defaultColor: string;
  defaultMaterial: string;
};
export type ProductConfig = Product & {
  id: string;
  brand: string;
  tagline: string;
  model: string;
  holoColor: string;
  sizes: string[];
  sizePrice: number;
  story: string;
  specs: { label: string; value: string }[];
  parts: ProductPartConfig[];
  gallery: string[];
};

const brandFor = (category: string) =>
  ["Smartphones", "Laptops", "Headphones"].includes(category)
    ? "HOLO Systems"
    : ["Watches", "Perfume"].includes(category)
      ? "HOLO Atelier"
      : category === "Gaming Chairs"
        ? "HOLO Works"
        : "HOLO Originals";
const taglineFor = (category: string) =>
  (
    ({
      Sneakers: "Engineered for the future of motion.",
      Smartphones: "A quieter interface for a louder world.",
      Laptops: "Power shaped into its most elegant form.",
      Headphones: "A private room for every frequency.",
      Watches: "Time, rendered as a luminous gesture.",
      Eyewear: "See the familiar from a new angle.",
      "Gaming Chairs": "Ergonomics designed like sculpture.",
      Perfume: "A trace of light, held in the air.",
    }) as Record<string, string>
  )[category];
const colorsFor = (tone: string) =>
  (
    ({
      cyan: ["#f4f4f5", "#0b1220", "#00eaff"],
      violet: ["#f4f4f5", "#111111", "#a855f7"],
      gold: ["#f4f4f5", "#111111", "#ffb347"],
      pink: ["#f4f4f5", "#111111", "#ff91ca"],
      blue: ["#f4f4f5", "#0b1220", "#3b82f6"],
      lime: ["#f4f4f5", "#111111", "#d2ff8b"],
      orange: ["#f4f4f5", "#111111", "#ff9d57"],
      rose: ["#f4f4f5", "#111111", "#ff7d8c"],
    }) as Record<string, string[]>
  )[tone] || ["#f4f4f5", "#111111", "#00eaff"];
export const productHref = (product: Product) =>
  product.slug === "aether-runner-01"
    ? "/product/sneaker"
    : `/products/${product.slug}`;
export const getProductConfig = (product: Product): ProductConfig => ({
  ...product,
  id: product.slug,
  brand: brandFor(product.category),
  tagline: taglineFor(product.category),
  model: `/models/${product.slug}.glb`,
  holoColor: `var(--${product.tone})`,
  sizes: ["6", "7", "8", "9", "10", "11", "12"],
  sizePrice: 0,
  story: `${product.description} ${product.details.join(". ")}. Every surface is considered as part of a larger language of personal objects — designed to be lived with, not simply displayed.`,
  specs: [
    { label: "Material", value: product.details[0] },
    { label: "Origin", value: "Designed in light" },
    { label: "Collection", value: "Design preview" },
    { label: "Ordering", value: "Unavailable" },
  ],
  parts: [
    {
      id: "body",
      label: product.category === "Perfume" ? "Bottle" : "Body",
      price: 0,
      materials: [
        { id: "signature", label: "Signature", price: 0 },
        { id: "studio", label: "Studio", price: 15 },
      ],
      colors: colorsFor(product.tone),
      defaultColor: colorsFor(product.tone)[0],
      defaultMaterial: "signature",
    },
    {
      id: "accent",
      label: "Accent",
      price: 0,
      materials: [
        { id: "standard", label: "Standard", price: 0 },
        { id: "premium", label: "Premium", price: 20 },
      ],
      colors: colorsFor(product.tone),
      defaultColor: colorsFor(product.tone)[2],
      defaultMaterial: "standard",
    },
  ],
  gallery: [product.tone, product.tone, product.tone],
});
export const productConfigs = products.map(getProductConfig);
export const getProductConfigBySlug = (slug: string) =>
  productConfigs.find(item => item.slug === slug);
export const toggleWishlist = (slug: string) => {
  const current = JSON.parse(
    localStorage.getItem("holo-wishlist") || "[]"
  ) as string[];
  const next = current.includes(slug)
    ? current.filter(item => item !== slug)
    : [...current, slug];
  localStorage.setItem("holo-wishlist", JSON.stringify(next));
  return next;
};
export const getWishlist = () =>
  JSON.parse(localStorage.getItem("holo-wishlist") || "[]") as string[];
export const rememberProduct = (slug: string) => {
  const current = JSON.parse(
    localStorage.getItem("holo-recent") || "[]"
  ) as string[];
  const next = [slug, ...current.filter(item => item !== slug)].slice(0, 6);
  localStorage.setItem("holo-recent", JSON.stringify(next));
};
export const getRecentProducts = () => {
  const ids = JSON.parse(
    localStorage.getItem("holo-recent") || "[]"
  ) as string[];
  return ids
    .map(id => products.find(item => item.slug === id))
    .filter(Boolean) as Product[];
};
