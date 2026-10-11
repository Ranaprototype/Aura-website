import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ShoppingBag, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { categories, formatPrice, type Product } from "../lib/catalog";
import { addToCart } from "../lib/cart";

type Props = { product: Product };

function ProductVisual({ product }: { product: Product }) {
  return (
    <div className={`detail-visual detail-visual--${product.kind} detail-visual--${product.tone}`} aria-label={`${product.name} product visualization`}>
      <div className="detail-visual__grid" />
      <div className="detail-visual__orbit detail-visual__orbit--one" />
      <div className="detail-visual__orbit detail-visual__orbit--two" />
      <div className="detail-visual__object" />
      <div className="detail-visual__scan" />
      <span className="detail-visual__label">HOLO OBJECT / {product.index}</span>
    </div>
  );
}

export default function ProductPage({ product }: Props) { const [added, setAdded] = useState(false);
  const related = categories.find((category) => category.slug === product.categorySlug)?.products.filter((item) => item.slug !== product.slug) ?? [];
  const goHome = () => { window.history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate")); };
  return (
    <div className="product-page holo-app">
      <header className="product-header">
        <button className="wordmark product-header__logo" onClick={goHome} aria-label="Back to HOLO home">HOLO</button>
        <div className="product-header__right"><span>PRODUCT / {product.index}</span><button className="product-back" onClick={goHome}><ArrowLeft size={14} /> Back to catalog</button></div>
      </header>
      <main>
        <div className="product-breadcrumb page-shell"><span>HOLO</span><b>/</b><span>{product.category}</span><b>/</b><strong>{product.name}</strong></div>
        <section className="product-detail page-shell">
          <motion.div className="product-detail__visual" initial={{ opacity: 0, x: -22 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .65 }}><ProductVisual product={product} /></motion.div>
          <motion.div className="product-detail__copy" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, delay: .1 }}>
            <span className="mono-label">{product.category} / {product.index}</span>
            <h1>{product.name}</h1>
            <div className="product-price">{formatPrice(product.price)} <span>USD</span></div>
            <p className="product-description">{product.description}</p>
            <div className="product-actions"><button className={`button button--primary ${added ? "is-added" : ""}`} onClick={() => { addToCart(product); setAdded(true); }}><ShoppingBag size={15} /> {added ? "Added to cart" : "Add to cart"}</button><button className="button button--ghost" onClick={() => {}}>Customize <ArrowRight size={15} /></button></div>
            <div className="product-note"><Sparkles size={14} /> Open the live hologram configurator to customize this object.</div>
            <div className="product-details"><span className="mono-label">OBJECT SPECIFICATION</span>{product.details.map((detail) => <div key={detail}><Check size={14} />{detail}</div>)}</div>
          </motion.div>
        </section>
        <section className="related-section page-shell"><div className="related-heading"><div><span className="mono-label">CONTINUE EXPLORING</span><h2>More from {product.category}</h2></div><button className="text-link" onClick={goHome}>View all objects <ArrowRight size={15} /></button></div><div className="related-grid">{related.map((item) => <button key={item.slug} className="related-card" onClick={() => { window.history.pushState({}, "", `/products/${item.slug}`); window.dispatchEvent(new PopStateEvent("popstate")); }}><div className={`related-card__visual related-card__visual--${item.tone}`}><span>{item.index}</span><div /></div><div><strong>{item.name}</strong><span>{formatPrice(item.price)}</span></div></button>)}</div></section>
      </main>
      <footer className="product-footer page-shell"><span className="wordmark">HOLO</span><span>© 2026 HOLO OBJECTS / DESIGNED IN LIGHT</span></footer>
    </div>
  );
}
