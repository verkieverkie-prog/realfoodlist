/* The Real Food List — funnel wiring (front-end only, no real payment).
   Flow:  index (opt-in, free)  →  thank-you (tripwire $9)  →  guide (one-click upsell)  →  success (delivery)
   All state lives in localStorage so the flow survives reloads and the honest
   48h countdown stays anchored to the visitor's first visit. Real money is NOT
   moved here — every checkout is a front-end stub that records intent and moves
   the visitor forward. Wire Stripe/beehiiv server-side before launch (see the
   DEV NOTE flags on each page). */
(function () {
  var LS = window.localStorage;
  var STATE_KEY = 'tt_funnel_v1';

  function load() {
    try { return JSON.parse(LS.getItem(STATE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save(s) { try { LS.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {} }
  function set(patch) { var s = load(); for (var k in patch) s[k] = patch[k]; save(s); return s; }

  function go(url) { window.location.href = url; }
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim()); }

  // ---- OPT-IN (index.html): capture email → tripwire ----
  function wireOptin() {
    var forms = document.querySelectorAll('form.optin');
    forms.forEach(function (f) {
      // an opt-in form has an email input but no card input
      var email = f.querySelector('input[type=email]');
      var card = f.querySelector('input[autocomplete=cc-number], #cc');
      if (!email || card) return;
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!isEmail(email.value)) {
          email.focus();
          email.setCustomValidity('Enter a valid email');
          email.reportValidity();
          return;
        }
        set({ email: email.value.trim(), subscribed_at: Date.now() });
        go('thank-you.html');
      });
    });
  }

  // ---- TRIPWIRE (thank-you.html): $9 buy → upsell; skip → success ----
  function wireTripwire() {
    var buy = document.querySelector('[data-buy=tripwire]');
    var pay = document.querySelector('[data-buy=tripwire-paypal]');
    var skip = document.querySelector('[data-skip=tripwire]');
    var bump = document.getElementById('bump');
    function purchase(method) {
      set({
        tripwire: 'purchased',
        tripwire_method: method,
        bump: !!(bump && bump.checked),
        tripwire_at: Date.now()
      });
      go('guide.html'); // one-click upsell to the complete guide
    }
    if (buy) buy.addEventListener('click', function (e) { e.preventDefault(); purchase('card'); });
    if (pay) pay.addEventListener('click', function (e) { e.preventDefault(); purchase('paypal'); });
    if (skip) skip.addEventListener('click', function (e) {
      e.preventDefault();
      set({ tripwire: 'declined' });
      go('success.html');
    });
  }

  // ---- UPSELL (guide.html): pick a tier → success; decline → success ----
  function wireUpsell() {
    var buttons = document.querySelectorAll('[data-upsell]');
    if (!buttons.length) return;
    buttons.forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        set({ upsell: b.getAttribute('data-upsell'), upsell_at: Date.now() });
        go('success.html');
      });
    });
    var decline = document.querySelector('[data-upsell-decline]');
    if (decline) decline.addEventListener('click', function (e) {
      e.preventDefault();
      set({ upsell: 'declined' });
      go('success.html');
    });
  }

  // ---- PRODUCTS (index.html): add a tier to the cart → checkout ----
  var TIERS = {
    one:      { name: 'One-Category Guide',            price: 9  },
    complete: { name: 'The Complete Grocery Guide',    price: 27 },
    system:   { name: 'The Real Food Kitchen System',  price: 97 }
  };
  function wireProducts() {
    document.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        set({ cart: b.getAttribute('data-add'), cart_at: Date.now() });
        go('checkout.html');
      });
    });
  }

  // ---- CHECKOUT (checkout.html): render cart, take email+payment (stub) ----
  function wireCheckout() {
    var cartEl = document.getElementById('cart');
    if (!cartEl) return;
    var s = load();
    if (!s.cart || !TIERS[s.cart]) { go('index.html#pricing'); return; }
    var bump = document.getElementById('bump');

    function render() {
      var t = TIERS[s.cart];
      cartEl.innerHTML =
        '<div class="cartline"><span class="nm">' + t.name + '</span><span>$' + t.price + '</span></div>' +
        (bump && bump.checked
          ? '<div class="cartline"><span class="nm">Printable Pocket Cards</span><span>$9</span></div>' : '');
      var total = t.price + (bump && bump.checked ? 9 : 0);
      var totEl = document.getElementById('total');
      if (totEl) totEl.textContent = '$' + total;
      var swap = document.getElementById('swap');
      if (swap) {
        var others = Object.keys(TIERS).filter(function (k) { return k !== s.cart; });
        swap.innerHTML = 'Change your pick: ' + others.map(function (k) {
          return '<a href="#" data-swap="' + k + '">' + TIERS[k].name + ' ($' + TIERS[k].price + ')</a>';
        }).join(' · ');
        swap.querySelectorAll('[data-swap]').forEach(function (a) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            s = set({ cart: a.getAttribute('data-swap') });
            render();
          });
        });
      }
    }
    render();
    if (bump) bump.addEventListener('change', render);

    var email = document.getElementById('email');
    if (email && s.email) email.value = s.email;
    function complete(method) {
      if (!isEmail(email.value)) {
        email.focus(); email.setCustomValidity('Enter a valid email'); email.reportValidity();
        return;
      }
      set({
        email: email.value.trim(),
        purchase: s.cart,
        purchase_method: method,
        bump: !!(bump && bump.checked),
        purchase_at: Date.now()
      });
      go('success.html');
    }
    var buy = document.querySelector('[data-checkout]');
    var pp  = document.querySelector('[data-checkout-paypal]');
    if (buy) buy.addEventListener('click', function (e) { e.preventDefault(); complete('card'); });
    if (pp)  pp.addEventListener('click', function (e) { e.preventDefault(); complete('paypal'); });
  }

  // ---- SUCCESS (success.html): reflect what they actually bought ----
  function renderSuccess() {
    var root = document.getElementById('success-summary');
    if (!root) return;
    var s = load();
    var lines = [];
    lines.push('Free Real Food List — sent to <strong>' + (s.email ? esc(s.email) : 'your inbox') + '</strong>');
    if (s.tripwire === 'purchased') {
      lines.push('Complete Real Dairy guide — <strong>unlocked</strong>');
      if (s.bump) lines.push('Printable Pocket Cards — <strong>added</strong>');
    }
    if (s.purchase && TIERS[s.purchase]) {
      lines.push(TIERS[s.purchase].name + ' — <strong>unlocked</strong>');
      if (s.bump) lines.push('Printable Pocket Cards — <strong>added</strong>');
    }
    if (s.upsell && s.upsell !== 'declined') {
      var names = {
        'complete': 'The Complete Grocery Guide (all 20+ categories)',
        'system': 'The Real Food Kitchen System (everything)',
        'one': 'One-Category Guide'
      };
      lines.push((names[s.upsell] || 'Guide upgrade') + ' — <strong>unlocked</strong>');
    }
    root.innerHTML = lines.map(function (l) {
      return '<li><span class="ok">✓</span> ' + l + '</li>';
    }).join('');
    var email = document.getElementById('success-email');
    if (email && s.email) email.textContent = s.email;
  }
  function esc(v) { return String(v).replace(/[<>&"]/g, function (c) {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  function init() {
    wireOptin();
    wireProducts();
    wireCheckout();
    wireTripwire();
    wireUpsell();
    renderSuccess();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
