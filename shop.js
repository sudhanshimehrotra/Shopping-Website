// Chaddha Fashion - shared shop behaviour.
//
// Everything that more than one page needs lives here: logging in,
// the cart (with sizes and quantities), saved orders, the little pop-up
// messages, and the header search box.
//
// Load shop-data.js before this file, because the cart looks products up
// by id and needs the catalogue to already exist.

const Shop = (function () {
  const CART_KEY = 'cart';
  const ORDERS_KEY = 'orders';
  const TOKEN_KEY = 'chaddha_token';

  const SHIPPING_COST = 99;
  const TAX_RATE = 0.1;
  const MAX_PER_LINE = 10; // nobody needs eleven of the same shirt

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------

  // 1299 -> "₹1,299"
  function money(amount) {
    return '₹' + Math.round(Number(amount) || 0).toLocaleString('en-IN');
  }

  function findProduct(id) {
    const wanted = Number(id);
    return PRODUCTS.find(product => product.id === wanted) || null;
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category;
  }

  // A star row like "★★★★☆" for the rating shown on cards.
  function stars(rating) {
    const filled = Math.round(Number(rating) || 0);
    return '★'.repeat(filled) + '☆'.repeat(Math.max(0, 5 - filled));
  }

  // ------------------------------------------------------------------
  // Pop-up messages, used instead of the browser's alert() box
  // ------------------------------------------------------------------
  function toast(message, kind) {
    let host = document.querySelector('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }

    const bubble = document.createElement('div');
    bubble.className = 'toast toast-' + (kind || 'info');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = kind === 'error' ? '!' : kind === 'success' ? '✓' : 'i';

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message; // textContent, so a product name can never inject markup

    bubble.appendChild(icon);
    bubble.appendChild(text);
    host.appendChild(bubble);

    // One frame later, so the browser animates the entrance.
    requestAnimationFrame(() => bubble.classList.add('is-visible'));

    setTimeout(() => {
      bubble.classList.remove('is-visible');
      setTimeout(() => bubble.remove(), 320);
    }, 3200);
  }

  // ------------------------------------------------------------------
  // Inline form errors, also instead of alert()
  // ------------------------------------------------------------------
  function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;

    field.classList.add('has-error');
    field.setAttribute('aria-invalid', 'true');

    let note = document.querySelector('[data-error-for="' + fieldId + '"]');
    if (!note) {
      note = document.createElement('p');
      note.className = 'field-error';
      note.setAttribute('data-error-for', fieldId);
      field.insertAdjacentElement('afterend', note);
    }
    note.textContent = message;
  }

  function clearFieldErrors(scope) {
    const root = scope || document;
    root.querySelectorAll('.field-error').forEach(note => note.remove());
    root.querySelectorAll('.has-error').forEach(field => {
      field.classList.remove('has-error');
      field.removeAttribute('aria-invalid');
    });
  }

  // Clear a field's error as soon as the shopper starts fixing it.
  function watchFieldsForRepair(scope) {
    (scope || document).querySelectorAll('input, select, textarea').forEach(field => {
      field.addEventListener('input', () => {
        field.classList.remove('has-error');
        field.removeAttribute('aria-invalid');
        const note = document.querySelector('[data-error-for="' + field.id + '"]');
        if (note) note.remove();
      });
    });
  }

  // ------------------------------------------------------------------
  // The cart
  //
  // Stored shape is deliberately small: { id, size, quantity }. Names,
  // prices and images are always read back from the catalogue, so a price
  // change never leaves a stale number sitting in someone's cart.
  // ------------------------------------------------------------------

  // Reads, repairs and merges the stored cart. Also upgrades carts saved
  // by the older version of the site, which stored a whole product copy
  // per row and had no sizes or quantities at all.
  function getCart() {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(CART_KEY));
    } catch (error) {
      stored = null;
    }
    if (!Array.isArray(stored)) return [];

    const lines = [];
    stored.forEach(entry => {
      if (!entry) return;
      const product = findProduct(entry.id);
      if (!product) return; // product was removed from the catalogue

      const size = product.sizes.includes(entry.size) ? entry.size : product.sizes[0];
      const asked = parseInt(entry.quantity, 10);
      const quantity = Math.min(MAX_PER_LINE, Math.max(1, isNaN(asked) ? 1 : asked));

      // Old carts pushed the same product twice instead of counting it.
      const existing = lines.find(line => line.id === product.id && line.size === size);
      if (existing) {
        existing.quantity = Math.min(MAX_PER_LINE, existing.quantity + quantity);
      } else {
        lines.push({ id: product.id, size: size, quantity: quantity });
      }
    });
    return lines;
  }

  function saveCart(lines) {
    localStorage.setItem(CART_KEY, JSON.stringify(lines));
    updateCartBadge();
  }

  // Joins the stored cart with the catalogue so pages can just render it.
  function cartLines() {
    return getCart().map(line => {
      const product = findProduct(line.id);
      return {
        id: product.id,
        size: line.size,
        quantity: line.quantity,
        name: product.name,
        image: product.image,
        price: product.price,
        description: product.description,
        category: product.category,
        subcategory: product.subcategory,
        sizes: product.sizes,
        lineTotal: product.price * line.quantity
      };
    });
  }

  function cartCount() {
    return getCart().reduce((sum, line) => sum + line.quantity, 0);
  }

  function totals() {
    const lines = cartLines();
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const shipping = lines.length > 0 ? SHIPPING_COST : 0;
    const tax = Math.round(subtotal * TAX_RATE);
    return {
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: subtotal + shipping + tax
    };
  }

  // Returns a short outcome so the calling page can show the right message.
  function addToCart(id, size, quantity) {
    const product = findProduct(id);
    if (!product) return { ok: false, reason: 'missing' };

    const chosenSize = product.sizes.includes(size) ? size : null;
    if (!chosenSize) return { ok: false, reason: 'size' };

    const wanted = Math.max(1, parseInt(quantity, 10) || 1);
    const lines = getCart();
    const existing = lines.find(line => line.id === product.id && line.size === chosenSize);

    if (existing) {
      if (existing.quantity >= MAX_PER_LINE) {
        return { ok: false, reason: 'limit', product: product, size: chosenSize };
      }
      existing.quantity = Math.min(MAX_PER_LINE, existing.quantity + wanted);
    } else {
      lines.push({ id: product.id, size: chosenSize, quantity: Math.min(MAX_PER_LINE, wanted) });
    }

    saveCart(lines);
    return { ok: true, product: product, size: chosenSize, quantity: wanted };
  }

  function setQuantity(id, size, quantity) {
    const wanted = parseInt(quantity, 10);
    if (isNaN(wanted) || wanted < 1) return removeLine(id, size);

    const lines = getCart();
    const line = lines.find(entry => entry.id === Number(id) && entry.size === size);
    if (!line) return false;

    line.quantity = Math.min(MAX_PER_LINE, wanted);
    saveCart(lines);
    return true;
  }

  function removeLine(id, size) {
    const lines = getCart().filter(line => !(line.id === Number(id) && line.size === size));
    saveCart(lines);
    return true;
  }

  function clearCart() {
    localStorage.removeItem(CART_KEY);
    updateCartBadge();
  }

  // Every page marks its badge with data-cart-count, so one call updates
  // whichever badge that page happens to have.
  function updateCartBadge() {
    const count = cartCount();
    document.querySelectorAll('[data-cart-count], #cart-count').forEach(badge => {
      badge.textContent = count;
      badge.classList.toggle('is-empty', count === 0);
    });
  }

  // ------------------------------------------------------------------
  // Saved orders
  // ------------------------------------------------------------------
  function getOrders() {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(ORDERS_KEY));
    } catch (error) {
      stored = null;
    }
    if (!Array.isArray(stored)) return [];
    // Newest first, which is what people expect from an order list.
    return stored.slice().sort((a, b) => String(b.placedAt).localeCompare(String(a.placedAt)));
  }

  function saveOrder(order) {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(ORDERS_KEY));
    } catch (error) {
      stored = null;
    }
    if (!Array.isArray(stored)) stored = [];
    stored.push(order);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(stored));
  }

  function formatOrderDate(isoString) {
    const when = new Date(isoString);
    if (isNaN(when.getTime())) return 'Unknown date';
    return when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ------------------------------------------------------------------
  // Login, logout, and "who am I?"
  // ------------------------------------------------------------------
  function redirectToLogin() {
    // Remember where we were, so login can send us straight back.
    const here = window.location.pathname.split('/').pop() + window.location.search;
    window.location.href = 'login.html?next=' + encodeURIComponent(here);
  }

  // Asks the server whether the saved token is still good. The real check
  // happens on the server, so it cannot be faked from the browser.
  async function requireLogin() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      redirectToLogin();
      return null;
    }

    try {
      const response = await fetch('/api/me', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!response.ok) throw new Error('Session expired');

      const user = await response.json();
      document.querySelectorAll('[data-user-name]').forEach(slot => {
        slot.textContent = (user.fullName || '').split(' ')[0] || 'there';
      });
      return user;
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      redirectToLogin();
      return null;
    }
  }

  // Reads the logged-in user without kicking a guest out to the login page.
  async function currentUser() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      const response = await fetch('/api/me', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  async function logout() {
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      });
    } catch (error) {
      // Even with the server unreachable, this browser is logged out.
    }
    window.location.href = 'login.html';
  }

  // ------------------------------------------------------------------
  // Search
  //
  // Matches on name, category and collection, so "kurta", "kids" and
  // "ethnic" all find something sensible.
  // ------------------------------------------------------------------
  function searchProducts(query, list) {
    const words = String(query || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const source = list || PRODUCTS;
    if (words.length === 0) return source.slice();

    return source.filter(product => {
      const haystack = [
        product.name,
        product.category,
        categoryLabel(product.category),
        product.subcategory,
        product.description
      ]
        .join(' ')
        .toLowerCase();
      return words.every(word => haystack.includes(word));
    });
  }

  // ------------------------------------------------------------------
  // If a picture ever fails to load, show a plain placeholder rather than
  // the browser's broken-image icon. Listening on the way down catches
  // images added later by a script, not just the ones in the markup.
  // ------------------------------------------------------------------
  function catchBrokenImages() {
    document.addEventListener(
      'error',
      event => {
        const target = event.target;
        if (!target || target.tagName !== 'IMG') return;
        if (target.dataset.fallbackApplied) return; // do not loop if the placeholder itself is missing
        target.dataset.fallbackApplied = '1';
        target.src = './placeholder.svg';
      },
      true
    );
  }

  // Wires up the header: cart badge, search box and any logout button.
  function initHeader() {
    updateCartBadge();
    catchBrokenImages();

    document.querySelectorAll('[data-search-form]').forEach(form => {
      const input = form.querySelector('input');
      if (!input) return;

      const existing = new URLSearchParams(window.location.search).get('q');
      if (existing) input.value = existing;

      form.addEventListener('submit', event => {
        event.preventDefault();
        const query = input.value.trim();
        window.location.href = 'products.html' + (query ? '?q=' + encodeURIComponent(query) : '');
      });
    });

    document.querySelectorAll('[data-logout]').forEach(button => {
      button.addEventListener('click', logout);
    });
  }

  // A product card, shared by the home page, the search results and the
  // "you may also like" row on the product page.
  function productCard(product) {
    return (
      '<article class="shop-card">' +
      '<a class="shop-card-media" href="product.html?id=' + product.id + '">' +
      '<img src="' + product.image + '" alt="' + product.name + '" loading="lazy" />' +
      (product.newArrival ? '<span class="shop-card-tag">New</span>' : '') +
      '</a>' +
      '<div class="shop-card-body">' +
      '<p class="shop-card-meta">' + categoryLabel(product.category) + ' · ' + product.subcategory + '</p>' +
      '<h3 class="shop-card-name"><a href="product.html?id=' + product.id + '">' + product.name + '</a></h3>' +
      '<p class="shop-card-rating"><span class="shop-stars">' + stars(product.rating) + '</span> ' +
      product.rating.toFixed(1) + ' <span>(' + product.reviews + ')</span></p>' +
      '<p class="shop-card-price">' + money(product.price) + '</p>' +
      '<a class="shop-card-btn" href="product.html?id=' + product.id + '">Choose size</a>' +
      '</div>' +
      '</article>'
    );
  }

  return {
    SHIPPING_COST: SHIPPING_COST,
    TAX_RATE: TAX_RATE,
    MAX_PER_LINE: MAX_PER_LINE,
    money: money,
    findProduct: findProduct,
    categoryLabel: categoryLabel,
    stars: stars,
    toast: toast,
    showFieldError: showFieldError,
    clearFieldErrors: clearFieldErrors,
    watchFieldsForRepair: watchFieldsForRepair,
    getCart: getCart,
    cartLines: cartLines,
    cartCount: cartCount,
    totals: totals,
    addToCart: addToCart,
    setQuantity: setQuantity,
    removeLine: removeLine,
    clearCart: clearCart,
    updateCartBadge: updateCartBadge,
    getOrders: getOrders,
    saveOrder: saveOrder,
    formatOrderDate: formatOrderDate,
    requireLogin: requireLogin,
    currentUser: currentUser,
    logout: logout,
    searchProducts: searchProducts,
    initHeader: initHeader,
    productCard: productCard
  };
})();
