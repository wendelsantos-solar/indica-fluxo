import { ATTRIBUTION_TOKEN_COOKIE, ATTRIBUTION_TOKEN_PATTERN } from "./attribution-token"
import { REF_QUERY_PARAMS, TRACK_API_PATH, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_DAYS } from "./constants"

/** Hosts whose links are Stripe checkouts the tracker may decorate. */
const STRIPE_CHECKOUT_HOSTS = ["buy.stripe.com", "checkout.stripe.com"]

/**
 * The browser tracker, served as a static asset from `/t.js`.
 *
 * Written as a plain string rather than a bundled entry point on purpose: it
 * must not depend on React, the Next.js runtime or any build step, so that the
 * same file can later be served by an edge worker unchanged.
 *
 *   <script defer src="https://app.example.com/t.js" data-key="pk_test_..."></script>
 *
 * `data-cookie-domain="example.com"` (optional) writes the visitor cookie for
 * every subdomain, so a signup on `app.example.com` reads what `www.` set.
 *
 * It also carries the public attribution reference
 * (INTEGRATION_ARCHITECTURE_V2.md §2): it stores what `/api/track` returns,
 * exposes it as `window.Referral.attributionToken`, and appends it to Stripe
 * Payment Link hrefs on the page as `client_reference_id`. That last part is
 * what makes the Payment Links integration need no code at all — opt out with
 * `data-decorate-links="off"`.
 */
export function trackerSource(endpoint: string): string {
  return `(function () {
  "use strict";
  var COOKIE = ${JSON.stringify(VISITOR_COOKIE)};
  var REF_COOKIE = ${JSON.stringify(ATTRIBUTION_TOKEN_COOKIE)};
  var REF_PATTERN = ${ATTRIBUTION_TOKEN_PATTERN.toString()};
  var STRIPE_HOSTS = ${JSON.stringify(STRIPE_CHECKOUT_HOSTS)};
  var PARAMS = ${JSON.stringify(REF_QUERY_PARAMS)};
  var MAX_AGE = ${VISITOR_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60};
  var script =
    document.currentScript ||
    document.querySelector("script[data-key]");
  var publicKey = script && script.getAttribute("data-key");
  if (!publicKey) return;

  // The endpoint lives on the host that served this script, whatever URL the
  // build baked in (a build without NEXT_PUBLIC_APP_URL would bake localhost).
  var ENDPOINT = ${JSON.stringify(endpoint)};
  try {
    if (script.src) ENDPOINT = new URL(${JSON.stringify(TRACK_API_PATH)}, script.src).href;
  } catch (e) {}

  function readCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  // Optional: share the visitor across subdomains (landing on www., signup on
  // app.). Only honoured when this page is that domain or under it — a
  // browser would reject any other Domain anyway, silently dropping the cookie.
  var COOKIE_DOMAIN = (function () {
    var value = (script.getAttribute("data-cookie-domain") || "").replace(/^\\./, "").toLowerCase();
    var host = (location.hostname || "").toLowerCase();
    if (!value || !host) return null;
    return host === value || host.slice(-(value.length + 1)) === "." + value ? value : null;
  })();

  function writeCookie(name, value) {
    var secure = location.protocol === "https:" ? "; Secure" : "";
    var domain = COOKIE_DOMAIN ? "; Domain=" + COOKIE_DOMAIN : "";
    document.cookie =
      name + "=" + encodeURIComponent(value) +
      "; Max-Age=" + MAX_AGE + "; Path=/; SameSite=Lax" + domain + secure;
  }

  function newVisitorId() {
    var alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    var out = "v_";
    var bytes = new Uint8Array(24);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    } else {
      for (var j = 0; j < 24; j++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  var visitorId = readCookie(COOKIE);
  if (!visitorId || !/^v_[a-z0-9]{16,48}$/.test(visitorId)) {
    visitorId = newVisitorId();
  }
  writeCookie(COOKIE, visitorId);

  var token = readCookie(REF_COOKIE);
  if (!token || !REF_PATTERN.test(token)) token = null;

  // Stripe Payment Links take the reference in the URL query
  // (client_reference_id), so a founder using them writes no code at all.
  // An href that already carries one is left alone: theirs wins.
  function decorateLinks() {
    if (!token || script.getAttribute("data-decorate-links") === "off") return;
    var anchors = document.querySelectorAll("a[href]");
    for (var a = 0; a < anchors.length; a++) {
      var href = anchors[a].getAttribute("href");
      if (!href) continue;
      try {
        var target = new URL(href, location.href);
        if (STRIPE_HOSTS.indexOf(target.hostname) === -1) continue;
        if (target.searchParams.get("client_reference_id")) continue;
        target.searchParams.set("client_reference_id", token);
        anchors[a].setAttribute("href", target.href);
      } catch (e) {}
    }
  }

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  var query = new URLSearchParams(location.search);
  var ref = null;
  for (var p = 0; p < PARAMS.length; p++) {
    var candidate = query.get(PARAMS[p]);
    if (candidate) { ref = candidate; break; }
  }

  // Exposed on every page, not only the one that carried the ref: the signup
  // page is where the founder reads it to send the visitorId to identify.
  window.Referral = {
    visitorId: visitorId,
    ref: ref,
    // The value to send to the checkout: Stripe client_reference_id, or
    // metadata[indicafluxo_ref] on a PaymentIntent or subscription.
    attributionToken: token,
    capture: function () {
      return { visitorId: visitorId, ref: ref, attributionToken: token };
    }
  };

  onReady(decorateLinks);

  if (!ref) return;

  var payload = {
    publicKey: publicKey,
    ref: ref,
    visitorId: visitorId,
    url: location.href,
    referrer: document.referrer || null,
    utm: {
      utm_source: query.get("utm_source"),
      utm_medium: query.get("utm_medium"),
      utm_campaign: query.get("utm_campaign"),
      utm_content: query.get("utm_content"),
      utm_term: query.get("utm_term")
    },
    token: token
  };

  var body = JSON.stringify(payload);

  function storeToken(value) {
    if (!value || !REF_PATTERN.test(value) || value === token) return;
    token = value;
    writeCookie(REF_COOKIE, value);
    window.Referral.attributionToken = value;
    onReady(decorateLinks);
  }

  // keepalive so the beacon survives the navigation that triggered it.
  if (window.fetch) {
    fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: body
    })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) { if (data) storeToken(data.token); })
      .catch(function () {});
  } else if (navigator.sendBeacon) {
    // No response to read: the reference arrives on the next page load, when
    // fetch is available or the cookie already holds it.
    navigator.sendBeacon(ENDPOINT, body);
  }

})();
`
}
