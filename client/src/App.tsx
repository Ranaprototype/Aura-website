import { useEffect, useState } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";
import { CommerceStatus } from "./components/CommerceStatus";
import SneakerConfigurator from "./pages/SneakerConfigurator";
import CatalogPage from "./pages/CatalogPage";
import CategoryPage from "./pages/CategoryPage";
import { getCategory } from "./lib/catalog";
import GenericConfigurator from "./pages/GenericConfigurator";
import CartPage from "./pages/CartPage";
import CheckoutPage from "./pages/CheckoutPage";
import OrderConfirmationPage from "./pages/OrderConfirmationPage";
import CommerceOverlay from "./components/CommerceOverlay";
import AccountPage from "./pages/AccountPage";
import { ComparisonPage } from "./components/Phase6ProductExtras";
import TestSupabase from "./pages/TestSupabase";

function Router() {
  const currentPath = () => window.location.pathname.replace(/\/+$/, "") || "/";
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (path === "/test-supabase") return <TestSupabase />;
  if (path === "/compare") {
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
  if (path !== "/")
    return (
      <CommerceStatus section="Navigation" title="Page not found.">
        <p>There is no page at this address.</p>
      </CommerceStatus>
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
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          (e.target.isContentEditable ||
            e.target.closest("input,textarea,select")))
      )
        return;
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
