// Footfall tracker. <script defer src="https://<api>/t.js" data-site="example.com"></script>
// No cookies, no storage. Sends one small beacon per page view; window.footfall("signup") sends a custom event.
(function () {
  var script = document.currentScript;
  if (!script) return;

  var endpoint = new URL(script.src).origin + "/e";
  var domain = script.getAttribute("data-site") || location.hostname;
  var local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  if (local && !script.hasAttribute("data-dev")) return;

  var referrer = document.referrer || null;
  var lastPath = null;

  function send(name) {
    var body = JSON.stringify({ d: domain, n: name, u: location.href, r: referrer });
    // Only the first page view of a visit carries the outside referrer.
    referrer = null;
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return;
    fetch(endpoint, { method: "POST", body: body, keepalive: true, credentials: "omit" }).catch(function () {});
  }

  function pageview() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    send("pageview");
  }

  // Single-page apps change the URL without reloading.
  var pushState = history.pushState;
  history.pushState = function () {
    pushState.apply(this, arguments);
    pageview();
  };
  window.addEventListener("popstate", pageview);

  window.footfall = function (name) {
    if (typeof name === "string" && name) send(name);
  };

  pageview();
})();
