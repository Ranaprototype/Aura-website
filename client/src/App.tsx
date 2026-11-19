import { useEffect, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";
import ProductPage from "./pages/ProductPage";
import SneakerConfigurator from "./pages/SneakerConfigurator";
import CatalogPage from "./pages/CatalogPage";
import CategoryPage from "./pages/CategoryPage";
import { getCategory } from "./lib/catalog";
import GenericConfigurator from "./pages/GenericConfigurator";
import { getProduct } from "./lib/catalog";
import CartPage from "./pages/CartPage";
import CheckoutPage from "./pages/CheckoutPage";
import OrderConfirmationPage from "./pages/OrderConfirmationPage";
import CommerceOverlay from "./components/CommerceOverlay";
import AccountPage from "./pages/AccountPage";
import { ComparisonPage } from "./components/Phase6ProductExtras";
import TestSupabase from "./pages/TestSupabase";

function Router() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (path === "/test-supabase") return <TestSupabase />;
  if (path.startsWith("/compare")) {
    const slugs =
      new URLSearchParams(window.location.search).get("products")?.split(",") ||
      [];
    return <ComparisonPage slugs={slugs} />;
  }
  if (path === "/cart")
    return (
      <>
        <CartPage />
        <CommerceOverlay />
      </>
    );
  if (path === "/checkout") return <CheckoutPage />;
  if (path === "/order-confirmation" || path.startsWith("/order/"))
    return <OrderConfirmationPage />;
  if (path === "/account" || path.startsWith("/account/"))
    return <AccountPage path={path} />;
  if (path === "/catalog")
    return (
      <>
        <CatalogPage />
        <CommerceOverlay />
      </>
    );
  const categoryMatch = path.match(/^\/category\/([^/]+)\/?$/);
  const category = categoryMatch ? getCategory(categoryMatch[1]) : undefined;
  if (category)
    return (
      <>
        <CategoryPage category={category} />
        <CommerceOverlay />
      </>
    );
  if (path === "/product/sneaker")
    return (
      <>
        <SneakerConfigurator />
        <CommerceOverlay />
      </>
    );
  const productMatch = path.match(/^\/products\/([^/]+)\/?$/);
  if (productMatch)
    return (
      <>
        <GenericConfigurator slug={productMatch[1]} />
        <CommerceOverlay />
      </>
    );
  const match = path.match(/^\/products\/([^/]+)\/?$/);
  const product = match ? getProduct(match[1]) : undefined;
  if (match && product)
    return (
      <>
        <ProductPage product={product} />
        <CommerceOverlay />
      </>
    );
  return (
    <>
      <Home />
      <CommerceOverlay />
    </>
  );
}

function GlobalPhase6() {
  useEffect(() => {
    let g = false;
    const on = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "g") {
        g = true;
        window.setTimeout(() => (g = false), 900);
        return;
      }
      if (g) {
        g = false;
        const path =
          e.key.toLowerCase() === "c"
            ? "/catalog"
            : e.key.toLowerCase() === "h"
              ? "/"
              : e.key.toLowerCase() === "a"
                ? "/account"
                : "";
        if (path) {
          window.history.pushState({}, "", path);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <GlobalPhase6 />
      <Router />
    </ErrorBoundary>
  );
}
