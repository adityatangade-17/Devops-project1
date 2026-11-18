/* Neubrain Solutions embeddable booking widget.
 *
 * Drop this on any website to render a booking page inline:
 *
 *   <div data-forgechat-booking-page="epr-registration"></div>
 *   <script async src="https://YOUR-FORGECHAT-HOST/booking-widget.js"></script>
 *
 * The div is replaced with an iframe pointing at /book.html?service=<slug>&embed=1
 * on the same host the script was loaded from. The iframe auto-resizes to its
 * content via postMessage. Multiple widgets per page are supported.
 */
(function () {
  var script = document.currentScript;
  var origin;
  try { origin = new URL(script.src).origin; } catch (e) { origin = window.location.origin; }

  function mount(el) {
    if (el.__forgechatMounted) return;
    var slug = el.getAttribute('data-forgechat-booking-page');
    if (!slug) return;
    el.__forgechatMounted = true;

    var iframe = document.createElement('iframe');
    iframe.src = origin + '/book.html?service=' + encodeURIComponent(slug) + '&embed=1';
    iframe.title = 'Book a consultation';
    iframe.setAttribute('loading', 'lazy');
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.minHeight = '560px';
    iframe.style.colorScheme = 'normal';
    el.appendChild(iframe);

    window.addEventListener('message', function (e) {
      if (e.origin !== origin) return;
      if (e.source !== iframe.contentWindow) return;
      var h = e.data && e.data.forgechatBookingHeight;
      if (h && typeof h === 'number') iframe.style.height = Math.ceil(h) + 'px';
    });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-forgechat-booking-page]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
