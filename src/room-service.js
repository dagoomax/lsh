"use strict";

// Room service — a hotel/rental ordering module (Node side; mirrors
// core-go/roomservice_api.go + roomservice_page.go).
//
// Guests reach a public, no-login ordering page at /order (optionally
// /order?room=101, which a per-room QR code encodes). The page loads the menu
// and places orders through the public /api/order/* endpoints. Staff see and
// acknowledge orders in the dashboard (admin /api/room-service/*); the menu is
// edited in Settings. Payment is "add to room bill" (recorded unpaid for the
// front desk) or "pay now" via Stripe (Apple Pay on Apple devices), inert
// until config.roomService.stripe is filled in and the domain verified.
//
// Orders persist to persist/room-service-orders.json (newest first, capped).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const ORDERS_FILE = path.join(__dirname, "..", "persist", "room-service-orders.json");
const MAX_ORDERS = 200;

function loadOrders() {
  try { const a = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
// The cap drops the oldest acknowledged orders first, so a burst of new orders
// can't push one the staff haven't seen yet off the list.
function trimOrders(orders) {
  let excess = orders.length - MAX_ORDERS;
  if (excess <= 0) return orders;
  const drop = new Set();
  for (let i = orders.length - 1; i >= 0 && excess > 0; i--) {
    if (orders[i]?.status !== "new") { drop.add(i); excess--; }
  }
  return orders.filter((_, i) => !drop.has(i)).slice(0, MAX_ORDERS);
}
function saveOrders(orders) {
  const arr = trimOrders(orders);
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  const tmp = ORDERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
}

// ── Used card payments ──────────────────────────────────────────────────────
// A Stripe PaymentIntent pays for exactly one order. The ids already spent are
// kept in their own file (the order list is capped and can be cleared), plus an
// in-memory claim that covers the moment between checking and saving.
const INTENTS_FILE = path.join(__dirname, "..", "persist", "room-service-intents.json");
const MAX_INTENTS = 5000;
const claimedIntents = new Set();

function loadIntents() {
  try { const a = JSON.parse(fs.readFileSync(INTENTS_FILE, "utf8")); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
// claimIntent — true if this payment hasn't paid for an order yet; it is then
// held until commitIntent (order saved) or releaseIntent (order failed).
function claimIntent(id) {
  id = String(id || "");
  if (!id || claimedIntents.has(id)) return false;
  if (loadIntents().includes(id) || loadOrders().some((o) => o && o.paymentIntentId === id)) return false;
  claimedIntents.add(id);
  return true;
}
function releaseIntent(id) { claimedIntents.delete(String(id || "")); }
function commitIntent(id) {
  id = String(id || "");
  try {
    fs.mkdirSync(path.dirname(INTENTS_FILE), { recursive: true });
    const tmp = INTENTS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify([id, ...loadIntents().filter((x) => x !== id)].slice(0, MAX_INTENTS)));
    fs.renameSync(tmp, INTENTS_FILE);
  } finally { claimedIntents.delete(id); }
}

// The room list orders are checked against (empty = any room or table).
function roomsOf(config) {
  const list = config.roomService?.rooms;
  return (Array.isArray(list) ? list : []).map((r) => String(r).trim()).filter(Boolean);
}

// menuPublic — available items only, no secret.
function menuPublic(config) {
  const rs = config.roomService || {};
  const st = rs.stripe || {};
  const currency = rs.currency || "PLN";
  const menu = (Array.isArray(rs.menu) ? rs.menu : [])
    .filter((i) => i && i.available !== false)
    .map((i) => ({ id: String(i.id || ""), category: String(i.category || ""), name: String(i.name || ""), desc: String(i.desc || ""), price: Number(i.price) || 0 }));
  return {
    enabled: rs.enabled === true,
    title: String(rs.title || ""),
    currency,
    payToRoom: rs.payToRoom !== false,
    stripe: { enabled: st.enabled === true && !!st.publishableKey, publishableKey: String(st.publishableKey || "") },
    menu,
    hideHotelServices: config.hideHotelServices === true,
  };
}

// priceItems — validate the cart against the menu; the server never trusts a
// client-sent price.
function priceItems(config, cart) {
  const byId = {};
  for (const i of (Array.isArray(config.roomService?.menu) ? config.roomService.menu : [])) {
    if (i && i.available !== false) byId[String(i.id)] = i;
  }
  const lines = [];
  let total = 0;
  for (const c of (Array.isArray(cart) ? cart : [])) {
    const qty = parseInt(c?.qty, 10);
    if (!(qty >= 1 && qty <= 99)) continue;
    const m = byId[String(c?.id)];
    if (!m) continue;
    const price = Number(m.price) || 0;
    total += price * qty;
    lines.push({ id: String(m.id), name: String(m.name || ""), price, qty });
  }
  return { lines, total: Math.round(total * 100) / 100 };
}

// ── Stripe (server side; uses global fetch, Node 18+) ───────────────────────
async function stripeCall(secret, method, endpoint, form) {
  const res = await fetch(endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + secret,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(form ? { body: form.toString() } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || ("HTTP " + res.status));
  return j;
}
async function stripeCreateIntent(secret, total, currency, room) {
  const form = new URLSearchParams();
  form.set("amount", String(Math.round(total * 100)));
  form.set("currency", String(currency || "PLN").toLowerCase());
  form.set("automatic_payment_methods[enabled]", "true");
  form.set("description", "Room service");
  if (room) form.set("metadata[room]", room);
  return stripeCall(secret, "POST", "https://api.stripe.com/v1/payment_intents", form);
}
async function stripeVerify(secret, id, total, currency) {
  if (!secret || !id) throw new Error("missing payment reference");
  const pi = await stripeCall(secret, "GET", "https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(id), null);
  const want = Math.round(total * 100);
  return pi.status === "succeeded" && Number(pi.amount_received) >= want &&
    String(pi.currency || "").toLowerCase() === String(currency || "").toLowerCase();
}

function orderId() { return Date.now().toString(36) + crypto.randomBytes(2).toString("hex"); }

// Guest page (identical to the Go core, shared verbatim).
const ORDER_PAGE_HTML = "<!doctype html>\n<html lang=\"en\"><head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"robots\" content=\"noindex, nofollow\">\n<title>Room service</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap\" rel=\"stylesheet\">\n<style>\n  :root{\n    --bg:#f6f1e9; --bg2:#efe7da; --card:#fffdf9; --ink:#23201b; --sub:#8a7f6e;\n    --line:#e6ddcd; --accent:#9a7b34; --accent-ink:#fff8ec;\n    --gold:#b7935a; --good:#5a7d4f; --bad:#b4442f;\n    --shadow:0 6px 24px rgba(60,45,20,.07); --radius:14px;\n    --serif:\"Cormorant Garamond\",Georgia,\"Times New Roman\",serif;\n    --sans:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif;\n  }\n  @media (prefers-color-scheme:dark){\n    :root{ --bg:#15130f; --bg2:#1c1915; --card:#201c17; --ink:#f3ece0; --sub:#a99d88;\n           --line:#322c23; --accent:#caa158; --accent-ink:#1a1611; --gold:#d8b878;\n           --shadow:0 8px 30px rgba(0,0,0,.45); }\n  }\n  *{box-sizing:border-box}\n  html,body{margin:0;background:var(--bg);color:var(--ink);\n    font:16px/1.45 var(--sans);-webkit-font-smoothing:antialiased;\n    background-image:radial-gradient(120% 60% at 50% 0,var(--bg2),var(--bg) 60%);background-attachment:fixed}\n  main{max-width:600px;margin:0 auto;padding:0 20px 150px}\n  header{text-align:center;padding:40px 10px 24px}\n  .crest{width:40px;height:1px;background:var(--gold);margin:0 auto 18px;position:relative}\n  .crest::before{content:\"◆\";position:absolute;top:-10px;left:50%;transform:translateX(-50%);\n    color:var(--gold);font-size:12px;background:var(--bg);padding:0 8px}\n  h1{font-family:var(--serif);font-size:40px;font-weight:600;letter-spacing:.01em;margin:0;line-height:1.05}\n  .room{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--sub);margin-top:12px}\n  .cat{font-family:var(--serif);font-style:italic;font-size:24px;color:var(--gold);\n    margin:34px 2px 14px;display:flex;align-items:center;gap:14px}\n  .cat::after{content:\"\";flex:1;height:1px;background:var(--line)}\n  .item{display:flex;align-items:baseline;gap:12px;padding:15px 2px;border-bottom:1px solid var(--line)}\n  .item .info{flex:1;min-width:0}\n  .item .name{font-family:var(--serif);font-size:21px;font-weight:600;line-height:1.1}\n  .item .desc{color:var(--sub);font-size:13.5px;margin-top:3px;font-style:italic}\n  .item .price{font-family:var(--serif);font-size:20px;font-weight:600;color:var(--gold);\n    font-variant-numeric:tabular-nums;white-space:nowrap}\n  .stepper{display:flex;align-items:center;gap:12px;flex-shrink:0}\n  .stepper button{width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:19px;line-height:1;\n    background:transparent;color:var(--gold);border:1px solid var(--gold);transition:.15s}\n  .stepper button.plus{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}\n  .stepper button:active{transform:scale(.92)}\n  .stepper .q{min-width:16px;text-align:center;font-weight:600;font-variant-numeric:tabular-nums;font-size:16px}\n  .hidden{display:none !important}\n  .bar{position:fixed;left:0;right:0;bottom:0;padding:14px 20px calc(16px + env(safe-area-inset-bottom));\n    background:color-mix(in srgb,var(--card) 90%,transparent);backdrop-filter:blur(14px) saturate(1.3);\n    border-top:1px solid var(--line)}\n  .bar .inner{max-width:600px;margin:0 auto}\n  .btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:none;\n    border-radius:12px;padding:17px;font-size:15px;font-weight:600;letter-spacing:.04em;cursor:pointer;\n    background:var(--accent);color:var(--accent-ink);font-family:var(--sans)}\n  .btn.sec{background:transparent;color:var(--ink);border:1px solid var(--line)}\n  .btn[disabled]{opacity:.5}\n  .btn+.btn{margin-top:10px}\n  .total{font-variant-numeric:tabular-nums}\n  .sheet-bg{position:fixed;inset:0;background:rgba(25,18,8,.5);backdrop-filter:blur(3px);\n    display:flex;align-items:flex-end;z-index:20}\n  .sheet{background:var(--bg);width:100%;max-width:600px;margin:0 auto;border-radius:22px 22px 0 0;\n    padding:26px 20px calc(22px + env(safe-area-inset-bottom));max-height:90vh;overflow:auto;\n    border-top:2px solid var(--gold)}\n  .sheet h2{font-family:var(--serif);font-weight:600;margin:0 0 16px;font-size:28px;text-align:center}\n  label{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);margin:14px 2px 6px;font-weight:600}\n  input,textarea{width:100%;border:1px solid var(--line);background:var(--card);color:var(--ink);\n    border-radius:10px;padding:13px;font-size:16px;font-family:inherit}\n  input:focus,textarea:focus{outline:none;border-color:var(--gold)}\n  .lines{border-top:1px solid var(--line);margin-bottom:4px}\n  .line{display:flex;justify-content:space-between;padding:10px 2px;border-bottom:1px solid var(--line)}\n  .line .q{color:var(--gold);margin-right:10px;font-variant-numeric:tabular-nums}\n  .sumline{display:flex;justify-content:space-between;align-items:baseline;font-family:var(--serif);\n    font-size:24px;font-weight:600;padding:14px 2px 18px}\n  .sumline span:last-child{color:var(--gold)}\n  .msg{text-align:center;padding:30px 16px}\n  .msg .big{font-family:var(--serif);font-size:52px;color:var(--gold);line-height:1}\n  .msg h2{font-family:var(--serif);font-size:30px;margin:14px 0 8px}\n  .msg p{color:var(--sub);margin:0}\n  .err{color:var(--bad);text-align:center;font-size:14px;margin-top:12px;min-height:18px}\n  #pay-el{margin-top:16px}\n</style></head>\n<body><main>\n  <header>\n    <div class=\"crest\"></div>\n    <h1 id=\"title\">Room Service</h1>\n    <div class=\"room\" id=\"room-label\"></div>\n  </header>\n  <div id=\"menu\"></div>\n  <div id=\"empty\" class=\"msg hidden\"><div class=\"big\">🍽️</div><h2>Menu unavailable</h2>\n    <p>Room service isn’t available right now.</p></div>\n</main>\n\n<div class=\"bar hidden\" id=\"cartbar\"><div class=\"inner\">\n  <button class=\"btn\" id=\"review\"><span id=\"cart-count\"></span> · <span class=\"total\" id=\"cart-total\"></span></button>\n</div></div>\n\n<div class=\"sheet-bg hidden\" id=\"checkout\"><div class=\"sheet\">\n  <h2>Your order</h2>\n  <div class=\"lines\" id=\"co-lines\"></div>\n  <div class=\"sumline\"><span>Total</span><span class=\"total\" id=\"co-total\"></span></div>\n  <label for=\"room\">Room / table</label>\n  <input id=\"room\" placeholder=\"e.g. 101\" autocomplete=\"off\">\n  <label for=\"note\">Note for the kitchen (optional)</label>\n  <textarea id=\"note\" rows=\"2\" placeholder=\"Allergies, timing…\"></textarea>\n  <div id=\"pay-choice\">\n    <button class=\"btn\" id=\"pay-room\">Add to my room bill</button>\n    <button class=\"btn sec\" id=\"pay-card\">Pay now</button>\n    <button class=\"btn sec\" id=\"co-cancel\">Back to menu</button>\n  </div>\n  <div id=\"pay-card-panel\" class=\"hidden\">\n    <div id=\"pay-el\"></div>\n    <button class=\"btn\" id=\"pay-submit\" style=\"margin-top:14px\">Pay <span class=\"total\" id=\"pay-amt\"></span></button>\n    <button class=\"btn sec\" id=\"pay-back\">Back</button>\n  </div>\n  <div class=\"err\" id=\"err\"></div>\n</div></div>\n\n<div class=\"sheet-bg hidden\" id=\"done\"><div class=\"sheet\"><div class=\"msg\">\n  <div class=\"big\">✅</div>\n  <h2>Order received</h2>\n  <p id=\"done-text\"></p>\n  <button class=\"btn\" id=\"done-ok\" style=\"margin-top:24px\">Done</button>\n</div></div></div>\n\n<script>\n(function(){\n  var $=function(s){return document.querySelector(s)};\n  var cfg=null, cart={}, stripe=null, elements=null, payIntent=null;\n  var params=new URLSearchParams(location.search);\n  var room=params.get('room')||decodeURIComponent((location.pathname.match(/^\\/order\\/(.+)$/)||[])[1]||'');\n\n  function money(n){ return new Intl.NumberFormat(undefined,{style:'currency',currency:cfg.currency}).format(n); }\n  function count(){ return Object.values(cart).reduce(function(a,b){return a+b},0); }\n  function total(){ var t=0; cfg.menu.forEach(function(i){ t+=(cart[i.id]||0)*i.price }); return Math.round(t*100)/100; }\n  function lines(){ return cfg.menu.filter(function(i){return cart[i.id]}).map(function(i){return {id:i.id,name:i.name,price:i.price,qty:cart[i.id]}}); }\n\n  fetch('/api/order/menu').then(function(r){ if(!r.ok) throw 0; return r.json() })\n    .then(function(j){ cfg=j.data; render(); })\n    .catch(function(){ $('#menu').classList.add('hidden'); $('#empty').classList.remove('hidden'); });\n\n  function render(){\n    if(cfg.title) { $('#title').textContent=cfg.title; document.title=cfg.title; }\n    if(room) $('#room-label').textContent='Room '+room;\n    var cats={}, order=[];\n    cfg.menu.forEach(function(i){ var c=i.category||'Menu'; if(!cats[c]){cats[c]=[];order.push(c)} cats[c].push(i); });\n    var html='';\n    order.forEach(function(c){\n      html+='<div class=\"cat\">'+esc(c)+'</div>';\n      cats[c].forEach(function(i){\n        html+='<div class=\"item\" data-id=\"'+esc(i.id)+'\"><div class=\"info\"><div class=\"name\">'+esc(i.name)+'</div>'+\n          (i.desc?'<div class=\"desc\">'+esc(i.desc)+'</div>':'')+'</div>'+\n          '<div class=\"price\">'+money(i.price)+'</div>'+\n          '<div class=\"stepper\"><button class=\"minus\" aria-label=\"Remove\">−</button>'+\n          '<span class=\"q\">0</span><button class=\"plus\" aria-label=\"Add\">+</button></div></div>';\n      });\n    });\n    $('#menu').innerHTML=html;\n    $('#menu').addEventListener('click',function(e){\n      var it=e.target.closest('.item'); if(!it) return; var id=it.getAttribute('data-id');\n      if(e.target.classList.contains('plus')) cart[id]=(cart[id]||0)+1;\n      else if(e.target.classList.contains('minus')) cart[id]=Math.max(0,(cart[id]||0)-1);\n      else return;\n      if(!cart[id]) delete cart[id];\n      it.querySelector('.q').textContent=cart[id]||0;\n      updateBar();\n    });\n  }\n  function updateBar(){\n    var n=count();\n    if(n){ $('#cartbar').classList.remove('hidden'); $('#cart-count').textContent=n+(n===1?' item':' items'); $('#cart-total').textContent=money(total()); }\n    else $('#cartbar').classList.add('hidden');\n  }\n\n  $('#review').addEventListener('click',function(){\n    var l=lines(), h='';\n    l.forEach(function(x){ h+='<div class=\"line\"><span><span class=\"q\">'+x.qty+'×</span>'+esc(x.name)+'</span><span>'+money(x.price*x.qty)+'</span></div>'; });\n    $('#co-lines').innerHTML=h; $('#co-total').textContent=money(total()); $('#pay-amt').textContent=money(total());\n    if(room) $('#room').value=room;\n    $('#pay-room').classList.toggle('hidden', !cfg.payToRoom);\n    $('#pay-card').classList.toggle('hidden', !(cfg.stripe&&cfg.stripe.enabled));\n    showPanel(false); $('#err').textContent='';\n    $('#checkout').classList.remove('hidden');\n  });\n  $('#co-cancel').addEventListener('click',function(){ $('#checkout').classList.add('hidden'); });\n\n  function place(payment, intentId){\n    return fetch('/api/order/place',{method:'POST',headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({room:$('#room').value.trim(),items:lines(),note:$('#note').value,payment:payment,paymentIntentId:intentId||''})})\n      .then(function(r){ return r.json().then(function(j){ if(!r.ok||!j.success) throw new Error(j.error||'Order failed'); return j.data; }); });\n  }\n  function finish(d){\n    $('#checkout').classList.add('hidden');\n    $('#done-text').textContent = (d.payment==='card'?'Payment received. ':'Charged to your room. ')+'The staff have been notified.';\n    $('#done').classList.remove('hidden');\n    cart={}; updateBar(); document.querySelectorAll('.q').forEach(function(q){ if(q.closest('.item')) q.textContent='0'; });\n  }\n  $('#done-ok').addEventListener('click',function(){ $('#done').classList.add('hidden'); });\n\n  $('#pay-room').addEventListener('click',function(){\n    var b=this; b.disabled=true; $('#err').textContent='';\n    place('room').then(finish).catch(function(e){ $('#err').textContent=e.message; b.disabled=false; });\n  });\n\n  function showPanel(card){ $('#pay-choice').classList.toggle('hidden',card); $('#pay-card-panel').classList.toggle('hidden',!card); }\n  $('#pay-back').addEventListener('click',function(){ showPanel(false); });\n\n  $('#pay-card').addEventListener('click',function(){\n    var b=this; b.disabled=true; $('#err').textContent='';\n    fetch('/api/order/pay',{method:'POST',headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({room:$('#room').value.trim(),items:lines()})})\n      .then(function(r){ return r.json().then(function(j){ if(!r.ok||!j.success) throw new Error(j.error||'Payment setup failed'); return j.data; }); })\n      .then(function(d){\n        payIntent=d.paymentIntentId;\n        return loadStripe().then(function(){\n          stripe=Stripe(d.publishableKey);\n          elements=stripe.elements({clientSecret:d.clientSecret});\n          $('#pay-el').innerHTML=''; elements.create('payment').mount('#pay-el');\n          showPanel(true); b.disabled=false;\n        });\n      })\n      .catch(function(e){ $('#err').textContent=e.message; b.disabled=false; });\n  });\n\n  $('#pay-submit').addEventListener('click',function(){\n    var b=this; b.disabled=true; $('#err').textContent='';\n    stripe.confirmPayment({elements:elements,redirect:'if_required'}).then(function(res){\n      if(res.error) throw new Error(res.error.message);\n      return place('card',payIntent);\n    }).then(finish).catch(function(e){ $('#err').textContent=e.message; b.disabled=false; });\n  });\n\n  function loadStripe(){\n    return new Promise(function(res,rej){\n      if(window.Stripe) return res();\n      var s=document.createElement('script'); s.src='https://js.stripe.com/v3/';\n      s.onload=res; s.onerror=function(){rej(new Error('Could not load Stripe'))}; document.head.appendChild(s);\n    });\n  }\n  function esc(s){ return String(s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]}); }\n})();\n</script>\n</body></html>";

// orderPageRouter — mounted at /order BEFORE auth (public), like the guest
// portal, so the QR code works without a login.
function orderPageRouter() {
  const r = express.Router();
  r.get(/.*/, (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.type("html").send(ORDER_PAGE_HTML);
  });
  return r;
}

module.exports = { loadOrders, saveOrders, trimOrders, claimIntent, releaseIntent, commitIntent, roomsOf, MAX_ORDERS, menuPublic, priceItems, stripeCreateIntent, stripeVerify, orderId, orderPageRouter, ORDER_PAGE_HTML };
