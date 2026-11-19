import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { CompareEntry } from "../components/Phase6ProductExtras";
import { AmbientCanvas } from "./Home";
import {
  categories,
  formatPrice,
  getRecentProducts,
  getWishlist,
  productHref,
  rememberProduct,
  toggleWishlist,
  type CatalogCategory,
  type Product,
} from "../lib/catalog";

function Visual({ category }: { category: CatalogCategory }) {
  return (
    <div className={`category-visual category-visual--${category.tone}`}>
      <div className={`category-shape category-shape--${category.kind}`} />
      <span>{category.tag}</span>
    </div>
  );
}
function CategoryQuickView({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  return (
    <div className="quick-backdrop" onClick={onClose}>
      <section
        className="quick-view category-quick-view"
        onClick={e => e.stopPropagation()}
      >
        <button
          className="quick-close"
          onClick={onClose}
          aria-label="Close quick view"
        >
          <X size={18} />
        </button>
        <Visual
          category={
            categories.find(item => item.slug === product.categorySlug) ||
            categoryFallback
          }
        />
        <div className="quick-copy">
          <span className="mono-label">
            {product.category} / {product.index}
          </span>
          <h2>{product.name}</h2>
          <p>{product.description}</p>
          <strong>{formatPrice(product.price)}</strong>
          <div className="quick-actions">
            <a className="button button--primary" href={productHref(product)}>
              View details <ArrowRight size={15} />
            </a>
            <button
              className="button button--ghost"
              onClick={() =>
                localStorage.setItem("holo-quick-add", product.slug)
              }
            >
              <Plus size={15} /> Quick add
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
const categoryFallback = {
  name: "Object",
  slug: "",
  count: "",
  tone: "cyan",
  kind: "shoe",
  tag: "",
  products: [],
} as CatalogCategory;
export default function CategoryPage({
  category,
}: {
  category: CatalogCategory;
}) {
  const [quick, setQuick] = useState<Product | null>(null);
  const [wishlist, setWishlist] = useState(getWishlist());
  const related = categories
    .filter(item => item.slug !== category.slug)
    .slice(0, 3);
  const recent = getRecentProducts();
  return (
    <div className="category-page">
      <AmbientCanvas count={40} />
      <a className="skip-link" href="#category-content">
        Skip to content
      </a>
      <header className="catalog-nav">
        <a className="wordmark" href="/">
          HOLO
        </a>
        <nav>
          <a href="/catalog">Store</a>
          <a href="/#collections">Collections</a>
          <a href="/#about">About</a>
          <a href="/#journal">Journal</a>
        </nav>
        <span className="wishlist-count">
          <Heart size={15} /> {getWishlist().length}
        </span>
        <a className="category-back" href="/catalog">
          <ArrowLeft size={15} /> Catalog
        </a>
      </header>
      <main id="category-content" tabIndex={-1}>
        <section className={`category-hero category-hero--${category.tone}`}>
          <div className="page-shell">
            <span className="mono-label">CATEGORY / {category.tag}</span>
            <h1>{category.name}</h1>
            <p>
              {category.name === "Sneakers"
                ? "Engineered movement, rendered in light."
                : `Two considered forms for a more intentional ${category.name.toLowerCase()} ritual.`}
            </p>
          </div>
        </section>
        <section className="category-products page-shell">
          <div className="category-section-heading">
            <div>
              <span className="mono-label">THE EDIT / 02 OBJECTS</span>
              <h2>
                Choose your <em>form.</em>
              </h2>
            </div>
            <span className="mono-label">{category.count}</span>
          </div>
          <div className="category-product-grid">
            {category.products.map(product => (
              <article key={product.slug} className="category-product-card">
                <a
                  href={productHref(product)}
                  onClick={() => rememberProduct(product.slug)}
                >
                  <Visual category={category} />
                  <div className="category-card-copy">
                    <div>
                      <span className="mono-label">{product.name}</span>
                      <p>{product.description}</p>
                    </div>
                    <strong>{formatPrice(product.price)}</strong>
                  </div>
                </a>
                <button
                  className={`category-heart ${wishlist.includes(product.slug) ? "active" : ""}`}
                  aria-label={`Save ${product.name}`}
                  onClick={() => setWishlist(toggleWishlist(product.slug))}
                >
                  <Heart
                    size={16}
                    fill={
                      wishlist.includes(product.slug) ? "currentColor" : "none"
                    }
                  />
                </button>
                <button
                  className="quick-button category-quick-button"
                  aria-label={`Quick view ${product.name}`}
                  onClick={() => setQuick(product)}
                >
                  <Plus size={16} />
                </button>
              </article>
            ))}
          </div>
        </section>
        <CompareEntry category={category.name} />
        <section className="category-story page-shell">
          <div>
            <span className="mono-label">THE CATEGORY STORY / 001</span>
            <h2>Objects with a point of view.</h2>
          </div>
          <div>
            <p>
              {category.name} are rarely neutral. They shape how we move,
              listen, see, work, and arrive. HOLO treats every surface as a
              decision — a chance to make the everyday feel newly considered.
            </p>
            <p>
              We pair precise materials with a luminous visual language, keeping
              the useful parts quiet and letting the details speak. The result
              is a small collection with a long afterimage.
            </p>
          </div>
        </section>
        <section className="category-features page-shell">
          {[
            { icon: Sparkles, text: "Made in light" },
            { icon: ShieldCheck, text: "Preview collection" },
            { icon: Zap, text: "Designed for motion" },
            { icon: Check, text: "Explore variations" },
          ].map(({ icon: Icon, text }) => (
            <div key={text}>
              <span>
                <Icon size={17} />
              </span>
              <strong>{text}</strong>
            </div>
          ))}
        </section>
        <section className="related-section page-shell">
          <div className="related-heading">
            <div>
              <span className="mono-label">KEEP EXPLORING</span>
              <h2>Adjacent objects.</h2>
            </div>
          </div>
          <div className="related-category-row">
            {related.map(item => (
              <a href={`/category/${item.slug}`} key={item.slug}>
                <Visual category={item} />
                <span>{item.name}</span>
                <ArrowRight size={14} />
              </a>
            ))}
          </div>
        </section>
        {recent.length > 0 && (
          <section className="recent-section page-shell">
            <span className="mono-label">
              RECENTLY VIEWED / {recent.length.toString().padStart(2, "0")}
            </span>
            <div>
              {recent.map(product => (
                <a href={productHref(product)} key={product.slug}>
                  {product.name}
                  <strong>{formatPrice(product.price)}</strong>
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
      {quick && (
        <CategoryQuickView product={quick} onClose={() => setQuick(null)} />
      )}
    </div>
  );
}
