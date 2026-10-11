import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  ChevronDown,
  Command,
  Headphones,
  Laptop,
  Menu,
  MonitorSmartphone,
  MousePointer2,
  ScanLine,
  Search,
  Shirt,
  Sparkles,
  Smartphone,
  Sofa,
  Watch,
  X,
  Zap,
  Rotate3d,
  ZoomIn,
} from "lucide-react";
import { categories, type CatalogCategory } from "../lib/catalog";
import { cartCount } from "../lib/cart";
import { openCart } from "../components/CommerceOverlay";

const navLinks = ["Store", "Collections", "About", "Journal"];

const spring = { duration: 0.75, ease: [0.22, 1, 0.36, 1] as const };
const categoryIcons = {
  Sneakers: Shirt,
  Smartphones: Smartphone,
  Laptops: Laptop,
  Headphones,
  Watches: Watch,
  Eyewear: ScanLine,
  "Gaming Chairs": Sofa,
  Perfume: Sparkles,
};

function Reveal({
  children,
  delay = 0,
  className = "",
  id,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  id?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ ...spring, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function MonoLabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`mono-label ${className}`}>{children}</span>;
}

function HoloMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`holo-mark ${small ? "holo-mark--small" : ""}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </span>
  );
}

function ProductVisual({ kind, tone }: { kind: string; tone: string }) {
  return (
    <div
      className={`product-visual product-visual--${kind} product-visual--${tone}`}
      aria-hidden="true"
    >
      <div className="visual-orbit visual-orbit--one" />
      <div className="visual-orbit visual-orbit--two" />
      <div className="visual-object" />
      <div className="visual-scanline" />
    </div>
  );
}

function CustomCursor() {
  const cursor = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const isTouch = window.matchMedia(
      "(hover: none), (pointer: coarse)"
    ).matches;
    if (isTouch) return;
    const move = (event: MouseEvent) => {
      if (cursor.current) {
        cursor.current.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      }
      const target = event.target as HTMLElement;
      const kind = target.closest(".bento-card")
        ? "cursor-product"
        : target.closest("button, .button")
          ? "cursor-button"
          : "";
      if (cursor.current)
        cursor.current.className = `custom-cursor ${active ? "custom-cursor--active" : ""} ${kind}`;
      setActive(Boolean(target.closest("a, button, input")));
    };
    const down = () => cursor.current?.classList.add("cursor-click");
    const up = () => cursor.current?.classList.remove("cursor-click");
    window.addEventListener("mousemove", move);
    window.addEventListener("mousedown", down);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <div
      ref={cursor}
      className={`custom-cursor ${active ? "custom-cursor--active" : ""}`}
    />
  );
}

function Preloader() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 1200);
    return () => window.clearTimeout(timeout);
  }, []);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="preloader"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="preloader-inner">
            <HoloMark />
            <span className="wordmark wordmark--preloader">HOLO</span>
            <MonoLabel>INITIALIZING LIGHT SYSTEM</MonoLabel>
          </div>
          <div className="preloader-progress">
            <span />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({ onSearch }: { onSearch: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [items, setItems] = useState(cartCount);
  const previousY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 40);
      setHidden(y > 100 && y > previousY.current);
      previousY.current = y;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const syncCart = () => setItems(cartCount());
    window.addEventListener("holo-cart-change", syncCart);
    return () => window.removeEventListener("holo-cart-change", syncCart);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <header
        className={`site-header ${scrolled ? "site-header--scrolled" : ""} ${hidden ? "site-header--hidden" : ""}`}
      >
        <a className="wordmark" href="#top" aria-label="HOLO home">
          HOLO
        </a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {navLinks.map(link => (
            <a
              href={link === "Store" ? "/catalog" : `#${link.toLowerCase()}`}
              key={link}
              className="animated-link"
            >
              {link}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button
            className="icon-button desktop-only"
            aria-label="Open search"
            onClick={onSearch}
          >
            <Search size={17} strokeWidth={1.5} />
          </button>
          <button
            className="cart-button desktop-only"
            onClick={openCart}
            aria-label={`Shopping cart, ${items} items`}
          >
            <span>Cart</span>
            <b>{items}</b>
          </button>
          <button
            className="menu-button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? (
              <X size={21} strokeWidth={1.5} />
            ) : (
              <Menu size={21} strokeWidth={1.5} />
            )}
          </button>
        </div>
      </header>
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="mobile-menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="mobile-menu__top">
              <MonoLabel>MENU / 00</MonoLabel>
              <button
                className="icon-button"
                onClick={closeMenu}
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>
            <nav aria-label="Mobile navigation">
              {navLinks.map((link, index) => (
                <motion.a
                  href={
                    link === "Store" ? "/catalog" : `#${link.toLowerCase()}`
                  }
                  key={link}
                  onClick={closeMenu}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring, delay: index * 0.07 }}
                >
                  <span>0{index + 1}</span>
                  {link}
                  <ArrowUpRightSmall />
                </motion.a>
              ))}
            </nav>
            <div className="mobile-menu__bottom">
              <MonoLabel>HOLO / NEW COLLECTION 2026</MonoLabel>
              <div className="menu-glow" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function ArrowUpRightSmall() {
  return <ArrowRight size={22} strokeWidth={1.3} aria-hidden="true" />;
}

function SearchPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="palette"
            initial={{ opacity: 0, y: -18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18 }}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Search placeholder"
          >
            <div className="palette__input">
              <Search size={18} />
              <input
                autoFocus
                placeholder="Search the collection"
                aria-label="Search the collection"
              />
              <kbd>
                <Command size={12} /> K
              </kbd>
            </div>
            <div className="palette__empty">
              <MonoLabel>SEARCH / READY</MonoLabel>
              <p>Search the catalog</p>
              <span>Type a product, category, or material to explore.</span>
            </div>
            <button className="palette__close" onClick={onClose}>
              ESC TO CLOSE
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AmbientCanvas({ count = 90 }: { count?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;
    const colors = ["#7C3AED", "#00B8D9", "#EC4899", "#10B981"];
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    let width = 0;
    let height = 0;
    const stars = Array.from({ length: count }, (_, index) => ({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() * 1.5 + 1,
      speed: Math.random() * 20 + 20,
      drift: (Math.random() - 0.5) * 2,
      alpha: Math.random() * 0.4 + 0.4,
      phase: index * 0.7,
      color: colors[index % colors.length],
    }));
    const resize = () => {
      width = element.width =
        window.innerWidth * Math.min(window.devicePixelRatio, 2);
      height = element.height =
        window.innerHeight * Math.min(window.devicePixelRatio, 2);
      element.style.width = `${window.innerWidth}px`;
      element.style.height = `${window.innerHeight}px`;
      context.setTransform(1, 0, 0, 1, 0, 0);
    };
    const draw = (time: number, delta: number) => {
      context.clearRect(0, 0, width, height);
      const scale = Math.min(window.devicePixelRatio, 2);
      stars.forEach(star => {
        star.y = (star.y + (star.speed * delta) / (1000 * height)) % 1;
        star.x = (star.x + (star.drift * delta) / (1000 * width) + 1) % 1;
        const opacity = Math.min(
          0.8,
          Math.max(
            0.4,
            star.alpha + Math.sin(time * 0.0012 + star.phase) * 0.08
          )
        );
        const radius = star.size * scale;
        context.beginPath();
        context.fillStyle = star.color;
        context.globalAlpha = opacity;
        context.shadowColor = star.color;
        context.shadowBlur = radius * 5;
        context.arc(star.x * width, star.y * height, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        context.globalAlpha = 1;
      });
    };
    resize();
    window.addEventListener("resize", resize);
    if (reducedMotion) {
      draw(0, 0);
      return () => window.removeEventListener("resize", resize);
    }
    let frame = 0;
    let previous = performance.now();
    const animate = (time: number) => {
      const delta = Math.min(40, time - previous);
      previous = time;
      draw(time, delta);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={canvas} className="ambient-stars" aria-hidden="true" />;
}

function LoadingAvatar({ label = "PREPARING VIEW…" }: { label?: string }) {
  const [shape, setShape] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setShape(value => (value + 1) % 4),
      400
    );
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="loading-avatar">
      <div className={`avatar-core avatar-core--${shape}`} />
      <MonoLabel>
        {[label, "ASSEMBLING…", "CALIBRATING…", "READYING…"][shape]}
      </MonoLabel>
    </div>
  );
}

function TiltCard({
  category,
  index,
  onOpen,
}: {
  category: CatalogCategory;
  index: number;
  onOpen: (category: CatalogCategory) => void;
}) {
  const card = useRef<HTMLAnchorElement>(null);
  const [loading, setLoading] = useState(false);
  const Icon = categoryIcons[category.name as keyof typeof categoryIcons];
  const move = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const rect = card.current?.getBoundingClientRect();
    if (!rect || window.matchMedia("(hover: none)").matches) return;
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.current!.style.setProperty("--tilt-x", `${y * -12}deg`);
    card.current!.style.setProperty("--tilt-y", `${x * 12}deg`);
    card.current!.style.setProperty("--glare-x", `${(x + 0.5) * 100}%`);
    card.current!.style.setProperty("--glare-y", `${(y + 0.5) * 100}%`);
  };
  const leave = () => {
    if (!card.current) return;
    card.current.style.setProperty("--tilt-x", "0deg");
    card.current.style.setProperty("--tilt-y", "0deg");
  };
  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setLoading(true);
    const destination =
      category.slug === "sneakers"
        ? "/product/sneaker"
        : `/products/${category.products[0].slug}`;
    window.setTimeout(() => {
      window.history.pushState({}, "", destination);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, 700);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ ...spring, delay: index * 0.04 }}
      className={`bento-card-wrap bento-card-wrap--${index}`}
    >
      <a
        ref={card}
        className={`bento-card bento-card--interactive ${loading ? "bento-card--loading" : ""}`}
        href="#preview"
        onMouseMove={move}
        onMouseLeave={leave}
        onClick={open}
        aria-label={`Open ${category.name} preview`}
      >
        <div className="bento-card__top">
          <MonoLabel>{category.tag}</MonoLabel>
          <Icon size={18} strokeWidth={1.2} />
        </div>
        <ProductVisual kind={category.kind} tone={category.tone} />
        {loading && (
          <div className="tile-loader">
            <LoadingAvatar />
          </div>
        )}
        <div className="bento-card__bottom">
          <div>
            <h3>{category.name}</h3>
            <MonoLabel>{category.count}</MonoLabel>
          </div>
          <ArrowDownRight className="bento-arrow" size={22} strokeWidth={1.2} />
        </div>
      </a>
    </motion.div>
  );
}

function WireframeBox() {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`wireframe-box ${hovered ? "wireframe-box--fast" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Animated rainbow wireframe object"
    >
      <div className="rainbow-ring rainbow-ring--one" />
      <div className="rainbow-ring rainbow-ring--two" />
      <div className="wire-cube">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="wire-particle wire-particle--one" />
      <span className="wire-particle wire-particle--two" />
      <span className="wire-particle wire-particle--three" />
    </div>
  );
}

function PreviewOverlay({
  category,
  onClose,
}: {
  category: CatalogCategory | null;
  onClose: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!category) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [category, onClose]);
  useEffect(() => {
    if (drag) return;
    const timer = window.setInterval(
      () => setRotation(value => value + 0.5),
      32
    );
    return () => window.clearInterval(timer);
  }, [drag]);
  if (!category) return null;
  const visual = category.kind === "phone" ? "phone" : "shoe";
  return (
    <motion.div
      className="preview-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onWheel={event =>
        setZoom(value =>
          Math.max(0.7, Math.min(1.45, value - event.deltaY * 0.001))
        )
      }
    >
      <button
        className="preview-close"
        onClick={onClose}
        aria-label="Close preview"
      >
        <X size={22} />
      </button>
      <div className="preview-header">
        <MonoLabel>HOLO LAB / LIVE OBJECT PREVIEW</MonoLabel>
        <span>
          <span className="status-dot" /> INTERACTIVE MODE
        </span>
      </div>
      <div className="preview-grid-floor" />
      <div
        className="preview-stage"
        onPointerDown={() => setDrag(true)}
        onPointerUp={() => setDrag(false)}
        onPointerLeave={() => setDrag(false)}
        onPointerMove={event => {
          if (drag) setRotation(value => value + event.movementX * 0.45);
        }}
      >
        <div className="preview-rings">
          <div />
          <div />
          <div />
        </div>
        <div
          className={`preview-object preview-object--${visual}`}
          style={{
            transform: `translate(-50%, -50%) scale(${zoom}) rotateY(${rotation}deg) rotateX(${rotation * 0.18}deg)`,
          }}
        >
          <div className="preview-object__shine" />
          <div className="preview-object__core" />
        </div>
        <div className="preview-particles" />
        <div className="preview-hint">
          <Rotate3d size={15} />
          <MonoLabel>DRAG TO ROTATE · SCROLL TO ZOOM</MonoLabel>
        </div>
      </div>
      <motion.div
        className="preview-hud"
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <div>
          <MonoLabel>OBJECT / {category.tag}</MonoLabel>
          <h2>{category.name}</h2>
          <p>Placeholder object · rendered in light</p>
        </div>
        <div className="preview-hud__right">
          <MonoLabel>PHASE 02 / PREVIEW</MonoLabel>
          <strong>$— — —</strong>
          <button className="button button--primary" onClick={() => {}}>
            Customize <ArrowRight size={15} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-glow hero-glow--one" aria-hidden="true" />
      <div className="hero-glow hero-glow--two" aria-hidden="true" />
      <div className="hero-inner page-shell">
        <div className="hero-kicker">
          <span className="status-dot" />
          <MonoLabel>NEW · 2026 COLLECTION</MonoLabel>
        </div>
        <motion.h1
          id="hero-title"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 1.05 }}
        >
          <em>Customize</em> it
          <br />
          before you buy it<span className="cyan-dot">.</span>
        </motion.h1>
        <motion.p
          className="hero-copy"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.3 }}
        >
          Sixteen premium products. Every color, material, and detail under your
          control.
          <br />
          See them in real 3D. Make them yours.
        </motion.p>
        <motion.div
          className="hero-ctas"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 1.4 }}
        >
          <a className="button button--primary" href="/product/sneaker">
            Start customizing <ArrowRight size={16} />
          </a>
          <a className="button button--ghost" href="/catalog">
            Browse the store
          </a>
        </motion.div>
        <div className="hero-bottom">
          <a href="#store" className="scroll-indicator">
            <span className="scroll-line">
              <i />
            </span>
            <MonoLabel>SCROLL TO EXPLORE</MonoLabel>
          </a>
          <div className="system-readout">
            <span className="status-dot" />
            <MonoLabel>
              16 OBJECTS <span className="muted-separator">·</span> 8 CATEGORIES{" "}
              <span className="muted-separator">·</span> LIVE 3D
            </MonoLabel>
          </div>
        </div>
      </div>
      <div className="hero-index">
        <MonoLabel>01 — 06</MonoLabel>
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    "FREE SHIPPING",
    "30-DAY RETURNS",
    "CARBON NEUTRAL",
    "SECURE CHECKOUT",
    "MADE IN LIGHT",
  ];
  return (
    <div className="trust-strip" aria-label="Our promises">
      <div className="marquee-track">
        {[...items, ...items].map((item, index) => (
          <span key={`${item}-${index}`}>
            <span>{item}</span>
            <b>◆</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function BentoGrid({
  onOpen,
}: {
  onOpen: (category: CatalogCategory) => void;
}) {
  return (
    <section
      className="section section--catalog"
      id="store"
      aria-labelledby="catalog-title"
    >
      <div className="page-shell">
        <Reveal className="section-heading section-heading--catalog">
          <div>
            <MonoLabel>THE CATALOG / 08 CATEGORIES</MonoLabel>
            <h2 id="catalog-title">
              Eight categories.
              <br />
              <span>Two icons each.</span>
            </h2>
          </div>
          <p>
            Everything you need to shape a signature presence. Begin with the
            object, finish with you.
          </p>
        </Reveal>
        <div className="bento-grid">
          {categories.map((category, index) => (
            <TiltCard
              key={category.name}
              category={category}
              index={index}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureHighlight() {
  return (
    <section
      className="section section--feature"
      id="collections"
      aria-labelledby="feature-title"
    >
      <div className="page-shell feature-layout">
        <Reveal className="feature-copy">
          <MonoLabel>THE NEXT DIMENSION / 02</MonoLabel>
          <h2 id="feature-title">
            Every product
            <br />
            is a <em>hologram.</em>
          </h2>
          <p>
            Rotate it. Recolor it.
            <br />
            Make it yours.
          </p>
          <div className="feature-list">
            {[
              { icon: ScanLine, text: "3D Configurator" },
              { icon: MousePointer2, text: "Voice Control" },
              { icon: MonitorSmartphone, text: "AR Preview" },
            ].map(({ icon: Icon, text }) => (
              <div key={text}>
                <span>
                  <Icon size={15} strokeWidth={1.4} />
                </span>
                <span>{text}</span>
              </div>
            ))}
          </div>
          <a href="#about" className="text-link">
            See how it works <ArrowRight size={16} />
          </a>
        </Reveal>
        <Reveal delay={0.12} className="hologram-stage" id="about">
          <div className="stage-corner stage-corner--tl" />
          <div className="stage-corner stage-corner--tr" />
          <div className="stage-corner stage-corner--bl" />
          <div className="stage-corner stage-corner--br" />
          <div className="stage-top">
            <MonoLabel>RAINBOW WIRE OBJECT</MonoLabel>
            <span>
              <span className="status-dot" /> PHASE 02
            </span>
          </div>
          <WireframeBox />
          <div className="stage-bottom">
            <MonoLabel>OBJECT / 001</MonoLabel>
            <MonoLabel>HOVER TO ACCELERATE</MonoLabel>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Manifesto() {
  return (
    <section
      className="manifesto"
      id="journal"
      aria-labelledby="manifesto-title"
    >
      <div className="manifesto-line" />
      <Reveal className="manifesto-inner page-shell">
        <MonoLabel>THE HOLO MANIFESTO / 001</MonoLabel>
        <h2 id="manifesto-title">
          “We don't sell products.
          <br />
          <span>We let you build them.</span>”
        </h2>
        <p>— A new language for personal objects</p>
      </Reveal>
      <div className="manifesto-orbit" aria-hidden="true" />
    </section>
  );
}

function Newsletter() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (email.trim()) setSubmitted(true);
  };
  return (
    <section
      className="section section--newsletter"
      id="newsletter"
      aria-labelledby="newsletter-title"
    >
      <Reveal className="newsletter-card page-shell">
        <div className="newsletter-grid" />
        <div className="newsletter-copy">
          <MonoLabel>THE INNER CIRCLE / 04</MonoLabel>
          <h2 id="newsletter-title">
            Join the
            <br />
            <em>inner circle.</em>
          </h2>
          <p>
            Early access to new drops
            <br />
            and hologram features.
          </p>
        </div>
        <div className="newsletter-form-wrap">
          {submitted ? (
            <div className="success-state">
              <span>
                <Check size={20} />
              </span>
              <div>
                <MonoLabel>ACCESS GRANTED</MonoLabel>
                <strong>You're in.</strong>
                <p>We'll keep you close to the light.</p>
              </div>
            </div>
          ) : (
            <form className="newsletter-form" onSubmit={submit}>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <button className="button button--primary" type="submit">
                Enter <ArrowRight size={16} />
              </button>
            </form>
          )}
          <MonoLabel className="newsletter-note">
            NO SPAM. UNSUBSCRIBE ANYTIME.
          </MonoLabel>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  const columns = [
    { title: "Shop", links: ["All objects", "New arrivals", "Best sellers"] },
    { title: "Company", links: ["About HOLO", "Journal", "Careers"] },
    { title: "Support", links: ["Shipping & returns", "Contact", "FAQ"] },
    { title: "Connect", links: ["Instagram", "Pinterest", "Are.na"] },
  ];
  return (
    <footer className="site-footer" id="footer">
      <div className="footer-divider">
        <span />
      </div>
      <div className="page-shell">
        <div className="footer-columns">
          {columns.map(column => (
            <div key={column.title}>
              <MonoLabel>{column.title}</MonoLabel>
              {column.links.map(link => (
                <a className="animated-link" href="#" key={link}>
                  {link}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className="footer-meta">
          <a className="wordmark" href="#top">
            HOLO
          </a>
          <div>
            <p>© 2026 HOLO OBJECTS. ALL RIGHTS RESERVED.</p>
            <div className="footer-legal">
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
              <a href="#">Cookies</a>
            </div>
          </div>
        </div>
        <div className="footer-monogram">HOLO</div>
      </div>
    </footer>
  );
}

export { AmbientCanvas };

export default function Home() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [preview, setPreview] = useState<(typeof categories)[number] | null>(
    null
  );
  return (
    <div className="holo-app" id="top">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Preloader />
      <AmbientCanvas />
      <div className="ambient-orbs" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <CustomCursor />
      <Header onSearch={() => setSearchOpen(true)} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <main id="main-content">
        <Hero />
        <TrustStrip />
        <BentoGrid onOpen={() => setPreview(null)} />
        <FeatureHighlight />
        <Manifesto />
        <Newsletter />
      </main>
      <Footer />
    </div>
  );
}
