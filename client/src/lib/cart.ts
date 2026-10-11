import { getProduct, type Product } from "./catalog";

export type CartItem = { id:string; slug:string; name:string; category:string; brand?:string; price:number; quantity:number; size?:string; configuration?:string; tone:string; giftWrap?:boolean; thumbnail?:string; };
export type CartState = { version:1; items:CartItem[]; promo?:string; };
const KEY = "holo.cart.v1";
const LEGACY = "holo-cart";
const readState = ():CartState => { try { const raw=localStorage.getItem(KEY); if(raw) return JSON.parse(raw) as CartState; const old=localStorage.getItem(LEGACY); const items=old ? JSON.parse(old) as CartItem[] : []; return {version:1,items}; } catch { return {version:1,items:[]}; } };
const write = (state:CartState) => localStorage.setItem(KEY, JSON.stringify(state));
const notify = (detail?:unknown) => { window.dispatchEvent(new CustomEvent("holo-cart-change")); if(detail) window.dispatchEvent(new CustomEvent("holo-cart-added",{detail})); };
export const getCartState = () => readState(); export const getCart = () => readState().items;
export const cartCount = (items=getCart()) => items.reduce((sum,item)=>sum+item.quantity,0);
export const cartSubtotal = (items=getCart()) => items.reduce((sum,item)=>sum+item.price*item.quantity,0);
export const cartShipping = (subtotal:number, method="standard") => method === "overnight" ? 48 : method === "express" ? 28 : subtotal >= 150 ? 0 : 18;
export const addToCart = (product:Product, options:{price?:number;size?:string;configuration?:string;thumbnail?:string}={}) => { const state=readState(); const id=`${product.slug}:${options.size||"default"}:${options.configuration||"standard"}`; const found=state.items.find(item=>item.id===id); if(found) found.quantity=Math.min(10,found.quantity+1); else state.items.push({id,slug:product.slug,name:product.name,category:product.category,price:options.price??product.price,quantity:1,size:options.size,configuration:options.configuration,tone:product.tone,thumbnail:options.thumbnail}); write(state); notify({item:state.items.find(item=>item.id===id)}); return state.items; };
export const updateCartQuantity = (id:string, quantity:number) => { const state=readState(); state.items=state.items.map(item=>item.id===id?{...item,quantity:Math.min(10,Math.max(0,quantity))}:item).filter(item=>item.quantity>0); write(state); notify(); return state.items; };
export const removeFromCart=(id:string)=>updateCartQuantity(id,0);
export const toggleGiftWrap=(id:string)=>{const state=readState(); state.items=state.items.map(item=>item.id===id?{...item,giftWrap:!item.giftWrap}:item);write(state);notify();return state.items;};
export const setPromo=(promo?:string)=>{const state=readState();state.promo=promo?.toUpperCase();write(state);notify();return state;};
export const clearCart=()=>{localStorage.removeItem(KEY);localStorage.removeItem(LEGACY);notify();};
export const cartProduct=(item:CartItem)=>getProduct(item.slug);
export const cartTax=(items=getCart(),discount=0)=>Math.round((Math.max(0,cartSubtotal(items)-discount))*0.08*100)/100;

export const getSavedForLater = ():CartItem[] => { try { return JSON.parse(localStorage.getItem("holo.savedForLater.v1") || "[]") as CartItem[]; } catch { return []; } };
export const saveForLater = (id:string) => { const state=readState(); const item=state.items.find(i=>i.id===id); if(!item) return; localStorage.setItem("holo.savedForLater.v1",JSON.stringify([...getSavedForLater(),item])); state.items=state.items.filter(i=>i.id!==id); write(state); notify(); };
export const restoreSavedItem = (id:string) => { const saved=getSavedForLater(); const item=saved.find(i=>i.id===id); if(!item) return; const state=readState(); const found=state.items.find(i=>i.id===id); if(found) found.quantity=Math.min(10,found.quantity+item.quantity); else state.items.push(item); localStorage.setItem("holo.savedForLater.v1",JSON.stringify(saved.filter(i=>i.id!==id))); write(state); notify(); };
export const removeSavedItem = (id:string) => localStorage.setItem("holo.savedForLater.v1",JSON.stringify(getSavedForLater().filter(i=>i.id!==id)));
