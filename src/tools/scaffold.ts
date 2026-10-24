import path from "node:path";
import fs from "node:fs";
import { Workspace } from "./workspace.js";
import type { DesignSpec } from "./design-planner.js";

export type ProjectTemplate = "react-vite" | "static";

export type ScaffoldResult = {
  success: boolean;
  files: string[];
  projectRoot?: string;
  error?: string;
};

export type ProjectValidationResult = {
  valid: boolean;
  projectType: "react" | "static" | "node" | "unknown";
  error?: string;
};

/**
 * Validate that an application directory has the required entry points and consistent scripts
 * before running start_app.
 */
export function validateProjectStructure(workingDir: string): ProjectValidationResult {
  const pkgPath = path.join(workingDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    // If no package.json, check if static index.html exists
    if (fs.existsSync(path.join(workingDir, "index.html"))) {
      return { valid: true, projectType: "static" };
    }
    return {
      valid: false,
      projectType: "unknown",
      error: `Project in ${workingDir} is missing package.json and index.html entry files.`,
    };
  }

  let pkg: any = {};
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    pkg = JSON.parse(raw);
  } catch (err) {
    return {
      valid: false,
      projectType: "unknown",
      error: `Invalid package.json in ${workingDir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const entryCandidates = [
    "src/main.jsx",
    "src/main.tsx",
    "src/main.js",
    "src/main.ts",
    "src/index.jsx",
    "src/index.tsx",
    "src/index.js",
    "src/App.jsx",
    "src/App.tsx",
    "src/App.js",
  ];
  const hasReactFiles = entryCandidates.some((c) => fs.existsSync(path.join(workingDir, c)));
  const isReact = Boolean((deps.react || deps["react-dom"] || deps["@vitejs/plugin-react"]) && hasReactFiles);
  const hasVite = Boolean(deps.vite || (typeof scripts.dev === "string" && scripts.dev.includes("vite")));

  if (isReact) {
    // React project validation
    const devScript = String(scripts.dev || "");
    const isStaticServer = /npx\s+(serve|http-server)|serve\s+\./i.test(devScript);
    if (isStaticServer) {
      return {
        valid: false,
        projectType: "react",
        error: `Incompatible configuration: React project specifies a static server ("${devScript}"). React requires a bundler dev server such as Vite ("vite").`,
      };
    }

    // Must have index.html at root (or public/index.html)
    const hasIndexHtml = fs.existsSync(path.join(workingDir, "index.html")) || fs.existsSync(path.join(workingDir, "public", "index.html"));
    if (!hasIndexHtml) {
      return {
        valid: false,
        projectType: "react",
        error: `React project is missing 'index.html' entry point at workspace root.`,
      };
    }

    // Must have an entry file in src/
    const entryCandidates = [
      "src/main.jsx",
      "src/main.tsx",
      "src/main.js",
      "src/main.ts",
      "src/index.jsx",
      "src/index.tsx",
      "src/index.js",
      "src/App.jsx",
      "src/App.tsx",
      "src/App.js",
    ];
    const hasEntry = entryCandidates.some((c) => fs.existsSync(path.join(workingDir, c)));
    if (!hasEntry) {
      return {
        valid: false,
        projectType: "react",
        error: `React project is missing entry file in src/ (expected src/main.jsx or src/App.jsx).`,
      };
    }

    return { valid: true, projectType: "react" };
  }

  // Static site validation
  const hasIndexHtml = fs.existsSync(path.join(workingDir, "index.html"));
  if (!hasIndexHtml) {
    return {
      valid: false,
      projectType: "static",
      error: `Web project is missing 'index.html'. A root index.html is required for the application to render.`,
    };
  }

  return { valid: true, projectType: "static" };
}

/**
 * Automatically diagnose and repair broken project configurations (e.g. React project configured with static serve).
 */
export async function autoRepairProjectStructure(workspace: Workspace): Promise<{ repaired: boolean; changes: string[] }> {
  const root = workspace.root;
  const changes: string[] = [];

  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return { repaired: false, changes };

  let pkg: any = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return { repaired: false, changes };
  }

  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const hasReactFiles = [
    "src/main.jsx",
    "src/main.tsx",
    "src/main.js",
    "src/main.ts",
    "src/index.jsx",
    "src/index.tsx",
    "src/index.js",
    "src/App.jsx",
    "src/App.tsx",
    "src/App.js",
  ].some((c) => fs.existsSync(path.join(root, c)));
  const isReact = Boolean((deps.react || deps["react-dom"]) && hasReactFiles);

  if (isReact) {
    const devScript = String(scripts.dev || "");
    const isStaticServer = /npx\s+(serve|http-server)|serve\s+\./i.test(devScript);

    if (isStaticServer || !scripts.dev) {
      pkg.scripts = {
        ...pkg.scripts,
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      };
      if (!pkg.devDependencies) pkg.devDependencies = {};
      if (!pkg.devDependencies.vite) pkg.devDependencies.vite = "^6.0.0";
      if (!pkg.devDependencies["@vitejs/plugin-react"]) pkg.devDependencies["@vitejs/plugin-react"] = "^4.3.4";
      if (!pkg.type) pkg.type = "module";

      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
      changes.push("Updated package.json scripts from static serve to Vite (dev: vite, build: vite build)");
    }

    // Ensure vite.config.js exists
    const viteConfigPath = path.join(root, "vite.config.js");
    const viteConfigTsPath = path.join(root, "vite.config.ts");
    if (!fs.existsSync(viteConfigPath) && !fs.existsSync(viteConfigTsPath)) {
      const viteConfigContent = `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    host: true,\n  },\n});\n`;
      fs.writeFileSync(viteConfigPath, viteConfigContent, "utf8");
      changes.push("Created vite.config.js for React compilation");
    }

    // Ensure index.html exists
    const indexHtmlPath = path.join(root, "index.html");
    if (!fs.existsSync(indexHtmlPath)) {
      // Find candidate entry script
      let entryScript = "/src/main.jsx";
      if (fs.existsSync(path.join(root, "src", "main.tsx"))) entryScript = "/src/main.tsx";
      else if (fs.existsSync(path.join(root, "src", "main.js"))) entryScript = "/src/main.js";
      else if (fs.existsSync(path.join(root, "src", "index.jsx"))) entryScript = "/src/index.jsx";
      else if (fs.existsSync(path.join(root, "src", "index.js"))) entryScript = "/src/index.js";
      else if (fs.existsSync(path.join(root, "src", "App.jsx"))) entryScript = "/src/App.jsx";
      else if (fs.existsSync(path.join(root, "src", "App.js"))) entryScript = "/src/App.js";

      const appTitle = pkg.name || "React Application";
      const htmlContent = `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${appTitle}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="${entryScript}"></script>\n  </body>\n</html>\n`;
      fs.writeFileSync(indexHtmlPath, htmlContent, "utf8");
      changes.push(`Created index.html linking to ${entryScript}`);
    }

    // Ensure src/main.jsx exists if src/App exists but no main entry
    const mainCandidates = ["src/main.jsx", "src/main.tsx", "src/main.js", "src/index.jsx", "src/index.js"];
    const hasMain = mainCandidates.some((c) => fs.existsSync(path.join(root, c)));
    const hasApp = fs.existsSync(path.join(root, "src", "App.jsx")) || fs.existsSync(path.join(root, "src", "App.js"));

    if (!hasMain && hasApp) {
      const appExt = fs.existsSync(path.join(root, "src", "App.jsx")) ? "jsx" : "js";
      const mainPath = path.join(root, "src", "main.jsx");
      const mainContent = `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.${appExt}';\n\nReactDOM.createRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n`;
      fs.writeFileSync(mainPath, mainContent, "utf8");
      changes.push("Created src/main.jsx entry point for React root rendering");
    }

    // Migrate .js files containing JSX to .jsx for Vite compatibility
    const appJsPath = path.join(root, "src", "App.js");
    const appJsxPath = path.join(root, "src", "App.jsx");
    if (fs.existsSync(appJsPath)) {
      try {
        const appContent = fs.readFileSync(appJsPath, "utf8");
        if (appContent.includes("<") && appContent.includes(">")) {
          fs.writeFileSync(appJsxPath, appContent, "utf8");
          fs.unlinkSync(appJsPath);
          changes.push("Migrated src/App.js to src/App.jsx with JSX extension");
        }
      } catch {}
    }

    const indexJsPath = path.join(root, "src", "index.js");
    const mainJsxPath = path.join(root, "src", "main.jsx");
    if (fs.existsSync(indexJsPath)) {
      try {
        const indexContent = fs.readFileSync(indexJsPath, "utf8");
        if (indexContent.includes("<") && indexContent.includes(">")) {
          fs.writeFileSync(mainJsxPath, indexContent.replace(/from\s+['"]\.\/App['"]/g, "from './App.jsx'"), "utf8");
          fs.unlinkSync(indexJsPath);
          changes.push("Migrated src/index.js to src/main.jsx with JSX extension");
        }
      } catch {}
    }

    // Ensure index.html references the .jsx entry point
    if (fs.existsSync(indexHtmlPath)) {
      let html = fs.readFileSync(indexHtmlPath, "utf8");
      if (html.includes("/src/index.js") && fs.existsSync(mainJsxPath)) {
        html = html.replace("/src/index.js", "/src/main.jsx");
        fs.writeFileSync(indexHtmlPath, html, "utf8");
        changes.push("Updated index.html to link to /src/main.jsx");
      }
    }
  }

  return { repaired: changes.length > 0, changes };
}

/**
 * Scaffolds a complete, valid Vite + React application.
 * When a DesignSpec is provided the CSS variables and typography are
 * driven by the spec rather than hardcoded defaults.
 */
export async function scaffoldReactViteProject(
  workspace: Workspace,
  projectName = "react-app",
  designSpec?: DesignSpec
): Promise<ScaffoldResult> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "react-app";
  const title = projectName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesCreated: string[] = [];

  // Only scaffold into a child folder if workspace already contains existing files or an existing project
  // AND the directory does not already match the project name
  // AND the requested projectName is a distinct custom project name (not default "app", "react-app", or "static-website").
  const defaultProjectNames = new Set(["app", "react-app", "static-website"]);
  let existingEntries: string[] = [];
  try {
    existingEntries = fs.readdirSync(workspace.root).filter(
      (e) => !e.startsWith(".") && e !== "node_modules"
    );
  } catch {}
  const hasExistingContent = existingEntries.length > 0;
  const currentDirName = path.basename(workspace.root).toLowerCase();
  const isMatchingDirectory = currentDirName === slug || currentDirName === projectName.toLowerCase();

  if (hasExistingContent && !isMatchingDirectory && !defaultProjectNames.has(slug) && !defaultProjectNames.has(projectName.toLowerCase())) {
    const childPath = path.join(workspace.root, projectName);
    fs.mkdirSync(childPath, { recursive: true });
    workspace.setRoot(childPath);
  }

  try {
    // 1. package.json
    const packageJson = {
      name: slug,
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^18.3.1",
        "react-dom": "^18.3.1",
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.3.4",
        vite: "^6.0.0",
      },
    };
    await workspace.write("package.json", JSON.stringify(packageJson, null, 2) + "\n");
    filesCreated.push("package.json");

    // 2. vite.config.js
    const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
`;
    await workspace.write("vite.config.js", viteConfig);
    filesCreated.push("vite.config.js");

    // 3. index.html
    const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
    await workspace.write("index.html", indexHtml);
    filesCreated.push("index.html");

    // 4. src/index.css — driven by DesignSpec when provided
    const rt = designSpec?.tokens;
    const rty = designSpec?.typography;
    const indexCss = rt
      ? `/* Phase 13 Design Tokens */
:root {
  --bg-primary:    ${rt.bgPrimary};
  --bg-surface:    ${rt.bgSurface};
  --bg-card:       ${rt.bgCard};
  --text-primary:  ${rt.textPrimary};
  --text-secondary:${rt.textSecondary};
  --accent-primary:${rt.accentPrimary};
  --accent-hover:  ${rt.accentHover};
  --border-subtle: ${rt.borderSubtle};
  --shadow-card:   ${rt.shadowCard};
  --radius-md:     ${rt.radiusMd};
  --radius-sm:     ${rt.radiusSm};
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: ${rty?.fontStack ?? 'system-ui, sans-serif'};
  -webkit-font-smoothing: antialiased;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
`
      : `*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  -webkit-font-smoothing: antialiased;
  background-color: #0f172a;
  color: #f8fafc;
  min-height: 100vh;
}
`;
    await workspace.write("src/index.css", indexCss);
    filesCreated.push("src/index.css");

    // 5. src/App.jsx
    const appJsx = `import React from 'react';

export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        padding: '3rem 2rem',
        textAlign: 'center',
        background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
        color: '#ffffff'
      }}>
        <h1 style={{ fontSize: '2.5rem', margin: '0 0 1rem 0', fontWeight: '800' }}>
          ${title}
        </h1>
        <p style={{ fontSize: '1.2rem', margin: 0, opacity: 0.9 }}>
          Built with React &amp; Vite
        </p>
      </header>

      <main style={{ flex: 1, maxWidth: '1000px', margin: '0 auto', width: '100%', padding: '2rem' }}>
        {/* Welcome Card */}
        <section style={{
          background: '#1e293b',
          borderRadius: '12px',
          padding: '2rem',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          marginBottom: '2rem'
        }}>
          <h2 style={{ marginTop: 0, color: '#60a5fa' }}>Welcome to Your Application</h2>
          <p style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
            This application is running live with hot-module reloading and full React component support.
          </p>
        </section>
      </main>
    </div>
  );
}
`;
    await workspace.write("src/App.jsx", appJsx);
    filesCreated.push("src/App.jsx");

    // 6. src/main.jsx
    const mainJsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
    await workspace.write("src/main.jsx", mainJsx);
    filesCreated.push("src/main.jsx");

    return { success: true, files: filesCreated, projectRoot: workspace.root };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, files: filesCreated, error };
  }
}

/**
 * Scaffolds a complete, valid static HTML5/CSS3/JavaScript project.
 * When a DesignSpec is provided the CSS tokens, typography, and spacing
 * are driven by the spec rather than hardcoded defaults.
 */
export async function scaffoldStaticProject(
  workspace: Workspace,
  projectName = "static-website",
  designSpec?: DesignSpec
): Promise<ScaffoldResult> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "static-website";
  const title = projectName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesCreated: string[] = [];

  // Only scaffold into a child folder if workspace already contains existing files or an existing project
  // AND the directory does not already match the project name
  // AND the requested projectName is a distinct custom project name (not default "app", "react-app", or "static-website").
  const defaultProjectNames = new Set(["app", "react-app", "static-website"]);
  let existingEntries: string[] = [];
  try {
    existingEntries = fs.readdirSync(workspace.root).filter(
      (e) => !e.startsWith(".") && e !== "node_modules"
    );
  } catch {}
  const hasExistingContent = existingEntries.length > 0;
  const currentDirName = path.basename(workspace.root).toLowerCase();
  const isMatchingDirectory = currentDirName === slug || currentDirName === projectName.toLowerCase();

  if (hasExistingContent && !isMatchingDirectory && !defaultProjectNames.has(slug) && !defaultProjectNames.has(projectName.toLowerCase())) {
    const childPath = path.join(workspace.root, projectName);
    fs.mkdirSync(childPath, { recursive: true });
    workspace.setRoot(childPath);
  }

  try {
    // 1. package.json
    const packageJson = {
      name: slug,
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "npx --yes serve -l 3000 .",
        build: "echo 'Static site - no build needed'",
        start: "npx --yes serve -l 3000 .",
      },
    };
    await workspace.write("package.json", JSON.stringify(packageJson, null, 2) + "\n");
    filesCreated.push("package.json");

    const isEcommerce = designSpec?.productType === "ecommerce" || /ecommerce|store|shop|catalog|cart/i.test(projectName);

    // 2. index.html
    const indexHtml = isEcommerce
      ? `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} Storefront</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="navbar">
    <div class="nav-container">
      <a href="#" class="brand-logo" aria-label="${title} Home">
        <span class="logo-icon">🛍️</span> ${title}
      </a>
      <div class="search-bar" role="search">
        <input
          type="search"
          id="searchInput"
          name="q"
          placeholder="Search products..."
          aria-label="Search products"
          class="search-input"
          autocomplete="off"
        />
      </div>
      <nav class="nav-links" aria-label="Main Navigation">
        <ul class="nav-menu">
          <li><a href="#catalog" class="nav-link">Catalog</a></li>
          <li><a href="#about" class="nav-link">About</a></li>
        </ul>
        <button id="cartBtn" class="btn btn-primary btn-sm cart-btn" aria-label="Shopping Cart">
          🛒 Cart (<span id="cartCount">0</span>)
        </button>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero-section">
      <div class="hero-grid">
        <div class="hero-content">
          <div class="hero-badge">⚡ Curated Collection &bull; Instant Delivery</div>
          <h1 class="hero-title">${title} Store</h1>
          <p class="hero-subtitle">Discover premium essentials, smart tech, and accessories designed for modern everyday living.</p>
          <div class="hero-actions">
            <a href="#catalog" class="btn btn-primary">Shop Now</a>
            <a href="#categories" class="btn btn-secondary">Explore Categories</a>
          </div>
          <div class="hero-trust-chips">
            <span class="trust-chip">✓ Free Express Shipping</span>
            <span class="trust-chip">✓ 2-Year Warranty</span>
            <span class="trust-chip">✓ 30-Day Returns</span>
          </div>
        </div>
        <div class="hero-visual">
          <div class="hero-showcase-card">
            <div class="showcase-glow"></div>
            <div class="showcase-badge">Flagship Device</div>
            <div class="showcase-svg-wrapper">
              <svg viewBox="0 0 200 200" fill="none" class="hero-flagship-svg" aria-label="Flagship Wireless Acoustic Headphones">
                <circle cx="100" cy="100" r="85" fill="var(--bg-surface)" stroke="var(--border-subtle)" stroke-width="2"/>
                <path d="M45 110 C45 45, 155 45, 155 110" stroke="var(--text-primary)" stroke-width="10" stroke-linecap="round" fill="none"/>
                <path d="M55 105 C55 58, 145 58, 145 105" stroke="var(--accent-primary)" stroke-width="4" stroke-linecap="round" fill="none"/>
                <rect x="30" y="95" width="28" height="52" rx="14" fill="var(--bg-primary)" stroke="var(--accent-primary)" stroke-width="3"/>
                <rect x="36" y="103" width="16" height="36" rx="8" fill="var(--accent-primary)" opacity="0.4"/>
                <circle cx="44" cy="121" r="5" fill="var(--accent-primary)"/>
                <rect x="142" y="95" width="28" height="52" rx="14" fill="var(--bg-primary)" stroke="var(--accent-primary)" stroke-width="3"/>
                <rect x="148" y="103" width="16" height="36" rx="8" fill="var(--accent-primary)" opacity="0.4"/>
                <circle cx="156" cy="121" r="5" fill="var(--accent-primary)"/>
                <path d="M18 105 C14 115, 14 127, 18 137" stroke="var(--accent-primary)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
                <path d="M182 105 C186 115, 186 127, 182 137" stroke="var(--accent-primary)" stroke-width="2.5" stroke-linecap="round" fill="none"/>
              </svg>
            </div>
            <div class="showcase-details">
              <span class="showcase-title">Acoustic Pro Wireless</span>
              <span class="showcase-price">$249.99</span>
            </div>
            <div class="showcase-pill showcase-pill-top">Active Noise Cancelling</div>
            <div class="showcase-pill showcase-pill-bottom">★ 4.9 Rating &bull; 48h Battery</div>
          </div>
        </div>
      </div>
    </section>

    <section id="catalog" class="catalog-section">
      <div class="section-header">
        <h2>Featured Products</h2>
        <p>Browse our catalog with live search, category filtering, and sorting.</p>
      </div>

      <div class="catalog-controls" id="categories">
        <div class="category-filters" role="group" aria-label="Filter by category">
          <button class="filter-btn active" data-category="all">All Items</button>
          <button class="filter-btn" data-category="electronics">Electronics</button>
          <button class="filter-btn" data-category="accessories">Accessories</button>
          <button class="filter-btn" data-category="apparel">Apparel</button>
          <button class="filter-btn" data-category="home">Home &amp; Living</button>
        </div>
        <div class="sort-controls">
          <label for="sortSelect">Sort by:</label>
          <select id="sortSelect" aria-label="Sort products">
            <option value="featured">Featured</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
            <option value="rating">Highest Rated</option>
          </select>
        </div>
      </div>

      <div id="productGrid" class="cards-grid">
        <!-- Products populated by script.js -->
      </div>

      <div id="noResults" class="no-results" style="display: none;" role="status">
        <div class="no-results-icon">🔍</div>
        <h3>No products found</h3>
        <p>No products match your current search or filter criteria.</p>
        <button id="resetFiltersBtn" class="btn btn-secondary btn-sm">Reset Filters</button>
      </div>
    </section>

    <section id="about" class="about-section">
      <div class="section-header">
        <h2>About ${title}</h2>
        <p>Built with quality craftsmanship, sustainable packaging, and responsive customer care.</p>
      </div>
    </section>
  </main>

  <!-- Slide-Over Cart Drawer -->
  <div id="cartOverlay" class="cart-overlay" style="display: none;"></div>
  <aside id="cartDrawer" class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cartTitle">
    <div class="drawer-header">
      <h2 id="cartTitle">Your Cart (<span id="drawerCount">0</span>)</h2>
      <button id="cartCloseBtn" class="close-btn" aria-label="Close cart">&times;</button>
    </div>
    <div class="drawer-body">
      <div id="emptyCartState" class="empty-cart-state">
        <div class="empty-cart-icon">🛒</div>
        <p>Your shopping cart is currently empty.</p>
        <button id="startShoppingBtn" class="btn btn-secondary btn-sm">Browse Catalog</button>
      </div>
      <div id="cartItemsList" class="cart-items-list"></div>
    </div>
    <div id="drawerFooter" class="drawer-footer" style="display: none;">
      <div class="summary-row">
        <span>Subtotal</span>
        <span id="subtotalPrice">$0.00</span>
      </div>
      <div class="summary-row">
        <span>Shipping</span>
        <span id="shippingPrice">Free</span>
      </div>
      <div class="summary-row">
        <span>Estimated Tax (8%)</span>
        <span id="taxPrice">$0.00</span>
      </div>
      <div class="summary-row total-row">
        <span>Total</span>
        <span id="totalPrice">$0.00</span>
      </div>
      <button id="checkoutBtn" class="btn btn-primary btn-block">Proceed to Checkout</button>
    </div>
  </aside>

  <!-- Simulated Checkout Demo Modal -->
  <div id="checkoutModal" class="modal-overlay" style="display: none;" role="dialog" aria-modal="true" aria-labelledby="checkoutTitle">
    <div class="modal-card">
      <div class="modal-header">
        <h2 id="checkoutTitle">Checkout (Demo Simulation)</h2>
        <button id="checkoutCloseBtn" class="close-btn" aria-label="Close checkout">&times;</button>
      </div>
      <div class="demo-banner">
        ⚠️ Simulated Checkout: This is an autonomous prototype demonstration. No real financial payments or live credit cards are processed.
      </div>
      <form id="checkoutForm" class="checkout-form">
        <div class="form-row">
          <div class="form-group">
            <label for="shippingName">Full Name</label>
            <input type="text" id="shippingName" name="name" placeholder="Alex Morgan" required>
          </div>
          <div class="form-group">
            <label for="shippingEmail">Email Address</label>
            <input type="email" id="shippingEmail" name="email" placeholder="alex@example.com" required>
          </div>
        </div>
        <div class="form-group">
          <label for="shippingAddress">Street Address</label>
          <input type="text" id="shippingAddress" name="address" placeholder="123 Market St, Suite 400" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="shippingCity">City</label>
            <input type="text" id="shippingCity" name="city" placeholder="San Francisco" required>
          </div>
          <div class="form-group">
            <label for="shippingZip">Postal Code</label>
            <input type="text" id="shippingZip" name="zip" placeholder="94105" required>
          </div>
        </div>
        <div class="checkout-summary">
          <div class="summary-line">
            <span>Order Total:</span>
            <strong id="modalTotalPrice">$0.00</strong>
          </div>
        </div>
        <button type="submit" id="placeOrderBtn" class="btn btn-primary btn-block">Place Simulated Order</button>
      </form>
      <div id="orderConfirmation" class="order-confirmation" style="display: none;" role="status">
        <div class="success-icon">✅</div>
        <h3>Order Placed Successfully!</h3>
        <p>Order Reference: <strong id="orderNumber">#ORD-0000</strong></p>
        <p>Thank you for testing the simulated checkout flow. A confirmation has been generated.</p>
        <button id="returnToStoreBtn" class="btn btn-primary btn-block">Continue Shopping</button>
      </div>
    </div>
  </div>

  <footer class="footer">
    <div class="footer-container">
      <p>&copy; ${new Date().getFullYear()} ${title}. Verified responsive e-commerce storefront prototype.</p>
    </div>
  </footer>

  <script src="script.js" defer></script>
</body>
</html>`
      : `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="navbar">
    <div class="nav-container">
      <a href="#" class="brand-logo">${title}</a>
      <nav class="nav-links">
        <a href="#features">Features</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
        <a href="#contact" class="btn btn-primary btn-sm">Get Started</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="hero-section">
      <div class="hero-badge">Modern Web Application</div>
      <h1 class="hero-title">${title}</h1>
      <p class="hero-subtitle">A high-performance, beautifully designed, and responsive web application built with modern standards.</p>
      <div class="hero-actions">
        <a href="#features" class="btn btn-primary">Explore Features</a>
        <a href="#contact" class="btn btn-secondary">Contact Us</a>
      </div>
    </section>

    <section id="features" class="features-section">
      <div class="section-header">
        <h2>Key Features</h2>
        <p>Everything you need for a fast, responsive user experience.</p>
      </div>
      <div class="cards-grid">
        <article class="feature-card">
          <div class="card-icon">⚡</div>
          <h3>High Performance</h3>
          <p>Optimized for lightning-fast load times and smooth client-side interactions.</p>
        </article>
        <article class="feature-card">
          <div class="card-icon">🎨</div>
          <h3>Polished Design</h3>
          <p>Clean modern aesthetic, balanced typography, and responsive layouts across all devices.</p>
        </article>
        <article class="feature-card">
          <div class="card-icon">🔒</div>
          <h3>Secure &amp; Reliable</h3>
          <p>Built with robust validation, semantic structure, and accessible components.</p>
        </article>
      </div>
    </section>

    <section id="contact" class="contact-section">
      <div class="contact-card">
        <h2>Get in Touch</h2>
        <p>Send a message and we'll respond promptly.</p>
        <form id="contact-form" class="contact-form">
          <div class="form-group">
            <label for="name">Your Name</label>
            <input type="text" id="name" name="name" placeholder="Jane Doe" required>
          </div>
          <div class="form-group">
            <label for="email">Email Address</label>
            <input type="email" id="email" name="email" placeholder="jane@example.com" required>
          </div>
          <div class="form-group">
            <label for="message">Message</label>
            <textarea id="message" name="message" rows="3" placeholder="Tell us about your project..." required></textarea>
          </div>
          <button type="submit" id="submit-btn" class="btn btn-primary btn-block">Send Message</button>
          <div id="form-feedback" class="form-feedback" role="alert" style="display:none;"></div>
        </form>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="footer-container">
      <p>&copy; ${new Date().getFullYear()} ${title}. All rights reserved.</p>
    </div>
  </footer>

  <script src="script.js" defer></script>
</body>
</html>
`;
    await workspace.write("index.html", indexHtml);
    filesCreated.push("index.html");

    // 3. styles.css — tokens driven by DesignSpec when provided
    const t = designSpec?.tokens;
    const ty = designSpec?.typography;
    const sp = designSpec?.spacing;

    const cssTokens = t
      ? `/* Design Tokens — Phase 13 Design Intelligence */
:root {
  --bg-primary:    ${t.bgPrimary};
  --bg-surface:    ${t.bgSurface};
  --bg-card:       ${t.bgCard};
  --text-primary:  ${t.textPrimary};
  --text-secondary:${t.textSecondary};
  --accent-primary:${t.accentPrimary};
  --accent-hover:  ${t.accentHover};
  --border-subtle: ${t.borderSubtle};
  --shadow-card:   ${t.shadowCard};
  --radius-md:     ${t.radiusMd};
  --radius-sm:     ${t.radiusSm};
}`
      : `/* Design Tokens */
:root {
  --bg-primary:    #0b0f19;
  --bg-surface:    #131c2e;
  --bg-card:       #1e293b;
  --text-primary:  #f8fafc;
  --text-secondary:#94a3b8;
  --accent-primary:#38bdf8;
  --accent-hover:  #0ea5e9;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --shadow-card:   0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
  --radius-md:     12px;
  --radius-sm:     8px;
}`;

    const heroFontSize = ty?.heroSize ?? "2.75rem";
    const h2FontSize   = ty?.h2Size   ?? "2rem";
    const bodyFont     = ty?.fontStack ?? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif";
    const heroV        = sp?.heroVertical    ?? "5rem";
    const sectionV     = sp?.sectionVertical ?? "4rem";
    const cardPad      = sp?.cardPadding     ?? "2rem";

    const reducedMotionBlock = designSpec?.useAnimations !== false
      ? `\n/* Accessibility — Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}`
      : "";

    const stylesCss = isEcommerce
      ? `${cssTokens}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

ul, ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

html, body {
  max-width: 100%;
  overflow-x: hidden;
}

body {
  font-family: ${bodyFont};
  background-color: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Navbar */
.navbar {
  background: var(--bg-surface);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  z-index: 100;
  width: 100%;
}
.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0.85rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.brand-logo {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}
.search-bar {
  flex: 1 1 240px;
  max-width: 400px;
  min-width: 0;
}
.search-input {
  width: 100%;
  padding: 0.6rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.search-input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 20%, transparent);
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}
.navbar ul,
.nav-links ul,
nav ul,
ul.nav-menu,
ul.nav-links {
  list-style: none !important;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 1.25rem;
}
.navbar li,
.nav-links li,
nav li {
  list-style: none !important;
  margin: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
}
.nav-links a:not(.btn) {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.95rem;
  font-weight: 500;
  transition: color 0.2s;
}
.nav-links a:not(.btn):hover {
  color: var(--accent-primary);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.95rem;
  text-decoration: none;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1.2;
}
.btn-primary {
  background-color: var(--accent-primary);
  color: var(--bg-primary);
}
.btn-primary:hover {
  background-color: var(--accent-hover);
  transform: translateY(-2px);
}
.btn-secondary {
  background-color: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
}
.btn-secondary:hover {
  background-color: var(--bg-card);
  transform: translateY(-2px);
}
.btn-sm {
  padding: 0.45rem 1rem;
  font-size: 0.85rem;
}
.btn-block {
  width: 100%;
}

/* Hero Section */
.hero-section {
  padding: ${heroV} 1.25rem 3.5rem;
  max-width: 1200px;
  margin: 0 auto;
}
.hero-grid {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 3rem;
  align-items: center;
}
.hero-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}
.hero-badge {
  display: inline-block;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  color: var(--accent-primary);
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 1.25rem;
  border: 1px solid var(--border-subtle);
}
.hero-title {
  font-size: ${heroFontSize};
  line-height: 1.15;
  font-weight: 800;
  margin-bottom: 1.25rem;
  letter-spacing: -0.02em;
}
.hero-subtitle {
  font-size: 1.15rem;
  color: var(--text-secondary);
  margin-bottom: 1.75rem;
  max-width: 580px;
}
.hero-actions {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.hero-trust-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.75rem;
}
.trust-chip {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  padding: 0.35rem 0.75rem;
  border-radius: 9999px;
}
.hero-visual {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  width: 100%;
}
.hero-showcase-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: var(--shadow-card);
  width: 100%;
  max-width: 380px;
}
.showcase-glow {
  position: absolute;
  inset: -10px;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent-primary) 25%, transparent) 0%, transparent 70%);
  z-index: 0;
  pointer-events: none;
}
.showcase-badge {
  position: relative;
  z-index: 1;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent-primary);
  margin-bottom: 0.5rem;
}
.showcase-svg-wrapper {
  position: relative;
  z-index: 1;
  width: 180px;
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hero-flagship-svg {
  width: 100%;
  height: 100%;
}
.showcase-details {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}
.showcase-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
}
.showcase-price {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--accent-primary);
}
.showcase-pill {
  position: absolute;
  z-index: 2;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border-radius: 9999px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
}
.showcase-pill-top {
  top: 1rem;
  right: -0.5rem;
}
.showcase-pill-bottom {
  bottom: 3.5rem;
  left: -0.5rem;
}

/* Catalog & Controls */
.catalog-section {
  max-width: 1200px;
  margin: 0 auto;
  padding: ${sectionV} 1.25rem;
  width: 100%;
}
.section-header {
  text-align: center;
  margin-bottom: 2.5rem;
}
.section-header h2 {
  font-size: ${h2FontSize};
  margin-bottom: 0.5rem;
}
.section-header p {
  color: var(--text-secondary);
}
.catalog-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 2rem;
}
.category-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.filter-btn {
  padding: 0.45rem 1rem;
  border-radius: 9999px;
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 36px;
}
.filter-btn:hover, .filter-btn.active {
  background: var(--accent-primary);
  color: var(--bg-primary);
  border-color: var(--accent-primary);
}
.sort-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--text-secondary);
}
.sort-controls select {
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  font-family: inherit;
  font-size: 0.9rem;
  outline: none;
  cursor: pointer;
}

/* Cards Grid */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1.5rem;
}
.product-card {
  background: var(--bg-card);
  padding: 1.25rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  transition: transform 0.2s, border-color 0.2s;
}
.product-card:hover {
  transform: translateY(-4px);
  border-color: var(--accent-primary);
}
.product-visual {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  margin-bottom: 1rem;
  overflow: hidden;
}
.product-svg {
  width: 90px;
  height: 90px;
}
.product-info {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}
.product-category {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent-primary);
  font-weight: 700;
  margin-bottom: 0.25rem;
}
.product-name {
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.4rem;
  line-height: 1.3;
}
.product-desc {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-bottom: 1rem;
  flex-grow: 1;
}
.product-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.product-rating {
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.product-price {
  font-size: 1.2rem;
  font-weight: 800;
  color: var(--text-primary);
}

/* No Results */
.no-results {
  text-align: center;
  padding: 3rem 1.5rem;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-subtle);
  margin-top: 1rem;
}
.no-results-icon {
  font-size: 2.5rem;
  margin-bottom: 0.75rem;
}
.no-results h3 {
  font-size: 1.25rem;
  margin-bottom: 0.5rem;
}
.no-results p {
  color: var(--text-secondary);
  margin-bottom: 1.25rem;
  font-size: 0.95rem;
}

/* About Section */
.about-section {
  max-width: 800px;
  margin: 3rem auto 1rem;
  padding: 0 1.25rem;
  text-align: center;
}

/* Cart Drawer */
.cart-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 999;
}
.cart-drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: 380px;
  max-width: 100%;
  height: 100vh;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  visibility: hidden;
  transition: transform 0.3s ease, visibility 0.3s ease;
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.4);
}
.cart-drawer.open {
  transform: translateX(0);
  visibility: visible;
}
.drawer-header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.drawer-header h2 {
  font-size: 1.2rem;
  font-weight: 700;
}
.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  line-height: 1;
}
.close-btn:hover {
  color: var(--text-primary);
}
.drawer-body {
  padding: 1.25rem;
  flex-grow: 1;
  overflow-y: auto;
}
.empty-cart-state {
  text-align: center;
  padding: 3rem 1rem;
}
.empty-cart-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
  opacity: 0.6;
}
.empty-cart-state p {
  color: var(--text-secondary);
  margin-bottom: 1.5rem;
}
.cart-items-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.cart-item {
  display: flex;
  gap: 0.75rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-subtle);
}
.cart-item-visual {
  width: 50px;
  height: 50px;
  background: var(--bg-primary);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cart-item-visual svg {
  width: 36px;
  height: 36px;
}
.cart-item-details {
  flex-grow: 1;
}
.cart-item-details h4 {
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
  line-height: 1.3;
}
.cart-item-price {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--accent-primary);
  margin-bottom: 0.5rem;
}
.cart-item-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.qty-btn {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qty-val {
  font-size: 0.9rem;
  font-weight: 600;
  min-width: 20px;
  text-align: center;
}
.remove-btn {
  background: none;
  border: none;
  color: #f87171;
  font-size: 0.8rem;
  margin-left: auto;
  cursor: pointer;
}
.remove-btn:hover {
  text-decoration: underline;
}
.drawer-footer {
  padding: 1.25rem;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}
.summary-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}
.total-row {
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--text-primary);
  margin-top: 0.75rem;
  margin-bottom: 1.25rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--border-subtle);
}

/* Checkout Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  z-index: 1001;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.modal-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 1.75rem;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.modal-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
}
.demo-banner {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #fbbf24;
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  margin-bottom: 1.25rem;
  line-height: 1.4;
}
.checkout-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.form-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.form-group input {
  padding: 0.65rem 0.85rem;
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.95rem;
}
.form-group input:focus {
  outline: none;
  border-color: var(--accent-primary);
}
.checkout-summary {
  background: var(--bg-card);
  padding: 1rem;
  border-radius: var(--radius-sm);
  margin-top: 0.5rem;
}
.summary-line {
  display: flex;
  justify-content: space-between;
  font-size: 1.1rem;
}
.order-confirmation {
  text-align: center;
  padding: 2rem 1rem;
}
.success-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}
.order-confirmation h3 {
  font-size: 1.4rem;
  margin-bottom: 0.75rem;
}
.order-confirmation p {
  color: var(--text-secondary);
  font-size: 0.95rem;
  margin-bottom: 1.5rem;
}

/* Footer */
.footer {
  margin-top: auto;
  border-top: 1px solid var(--border-subtle);
  padding: 2rem 1.25rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

/* Responsive Media Queries */
@media (max-width: 768px) {
  .hero-grid {
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
  .hero-content {
    align-items: center;
    text-align: center;
  }
  .hero-actions {
    justify-content: center;
  }
  .hero-trust-chips {
    justify-content: center;
  }
  .hero-title {
    font-size: calc(${heroFontSize} * 0.72);
  }
  .nav-links a:not(.btn),
  .nav-menu {
    display: none;
  }
  .hero-section {
    padding: calc(${heroV} * 0.6) 1rem 2.5rem;
  }
  .catalog-section {
    padding: calc(${sectionV} * 0.6) 1rem;
  }
  .cards-grid {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
  .showcase-pill-top {
    right: 0;
  }
  .showcase-pill-bottom {
    left: 0;
  }
}

@media (max-width: 480px) {
  .hero-section {
    padding: 2.5rem 0.75rem 2rem;
  }
  .hero-title {
    font-size: clamp(1.6rem, 7vw, 2.2rem);
    word-break: break-word;
    overflow-wrap: break-word;
  }
  .hero-actions {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 0.75rem;
  }
  .hero-actions .btn {
    width: 100%;
    padding: 0.75rem 1rem;
  }
  .catalog-controls {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
  .category-filters {
    justify-content: flex-start;
  }
  .cards-grid {
    grid-template-columns: 1fr;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
  .cart-drawer {
    width: 100%;
  }
}

@media (max-width: 360px) {
  .nav-container {
    padding: 0.5rem 0.5rem;
  }
  .brand-logo {
    font-size: 1rem;
  }
  .hero-section {
    padding: 2rem 0.5rem;
  }
  .hero-title {
    font-size: 1.5rem;
  }
  .category-filters button {
    padding: 0.4rem 0.65rem;
    font-size: 0.8rem;
  }
}

${reducedMotionBlock}
`
      : `${cssTokens}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

ul, ol {
  list-style: none;
  margin: 0;
  padding: 0;
}

html, body {
  max-width: 100%;
  overflow-x: hidden;
}

body {
  font-family: ${bodyFont};
  background-color: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Navigation */
.navbar {
  background: var(--bg-surface);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand-logo {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  text-decoration: none;
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.navbar ul,
.nav-links ul,
nav ul,
ul.nav-menu,
ul.nav-links {
  list-style: none !important;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.navbar li,
.nav-links li,
nav li {
  list-style: none !important;
  margin: 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
}
.nav-links a:not(.btn) {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.95rem;
  transition: color 0.2s ease;
}
.nav-links a:not(.btn):hover {
  color: var(--accent-primary);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 0.95rem;
  text-decoration: none;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-primary {
  background-color: var(--accent-primary);
  color: var(--bg-primary);
}
.btn-primary:hover {
  background-color: var(--accent-hover);
  transform: translateY(-2px);
}
.btn-secondary {
  background-color: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
}
.btn-secondary:hover {
  background-color: var(--bg-card);
  transform: translateY(-2px);
}
.btn-sm {
  padding: 0.4rem 1rem;
  font-size: 0.85rem;
}
.btn-block {
  width: 100%;
}

/* Hero Section */
.hero-section {
  text-align: center;
  padding: ${heroV} 1.5rem 3.5rem;
  max-width: 800px;
  margin: 0 auto;
}
.hero-badge {
  display: inline-block;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  color: var(--accent-primary);
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
  border: 1px solid var(--border-subtle);
}
.hero-title {
  font-size: ${heroFontSize};
  line-height: 1.15;
  font-weight: 800;
  margin-bottom: 1.25rem;
  letter-spacing: -0.02em;
}
.hero-subtitle {
  font-size: 1.15rem;
  color: var(--text-secondary);
  margin-bottom: 2rem;
}
.hero-actions {
  display: flex;
  justify-content: center;
  gap: 1rem;
  flex-wrap: wrap;
}

/* Features Section */
.features-section {
  max-width: 1100px;
  margin: 0 auto;
  padding: ${sectionV} 1.5rem;
}
.section-header {
  text-align: center;
  margin-bottom: 3rem;
}
.section-header h2 {
  font-size: ${h2FontSize};
  margin-bottom: 0.5rem;
}
.section-header p {
  color: var(--text-secondary);
}
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.5rem;
}
.feature-card {
  background: var(--bg-card);
  padding: ${cardPad};
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-card);
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.feature-card:hover {
  transform: translateY(-4px);
  border-color: var(--accent-primary);
}
.card-icon {
  font-size: 2rem;
  margin-bottom: 1rem;
}
.feature-card h3 {
  font-size: 1.25rem;
  margin-bottom: 0.5rem;
}
.feature-card p {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

/* Contact Section */
.contact-section {
  max-width: 540px;
  margin: 2rem auto 5rem;
  padding: 0 1.5rem;
}
.contact-card {
  background: var(--bg-surface);
  padding: ${cardPad};
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-card);
}
.contact-card h2 {
  margin-bottom: 0.5rem;
}
.contact-card > p {
  color: var(--text-secondary);
  margin-bottom: 1.75rem;
  font-size: 0.95rem;
}
.contact-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.form-group label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.form-group input,
.form-group textarea {
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.95rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 20%, transparent);
}
.form-feedback {
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  text-align: center;
}
.form-feedback.success {
  background: rgba(34, 197, 94, 0.1);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.form-feedback.error {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

/* Footer */
.footer {
  margin-top: auto;
  border-top: 1px solid var(--border-subtle);
  padding: 2rem 1.5rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

/* Mobile Responsiveness */
@media (max-width: 768px) {
  .hero-title {
    font-size: calc(${heroFontSize} * 0.72);
  }
  .nav-links a:not(.btn) {
    display: none;
  }
  .hero-section {
    padding: calc(${heroV} * 0.6) 1rem 2.5rem;
  }
  .features-section {
    padding: calc(${sectionV} * 0.6) 1rem;
  }
}
@media (max-width: 480px) {
  .hero-section {
    padding: 2.5rem 0.75rem 2rem;
  }
  .hero-title {
    font-size: clamp(1.6rem, 7vw, 2.2rem);
    word-break: break-word;
    overflow-wrap: break-word;
  }
  .hero-actions {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: 0.75rem;
  }
  .hero-actions .btn {
    width: 100%;
    padding: 0.75rem 1rem;
  }
  .cards-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 360px) {
  .hero-section {
    padding: 2rem 0.5rem;
  }
  .hero-title {
    font-size: 1.5rem;
  }
  .nav-container {
    padding: 0.5rem 0.75rem;
  }
}
${reducedMotionBlock}
`;

    await workspace.write("styles.css", stylesCss);
    filesCreated.push("styles.css");

    // 4. script.js
    const scriptJs = isEcommerce
      ? `document.addEventListener('DOMContentLoaded', () => {
  const PRODUCTS = [
    {
      id: "prod-1",
      name: "Pro Wireless Noise-Cancelling Headphones",
      category: "electronics",
      price: 249.99,
      rating: 4.9,
      reviews: 128,
      description: "Active noise cancellation with 40-hour battery life and spatial audio clarity.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><circle cx="50" cy="50" r="42" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><path d="M28 52 C28 34, 72 34, 72 52" stroke="var(--accent-primary)" stroke-width="4" stroke-linecap="round"/><rect x="22" y="48" width="12" height="22" rx="6" fill="var(--accent-primary)"/><rect x="66" y="48" width="12" height="22" rx="6" fill="var(--accent-primary)"/></svg>'
    },
    {
      id: "prod-2",
      name: "Ultra-Slim Mechanical Keyboard",
      category: "electronics",
      price: 129.99,
      rating: 4.8,
      reviews: 94,
      description: "Low-profile tactile switches with aircraft-grade aluminum top case and RGB backlighting.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><rect x="15" y="32" width="70" height="38" rx="6" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><rect x="22" y="38" width="8" height="6" rx="2" fill="var(--accent-primary)"/><rect x="34" y="38" width="8" height="6" rx="2" fill="var(--accent-primary)"/><rect x="46" y="38" width="8" height="6" rx="2" fill="var(--accent-primary)"/><rect x="58" y="38" width="8" height="6" rx="2" fill="var(--accent-primary)"/><rect x="70" y="38" width="8" height="6" rx="2" fill="var(--accent-primary)"/><rect x="30" y="56" width="40" height="6" rx="2" fill="var(--accent-primary)"/></svg>'
    },
    {
      id: "prod-3",
      name: "Handcrafted Leather Messenger Bag",
      category: "accessories",
      price: 189.99,
      rating: 4.7,
      reviews: 76,
      description: "Full-grain vegetable-tanned leather with padded 16-inch laptop compartment.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><path d="M22 40 L78 40 L74 76 C74 80, 26 80, 26 76 Z" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><path d="M36 40 C36 28, 64 28, 64 40" stroke="var(--accent-primary)" stroke-width="3" fill="none"/><line x1="22" y1="48" x2="78" y2="48" stroke="var(--accent-primary)" stroke-width="2"/></svg>'
    },
    {
      id: "prod-4",
      name: "Minimalist Ceramic Desk Lamp",
      category: "home",
      price: 79.99,
      rating: 4.6,
      reviews: 52,
      description: "Warm dimmable LED glow with weighted matte ceramic base and touch controls.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><circle cx="50" cy="80" r="14" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><path d="M50 66 L50 36 L66 26" stroke="var(--accent-primary)" stroke-width="4" stroke-linecap="round"/><path d="M60 18 L76 30 L54 36 Z" fill="var(--accent-primary)"/></svg>'
    },
    {
      id: "prod-5",
      name: "Merino Wool Everyday Hoodie",
      category: "apparel",
      price: 119.99,
      rating: 4.9,
      reviews: 143,
      description: "100% fine merino wool providing thermal regulation, natural stretch, and breathability.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><path d="M32 26 L50 34 L68 26 L82 44 L72 50 L64 42 L64 78 L36 78 L36 42 L28 50 L18 44 Z" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><circle cx="50" cy="22" r="10" stroke="var(--accent-primary)" stroke-width="2"/></svg>'
    },
    {
      id: "prod-6",
      name: "Precision Smart Water Bottle",
      category: "accessories",
      price: 49.99,
      rating: 4.5,
      reviews: 61,
      description: "Vacuum-insulated stainless steel bottle tracking daily hydration with subtle LED indicator.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><rect x="42" y="16" width="16" height="8" rx="2" fill="var(--accent-primary)"/><rect x="36" y="24" width="28" height="60" rx="8" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><circle cx="50" cy="46" r="6" fill="var(--accent-primary)"/></svg>'
    },
    {
      id: "prod-7",
      name: "Ergonomic Memory Foam Wrist Rest",
      category: "accessories",
      price: 34.99,
      rating: 4.7,
      reviews: 89,
      description: "High-density cooling gel memory foam contoured to relieve wrist strain during long sessions.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><rect x="18" y="44" width="64" height="20" rx="8" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><line x1="26" y1="54" x2="74" y2="54" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    {
      id: "prod-8",
      name: "High-Fidelity Bluetooth Speaker",
      category: "electronics",
      price: 159.99,
      rating: 4.8,
      reviews: 110,
      description: "360-degree room-filling acoustic sound with deep dual passive bass radiators.",
      svg: '<svg viewBox="0 0 100 100" fill="none" class="product-svg"><rect x="28" y="22" width="44" height="60" rx="12" fill="var(--bg-surface)" stroke="var(--accent-primary)" stroke-width="2"/><circle cx="50" cy="42" r="12" fill="var(--accent-primary)"/><circle cx="50" cy="66" r="8" fill="var(--accent-primary)"/></svg>'
    }
  ];

  let cart = [];
  try {
    const saved = localStorage.getItem('achu_cart_items');
    if (saved) cart = JSON.parse(saved);
  } catch (err) {}

  function saveCart() {
    try {
      localStorage.setItem('achu_cart_items', JSON.stringify(cart));
    } catch (err) {}
  }

  const productGrid = document.getElementById('productGrid');
  const searchInput = document.getElementById('searchInput');
  const sortSelect = document.getElementById('sortSelect');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const noResults = document.getElementById('noResults');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');

  const cartBtn = document.getElementById('cartBtn');
  const cartDrawer = document.getElementById('cartDrawer');
  const cartOverlay = document.getElementById('cartOverlay');
  const cartCloseBtn = document.getElementById('cartCloseBtn');
  const cartCount = document.getElementById('cartCount');
  const drawerCount = document.getElementById('drawerCount');
  const cartItemsList = document.getElementById('cartItemsList');
  const emptyCartState = document.getElementById('emptyCartState');
  const drawerFooter = document.getElementById('drawerFooter');
  const subtotalPrice = document.getElementById('subtotalPrice');
  const shippingPrice = document.getElementById('shippingPrice');
  const taxPrice = document.getElementById('taxPrice');
  const totalPrice = document.getElementById('totalPrice');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const startShoppingBtn = document.getElementById('startShoppingBtn');

  const checkoutModal = document.getElementById('checkoutModal');
  const checkoutCloseBtn = document.getElementById('checkoutCloseBtn');
  const checkoutForm = document.getElementById('checkoutForm');
  const modalTotalPrice = document.getElementById('modalTotalPrice');
  const orderConfirmation = document.getElementById('orderConfirmation');
  const orderNumber = document.getElementById('orderNumber');
  const returnToStoreBtn = document.getElementById('returnToStoreBtn');

  let activeCategory = 'all';

  function renderProducts(items) {
    if (!productGrid) return;
    productGrid.innerHTML = '';
    if (items.length === 0) {
      if (noResults) noResults.style.display = 'block';
      return;
    }
    if (noResults) noResults.style.display = 'none';

    items.forEach(product => {
      const card = document.createElement('article');
      card.className = 'feature-card product-card';
      card.innerHTML = \`
        <div class="product-visual">\${product.svg}</div>
        <div class="product-info">
          <span class="product-category">\${product.category}</span>
          <h3 class="product-name">\${product.name}</h3>
          <p class="product-desc">\${product.description}</p>
          <div class="product-meta">
            <span class="product-rating">⭐ \${product.rating} <small>(\${product.reviews})</small></span>
            <span class="product-price">$\${product.price.toFixed(2)}</span>
          </div>
          <button class="btn btn-primary btn-block btn-add-to-cart" data-id="\${product.id}">
            Add to Cart
          </button>
        </div>
      \`;
      productGrid.appendChild(card);
    });

    productGrid.querySelectorAll('.btn-add-to-cart').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        addToCart(id);
      });
    });
  }

  function filterAndSortProducts() {
    const query = (searchInput?.value || '').trim().toLowerCase();
    let filtered = PRODUCTS.filter(p => {
      const matchesCategory = activeCategory === 'all' || p.category.toLowerCase() === activeCategory.toLowerCase();
      const matchesSearch = !query || p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query) || p.category.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    const sortValue = sortSelect?.value || 'featured';
    if (sortValue === 'price-low') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sortValue === 'price-high') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sortValue === 'rating') {
      filtered.sort((a, b) => b.rating - a.rating);
    }

    renderProducts(filtered);
  }

  function addToCart(productId) {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return;
    const existing = cart.find(item => item.id === productId);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ id: product.id, name: product.name, price: product.price, quantity: 1, svg: product.svg });
    }
    saveCart();
    updateCartUI();
    openCart();
  }

  function updateCartUI() {
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (cartCount) cartCount.textContent = String(totalItems);
    if (drawerCount) drawerCount.textContent = String(totalItems);
    const badge = document.querySelector('.cart-badge');
    if (badge) {
      badge.textContent = String(totalItems);
      badge.style.display = totalItems > 0 ? 'inline-block' : 'none';
    }

    if (totalItems === 0) {
      if (emptyCartState) emptyCartState.style.display = 'block';
      if (cartItemsList) cartItemsList.innerHTML = '';
      if (drawerFooter) drawerFooter.style.display = 'none';
      return;
    }

    if (emptyCartState) emptyCartState.style.display = 'none';
    if (drawerFooter) drawerFooter.style.display = 'block';

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal >= 100 || subtotal === 0 ? 0 : 9.99;
    const tax = subtotal * 0.08;
    const total = subtotal + shipping + tax;

    if (subtotalPrice) subtotalPrice.textContent = \`$\${subtotal.toFixed(2)}\`;
    if (shippingPrice) shippingPrice.textContent = shipping === 0 ? 'Free' : \`$\${shipping.toFixed(2)}\`;
    if (taxPrice) taxPrice.textContent = \`$\${tax.toFixed(2)}\`;
    if (totalPrice) totalPrice.textContent = \`$\${total.toFixed(2)}\`;
    if (modalTotalPrice) modalTotalPrice.textContent = \`$\${total.toFixed(2)}\`;

    if (cartItemsList) {
      cartItemsList.innerHTML = '';
      cart.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item';
        itemEl.innerHTML = \`
          <div class="cart-item-visual">\${item.svg}</div>
          <div class="cart-item-details">
            <h4>\${item.name}</h4>
            <div class="cart-item-price">$\${item.price.toFixed(2)}</div>
            <div class="cart-item-controls">
              <button class="qty-btn dec-btn" data-id="\${item.id}" aria-label="Decrease quantity">&minus;</button>
              <span class="qty-val">\${item.quantity}</span>
              <button class="qty-btn inc-btn" data-id="\${item.id}" aria-label="Increase quantity">&plus;</button>
              <button class="remove-btn" data-id="\${item.id}" aria-label="Remove item">Remove</button>
            </div>
          </div>
        \`;
        cartItemsList.appendChild(itemEl);
      });

      cartItemsList.querySelectorAll('.dec-btn').forEach(b => {
        b.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          const entry = cart.find(i => i.id === id);
          if (entry) {
            entry.quantity -= 1;
            if (entry.quantity <= 0) {
              cart = cart.filter(i => i.id !== id);
            }
            saveCart();
            updateCartUI();
          }
        });
      });

      cartItemsList.querySelectorAll('.inc-btn').forEach(b => {
        b.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          const entry = cart.find(i => i.id === id);
          if (entry) {
            entry.quantity += 1;
            saveCart();
            updateCartUI();
          }
        });
      });

      cartItemsList.querySelectorAll('.remove-btn').forEach(b => {
        b.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          cart = cart.filter(i => i.id !== id);
          saveCart();
          updateCartUI();
        });
      });
    }
  }

  function openCart() {
    if (cartDrawer) cartDrawer.classList.add('open');
    if (cartOverlay) cartOverlay.style.display = 'block';
  }

  function closeCart() {
    if (cartDrawer) cartDrawer.classList.remove('open');
    if (cartOverlay) cartOverlay.style.display = 'none';
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      activeCategory = e.currentTarget.getAttribute('data-category') || 'all';
      filterAndSortProducts();
    });
  });

  searchInput?.addEventListener('input', filterAndSortProducts);
  sortSelect?.addEventListener('change', filterAndSortProducts);

  resetFiltersBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    filterBtns.forEach(b => {
      if (b.getAttribute('data-category') === 'all') b.classList.add('active');
      else b.classList.remove('active');
    });
    activeCategory = 'all';
    if (sortSelect) sortSelect.value = 'featured';
    filterAndSortProducts();
  });

  cartBtn?.addEventListener('click', openCart);
  cartCloseBtn?.addEventListener('click', closeCart);
  cartOverlay?.addEventListener('click', closeCart);
  startShoppingBtn?.addEventListener('click', closeCart);

  checkoutBtn?.addEventListener('click', () => {
    closeCart();
    if (checkoutModal) checkoutModal.style.display = 'flex';
  });

  checkoutCloseBtn?.addEventListener('click', () => {
    if (checkoutModal) checkoutModal.style.display = 'none';
  });

  checkoutForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const randNum = Math.floor(10000 + Math.random() * 90000);
    if (orderNumber) orderNumber.textContent = \`#ORD-\${randNum}\`;
    if (checkoutForm) checkoutForm.style.display = 'none';
    if (orderConfirmation) orderConfirmation.style.display = 'block';
    cart = [];
    saveCart();
    updateCartUI();
  });

  returnToStoreBtn?.addEventListener('click', () => {
    if (checkoutModal) checkoutModal.style.display = 'none';
    if (checkoutForm) {
      checkoutForm.reset();
      checkoutForm.style.display = 'flex';
    }
    if (orderConfirmation) orderConfirmation.style.display = 'none';
  });

  updateCartUI();
  filterAndSortProducts();

  // Expose helpers globally for accessibility, tests, and inline event handlers
  window.updateCartBadge = updateCartUI;
  window.updateCartUI = updateCartUI;
  window.addToCart = addToCart;
  window.saveCart = saveCart;
  window.PRODUCTS = PRODUCTS;
});`
      : `document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contact-form');
  const feedback = document.getElementById('form-feedback');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('name')?.value.trim();
      const email = document.getElementById('email')?.value.trim();
      const message = document.getElementById('message')?.value.trim();

      if (!name || !email || !message) {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.className = 'form-feedback error';
          feedback.textContent = 'Please complete all required fields.';
        }
        return;
      }

      if (feedback) {
        feedback.style.display = 'block';
        feedback.className = 'form-feedback success';
        feedback.textContent = \`Thank you, \${name}! Your message has been received.\`;
      }
      form.reset();
    });
  }
});
`;
    await workspace.write("script.js", scriptJs);
    filesCreated.push("script.js");

    return { success: true, files: filesCreated, projectRoot: workspace.root };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, files: filesCreated, error };
  }
}
