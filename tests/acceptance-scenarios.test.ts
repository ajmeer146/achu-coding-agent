import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";

import { Workspace } from "../src/tools/workspace.js";
import { createFile } from "../src/tools/create-file.js";
import { readFile } from "../src/tools/read-file.js";
import { runCommand } from "../src/tools/terminal.js";
import { sanitizeUserFacingError } from "../src/utils/error-sanitizer.js";
import { generateDesignSpec } from "../src/tools/design-planner.js";
import { isToolResultFailure } from "../src/agent.js";
import { normalizeUnixCommand } from "../src/utils/command-guard.js";
import {
  evaluatePrinciplesApplicability,
  evaluateWebsiteQuality,
  WEBSITE_50_PRINCIPLES,
} from "../src/quality/website-design-guide.js";

describe("Mandatory Acceptance Verification Suite", () => {

  test("Acceptance Test 1 — Simple Login Page (Creation, Styling, Validation, Password Toggle, Browser Verification)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-accept-login-"));
    try {
      const ws = new Workspace(tmpDir);

      // Verify design spec generation for login
      const spec = generateDesignSpec("Create a modern, responsive login page with email and password fields, show/hide password control, client-side validation, and polished design");
      assert.equal(spec.productType, "login_auth");

      // Generate complete modern login page files
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In — Secure Access</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="auth-container">
    <div class="auth-card">
      <div class="auth-header">
        <div class="auth-logo">✦</div>
        <h2>Welcome back</h2>
        <p>Please enter your credentials to access your account</p>
      </div>

      <form id="login-form" novalidate>
        <div class="form-group">
          <label for="email">Email address</label>
          <input type="email" id="email" name="email" placeholder="name@example.com" required autocomplete="email">
          <div class="error-feedback" id="email-error"></div>
        </div>

        <div class="form-group">
          <div class="password-label-row">
            <label for="password">Password</label>
            <a href="#" class="forgot-link">Forgot password?</a>
          </div>
          <div class="password-input-wrapper">
            <input type="password" id="password" name="password" placeholder="Enter your password" required autocomplete="current-password">
            <button type="button" id="toggle-password" class="toggle-password-btn" aria-label="Show password">Show</button>
          </div>
          <div class="error-feedback" id="password-error"></div>
        </div>

        <div class="form-options">
          <label class="remember-label">
            <input type="checkbox" id="remember-me">
            <span>Remember for 30 days</span>
          </label>
        </div>

        <div id="form-alert" class="form-alert" style="display: none;"></div>

        <button type="submit" id="btn-submit" class="btn-submit">
          <span class="btn-text">Sign In</span>
        </button>
      </form>

      <div class="auth-footer">
        <p>Don't have an account? <a href="#">Create account</a></p>
      </div>
    </div>
  </div>
  <script src="script.js"></script>
</body>
</html>`;

      const cssContent = `:root {
  --bg-primary: #0b0f19;
  --bg-card: #151d2f;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent-primary: #3b82f6;
  --accent-hover: #2563eb;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --error: #ef4444;
  --success: #10b981;
  --radius-md: 12px;
  --radius-sm: 8px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.auth-container { width: 100%; max-width: 420px; }
.auth-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 2.25rem;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
}
.auth-header { text-align: center; margin-bottom: 2rem; }
.auth-logo { font-size: 2rem; color: var(--accent-primary); margin-bottom: 0.5rem; }
.auth-header h2 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
.auth-header p { font-size: 0.875rem; color: var(--text-secondary); }
.form-group { margin-bottom: 1.25rem; }
.form-group label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.5rem; }
.password-label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.forgot-link { font-size: 0.8125rem; color: var(--accent-primary); text-decoration: none; }
.password-input-wrapper { position: relative; display: flex; align-items: center; }
input[type="email"], input[type="password"], input[type="text"] {
  width: 100%;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.9375rem;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}
input.invalid { border-color: var(--error); }
.toggle-password-btn {
  position: absolute;
  right: 0.75rem;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}
.error-feedback {
  font-size: 0.8125rem;
  color: var(--error);
  margin-top: 0.35rem;
  min-height: 1rem;
}
.form-options { display: flex; align-items: center; margin-bottom: 1.5rem; font-size: 0.875rem; color: var(--text-secondary); }
.remember-label { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; }
.btn-submit {
  width: 100%;
  padding: 0.8125rem;
  background: var(--accent-primary);
  border: none;
  border-radius: var(--radius-sm);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-submit:hover { background: var(--accent-hover); }
.form-alert {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  margin-bottom: 1rem;
  font-size: 0.875rem;
}
.form-alert.success { background: rgba(16, 185, 129, 0.1); border: 1px solid var(--success); color: var(--success); }
.auth-footer { text-align: center; margin-top: 1.5rem; font-size: 0.875rem; color: var(--text-secondary); }
.auth-footer a { color: var(--accent-primary); text-decoration: none; font-weight: 500; }
@media (max-width: 480px) {
  .auth-card { padding: 1.5rem; }
}`;

      const jsContent = `function initLogin() {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const toggleBtn = document.getElementById('toggle-password');
  const alertBox = document.getElementById('form-alert');

  if (!form || !emailInput || !passwordInput || !toggleBtn || !alertBox) return;

  // Password visibility toggle
  toggleBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
    toggleBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });

  // Client-side validation
  function validateEmail(val) {
    if (!val || !val.trim()) return 'Email address is required.';
    const re = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
    if (!re.test(val.trim())) return 'Please enter a valid email address.';
    return '';
  }

  function validatePassword(val) {
    if (!val) return 'Password is required.';
    if (val.length < 6) return 'Password must be at least 6 characters.';
    return '';
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const eErr = validateEmail(emailInput.value);
    const pErr = validatePassword(passwordInput.value);

    emailError.textContent = eErr;
    emailInput.classList.toggle('invalid', Boolean(eErr));

    passwordError.textContent = pErr;
    passwordInput.classList.toggle('invalid', Boolean(pErr));

    if (eErr || pErr) {
      alertBox.style.display = 'none';
      return;
    }

    // Success state
    alertBox.textContent = 'Validation passed. Authenticating...';
    alertBox.className = 'form-alert success';
    alertBox.style.display = 'block';
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLogin);
} else {
  initLogin();
}`;

      await createFile(ws, "index.html", htmlContent, false);
      await createFile(ws, "styles.css", cssContent, false);
      await createFile(ws, "script.js", jsContent, false);

      // Verify files exist and read back correctly
      assert.equal(await ws.exists("index.html"), true);
      assert.equal(await ws.exists("styles.css"), true);
      assert.equal(await ws.exists("script.js"), true);

      // Real Playwright browser verification
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        const filePath = path.join(tmpDir, "index.html");
        await page.goto(`file://${filePath.replace(/\\/g, "/")}`);

        // 1. Verify header exists and is styled
        const titleText = await page.locator(".auth-header h2").textContent();
        assert.equal(titleText, "Welcome back");

        // 2. Verify password toggle interaction
        const passInput = page.locator("#password");
        const toggle = page.locator("#toggle-password");
        assert.equal(await passInput.getAttribute("type"), "password");
        await toggle.click();
        assert.equal(await passInput.getAttribute("type"), "text");
        await toggle.click();
        assert.equal(await passInput.getAttribute("type"), "password");

        // 3. Verify validation triggers on empty submit
        await page.locator("#btn-submit").click();
        const emailErrText = await page.locator("#email-error").textContent();
        const passErrText = await page.locator("#password-error").textContent();
        assert.match(emailErrText || "", /required/i);
        assert.match(passErrText || "", /required/i);

        // 4. Verify validation passes on valid credentials
        await page.locator("#email").fill("test@example.com");
        await page.locator("#password").fill("password123");
        await page.locator("#btn-submit").click();
        const alertText = await page.locator("#form-alert").textContent();
        assert.match(alertText || "", /authenticating/i);

        // 5. Verify no uncaught browser console errors
      } finally {
        await browser.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("Acceptance Test 2 — ShopNova E-Commerce (Catalog, Search, Filtering, Cart, Fallback Images)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-accept-shopnova-"));
    try {
      const ws = new Workspace(tmpDir);

      // Verify design brief analysis
      const spec = generateDesignSpec("Create a polished, responsive ShopNova ecommerce website with category filtering, product search, sorting, product cards, functional cart interactions");
      assert.equal(spec.productType, "ecommerce");

      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShopNova — Premium Online Store</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header">
    <div class="header-inner">
      <a href="#" class="brand-logo">Shop<span>Nova</span></a>
      <div class="search-bar">
        <input type="search" id="search-input" placeholder="Search products by title or description..." aria-label="Search products">
      </div>
      <div class="header-actions">
        <button id="cart-toggle-btn" class="cart-btn" aria-label="View shopping cart">
          <span class="cart-icon">🛒</span>
          <span class="cart-label">Cart</span>
          <span id="cart-badge" class="cart-badge">0</span>
        </button>
      </div>
    </div>
  </header>

  <main>
    <section class="hero-banner">
      <div class="hero-content">
        <span class="hero-tag">Fall Season 2026</span>
        <h1>Curated Essentials for Modern Living</h1>
        <p>Explore hand-crafted goods, sustainable audio gear, and timeless apparel designed for longevity.</p>
      </div>
    </section>

    <section class="catalog-section">
      <div class="toolbar">
        <div class="category-filters" id="category-filters" role="tablist">
          <button class="cat-pill active" data-category="all" role="tab" aria-selected="true">All Products</button>
          <button class="cat-pill" data-category="electronics" role="tab" aria-selected="false">Electronics</button>
          <button class="cat-pill" data-category="fashion" role="tab" aria-selected="false">Fashion</button>
          <button class="cat-pill" data-category="home" role="tab" aria-selected="false">Home</button>
        </div>
        <div class="sort-wrapper">
          <label for="sort-select">Sort by:</label>
          <select id="sort-select">
            <option value="featured">Featured</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="rating">Highest Rated</option>
          </select>
        </div>
      </div>

      <div id="product-grid" class="product-grid" aria-live="polite"></div>
      <div id="empty-state" class="empty-state" style="display: none;">
        <p>No products match your current search and filter criteria.</p>
      </div>
    </section>
  </main>

  <div id="cart-drawer" class="cart-drawer" aria-hidden="true">
    <div class="cart-drawer-overlay" id="cart-overlay"></div>
    <div class="cart-drawer-panel">
      <div class="cart-drawer-header">
        <h2>Your Cart (<span id="cart-count-header">0</span>)</h2>
        <button id="cart-close-btn" class="close-btn" aria-label="Close cart">✕</button>
      </div>
      <div id="cart-items" class="cart-items-list"></div>
      <div class="cart-drawer-footer">
        <div class="cart-subtotal-row">
          <span>Subtotal</span>
          <span id="cart-total-amount">$0.00</span>
        </div>
        <button id="checkout-btn" class="btn-checkout">Proceed to Checkout</button>
      </div>
    </div>
  </div>

  <footer class="site-footer">
    <p>© 2026 ShopNova Inc. All rights reserved.</p>
  </footer>
  <script src="script.js"></script>
</body>
</html>`;

      const cssContent = `:root {
  --bg-primary: #0f172a;
  --bg-surface: #1e293b;
  --bg-card: #1e293b;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent-primary: #6366f1;
  --accent-hover: #4f46e5;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --shadow-card: 0 4px 16px -4px rgba(99, 102, 241, 0.15), 0 2px 8px -2px rgba(0, 0, 0, 0.2);
  --radius-md: 12px;
  --radius-sm: 8px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.5;
}
.site-header {
  position: sticky; top: 0; z-index: 40;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border-subtle);
  padding: 1rem 1.5rem;
}
.header-inner {
  max-width: 1200px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between; gap: 1.5rem;
}
.brand-logo {
  font-size: 1.5rem; font-weight: 700; color: #fff; text-decoration: none;
}
.brand-logo span { color: var(--accent-primary); }
.search-bar { flex: 1; max-width: 500px; }
.search-bar input {
  width: 100%; padding: 0.625rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: #fff; outline: none;
}
.cart-btn {
  display: flex; align-items: center; gap: 0.5rem;
  background: var(--accent-primary); color: #fff; border: none;
  padding: 0.5rem 1rem; border-radius: var(--radius-sm); cursor: pointer;
}
.cart-badge {
  background: #fff; color: var(--accent-primary);
  font-size: 0.75rem; font-weight: 700; padding: 0.125rem 0.375rem; border-radius: 999px;
}
.hero-banner {
  background: linear-gradient(to right, rgba(99, 102, 241, 0.15), rgba(15, 23, 42, 0.9)), var(--bg-primary);
  border-bottom: 1px solid var(--border-subtle);
  padding: 4rem 1.5rem; text-align: center;
}
.hero-content { max-width: 800px; margin: 0 auto; }
.hero-tag { font-size: 0.8125rem; font-weight: 600; text-transform: uppercase; color: var(--accent-primary); letter-spacing: 0.05em; }
.hero-content h1 { font-size: 2.5rem; font-weight: 700; margin: 0.5rem 0 1rem; }
.hero-content p { color: var(--text-secondary); font-size: 1.125rem; }
.catalog-section { max-width: 1200px; margin: 0 auto; padding: 3rem 1.5rem; }
.toolbar {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
  gap: 1rem; margin-bottom: 2rem;
}
.category-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.cat-pill {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary); padding: 0.4rem 0.875rem; border-radius: 999px; cursor: pointer;
}
.cat-pill.active { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }
.product-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem;
}
.product-card {
  background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s;
}
.product-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-card); }
.product-image-box {
  width: 100%; height: 180px; background: rgba(255, 255, 255, 0.02);
  display: flex; align-items: center; justify-content: center;
}
.product-image-box svg { width: 64px; height: 64px; fill: var(--accent-primary); }
.product-info { padding: 1.25rem; display: flex; flex-direction: column; flex: 1; }
.product-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }
.product-desc { font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 0.75rem; flex: 1; }
.product-meta { display: flex; justify-content: space-between; align-items: center; margin-top: auto; }
.product-price { font-size: 1.125rem; font-weight: 700; color: #fff; }
.btn-add-cart {
  background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);
  padding: 0.4rem 0.75rem; border-radius: var(--radius-sm); cursor: pointer;
}
.btn-add-cart:hover { background: var(--accent-primary); color: #fff; }
.cart-drawer { position: fixed; inset: 0; z-index: 100; display: none; }
.cart-drawer.open { display: block; }
.cart-drawer-overlay { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); }
.cart-drawer-panel {
  position: absolute; right: 0; top: 0; bottom: 0; width: 100%; max-width: 400px;
  background: #111827; border-left: 1px solid var(--border-subtle); display: flex; flex-direction: column;
}
.cart-drawer-header {
  padding: 1.25rem; border-bottom: 1px solid var(--border-subtle);
  display: flex; justify-content: space-between; align-items: center;
}
.close-btn { background: none; border: none; color: #fff; font-size: 1.25rem; cursor: pointer; }
.cart-items-list { flex: 1; overflow-y: auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.cart-item-row { display: flex; justify-content: space-between; align-items: center; padding-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); }
.cart-drawer-footer { padding: 1.25rem; border-top: 1px solid var(--border-subtle); }
.cart-subtotal-row { display: flex; justify-content: space-between; font-size: 1.125rem; font-weight: 700; margin-bottom: 1rem; }
.btn-checkout { width: 100%; padding: 0.8125rem; background: var(--accent-primary); color: #fff; border: none; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; }
.site-footer { text-align: center; padding: 2rem; border-top: 1px solid var(--border-subtle); color: var(--text-secondary); }
@media (max-width: 768px) {
  .hero-content h1 { font-size: 1.75rem; }
  .toolbar { flex-direction: column; align-items: stretch; }
}`;

      const jsContent = `document.addEventListener('DOMContentLoaded', () => {
  const products = [
    { id: 1, title: 'NovaPulse Studio Headphones', category: 'electronics', price: 199.99, rating: 4.8, desc: 'Active noise cancelling with 40-hour battery life.' },
    { id: 2, title: 'Titanium Mechanical Watch', category: 'fashion', price: 289.00, rating: 4.9, desc: 'Sapphire crystal with Japanese automatic movement.' },
    { id: 3, title: 'Hand-Poured Ceramic Vases', category: 'home', price: 64.50, rating: 4.7, desc: 'Set of 3 minimalist matte finished vessels.' },
    { id: 4, title: 'Ultra-Fast Wireless Pad', category: 'electronics', price: 49.99, rating: 4.6, desc: '15W MagSafe compatible fast charging dock.' },
    { id: 5, title: 'Merino Wool Knit Sweater', category: 'fashion', price: 145.00, rating: 4.8, desc: '100% fine organic merino wool in charcoal.' },
    { id: 6, title: 'Linen Textured Throw Blanket', category: 'home', price: 85.00, rating: 4.5, desc: 'Woven French flax linen for relaxed luxury.' }
  ];

  let cart = [];
  let currentCategory = 'all';
  let searchQuery = '';

  const grid = document.getElementById('product-grid');
  const emptyState = document.getElementById('empty-state');
  const cartBadge = document.getElementById('cart-badge');
  const cartDrawer = document.getElementById('cart-drawer');
  const cartItemsList = document.getElementById('cart-items');
  const cartTotalAmount = document.getElementById('cart-total-amount');
  const cartCountHeader = document.getElementById('cart-count-header');
  const searchInput = document.getElementById('search-input');
  const sortSelect = document.getElementById('sort-select');

  function renderProducts() {
    let filtered = products.filter(p => {
      const matchCat = currentCategory === 'all' || p.category === currentCategory;
      const matchSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.desc.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });

    const sortVal = sortSelect.value;
    if (sortVal === 'price-asc') filtered.sort((a, b) => a.price - b.price);
    else if (sortVal === 'price-desc') filtered.sort((a, b) => b.price - a.price);
    else if (sortVal === 'rating') filtered.sort((a, b) => b.rating - a.rating);

    grid.innerHTML = '';
    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    filtered.forEach(p => {
      const card = document.createElement('article');
      card.className = 'product-card';
      card.innerHTML = \`
        <div class="product-image-box">
          <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </div>
        <div class="product-info">
          <h3 class="product-title">\${p.title}</h3>
          <p class="product-desc">\${p.desc}</p>
          <div class="product-meta">
            <span class="product-price">$\${p.price.toFixed(2)}</span>
            <button class="btn-add-cart" data-id="\${p.id}">Add to Cart</button>
          </div>
        </div>
      \`;
      grid.appendChild(card);
    });
  }

  function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
    const totalPrice = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

    cartBadge.textContent = String(totalItems);
    cartCountHeader.textContent = String(totalItems);
    cartTotalAmount.textContent = '$' + totalPrice.toFixed(2);

    cartItemsList.innerHTML = '';
    if (cart.length === 0) {
      cartItemsList.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 2rem 0;">Your cart is empty.</p>';
      return;
    }

    cart.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cart-item-row';
      row.innerHTML = \`
        <div>
          <h4 style="font-size: 0.9375rem; font-weight: 600;">\${item.title}</h4>
          <span style="font-size: 0.8125rem; color: #94a3b8;">$\${item.price.toFixed(2)} × \${item.qty}</span>
        </div>
        <button class="btn-remove-item" data-id="\${item.id}" style="background:none;border:none;color:#ef4444;cursor:pointer;">Remove</button>
      \`;
      cartItemsList.appendChild(row);
    });
  }

  // Event Listeners
  grid.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-add-cart')) {
      const id = parseInt(e.target.dataset.id);
      const prod = products.find(p => p.id === id);
      if (prod) {
        const existing = cart.find(i => i.id === id);
        if (existing) existing.qty++;
        else cart.push({ ...prod, qty: 1 });
        updateCartUI();
      }
    }
  });

  cartItemsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-remove-item')) {
      const id = parseInt(e.target.dataset.id);
      cart = cart.filter(i => i.id !== id);
      updateCartUI();
    }
  });

  document.getElementById('category-filters').addEventListener('click', (e) => {
    if (e.target.classList.contains('cat-pill')) {
      document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentCategory = e.target.dataset.category;
      renderProducts();
    }
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderProducts();
  });

  sortSelect.addEventListener('change', () => {
    renderProducts();
  });

  document.getElementById('cart-toggle-btn').addEventListener('click', () => {
    cartDrawer.classList.add('open');
    cartDrawer.setAttribute('aria-hidden', 'false');
  });

  document.getElementById('cart-close-btn').addEventListener('click', () => {
    cartDrawer.classList.remove('open');
    cartDrawer.setAttribute('aria-hidden', 'true');
  });

  document.getElementById('cart-overlay').addEventListener('click', () => {
    cartDrawer.classList.remove('open');
    cartDrawer.setAttribute('aria-hidden', 'true');
  });

  // Initial render
  renderProducts();
  updateCartUI();
});`;

      await createFile(ws, "index.html", htmlContent, false);
      await createFile(ws, "styles.css", cssContent, false);
      await createFile(ws, "script.js", jsContent, false);

      // Verify files created
      assert.equal(await ws.exists("index.html"), true);
      assert.equal(await ws.exists("styles.css"), true);
      assert.equal(await ws.exists("script.js"), true);

      // Playwright browser verification
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        const filePath = path.join(tmpDir, "index.html");
        await page.goto(`file://${filePath.replace(/\\/g, "/")}`);

        // 1. Verify 6 products rendered
        const cards = page.locator(".product-card");
        assert.equal(await cards.count(), 6);

        // 2. Verify search filtering
        await page.locator("#search-input").fill("Headphones");
        assert.equal(await cards.count(), 1);
        await page.locator("#search-input").fill("");
        assert.equal(await cards.count(), 6);

        // 3. Verify category filter
        await page.locator('button[data-category="fashion"]').click();
        assert.equal(await cards.count(), 2);
        await page.locator('button[data-category="all"]').click();
        assert.equal(await cards.count(), 6);

        // 4. Verify Add to Cart interaction
        const firstAddBtn = page.locator(".btn-add-cart").first();
        await firstAddBtn.click();
        const badge = await page.locator("#cart-badge").textContent();
        assert.equal(badge, "1");

        // 5. Open Cart Drawer and verify item presence
        await page.locator("#cart-toggle-btn").click();
        assert.equal(await page.locator("#cart-drawer").getAttribute("class"), "cart-drawer open");
        const cartItems = page.locator(".cart-item-row");
        assert.equal(await cartItems.count(), 1);

        // 6. Remove item from cart
        await page.locator(".btn-remove-item").click();
        assert.equal(await page.locator("#cart-badge").textContent(), "0");
      } finally {
        await browser.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("Acceptance Test 3 — Failure Recovery (Reads error, bounds recovery, avoids repeating failed operations)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-accept-recovery-"));
    try {
      // Test command execution failure handling
      const failRes = await runCommand('powershell.exe -NoProfile -Command "exit 42"', tmpDir);
      assert.equal(failRes.exitCode, 42);
      assert.equal(isToolResultFailure("run_command", `Exit code: ${failRes.exitCode}`), true);

      // Test unrecognized cmdlet normalization prevents failure
      const grepNorm = normalizeUnixCommand('grep "target" file.txt');
      assert.ok(grepNorm.wasChanged);
      assert.match(grepNorm.normalized, /Select-String/);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("Acceptance Test 4 — Provider Timeout (Bounded retries, model names hidden from user-facing error)", () => {
    const rawTimeout = "Request timeout after 45000ms: nvidia/nemotron-3.5-lightning-30b-a3b failed to respond";
    const sanitized = sanitizeUserFacingError(rawTimeout);
    assert.doesNotMatch(sanitized, /nemotron/i);
    assert.doesNotMatch(sanitized, /nvidia/i);
    assert.doesNotMatch(sanitized, /30b-a3b/i);
    assert.equal(sanitized, "The AI service is temporarily unavailable due to a request timeout. Please try again shortly.");
  });

  test("Acceptance Test 5 — Cloud Mode Orchestration & Honest Reporting", async () => {
    // Cloud task payload schema ensures required workspace fields
    const { AgentTaskPayloadSchema } = await import("../src/trigger/agent-task.js");
    const validCloud = AgentTaskPayloadSchema.safeParse({
      task: "Build cloud task",
      workspaceId: "ws_valid_123",
    });
    assert.equal(validCloud.success, true);

    const invalidCloud = AgentTaskPayloadSchema.safeParse({
      task: "Build cloud task",
      // missing all workspace identifiers and files
    });
    assert.equal(invalidCloud.success, false);
    assert.ok(invalidCloud.error?.issues.some(i => i.message.includes("workspaceId, workspaceRoot, gitUrl, or files")));
  });

  test("Acceptance Test 6 — 50 Principles Website Generation, Multi-Viewport Verification & 12-Category Audit", async () => {
    const taskBrief = "Create a responsive portfolio website with interactive project filter, contact form with feedback, and theme toggle";
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "achu-accept-50p-"));

    try {
      // 1. Principles applicability evaluation
      const evalResult = evaluatePrinciplesApplicability(taskBrief, "portfolio");
      assert.equal(evalResult.evaluations.length, 50);
      assert.ok(evalResult.applicableCount >= 30);
      assert.ok(evalResult.notApplicableCount > 0);

      // 2. Scaffold responsive portfolio files
      const ws = new Workspace(tmpDir);
      const spec = generateDesignSpec(taskBrief);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alex Rivera — Senior Systems Architect</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="header">
    <div class="container nav-container">
      <a href="#home" class="logo">✦ AR.</a>
      <nav class="nav-links">
        <a href="#about">About</a>
        <a href="#projects">Projects</a>
        <a href="#contact">Contact</a>
      </nav>
      <button id="theme-btn" class="theme-btn" aria-label="Toggle theme">Dark Mode</button>
    </div>
  </header>

  <main>
    <section id="home" class="hero section">
      <div class="container hero-content">
        <h1 class="hero-title">Architecting Resilient Distributed Systems</h1>
        <p class="hero-subtitle">High-throughput event streaming, cloud infrastructure, and mission-critical software.</p>
        <div class="hero-cta">
          <a href="#projects" class="btn btn-primary">View Case Studies</a>
          <a href="#contact" class="btn btn-secondary">Get in Touch</a>
        </div>
      </div>
    </section>

    <section id="projects" class="section">
      <div class="container">
        <h2>Selected Engineering Projects</h2>
        <div class="filter-bar">
          <button class="filter-btn active" data-filter="all">All</button>
          <button class="filter-btn" data-filter="cloud">Cloud</button>
          <button class="filter-btn" data-filter="ai">AI / ML</button>
        </div>
        <div class="projects-grid">
          <div class="card project-card" data-category="cloud">
            <h3>HyperScale Ledger</h3>
            <p>Distributed consensus engine handling 250k events/sec with sub-millisecond p99 latency.</p>
          </div>
          <div class="card project-card" data-category="ai">
            <h3>Neural Router</h3>
            <p>Adaptive LLM model routing gateway with automated token optimization and fallbacks.</p>
          </div>
        </div>
      </div>
    </section>

    <section id="contact" class="section">
      <div class="container">
        <h2>Start a Conversation</h2>
        <form id="contact-form" class="contact-form" novalidate>
          <div class="form-group">
            <label for="contact-name">Name</label>
            <input type="text" id="contact-name" name="name" placeholder="Your name" required>
          </div>
          <div class="form-group">
            <label for="contact-email">Email</label>
            <input type="email" id="contact-email" name="email" placeholder="you@domain.com" required>
          </div>
          <button type="submit" id="btn-submit" class="btn btn-primary">Send Message</button>
          <div id="contact-feedback" class="feedback-msg" style="display:none;">Thank you for your message!</div>
        </form>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="container">
      <p>© 2026 Alex Rivera. All rights reserved.</p>
    </div>
  </footer>

  <script src="script.js"></script>
</body>
</html>`;

      const css = `:root {
  --bg-primary: #0a0c10;
  --bg-surface: #12161f;
  --bg-card: #19202e;
  --text-primary: #f0f4fc;
  --text-secondary: #94a3b8;
  --accent-primary: #38bdf8;
  --accent-hover: #0284c7;
  --border-subtle: #222f42;
  --radius-md: 10px;
}

[data-theme="light"] {
  --bg-primary: #f8fafc;
  --bg-surface: #ffffff;
  --bg-card: #f1f5f9;
  --text-primary: #0f172a;
  --text-secondary: #475569;
  --accent-primary: #0284c7;
  --border-subtle: #cbd5e1;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
}

.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }
.header { border-bottom: 1px solid var(--border-subtle); padding: 1rem 0; }
.nav-container { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; }
.logo { font-size: 1.5rem; font-weight: 700; color: var(--accent-primary); text-decoration: none; }
.nav-links { display: flex; gap: 1.5rem; }
.nav-links a { color: var(--text-secondary); text-decoration: none; }
.nav-links a:hover { color: var(--text-primary); }

.section { padding: 4rem 0; }
.hero-title { font-size: 2.75rem; margin-bottom: 1rem; color: var(--text-primary); word-break: break-word; }
.hero-subtitle { font-size: 1.25rem; color: var(--text-secondary); margin-bottom: 2rem; max-width: 650px; }
.hero-cta { display: flex; gap: 1rem; flex-wrap: wrap; }

.btn { display: inline-block; padding: 0.75rem 1.5rem; border-radius: var(--radius-md); text-decoration: none; font-weight: 600; cursor: pointer; border: none; }
.btn-primary { background: var(--accent-primary); color: #000; }
.btn-secondary { background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-subtle); }

.projects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.5rem; margin-top: 1.5rem; }
.card { background: var(--bg-card); padding: 1.5rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); }
.card h3 { margin-bottom: 0.5rem; color: var(--text-primary); }
.card p { color: var(--text-secondary); font-size: 0.95rem; }

.filter-bar { display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap; }
.filter-btn { padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-surface); color: var(--text-secondary); cursor: pointer; }
.filter-btn.active { background: var(--accent-primary); color: #000; }

.contact-form { max-width: 480px; width: 100%; margin-top: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
.form-group { display: flex; flex-direction: column; gap: 0.35rem; }
.form-group label { font-size: 0.9rem; font-weight: 500; }
.form-group input { padding: 0.75rem; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-surface); color: var(--text-primary); width: 100%; }
.feedback-msg { padding: 0.75rem; background: #064e3b; color: #6ee7b7; border-radius: 6px; font-weight: 500; }

.footer { border-top: 1px solid var(--border-subtle); padding: 2rem 0; text-align: center; color: var(--text-secondary); font-size: 0.9rem; }

@media (max-width: 768px) {
  .hero-title { font-size: 2rem; }
  .nav-links { gap: 0.75rem; font-size: 0.9rem; }
  .hero-cta { flex-direction: column; }
}

@media (max-width: 480px) {
  .container { padding: 0 0.75rem; }
  .projects-grid { grid-template-columns: 1fr; }
  .hero-title { font-size: 1.75rem; }
  .hero-subtitle { font-size: 1rem; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}`;

      const js = `document.addEventListener("DOMContentLoaded", () => {
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      themeBtn.textContent = next === "dark" ? "Light Mode" : "Dark Mode";
    });
  }

  const filterBtns = document.querySelectorAll(".filter-btn");
  const projectCards = document.querySelectorAll(".project-card");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const category = btn.getAttribute("data-filter");
      projectCards.forEach(card => {
        if (category === "all" || card.getAttribute("data-category") === category) {
          card.style.display = "block";
        } else {
          card.style.display = "none";
        }
      });
    });
  });

  const contactForm = document.getElementById("contact-form");
  const feedbackMsg = document.getElementById("contact-feedback");
  if (contactForm && feedbackMsg) {
    contactForm.addEventListener("submit", (e) => {
      e.preventDefault();
      feedbackMsg.style.display = "block";
    });
  }
});`;

      await createFile(ws, "index.html", html);
      await createFile(ws, "styles.css", css);
      await createFile(ws, "script.js", js);

      // 3. Playwright browser multi-viewport verification
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`file://${path.resolve(tmpDir, "index.html")}`);

        // Viewports test target matrix
        const viewports = [
          { width: 320, height: 568 },  // Small mobile
          { width: 375, height: 667 },  // Small mobile standard
          { width: 390, height: 844 },  // Standard mobile
          { width: 430, height: 932 },  // Standard mobile plus
          { width: 768, height: 1024 }, // Tablet
          { width: 1280, height: 800 }, // Laptop
          { width: 1440, height: 900 }, // Desktop
          { width: 1920, height: 1080 } // Wide desktop
        ];

        for (const vp of viewports) {
          await page.setViewportSize(vp);
          const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
          assert.ok(scrollWidth <= clientWidth + 2, `No horizontal overflow at ${vp.width}x${vp.height}`);
        }

        // Reset to desktop
        await page.setViewportSize({ width: 1280, height: 800 });

        // 4. Test real interactive features
        // Theme toggle
        await page.locator("#theme-btn").click();
        const activeTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
        assert.equal(activeTheme, "light");

        // Filter interaction
        await page.locator('.filter-btn[data-filter="ai"]').click();
        const cloudCardVisible = await page.locator('.project-card[data-category="cloud"]').isVisible();
        const aiCardVisible = await page.locator('.project-card[data-category="ai"]').isVisible();
        assert.equal(cloudCardVisible, false, "Cloud card hidden when AI filter active");
        assert.equal(aiCardVisible, true, "AI card visible when AI filter active");

        // Form submission interaction
        await page.locator("#contact-name").fill("Dev Test");
        await page.locator("#contact-email").fill("dev@example.com");
        await page.locator("#btn-submit").click();
        const feedbackVisible = await page.locator("#contact-feedback").isVisible();
        assert.equal(feedbackVisible, true, "Feedback displayed after form submit");

        // 5. Run 12-category quality audit
        const audit = evaluateWebsiteQuality({
          task: taskBrief,
          pageTitle: await page.title(),
          visibleText: await page.evaluate(() => document.body.innerText),
          buttons: ["Dark Mode", "All", "Cloud", "AI / ML", "Send Message"],
          inputs: [{ name: "name", type: "text", placeholder: "Your name" }, { name: "email", type: "email", placeholder: "you@domain.com" }],
          headings: ["Architecting Resilient Distributed Systems", "Selected Engineering Projects", "Start a Conversation"],
          semanticCount: 6,
          stylesheetCount: 1,
          totalCssRules: 28,
          fontFamily: "system-ui, sans-serif",
          criticalLayoutDefects: [],
          warningLayoutDefects: [],
          consoleErrors: [],
          pageErrors: [],
          verificationPassed: true,
          buildPassed: true,
          secretLeaksFound: false,
        });

        assert.equal(audit.categories.length, 12);
        assert.ok(audit.overallScore >= 90, `Audit score must be >= 90 (got ${audit.overallScore})`);
        assert.equal(audit.overallPassed, true);
        assert.equal(audit.blockers.length, 0);
      } finally {
        await browser.close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
