import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Heart,
  PackageCheck,
  RotateCcw,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import {
  getProductConfigBySlug,
  getRecentProducts,
  getWishlist,
  productHref,
  products,
  toggleWishlist,
  type ProductConfig,
  rememberProduct,
} from "../lib/catalog";
import { addToCart } from "../lib/cart";
import {
  CategoryBackdrop,
  CuratedForYou,
  ProductKeyboardHint,
} from "../components/Phase6ProductExtras";

function ObjectPreview({
  product,
  color,
  accent,
}: {
  product: ProductConfig;
  color: string;
  accent: string;
}) {
  return (
    <div className={`generic-preview generic-preview--${product.kind}`}>
      <div className="generic-orbit generic-orbit--one" />
      <div className="generic-orbit generic-orbit--two" />
      <div
        className={`generic-object generic-object--${product.kind}`}
        style={{
          background: `linear-gradient(135deg, #f4f4f5, ${color})`,
          boxShadow: `0 0 75px ${color}66`,
        }}
      >
        <i style={{ background: accent }} />
      </div>
      <span className="preview-signal">
        <b /> LIVE OBJECT / {product.index}
      </span>
    </div>
  );
}
export default function GenericConfigurator({ slug }: { slug: string }) {
  const product = getProductConfigBySlug(slug);
  const [color, setColor] = useState(
    product?.parts[0].defaultColor || "#00eaff"
  );
  const [accent, setAccent] = useState(
    product?.parts[1].defaultColor || "#a855f7"
  );
  const [material, setMaterial] = useState(
    product?.parts[0].defaultMaterial || "signature"
  );
  const [size, setSize] = useState("9");
  const [wishlisted, setWishlisted] = useState(() =>
    product ? getWishlist().includes(product.slug) : false
  );
  const [added, setAdded] = useState(false);
  if (!product)
    return (
      <div className="object-not-found">
        <span>OBJECT NOT FOUND</span>
        <a href="/catalog">Return to catalog</a>
      </div>
    );
  const total = useMemo(
    () => product.price + (material === "studio" ? 15 : 0),
    [product.price, material]
  );
  const share = () => {
    const params = new URLSearchParams({ color, accent, material, size });
    navigator.clipboard?.writeText(
      `${window.location.origin}${productHref(product)}?${params}`
    );
  };
  const related = products
    .filter(
      item =>
        item.categorySlug === product.categorySlug && item.slug !== product.slug
    )
    .slice(0, 2);
  const recent = getRecentProducts().filter(item => item.slug !== product.slug);
  return (
    <div className="generic-configurator">
      <CategoryBackdrop category={product.category} />
      <ProductKeyboardHint />
      <a className="skip-link" href="#generic-content">
        Skip to content
      </a>
      <header className="generic-topbar">
        <a href="/catalog">
          <ArrowLeft size={16} /> Back
        </a>
        <div>
          <strong>{product.name}</strong>
          <small>
            {product.brand} / {product.category}
          </small>
        </div>
        <span>
          ${total.toLocaleString()}.00{" "}
          <button
            className="generic-heart"
            aria-label="Toggle wishlist"
            onClick={() => {
              toggleWishlist(product.slug);
              setWishlisted(value => !value);
            }}
          >
            <Heart size={16} fill={wishlisted ? "currentColor" : "none"} />
          </button>
          <a href="/cart" aria-label="Open cart">
            <ShoppingBag size={16} />
          </a>
        </span>
      </header>
      <main id="generic-content" className="generic-main" tabIndex={-1}>
        <aside className="generic-side">
          <span className="mono-label">CONFIGURE / {product.index}</span>
          <h1>{product.name}</h1>
          <p>{product.tagline}</p>
          <div className="generic-part">
            <span>01 / {product.parts[0].label}</span>
            <div className="generic-swatches">
              {product.parts[0].colors.map(item => (
                <button
                  key={item}
                  className={color === item ? "active" : ""}
                  style={{ background: item }}
                  onClick={() => setColor(item)}
                />
              ))}
            </div>
            <div className="generic-materials">
              {product.parts[0].materials.map(item => (
                <button
                  key={item.id}
                  className={material === item.id ? "active" : ""}
                  onClick={() => setMaterial(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="generic-part">
            <span>02 / {product.parts[1].label}</span>
            <div className="generic-swatches">
              {product.parts[1].colors.map(item => (
                <button
                  key={item}
                  className={accent === item ? "active" : ""}
                  style={{ background: item }}
                  onClick={() => setAccent(item)}
                />
              ))}
            </div>
          </div>
          <button
            className="generic-reset"
            onClick={() => {
              setColor(product.parts[0].defaultColor);
              setAccent(product.parts[1].defaultColor);
              setMaterial(product.parts[0].defaultMaterial);
            }}
          >
            <RotateCcw size={14} /> Reset configuration
          </button>
        </aside>
        <section className="generic-stage">
          <ObjectPreview product={product} color={color} accent={accent} />
          <div className="generic-stage-label">
            <span>DRAG TO ROTATE</span>
            <span>GRID / 04 · 23 · 11</span>
          </div>
        </section>
        <aside className="generic-summary">
          <span className="mono-label">{product.brand} / LIVE BUILD</span>
          <div className="generic-price">
            <small>LIVE PRICE</small>
            <strong>${total.toLocaleString()}.00</strong>
            <span>USD · CONFIGURATION SYNCED</span>
          </div>
          <div className="generic-size">
            <span className="mono-label">SELECT SIZE</span>
            <div>
              {product.sizes.map(item => (
                <button
                  className={size === item ? "active" : ""}
                  key={item}
                  onClick={() => setSize(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="generic-breakdown">
            <span>
              Base <b>${product.price.toLocaleString()}.00</b>
            </span>
            <span>
              {material} <b>+${material === "studio" ? "15.00" : "0.00"}</b>
            </span>
            <span>
              Total <b>${total.toLocaleString()}.00</b>
            </span>
          </div>
          <button
            className={`button button--primary ${added ? "is-added" : ""}`}
            onClick={() => {
              localStorage.setItem(
                `holo-build-${product.slug}`,
                JSON.stringify({ color, accent, material, size })
              );
              addToCart(product, {
                price: total,
                size,
                configuration: `${material} · ${color}`,
              });
              setAdded(true);
              rememberProduct(product.slug);
            }}
          >
            {added ? <Check size={16} /> : <ShoppingBag size={16} />}{" "}
            {added ? "Added to Collection" : "Add to Collection"}
          </button>
          <button className="button button--ghost" onClick={share}>
            <Copy size={15} /> Share build
          </button>
          <p className="generic-note">
            <PackageCheck size={13} /> Ships worldwide · 30-day returns
          </p>
        </aside>
      </main>
      <section className="product-editorial">
        <div className="editorial-story">
          <span className="mono-label">THE STORY / {product.index}</span>
          <h2>
            Designed in light.
            <br />
            <em>Made to stay.</em>
          </h2>
          <div>
            <p>{product.story}</p>
            <p>
              HOLO objects are designed as quiet signals: considered
              proportions, precise materials, and a luminous edge that rewards a
              closer look. This configuration remains yours, saved locally for
              the next time you return.
            </p>
          </div>
        </div>
        <div className="editorial-specs">
          <span className="mono-label">OBJECT SPECIFICATION</span>
          {product.specs.map(spec => (
            <div key={spec.label}>
              <span>{spec.label}</span>
              <strong>{spec.value}</strong>
            </div>
          ))}
        </div>
        <div className="editorial-gallery">
          <span className="mono-label">MATERIAL STUDY / 03</span>
          <div>
            <i
              style={{ background: `linear-gradient(135deg,#fff,${color})` }}
            />
            <i
              style={{
                background: `linear-gradient(135deg,${color},${accent})`,
              }}
            />
            <i
              style={{ background: `linear-gradient(135deg,${accent},#fff)` }}
            />
          </div>
        </div>
        <div className="editorial-reviews">
          <span className="mono-label">FIELD NOTES / VERIFIED</span>
          <blockquote>
            “The object feels familiar for one second, then the details keep
            unfolding.”<cite>— A. Mercer · Verified owner</cite>
          </blockquote>
          <blockquote>
            “A beautifully calm interface around a surprisingly expressive
            product.”<cite>— N. Rao · Verified owner</cite>
          </blockquote>
          <blockquote>
            “The finish catches the room without asking for attention.”
            <cite>— J. Vale · Verified owner</cite>
          </blockquote>
        </div>
        {related.length > 0 && (
          <div className="editorial-related">
            <span className="mono-label">
              MORE FROM {product.category.toUpperCase()}
            </span>
            <div>
              {related.map(item => (
                <a href={productHref(item)} key={item.slug}>
                  <strong>{item.name}</strong>
                  <span>${item.price.toLocaleString()}</span>
                </a>
              ))}
            </div>
          </div>
        )}
        {recent.length > 0 && (
          <div className="editorial-related">
            <span className="mono-label">
              RECENTLY VIEWED / {recent.length.toString().padStart(2, "0")}
            </span>
            <div>
              {recent.map(item => (
                <a href={productHref(item)} key={item.slug}>
                  <strong>{item.name}</strong>
                  <span>${item.price.toLocaleString()}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </section>
      <CuratedForYou product={product as any} />
      <footer className="generic-bottom">
        <span>
          <Sparkles size={14} /> HOLO OBJECT / {product.category.toUpperCase()}
        </span>
        <span>
          <Heart size={14} /> CONFIGURATION SAVED LOCALLY
        </span>
      </footer>
    </div>
  );
}
