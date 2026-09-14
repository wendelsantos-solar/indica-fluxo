import { REF_QUERY_PARAMS, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE_DAYS } from "./constants"

/**
 * The browser tracker, served as a static asset from `/t.js`.
 *
 * Written as a plain string rather than a bundled entry point on purpose: it
 * must not depend on React, the Next.js runtime or any build step, so that the
 * same file can later be served by an edge worker unchanged.
 *
 *   <script defer src="https://app.example.com/t.js" data-key="pk_live_..."></script>
 */
export function trackerSource(endpoint: string): string {
  return `(function () {
  "use strict";
  var COOKIE = ${JSON.stringify(VISITOR_COOKIE)};
  var PARAMS = ${JSON.stringify(REF_QUERY_PARAMS)};
  var MAX_AGE = ${VISITOR_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60};
  var ENDPOINT = ${JSON.stringify(endpoint)};

  var script =
    document.currentScript ||
    document.querySelector("script[data-key]");
  var publicKey = script && script.getAttribute("data-key");
  if (!publicKey) return;

  function readCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  function writeCookie(name, value) {
    var secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      name + "=" + encodeURIComponent(value) +
      "; Max-Age=" + MAX_AGE + "; Path=/; SameSite=Lax" + secure;
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

  var query = new URLSearchParams(location.search);
  var ref = null;
  for (var p = 0; p < PARAMS.length; p++) {
    var candidate = query.get(PARAMS[p]);
    if (candidate) { ref = candidate; break; }
  }
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
    }
  };

  var body = JSON.stringify(payload);
  // keepalive so the beacon survives the navigation that triggered it.
  if (window.fetch) {
    fetch(ENDPOINT, {
      method: "POST",
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: body
    }).catch(function () {});
  } else if (navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, body);
  }

  window.Referral = {
    visitorId: visitorId,
    ref: ref,
    capture: function () { return { visitorId: visitorId, ref: ref }; }
  };
})();
`
}
