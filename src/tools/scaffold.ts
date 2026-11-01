import path from "node:path";
import fs from "node:fs";
import { Workspace } from "./workspace.js";
import type { DesignSpec } from "./design-planner.js";

export type ProjectTemplate = "react-vite" | "static" | "nextjs" | "node-express" | "fullstack-ecommerce";

export type ScaffoldResult = {
  success: boolean;
  files: string[];
  projectRoot?: string;
  error?: string;
};

export type ProjectValidationResult = {
  valid: boolean;
  projectType: "react" | "static" | "node" | "nextjs" | "unknown";
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

  // Next.js project validation
  const isNext = Boolean(deps.next || (typeof scripts.dev === "string" && scripts.dev.includes("next")));
  if (isNext) {
    const hasNextEntry =
      fs.existsSync(path.join(workingDir, "app/page.tsx")) ||
      fs.existsSync(path.join(workingDir, "app/page.jsx")) ||
      fs.existsSync(path.join(workingDir, "app/page.js")) ||
      fs.existsSync(path.join(workingDir, "src/app/page.tsx")) ||
      fs.existsSync(path.join(workingDir, "pages/index.tsx")) ||
      fs.existsSync(path.join(workingDir, "pages/index.js"));
    if (!hasNextEntry) {
      return {
        valid: false,
        projectType: "nextjs",
        error: `Next.js project is missing entry page (expected app/page.tsx or pages/index.js).`,
      };
    }
    return { valid: true, projectType: "nextjs" };
  }

  // Node server / backend validation
  const hasServerScript =
    fs.existsSync(path.join(workingDir, "server.js")) ||
    fs.existsSync(path.join(workingDir, "server.mjs")) ||
    fs.existsSync(path.join(workingDir, "server.cjs")) ||
    (typeof scripts.start === "string" && scripts.start.includes("node server"));
  if (hasServerScript) {
    return { valid: true, projectType: "node" };
  }

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

  // Static site validation: index.html at root or public/index.html
  const hasIndexHtml = fs.existsSync(path.join(workingDir, "index.html")) || fs.existsSync(path.join(workingDir, "public", "index.html"));
  if (!hasIndexHtml) {
    return {
      valid: false,
      projectType: "static",
      error: `Web project is missing 'index.html'. A root index.html or public/index.html is required for the application to render.`,
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
        build: "node -e \"const fs=require('fs'); fs.mkdirSync('public', {recursive:true}); for(const f of fs.readdirSync('.')){ if(!['public','node_modules','.git','package.json','package-lock.json','.env'].includes(f)){ fs.cpSync(f, 'public/'+f, {recursive:true}); } } console.log('Static site staged to public/');\"",
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

/**
 * Scaffolds a complete Next.js full-stack application (App Router, API routes, layout, client page).
 */
export async function scaffoldNextjsProject(
  workspace: Workspace,
  projectName = "nextjs-app",
  designSpec?: DesignSpec
): Promise<ScaffoldResult> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "nextjs-app";
  const title = projectName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesCreated: string[] = [];

  try {
    // 1. package.json
    const packageJson = {
      name: slug,
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
      },
      dependencies: {
        next: "^15.1.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        typescript: "^5.7.0",
        "@types/node": "^22.0.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
      },
    };
    await workspace.write("package.json", JSON.stringify(packageJson, null, 2) + "\n");
    filesCreated.push("package.json");

    // 2. next.config.mjs
    const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`;
    await workspace.write("next.config.mjs", nextConfig);
    filesCreated.push("next.config.mjs");

    // 3. tsconfig.json
    const tsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;
    await workspace.write("tsconfig.json", tsconfig);
    filesCreated.push("tsconfig.json");

    // 4. app/globals.css
    const globalsCss = `:root {
  --bg: #090d16;
  --surface: #131b2e;
  --card: #1e293b;
  --border: rgba(255, 255, 255, 0.08);
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --radius: 12px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: var(--bg);
  color: var(--text-primary);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(9, 13, 22, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 1rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  text-decoration: none;
}

.nav-links {
  display: flex;
  gap: 1.5rem;
  list-style: none;
}

.nav-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.95rem;
  transition: color 0.2s;
}

.nav-link:hover {
  color: var(--accent);
}

.container {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  flex: 1;
}

.hero {
  text-align: center;
  padding: 4rem 1rem 3rem;
}

.hero h1 {
  font-size: clamp(2rem, 5vw, 3.25rem);
  font-weight: 800;
  margin-bottom: 1rem;
  background: linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero p {
  color: var(--text-secondary);
  font-size: 1.15rem;
  max-width: 600px;
  margin: 0 auto 2rem;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s, transform 0.1s;
}

.btn-primary {
  background: var(--accent);
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-top: 2rem;
}

.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.5rem;
  transition: transform 0.2s, box-shadow 0.2s;
}

.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.5);
}

.card-title {
  font-size: 1.15rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.card-desc {
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

footer {
  border-top: 1px solid var(--border);
  padding: 2rem 1.5rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.875rem;
}
`;
    await workspace.write("app/globals.css", globalsCss);
    filesCreated.push("app/globals.css");

    // 5. app/layout.tsx
    const layoutTsx = `import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "${title} — Full-Stack Application",
  description: "Built with Next.js App Router and full-stack API integration.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="navbar">
          <a href="/" className="brand">🚀 ${title}</a>
          <nav>
            <ul className="nav-links">
              <li><a href="#features" className="nav-link">Features</a></li>
              <li><a href="#api" className="nav-link">API</a></li>
            </ul>
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          <p>&copy; ${new Date().getFullYear()} ${title}. Built with Next.js and Achu Coding Agent.</p>
        </footer>
      </body>
    </html>
  );
}
`;
    await workspace.write("app/layout.tsx", layoutTsx);
    filesCreated.push("app/layout.tsx");

    // 6. app/api/items/route.ts
    const apiRouteTs = `import { NextResponse } from "next/server";

interface Item {
  id: string;
  name: string;
  description: string;
  status: "active" | "completed";
}

let items: Item[] = [
  { id: "1", name: "High-Performance Next.js Architecture", description: "Built with React Server Components and fast edge routing.", status: "completed" },
  { id: "2", name: "Full-Stack API Routes", description: "Native RESTful API handlers for seamless frontend-backend integration.", status: "active" },
  { id: "3", name: "Responsive Responsive Layout", description: "Mobile-first design with accessible components and dark mode.", status: "active" },
];

export async function GET() {
  return NextResponse.json({ success: true, count: items.length, items });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || !body.name) {
      return NextResponse.json({ success: false, error: "Field 'name' is required." }, { status: 400 });
    }
    const newItem: Item = {
      id: String(Date.now()),
      name: String(body.name).trim(),
      description: String(body.description || "Custom item added via API").trim(),
      status: "active",
    };
    items.push(newItem);
    return NextResponse.json({ success: true, item: newItem }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }
}
`;
    await workspace.write("app/api/items/route.ts", apiRouteTs);
    filesCreated.push("app/api/items/route.ts");

    // 7. app/page.tsx
    const pageTsx = `"use client";

import { useEffect, useState } from "react";

interface Item {
  id: string;
  name: string;
  description: string;
  status: "active" | "completed";
}

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/items")
      .then((res) => res.json())
      .then((data) => {
        if (data.items) setItems(data.items);
      })
      .catch((err) => console.error("Failed to load items:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newItemName, description: "Interactive task created via client" }),
      });
      const data = await res.json();
      if (data.success && data.item) {
        setItems((prev) => [...prev, data.item]);
        setNewItemName("");
      }
    } catch (err) {
      console.error("Failed to add item:", err);
    }
  };

  return (
    <div className="container">
      <section className="hero">
        <h1>${title} Full-Stack App</h1>
        <p>A production-ready full-stack application with live API endpoints and responsive UI.</p>
        <form onSubmit={handleAddItem} style={{ display: "flex", gap: "0.5rem", maxWidth: "480px", margin: "0 auto" }}>
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder="Add new feature or task..."
            aria-label="Add new item"
            style={{
              flex: 1,
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--text-primary)",
              fontSize: "0.95rem",
            }}
          />
          <button type="submit" className="btn btn-primary">Add Item</button>
        </form>
      </section>

      <section id="features" style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Application Features & Data</h2>
        {loading ? (
          <p style={{ color: "var(--text-secondary)" }}>Loading items from backend...</p>
        ) : (
          <div className="grid">
            {items.map((item) => (
              <div key={item.id} className="card">
                <h3 className="card-title">{item.name}</h3>
                <p className="card-desc">{item.description}</p>
                <span
                  style={{
                    display: "inline-block",
                    marginTop: "0.75rem",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    background: item.status === "completed" ? "rgba(34, 197, 94, 0.15)" : "rgba(59, 130, 246, 0.15)",
                    color: item.status === "completed" ? "#22c55e" : "#3b82f6",
                  }}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
`;
    await workspace.write("app/page.tsx", pageTsx);
    filesCreated.push("app/page.tsx");

    // 8. index.html at root (for static preview fallbacks)
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="app/globals.css">
</head>
<body>
  <header class="navbar">
    <a href="/" class="brand">🚀 ${title}</a>
  </header>
  <main class="container">
    <section class="hero">
      <h1>${title} Full-Stack App</h1>
      <p>Running on Next.js with App Router and native API routes.</p>
    </section>
  </main>
</body>
</html>`;
    await workspace.write("index.html", indexHtml);
    filesCreated.push("index.html");

    return { success: true, files: filesCreated, projectRoot: workspace.root };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, files: filesCreated, error };
  }
}

/**
 * Scaffolds a complete Node.js + Express backend with REST APIs and interactive frontend.
 */
export async function scaffoldNodeExpressProject(
  workspace: Workspace,
  projectName = "express-api",
  designSpec?: DesignSpec
): Promise<ScaffoldResult> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "express-api";
  const title = projectName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesCreated: string[] = [];

  try {
    // 1. package.json
    const packageJson = {
      name: slug,
      version: "0.1.0",
      type: "module",
      scripts: {
        start: "node server.js",
        dev: "node server.js",
      },
      dependencies: {
        express: "^4.21.0",
        cors: "^2.8.5",
      },
    };
    await workspace.write("package.json", JSON.stringify(packageJson, null, 2) + "\n");
    filesCreated.push("package.json");

    // 2. server.js
    const serverJs = `import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || "3000", 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let items = [
  { id: 1, title: "Database Connectivity", category: "Core", status: "Active" },
  { id: 2, title: "RESTful Endpoints", category: "API", status: "Active" },
  { id: 3, title: "Frontend Client UI", category: "Client", status: "Active" },
];

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/items", (_req, res) => {
  res.json({ success: true, count: items.length, items });
});

app.post("/api/items", (req, res) => {
  const { title, category } = req.body || {};
  if (!title) {
    return res.status(400).json({ success: false, error: "Title is required" });
  }
  const newItem = {
    id: Date.now(),
    title: String(title).trim(),
    category: String(category || "General").trim(),
    status: "Active",
  };
  items.push(newItem);
  res.status(201).json({ success: true, item: newItem });
});

app.delete("/api/items/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  items = items.filter((item) => item.id !== id);
  res.json({ success: true, message: "Item deleted" });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(\`Server is running on port \${port}\`);
});
`;
    await workspace.write("server.js", serverJs);
    filesCreated.push("server.js");

    // 3. public/index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Express Service</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="navbar">
    <div class="nav-container">
      <a href="/" class="brand-logo">⚡ ${title}</a>
      <span class="status-badge" id="apiStatus">Checking API...</span>
    </div>
  </header>
  <main class="container">
    <section class="hero">
      <h1>${title} Service</h1>
      <p>Node.js & Express REST API with real-time browser client interface.</p>
      <form id="itemForm" class="add-form">
        <input type="text" id="itemTitle" placeholder="Enter new item name..." required aria-label="Item title" />
        <input type="text" id="itemCategory" placeholder="Category (optional)" aria-label="Item category" />
        <button type="submit" class="btn btn-primary">Add Item</button>
      </form>
    </section>
    <section class="content-section">
      <h2>Active Records</h2>
      <div id="itemList" class="items-grid"></div>
    </section>
  </main>
  <script src="app.js"></script>
</body>
</html>`;
    await workspace.write("public/index.html", indexHtml);
    filesCreated.push("public/index.html");

    // Also write root index.html so root preview servers locate it immediately
    await workspace.write("index.html", indexHtml);
    filesCreated.push("index.html");

    // 4. public/styles.css
    const stylesCss = `:root {
  --bg: #0b0f19;
  --card-bg: #1e293b;
  --border: rgba(255, 255, 255, 0.1);
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background-color: var(--bg);
  color: var(--text-primary);
  min-height: 100vh;
}
.navbar {
  border-bottom: 1px solid var(--border);
  padding: 1rem 1.5rem;
  background: rgba(11, 15, 25, 0.8);
  backdrop-filter: blur(8px);
}
.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.brand-logo {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  text-decoration: none;
}
.status-badge {
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 9999px;
  background: rgba(59, 130, 246, 0.15);
  color: var(--accent);
}
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem;
}
.hero {
  text-align: center;
  margin-bottom: 3rem;
}
.hero h1 { font-size: 2.5rem; margin-bottom: 0.75rem; }
.hero p { color: var(--text-secondary); margin-bottom: 1.5rem; }
.add-form {
  display: flex;
  gap: 0.75rem;
  max-width: 600px;
  margin: 0 auto;
}
.add-form input {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card-bg);
  color: var(--text-primary);
  flex: 1;
}
.btn {
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-delete { background: #ef4444; color: #fff; padding: 4px 8px; font-size: 0.75rem; }
.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1.5rem;
  margin-top: 1rem;
}
.item-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.25rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
`;
    await workspace.write("public/styles.css", stylesCss);
    filesCreated.push("public/styles.css");

    // 5. public/app.js
    const appJs = `document.addEventListener("DOMContentLoaded", () => {
  const itemList = document.getElementById("itemList");
  const itemForm = document.getElementById("itemForm");
  const apiStatus = document.getElementById("apiStatus");

  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        apiStatus.textContent = "● API Online";
        apiStatus.style.color = "#22c55e";
      }
    } catch {
      apiStatus.textContent = "● API Connecting...";
    }
  }

  async function loadItems() {
    try {
      const res = await fetch("/api/items");
      const data = await res.json();
      if (data.items) {
        renderItems(data.items);
      }
    } catch (err) {
      console.error("Failed to load items:", err);
    }
  }

  function renderItems(items) {
    if (!itemList) return;
    if (items.length === 0) {
      itemList.innerHTML = "<p style='color:var(--text-secondary)'>No items recorded yet.</p>";
      return;
    }
    itemList.innerHTML = items
      .map(
        (item) => \`
      <div class="item-card">
        <div>
          <h4>\${item.title}</h4>
          <span style="font-size:0.8rem;color:var(--text-secondary)">\${item.category}</span>
        </div>
        <button class="btn btn-delete" onclick="deleteItem(\${item.id})">Delete</button>
      </div>\`
      )
      .join("");
  }

  window.deleteItem = async (id) => {
    try {
      await fetch(\`/api/items/\${id}\`, { method: "DELETE" });
      loadItems();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  itemForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const titleInput = document.getElementById("itemTitle");
    const catInput = document.getElementById("itemCategory");
    const title = titleInput.value.trim();
    const category = catInput.value.trim() || "General";
    if (!title) return;

    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category }),
      });
      if (res.ok) {
        titleInput.value = "";
        catInput.value = "";
        loadItems();
      }
    } catch (err) {
      console.error("Add failed:", err);
    }
  });

  checkHealth();
  loadItems();
});
`;
    await workspace.write("public/app.js", appJs);
    filesCreated.push("public/app.js");

    return { success: true, files: filesCreated, projectRoot: workspace.root };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, files: filesCreated, error };
  }
}

/**
 * Scaffolds a complete full-stack e-commerce shopping platform with authentication,
 * persistent product catalog, cart, checkout, orders, admin dashboard, and automated tests.
 */
export async function scaffoldFullstackEcommerceProject(
  workspace: Workspace,
  projectName = "novamart-store",
  designSpec?: DesignSpec
): Promise<ScaffoldResult> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "novamart-store";
  const title = projectName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesCreated: string[] = [];

  try {
    // 1. package.json
    const packageJson = {
      name: slug,
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        start: "node server.js",
        dev: "node server.js",
        test: "node --test tests/api.test.js",
      },
      dependencies: {
        express: "^4.21.0",
        cors: "^2.8.5",
      },
    };
    await workspace.write("package.json", JSON.stringify(packageJson, null, 2) + "\n");
    filesCreated.push("package.json");

    // 2. db.js - Database persistence with SQLite & resilient storage
    const dbJs = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, "store.json");

const INITIAL_RESTAURANTS = [
  { id: 1, name: "The Burger Loft", cuisine: "American & Burgers", rating: 4.9, eta: "20-30 min", deliveryFee: 2.99, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='50' fill='%23f59e0b' fill-opacity='0.2'/%3E%3Ctext x='100' y='120' font-size='60' text-anchor='middle'%3E🍔%3C/text%3E%3C/svg%3E" },
  { id: 2, name: "Napoli Fire Kitchen", cuisine: "Wood-Fired Pizza & Italian", rating: 4.8, eta: "25-35 min", deliveryFee: 3.49, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='50' fill='%23ef4444' fill-opacity='0.2'/%3E%3Ctext x='100' y='120' font-size='60' text-anchor='middle'%3E🍕%3C/text%3E%3C/svg%3E" },
  { id: 3, name: "Sakura Japanese Bistro", cuisine: "Sushi & Japanese", rating: 4.9, eta: "30-40 min", deliveryFee: 3.99, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='50' fill='%233b82f6' fill-opacity='0.2'/%3E%3Ctext x='100' y='120' font-size='60' text-anchor='middle'%3E🍣%3C/text%3E%3C/svg%3E" },
  { id: 4, name: "Sweet Craft Patisserie", cuisine: "Bakery & Desserts", rating: 4.9, eta: "15-25 min", deliveryFee: 1.99, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='50' fill='%23ec4899' fill-opacity='0.2'/%3E%3Ctext x='100' y='120' font-size='60' text-anchor='middle'%3E🍰%3C/text%3E%3C/svg%3E" },
  { id: 5, name: "Green Vitality Bar", cuisine: "Organic Juices & Bowls", rating: 4.6, eta: "10-20 min", deliveryFee: 1.49, image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='50' fill='%2310b981' fill-opacity='0.2'/%3E%3Ctext x='100' y='120' font-size='60' text-anchor='middle'%3E🥗%3C/text%3E%3C/svg%3E" }
];

const INITIAL_PRODUCTS = [
  { id: 1, restaurantId: 1, restaurantName: "The Burger Loft", title: "Truffle Smash Burger", category: "Burgers", price: 14.99, rating: 4.9, stock: 40, eta: "20-30 min", description: "Double aged beef patty, black truffle aioli, melted gruyere on toasted brioche bun.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='50' fill='%23f59e0b' fill-opacity='0.2' stroke='%23f59e0b' stroke-width='4'/%3E%3Cpath d='M65 95 Q100 65 135 95 Z' fill='%23d97706'/%3E%3Crect x='60' y='100' width='80' height='10' rx='3' fill='%23ef4444'/%3E%3Crect x='58' y='112' width='84' height='12' rx='4' fill='%2378350f'/%3E%3Cpath d='M65 128 Q100 145 135 128 Z' fill='%23d97706'/%3E%3C/svg%3E" },
  { id: 2, restaurantId: 2, restaurantName: "Napoli Fire Kitchen", title: "Artisan Margherita Pizza", category: "Pizza", price: 18.50, rating: 4.8, stock: 30, eta: "25-35 min", description: "San Marzano tomatoes, fresh buffalo mozzarella, fragrant sweet basil, extra virgin olive oil.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='55' fill='%23d97706' stroke='%23b45309' stroke-width='4'/%3E%3Ccircle cx='100' cy='100' r='45' fill='%23ef4444'/%3E%3Ccircle cx='85' cy='85' r='12' fill='%23fef08a'/%3E%3Ccircle cx='115' cy='95' r='10' fill='%23fef08a'/%3E%3Ccircle cx='95' cy='115' r='11' fill='%23fef08a'/%3E%3C/svg%3E" },
  { id: 3, restaurantId: 3, restaurantName: "Sakura Japanese Bistro", title: "Spicy Dragon Roll Combo", category: "Sushi", price: 22.00, rating: 4.9, stock: 25, eta: "30-40 min", description: "Fresh unagi, avocado, spicy bluefin tuna, cucumber with house tare glaze and sesame.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Crect x='50' y='75' width='100' height='50' rx='8' fill='%230f172a' stroke='%2338bdf8' stroke-width='3'/%3E%3Ccircle cx='75' cy='100' r='14' fill='%23f8fafc' stroke='%23ef4444' stroke-width='4'/%3E%3Ccircle cx='100' cy='100' r='14' fill='%23f8fafc' stroke='%23f59e0b' stroke-width='4'/%3E%3Ccircle cx='125' cy='100' r='14' fill='%23f8fafc' stroke='%2310b981' stroke-width='4'/%3E%3C/svg%3E" },
  { id: 4, restaurantId: 1, restaurantName: "The Burger Loft", title: "Hot Honey Fried Chicken", category: "Burgers", price: 13.50, rating: 4.7, stock: 35, eta: "20-30 min", description: "Buttermilk fried chicken breast, habanero hot honey drizzle, crunchy slaw.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Cpath d='M65 90 Q100 65 135 90 Z' fill='%23d97706'/%3E%3Crect x='55' y='95' width='90' height='20' rx='5' fill='%23b45309' stroke='%23f59e0b' stroke-width='2'/%3E%3Cpath d='M65 125 Q100 145 135 125 Z' fill='%23d97706'/%3E%3C/svg%3E" },
  { id: 5, restaurantId: 2, restaurantName: "Napoli Fire Kitchen", title: "Truffle & Wild Mushroom Pizza", category: "Pizza", price: 21.00, rating: 4.9, stock: 20, eta: "25-35 min", description: "Roasted cremini, shiitake, white truffle cream, fresh thyme, fior di latte.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='55' fill='%2378350f' stroke='%23d97706' stroke-width='4'/%3E%3Ccircle cx='100' cy='100' r='45' fill='%23fef08a'/%3E%3Ccircle cx='85' cy='85' r='8' fill='%23451a03'/%3E%3Ccircle cx='115' cy='95' r='8' fill='%23451a03'/%3E%3Ccircle cx='95' cy='115' r='8' fill='%23451a03'/%3E%3C/svg%3E" },
  { id: 6, restaurantId: 3, restaurantName: "Sakura Japanese Bistro", title: "Fresh Salmon Sashimi Bowl", category: "Sushi", price: 19.50, rating: 4.8, stock: 25, eta: "25-35 min", description: "Atlantic salmon, seasoned sushi rice, avocado, cucumber, edamame, ponzu.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Cpath d='M60 110 Q100 155 140 110 Z' fill='%230f172a' stroke='%2338bdf8' stroke-width='3'/%3E%3Crect x='70' y='80' width='35' height='25' rx='4' fill='%23f97316'/%3E%3Crect x='95' y='80' width='35' height='25' rx='4' fill='%23f97316'/%3E%3Ccircle cx='80' cy='105' r='6' fill='%2310b981'/%3E%3C/svg%3E" },
  { id: 7, restaurantId: 4, restaurantName: "Sweet Craft Patisserie", title: "Belgian Chocolate Lava Cake", category: "Desserts", price: 9.50, rating: 4.9, stock: 50, eta: "15-25 min", description: "Warm molten Valrhona dark chocolate center, madagascar vanilla bean cream.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Cpath d='M70 140 L75 90 L125 90 L130 140 Z' fill='%233b1e08' stroke='%2378350f' stroke-width='3'/%3E%3Ccircle cx='100' cy='90' r='10' fill='%23ef4444'/%3E%3C/svg%3E" },
  { id: 8, restaurantId: 5, restaurantName: "Green Vitality Bar", title: "Organic Cold-Pressed Juice", category: "Beverages", price: 6.50, rating: 4.6, stock: 60, eta: "10-20 min", description: "Organic kale, green apple, cucumber, celery, fresh lemon and ginger root.", image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Crect x='80' y='60' width='40' height='80' rx='8' fill='%2310b981' stroke='%23059669' stroke-width='3'/%3E%3C/svg%3E" }
];

const INITIAL_USERS = [
  { id: 1, email: "admin@store.com", password: "admin123", name: "System Admin", role: "admin" },
  { id: 2, email: "user@store.com", password: "user123", name: "Alex Customer", role: "user" }
];

class StoreDB {
  constructor() {
    this.data = {
      restaurants: INITIAL_RESTAURANTS,
      products: INITIAL_PRODUCTS,
      users: INITIAL_USERS,
      cart: [],
      orders: []
    };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(dbPath)) {
        const raw = fs.readFileSync(dbPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.products && parsed.users) {
          this.data = {
            restaurants: parsed.restaurants || INITIAL_RESTAURANTS,
            ...parsed
          };
        }
      } else {
        this.save();
      }
    } catch {
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(this.data, null, 2), "utf8");
    } catch {}
  }

  getProducts({ q = "", category = "", sort = "featured" } = {}) {
    let list = [...this.data.products];
    if (category && category !== "all") {
      list = list.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }
    if (q) {
      const query = q.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query));
    }
    if (sort === "price-low") list.sort((a, b) => a.price - b.price);
    else if (sort === "price-high") list.sort((a, b) => b.price - a.price);
    else if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
    return list;
  }

  getProductById(id) {
    return this.data.products.find(p => p.id === Number(id));
  }

  addProduct(product) {
    const newProduct = {
      id: Date.now(),
      ...product,
      price: Number(product.price) || 0,
      rating: Number(product.rating) || 5.0,
      stock: Number(product.stock) || 10,
    };
    this.data.products.push(newProduct);
    this.save();
    return newProduct;
  }

  authenticate(email, password) {
    return this.data.users.find(u => u.email.toLowerCase() === String(email).toLowerCase() && u.password === String(password));
  }

  registerUser({ email, password, name }) {
    if (this.data.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      return null;
    }
    const newUser = {
      id: Date.now(),
      email,
      password,
      name: name || email.split("@")[0],
      role: "user"
    };
    this.data.users.push(newUser);
    this.save();
    return newUser;
  }

  getCart(userId = 1) {
    return this.data.cart.filter(item => item.userId === userId).map(item => {
      const product = this.getProductById(item.productId);
      return {
        ...item,
        product
      };
    });
  }

  addToCart(userId = 1, productId, quantity = 1) {
    const existing = this.data.cart.find(c => c.userId === userId && c.productId === Number(productId));
    if (existing) {
      existing.quantity += Number(quantity);
      if (existing.quantity <= 0) {
        this.removeFromCart(userId, productId);
        return null;
      }
    } else {
      this.data.cart.push({
        id: Date.now(),
        userId,
        productId: Number(productId),
        quantity: Number(quantity)
      });
    }
    this.save();
    return this.getCart(userId);
  }

  removeFromCart(userId = 1, productId) {
    this.data.cart = this.data.cart.filter(c => !(c.userId === userId && c.productId === Number(productId)));
    this.save();
    return this.getCart(userId);
  }

  clearCart(userId = 1) {
    this.data.cart = this.data.cart.filter(c => c.userId !== userId);
    this.save();
  }

  createOrder(userId = 1, shippingInfo) {
    const cart = this.getCart(userId);
    if (cart.length === 0) return null;
    const total = cart.reduce((acc, item) => acc + (item.product?.price || 0) * item.quantity, 0);
    const order = {
      id: Date.now(),
      orderNumber: "#ORD-" + Math.floor(10000 + Math.random() * 90000),
      userId,
      items: cart,
      total: Number(total.toFixed(2)),
      shippingInfo,
      status: "placed",
      timeline: [
        { status: "placed", label: "Order Placed", time: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString()
    };
    this.data.orders.push(order);
    this.clearCart(userId);
    this.save();
    return order;
  }

  updateOrderStatus(orderId, status) {
    const order = this.data.orders.find(o => String(o.id) === String(orderId) || o.orderNumber === orderId);
    if (order) {
      order.status = status;
      order.updatedAt = new Date().toISOString();
      if (!order.timeline) order.timeline = [];
      order.timeline.push({ status, time: new Date().toISOString() });
      this.save();
      return order;
    }
    return null;
  }

  getOrderById(orderId) {
    return this.data.orders.find(o => String(o.id) === String(orderId) || o.orderNumber === orderId);
  }

  getRestaurants() {
    return this.data.restaurants || [];
  }

  updateProduct(id, updates) {
    const product = this.getProductById(id);
    if (product) {
      Object.assign(product, updates);
      this.save();
      return product;
    }
    return null;
  }

  getOrders(userId = 1) {
    return this.data.orders.filter(o => o.userId === userId || userId === "admin");
  }

  getAdminMetrics() {
    const totalRevenue = this.data.orders.reduce((acc, o) => acc + o.total, 0);
    const totalOrders = this.data.orders.length;
    const productCount = this.data.products.length;
    const lowStockCount = this.data.products.filter(p => p.stock < 20).length;
    return {
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalOrders,
      productCount,
      lowStockCount,
      recentOrders: this.data.orders.slice(-5)
    };
  }
}

export const db = new StoreDB();
`;
    await workspace.write("db.js", dbJs);
    filesCreated.push("db.js");

    // 3. server.js
    const serverJs = `import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || "3000", 10);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- API Endpoints ---

// Health & Status
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", service: "${title}", timestamp: new Date().toISOString() });
});

// Auth
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.authenticate(email, password);
  if (!user) {
    return res.status(401).json({ success: false, error: "Invalid email or password." });
  }
  const token = "demo_token_" + Buffer.from(email).toString("base64");
  res.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token
  });
});

app.post("/api/auth/register", (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, error: "Email and password are required." });
  }
  const user = db.registerUser({ email, password, name });
  if (!user) {
    return res.status(409).json({ success: false, error: "Email already registered." });
  }
  const token = "demo_token_" + Buffer.from(email).toString("base64");
  res.status(201).json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token
  });
});

// Products
app.get("/api/products", (req, res) => {
  const { q, category, sort } = req.query;
  const products = db.getProducts({ q, category, sort });
  res.json({ success: true, count: products.length, products });
});

app.get("/api/products/:id", (req, res) => {
  const product = db.getProductById(req.params.id);
  if (!product) return res.status(404).json({ success: false, error: "Product not found" });
  res.json({ success: true, product });
});

app.post("/api/products", (req, res) => {
  const { title, price, category, description, stock } = req.body || {};
  if (!title || price === undefined) {
    return res.status(400).json({ success: false, error: "Title and price are required." });
  }
  const product = db.addProduct({
    title,
    price: Number(price),
    category: category || "General",
    description: description || "New catalog product",
    stock: Number(stock) || 10,
    image: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' rx='20' fill='%231e293b'/%3E%3Ccircle cx='100' cy='100' r='40' fill='%233b82f6'/%3E%3C/svg%3E"
  });
  res.status(201).json({ success: true, product });
});

// Cart
app.get("/api/cart", (_req, res) => {
  const items = db.getCart(1);
  const total = items.reduce((acc, i) => acc + (i.product?.price || 0) * i.quantity, 0);
  const itemCount = items.reduce((acc, i) => acc + i.quantity, 0);
  res.json({ success: true, count: itemCount, total: Number(total.toFixed(2)), items });
});

app.post("/api/cart", (req, res) => {
  const { productId, quantity } = req.body || {};
  if (!productId) return res.status(400).json({ success: false, error: "productId is required" });
  const items = db.addToCart(1, productId, quantity || 1);
  const total = items.reduce((acc, i) => acc + (i.product?.price || 0) * i.quantity, 0);
  const itemCount = items.reduce((acc, i) => acc + i.quantity, 0);
  res.json({ success: true, count: itemCount, total: Number(total.toFixed(2)), items });
});

app.delete("/api/cart/:productId", (req, res) => {
  const items = db.removeFromCart(1, req.params.productId);
  const total = items.reduce((acc, i) => acc + (i.product?.price || 0) * i.quantity, 0);
  const itemCount = items.reduce((acc, i) => acc + i.quantity, 0);
  res.json({ success: true, count: itemCount, total: Number(total.toFixed(2)), items });
});

// Restaurants
app.get("/api/restaurants", (_req, res) => {
  const restaurants = db.getRestaurants();
  res.json({ success: true, count: restaurants.length, restaurants });
});

// Checkout & Orders
app.post("/api/checkout", (req, res) => {
  const { shippingInfo } = req.body || {};
  const order = db.createOrder(1, shippingInfo || { name: "Valued Customer", address: "123 Market St" });
  if (!order) {
    return res.status(400).json({ success: false, error: "Cannot checkout with an empty cart." });
  }
  res.status(201).json({ success: true, order });
});

app.get("/api/orders", (_req, res) => {
  const orders = db.getOrders(1);
  res.json({ success: true, orders });
});

app.get("/api/orders/:id", (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ success: false, error: "Order not found" });
  res.json({ success: true, order });
});

app.patch("/api/orders/:id/status", (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: "status is required" });
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ success: false, error: "Order not found" });
  res.json({ success: true, order });
});

app.put("/api/products/:id", (req, res) => {
  const product = db.updateProduct(req.params.id, req.body || {});
  if (!product) return res.status(404).json({ success: false, error: "Product not found" });
  res.json({ success: true, product });
});

// Admin Dashboard
app.get("/api/admin/metrics", (_req, res) => {
  const metrics = db.getAdminMetrics();
  res.json({ success: true, metrics });
});

app.get("/api/admin/orders", (_req, res) => {
  const orders = db.getOrders("admin");
  res.json({ success: true, orders });
});

// Catch-all to serve index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(\`${title} server listening on http://localhost:\${port}\`);
});
`;
    await workspace.write("server.js", serverJs);
    filesCreated.push("server.js");

    // 4. public/index.html
    const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Full-Stack Online Store</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <!-- Navigation Header -->
  <header class="navbar">
    <div class="nav-container">
      <a href="#" class="brand-logo" aria-label="${title} Home">
        <span class="logo-icon">🛍️</span> ${title}
      </a>
      <div class="search-bar" role="search">
        <input
          type="search"
          id="searchInput"
          placeholder="Search products..."
          aria-label="Search products"
          autocomplete="off"
        />
      </div>
      <nav class="nav-links" aria-label="Main Navigation">
        <button id="adminBtn" class="btn btn-secondary btn-sm" aria-label="Admin Dashboard">⚙️ Admin</button>
        <button id="authBtn" class="btn btn-secondary btn-sm" aria-label="User Account">👤 Login</button>
        <button id="cartBtn" class="btn btn-primary btn-sm cart-btn" aria-label="Shopping Cart">
          🛒 Cart (<span id="cartCount">0</span>)
        </button>
      </nav>
    </div>
  </header>

  <main>
    <!-- Hero Section -->
    <section class="hero-section">
      <div class="container hero-grid">
        <div class="hero-content">
          <div class="hero-badge">⚡ Instant Delivery &bull; Real Database Persistence</div>
          <h1 class="hero-title">${title}</h1>
          <p class="hero-subtitle">Premium goods, smart devices, and modern lifestyle essentials with working shopping cart, live checkout, and admin dashboard.</p>
          <div class="hero-actions">
            <a href="#catalog" class="btn btn-primary">Shop Catalog</a>
            <button id="openAdminHeroBtn" class="btn btn-secondary">Open Admin Panel</button>
          </div>
          <div class="hero-trust-chips">
            <span class="trust-chip">✓ Working REST APIs</span>
            <span class="trust-chip">✓ Real Database Storage</span>
            <span class="trust-chip">✓ Live Order Processing</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Catalog Section -->
    <section id="catalog" class="container catalog-section">
      <div class="catalog-header">
        <div>
          <h2>Explore Collection</h2>
          <p class="section-desc">Handcrafted selection with real-time inventory and pricing.</p>
        </div>
        <div class="controls-row">
          <div class="filter-pills" id="categoryFilters">
            <button class="pill-btn active" data-category="all">All</button>
            <button class="pill-btn" data-category="Electronics">Electronics</button>
            <button class="pill-btn" data-category="Fashion">Fashion</button>
            <button class="pill-btn" data-category="Home">Home</button>
            <button class="pill-btn" data-category="Books">Books</button>
          </div>
          <select id="sortSelect" aria-label="Sort products by">
            <option value="featured">Featured</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
            <option value="rating">Top Rated</option>
          </select>
        </div>
      </div>

      <!-- Product Grid -->
      <div id="productGrid" class="product-grid" role="region" aria-label="Product listings">
        <div class="loading-state">Loading products from database...</div>
      </div>
    </section>
  </main>

  <!-- Slide-out Cart Drawer -->
  <aside id="cartDrawer" class="cart-drawer" aria-label="Shopping Cart Drawer">
    <div class="drawer-header">
      <h3>Your Shopping Cart</h3>
      <button id="closeCartBtn" class="close-btn" aria-label="Close cart">&times;</button>
    </div>
    <div id="cartItemsList" class="drawer-body">
      <div class="empty-cart-msg">Your cart is currently empty.</div>
    </div>
    <div class="drawer-footer">
      <div class="cart-summary-line">
        <span>Subtotal</span>
        <span id="cartSubtotal">$0.00</span>
      </div>
      <button id="checkoutBtn" class="btn btn-primary btn-block">Proceed to Checkout</button>
    </div>
  </aside>
  <div id="cartBackdrop" class="drawer-backdrop"></div>

  <!-- Checkout Modal -->
  <div id="checkoutModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="checkoutTitle">
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="checkoutTitle">Complete Order</h3>
        <button id="closeCheckoutBtn" class="close-btn" aria-label="Close checkout">&times;</button>
      </div>
      <form id="checkoutForm" class="modal-body">
        <div class="form-group">
          <label for="shippingName">Full Name</label>
          <input type="text" id="shippingName" required placeholder="Alex Smith" />
        </div>
        <div class="form-group">
          <label for="shippingEmail">Email Address</label>
          <input type="email" id="shippingEmail" required placeholder="alex@example.com" />
        </div>
        <div class="form-group">
          <label for="shippingAddress">Shipping Address</label>
          <input type="text" id="shippingAddress" required placeholder="123 Market Street, Suite 400" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="cardNumber">Card Number</label>
            <input type="text" id="cardNumber" placeholder="4242 &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; 4242" required />
          </div>
          <div class="form-group">
            <label for="cardExp">Expiry</label>
            <input type="text" id="cardExp" placeholder="MM/YY" required />
          </div>
        </div>
        <div class="modal-footer">
          <button type="submit" class="btn btn-primary btn-block">Place Order Now</button>
        </div>
      </form>
      <div id="orderConfirmation" class="order-confirmation" style="display:none;">
        <div class="success-icon">🎉</div>
        <h4>Order Placed Successfully!</h4>
        <p>Thank you! Your order reference is <strong id="confirmedOrderNumber">#ORD-00000</strong>.</p>
        <div class="tracking-timeline" style="margin: 1.5rem 0; text-align: left; background: var(--bg-card); padding: 1rem; border-radius: 8px;">
          <h5 style="margin-bottom: 0.75rem;">Live Order Tracking</h5>
          <div class="timeline-step active" id="stepPlaced">✓ Order Placed</div>
          <div class="timeline-step" id="stepPreparing">⏳ Kitchen Preparing</div>
          <div class="timeline-step" id="stepOutForDelivery">🛵 Out for Delivery</div>
          <div class="timeline-step" id="stepDelivered">📍 Delivered</div>
        </div>
        <button id="trackOrderBtn" class="btn btn-secondary btn-sm" onclick="trackCurrentOrder()">Refresh Status</button>
        <button id="finishOrderBtn" class="btn btn-primary" style="margin-top:1.5rem;">Continue Shopping</button>
      </div>
    </div>
  </div>

  <!-- Auth Modal -->
  <div id="authModal" class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="authTitle">Customer Account</h3>
        <button id="closeAuthBtn" class="close-btn" aria-label="Close login">&times;</button>
      </div>
      <div class="auth-tabs" style="display:flex;border-bottom:1px solid var(--border);">
        <button type="button" id="tabLogin" class="tab-btn active" style="flex:1;padding:0.75rem;background:none;border:none;color:var(--text-primary);cursor:pointer;font-weight:600;">Sign In</button>
        <button type="button" id="tabRegister" class="tab-btn" style="flex:1;padding:0.75rem;background:none;border:none;color:var(--text-secondary);cursor:pointer;font-weight:600;">Register</button>
      </div>
      <form id="loginForm" class="modal-body">
        <div class="form-group">
          <label for="authEmail">Email Address</label>
          <input type="email" id="authEmail" required value="customer@example.com" />
        </div>
        <div class="form-group">
          <label for="authPassword">Password</label>
          <input type="password" id="authPassword" required value="customer123" />
        </div>
        <div id="authError" class="auth-error" style="display:none;color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
        <button type="submit" class="btn btn-primary btn-block">Sign In</button>
        <p class="auth-hint" style="margin-top:1rem;font-size:0.8rem;color:var(--text-secondary)">Demo: <code>customer@example.com / customer123</code> or <code>admin@fooddelivery.com / admin123</code></p>
      </form>
      <form id="registerForm" class="modal-body" style="display:none;">
        <div class="form-group">
          <label for="regName">Full Name</label>
          <input type="text" id="regName" required placeholder="Jane Doe" />
        </div>
        <div class="form-group">
          <label for="regEmail">Email Address</label>
          <input type="email" id="regEmail" required placeholder="jane@example.com" />
        </div>
        <div class="form-group">
          <label for="regPassword">Password</label>
          <input type="password" id="regPassword" required placeholder="Choose a password" />
        </div>
        <div id="regError" class="auth-error" style="display:none;color:#ef4444;font-size:0.85rem;margin-bottom:0.75rem;"></div>
        <button type="submit" class="btn btn-primary btn-block">Create Account</button>
      </form>
    </div>
  </div>

  <!-- Admin Modal -->
  <div id="adminModal" class="modal-overlay" role="dialog" aria-modal="true">
    <div class="modal-card modal-large">
      <div class="modal-header">
        <h3>⚙️ Store Admin & Analytics</h3>
        <button id="closeAdminBtn" class="close-btn" aria-label="Close admin">&times;</button>
      </div>
      <div class="modal-body">
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="metric-label">Total Revenue</span>
            <span class="metric-value" id="metricRevenue">$0.00</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Orders Processed</span>
            <span class="metric-value" id="metricOrders">0</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Products Active</span>
            <span class="metric-value" id="metricProducts">0</span>
          </div>
        </div>
        <h4 style="margin:1.5rem 0 0.75rem;">Active Customer Orders</h4>
        <div id="adminOrdersList" style="max-height:200px;overflow-y:auto;background:var(--bg-card);border-radius:8px;padding:0.75rem;margin-bottom:1.5rem;">
          <p style="color:var(--text-secondary)">Loading orders...</p>
        </div>
        <h4 style="margin:1.5rem 0 0.75rem;">Add New Product to Database</h4>
        <form id="newProductForm" class="add-product-form">
          <input type="text" id="newProdTitle" placeholder="Product Title" required />
          <input type="number" step="0.01" id="newProdPrice" placeholder="Price ($)" required />
          <select id="newProdCat">
            <option value="Electronics">Electronics</option>
            <option value="Fashion">Fashion</option>
            <option value="Home">Home</option>
            <option value="Books">Books</option>
          </select>
          <button type="submit" class="btn btn-primary">Create Product</button>
        </form>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <footer class="footer">
    <div class="container footer-content">
      <p>&copy; ${new Date().getFullYear()} ${title}. Autonomous Full-Stack Architecture powered by Achu.</p>
    </div>
  </footer>

  <script src="app.js"></script>
</body>
</html>`;
    await workspace.write("public/index.html", indexHtml);
    filesCreated.push("public/index.html");

    // Also write root index.html so preview servers match immediately
    await workspace.write("index.html", indexHtml);
    filesCreated.push("index.html");

    // 5. public/styles.css
    const stylesCss = `:root {
  --bg-primary: #090d16;
  --bg-surface: #111827;
  --bg-card: #1f2937;
  --text-primary: #f9fafb;
  --text-secondary: #9ca3af;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --border: rgba(255, 255, 255, 0.08);
  --shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
  --radius: 12px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.5;
  overflow-x: hidden;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

/* Navbar */
.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(9, 13, 22, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 0.75rem 1.5rem;
}

.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  text-decoration: none;
}

.search-bar {
  flex: 1;
  max-width: 440px;
}

.search-bar input {
  width: 100%;
  padding: 0.6rem 1rem;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  outline: none;
  font-size: 0.9rem;
}

.search-bar input:focus {
  border-color: var(--accent);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0.6rem 1.25rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  border: none;
  text-decoration: none;
  transition: all 0.2s;
  min-height: 40px;
}

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-secondary { background: rgba(255, 255, 255, 0.08); color: var(--text-primary); }
.btn-secondary:hover { background: rgba(255, 255, 255, 0.15); }
.btn-sm { padding: 0.4rem 0.85rem; font-size: 0.85rem; }
.btn-block { width: 100%; }

/* Hero */
.hero-section {
  padding: 4rem 0 3rem;
  background: radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.12) 0%, transparent 60%);
  border-bottom: 1px solid var(--border);
}

.hero-badge {
  display: inline-block;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  margin-bottom: 1rem;
}

.hero-title {
  font-size: clamp(2.25rem, 5vw, 3.5rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 1rem;
}

.hero-subtitle {
  font-size: 1.15rem;
  color: var(--text-secondary);
  max-width: 650px;
  margin-bottom: 1.75rem;
}

.hero-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
}

.hero-trust-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.trust-chip {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

/* Catalog */
.catalog-section {
  padding: 3.5rem 1.5rem;
}

.catalog-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 2rem;
}

.section-desc {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.controls-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.filter-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.pill-btn {
  padding: 0.4rem 0.9rem;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.pill-btn.active, .pill-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

#sortSelect {
  padding: 0.45rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 0.85rem;
}

/* Product Grid */
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1.75rem;
}

.product-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.2s, box-shadow 0.2s;
}

.product-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow);
}

.product-img {
  width: 100%;
  height: 200px;
  object-fit: cover;
  background: #111827;
}

.product-body {
  padding: 1.25rem;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.product-cat {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 4px;
}

.product-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin-bottom: 6px;
}

.product-desc {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
  flex: 1;
}

.product-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}

.product-price {
  font-size: 1.25rem;
  font-weight: 700;
  color: #f8fafc;
}

/* Cart Drawer */
.cart-drawer {
  position: fixed;
  top: 0;
  right: -420px;
  width: 100%;
  max-width: 400px;
  height: 100vh;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  z-index: 200;
  transition: right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
}

.cart-drawer.open {
  right: 0;
}

.drawer-header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.drawer-body {
  padding: 1.25rem;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.cart-item {
  display: flex;
  gap: 1rem;
  align-items: center;
  background: var(--bg-card);
  padding: 0.75rem;
  border-radius: 8px;
}

.cart-item img {
  width: 50px;
  height: 50px;
  border-radius: 6px;
  object-fit: cover;
}

.cart-item-info {
  flex: 1;
}

.cart-item-title {
  font-size: 0.9rem;
  font-weight: 600;
}

.cart-item-price {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.qty-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.qty-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-primary);
  cursor: pointer;
}

.drawer-footer {
  padding: 1.25rem;
  border-top: 1px solid var(--border);
}

.cart-summary-line {
  display: flex;
  justify-content: space-between;
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 150;
  display: none;
}

.drawer-backdrop.active {
  display: block;
}

/* Modals */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  z-index: 300;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modal-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 100%;
  max-width: 480px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}

.modal-large { max-width: 720px; }

.modal-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-body {
  padding: 1.5rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.form-group input, .form-group select {
  width: 100%;
  padding: 0.65rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.95rem;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-row .form-group { flex: 1; }

.order-confirmation {
  text-align: center;
  padding: 2rem 1rem;
}

.success-icon { font-size: 3rem; margin-bottom: 1rem; }

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.metric-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}

.metric-label {
  display: block;
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.metric-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #f8fafc;
}

.add-product-form {
  display: flex;
  gap: 0.5rem;
}

.add-product-form input, .add-product-form select {
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  flex: 1;
}

.footer {
  border-top: 1px solid var(--border);
  padding: 2.5rem 1.5rem;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

@media (max-width: 768px) {
  .navbar {
    padding: 0.5rem 0.75rem;
  }
  .nav-container {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .search-bar {
    order: 3;
    max-width: 100%;
    width: 100%;
  }
  .nav-links {
    gap: 0.4rem;
  }
  .btn-sm {
    padding: 0.35rem 0.5rem;
    font-size: 0.8rem;
  }
  .hero-actions {
    flex-direction: column;
  }
  .controls-row {
    flex-direction: column;
    align-items: stretch;
  }
  .filter-pills {
    flex-wrap: wrap;
  }
  .metrics-grid {
    grid-template-columns: 1fr;
  }
  .form-row {
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  .container {
    padding: 0 0.75rem;
  }
  .hero-title {
    font-size: 2rem;
  }
  .product-grid {
    grid-template-columns: 1fr;
  }
  .cart-drawer {
    max-width: 100%;
  }
}
`;
    await workspace.write("public/styles.css", stylesCss);
    filesCreated.push("public/styles.css");

    // 6. public/app.js - Client application logic
    const appJs = `document.addEventListener("DOMContentLoaded", () => {
  let products = [];
  let cart = { count: 0, total: 0, items: [] };
  let activeCategory = "all";

  // DOM Elements
  const productGrid = document.getElementById("productGrid");
  const searchInput = document.getElementById("searchInput");
  const sortSelect = document.getElementById("sortSelect");
  const cartBtn = document.getElementById("cartBtn");
  const closeCartBtn = document.getElementById("closeCartBtn");
  const cartDrawer = document.getElementById("cartDrawer");
  const cartBackdrop = document.getElementById("cartBackdrop");
  const cartCount = document.getElementById("cartCount");
  const cartSubtotal = document.getElementById("cartSubtotal");
  const cartItemsList = document.getElementById("cartItemsList");
  const checkoutBtn = document.getElementById("checkoutBtn");
  const checkoutModal = document.getElementById("checkoutModal");
  const closeCheckoutBtn = document.getElementById("closeCheckoutBtn");
  const checkoutForm = document.getElementById("checkoutForm");
  const orderConfirmation = document.getElementById("orderConfirmation");
  const confirmedOrderNumber = document.getElementById("confirmedOrderNumber");
  const finishOrderBtn = document.getElementById("finishOrderBtn");
  const authBtn = document.getElementById("authBtn");
  const authModal = document.getElementById("authModal");
  const closeAuthBtn = document.getElementById("closeAuthBtn");
  const loginForm = document.getElementById("loginForm");
  const adminBtn = document.getElementById("adminBtn");
  const openAdminHeroBtn = document.getElementById("openAdminHeroBtn");
  const adminModal = document.getElementById("adminModal");
  const closeAdminBtn = document.getElementById("closeAdminBtn");
  const newProductForm = document.getElementById("newProductForm");

  // Fetch and display products
  async function loadProducts() {
    try {
      const q = searchInput?.value.trim() || "";
      const sort = sortSelect?.value || "featured";
      const res = await fetch(\`/api/products?category=\${activeCategory}&q=\${encodeURIComponent(q)}&sort=\${sort}\`);
      const data = await res.json();
      if (data.products) {
        products = data.products;
        renderProducts(products);
      }
    } catch (err) {
      console.error("Failed to fetch products:", err);
    }
  }

  function renderProducts(list) {
    if (!productGrid) return;
    if (list.length === 0) {
      productGrid.innerHTML = \`<div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
        <h3>No matching products found</h3>
        <p style="color:var(--text-secondary)">Try adjusting your search or category filter.</p>
      </div>\`;
      return;
    }

    productGrid.innerHTML = list
      .map(
        (p) => \`
      <div class="product-card">
        <img src="\${p.image}" alt="\${p.title}" class="product-img" />
        <div class="product-body">
          <div class="product-cat">\${p.category}</div>
          <h3 class="product-title">\${p.title}</h3>
          <p class="product-desc">\${p.description}</p>
          <div class="product-footer">
            <span class="product-price">$\${Number(p.price).toFixed(2)}</span>
            <button class="btn btn-primary btn-sm add-cart-btn" onclick="addToCart(\${p.id})">Add to Cart</button>
          </div>
        </div>
      </div>\`
      )
      .join("");
  }

  // Fetch cart
  async function loadCart() {
    try {
      const res = await fetch("/api/cart");
      const data = await res.json();
      if (data.success) {
        cart = data;
        updateCartUI();
      }
    } catch (err) {
      console.error("Failed to load cart:", err);
    }
  }

  function updateCartUI() {
    if (cartCount) cartCount.textContent = cart.count;
    if (cartSubtotal) cartSubtotal.textContent = \`$\${cart.total.toFixed(2)}\`;

    if (!cartItemsList) return;
    if (!cart.items || cart.items.length === 0) {
      cartItemsList.innerHTML = '<div class="empty-cart-msg" style="text-align:center;padding:2rem;color:var(--text-secondary)">Your shopping cart is empty.</div>';
      return;
    }

    cartItemsList.innerHTML = cart.items
      .map(
        (item) => \`
      <div class="cart-item">
        <img src="\${item.product?.image || ''}" alt="\${item.product?.title}" />
        <div class="cart-item-info">
          <div class="cart-item-title">\${item.product?.title || 'Product'}</div>
          <div class="cart-item-price">$\${item.product?.price.toFixed(2)} &times; \${item.quantity}</div>
        </div>
        <div class="qty-controls">
          <button class="qty-btn" onclick="updateQty(\${item.productId}, \${item.quantity - 1})">-</button>
          <span>\${item.quantity}</span>
          <button class="qty-btn" onclick="updateQty(\${item.productId}, \${item.quantity + 1})">+</button>
        </div>
      </div>\`
      )
      .join("");
  }

  window.addToCart = async (productId) => {
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: 1 }),
      });
      const data = await res.json();
      if (data.success) {
        cart = data;
        updateCartUI();
        openCart();
      }
    } catch (err) {
      console.error("Failed to add to cart:", err);
    }
  };

  window.updateQty = async (productId, newQty) => {
    try {
      if (newQty <= 0) {
        const res = await fetch(\`/api/cart/\${productId}\`, { method: "DELETE" });
        cart = await res.json();
      } else {
        const res = await fetch("/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, quantity: newQty - (cart.items.find((i) => i.productId === productId)?.quantity || 0) }),
        });
        cart = await res.json();
      }
      updateCartUI();
    } catch (err) {
      console.error("Failed to update qty:", err);
    }
  };

  function openCart() {
    cartDrawer?.classList.add("open");
    cartBackdrop?.classList.add("active");
  }

  function closeCart() {
    cartDrawer?.classList.remove("open");
    cartBackdrop?.classList.remove("active");
  }

  // Category filter clicks
  document.querySelectorAll(".pill-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".pill-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeCategory = btn.getAttribute("data-category") || "all";
      loadProducts();
    });
  });

  searchInput?.addEventListener("input", loadProducts);
  sortSelect?.addEventListener("change", loadProducts);
  cartBtn?.addEventListener("click", openCart);
  closeCartBtn?.addEventListener("click", closeCart);
  cartBackdrop?.addEventListener("click", closeCart);

  // Checkout Modal
  checkoutBtn?.addEventListener("click", () => {
    closeCart();
    if (checkoutModal) checkoutModal.style.display = "flex";
  });

  closeCheckoutBtn?.addEventListener("click", () => {
    if (checkoutModal) checkoutModal.style.display = "none";
  });

  checkoutForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("shippingName")?.value;
    const address = document.getElementById("shippingAddress")?.value;

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shippingInfo: { name, address } }),
      });
      const data = await res.json();
      if (data.success && data.order) {
        checkoutForm.style.display = "none";
        if (orderConfirmation) orderConfirmation.style.display = "block";
        if (confirmedOrderNumber) confirmedOrderNumber.textContent = data.order.orderNumber;
        window.lastPlacedOrderId = data.order.id;
        window.trackCurrentOrder(data.order.id);
        loadCart();
      }
    } catch (err) {
      console.error("Checkout failed:", err);
    }
  });

  finishOrderBtn?.addEventListener("click", () => {
    if (checkoutModal) checkoutModal.style.display = "none";
    if (checkoutForm) {
      checkoutForm.reset();
      checkoutForm.style.display = "block";
    }
    if (orderConfirmation) orderConfirmation.style.display = "none";
  });

  // Order Tracking
  window.lastPlacedOrderId = null;
  window.trackCurrentOrder = async (orderId) => {
    const id = orderId || window.lastPlacedOrderId;
    if (!id) return;
    try {
      const res = await fetch(\`/api/orders/\${id}\`);
      const data = await res.json();
      if (data.success && data.order) {
        const status = data.order.status;
        const steps = ["placed", "preparing", "out_for_delivery", "delivered"];
        const stepIdx = steps.indexOf(status);
        const stepEls = ["stepPlaced", "stepPreparing", "stepOutForDelivery", "stepDelivered"];
        stepEls.forEach((elId, idx) => {
          const el = document.getElementById(elId);
          if (el) {
            if (idx <= stepIdx) el.classList.add("active");
            else el.classList.remove("active");
          }
        });
      }
    } catch (err) {
      console.error("Failed to track order:", err);
    }
  };

  // Auth Modal & Registration Tabs
  authBtn?.addEventListener("click", () => {
    if (authModal) authModal.style.display = "flex";
  });
  closeAuthBtn?.addEventListener("click", () => {
    if (authModal) authModal.style.display = "none";
  });

  const tabLogin = document.getElementById("tabLogin");
  const tabRegister = document.getElementById("tabRegister");
  const registerForm = document.getElementById("registerForm");

  tabLogin?.addEventListener("click", () => {
    tabLogin.classList.add("active");
    tabRegister?.classList.remove("active");
    if (loginForm) loginForm.style.display = "block";
    if (registerForm) registerForm.style.display = "none";
  });

  tabRegister?.addEventListener("click", () => {
    tabRegister?.classList.add("active");
    tabLogin?.classList.remove("active");
    if (registerForm) registerForm.style.display = "block";
    if (loginForm) loginForm.style.display = "none";
  });

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("authEmail")?.value;
    const password = document.getElementById("authPassword")?.value;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        if (authBtn) authBtn.textContent = \`👤 \${data.user.name.split(" ")[0]}\`;
        if (authModal) authModal.style.display = "none";
      } else {
        const errEl = document.getElementById("authError");
        if (errEl) {
          errEl.style.display = "block";
          errEl.textContent = data.error;
        }
      }
    } catch (err) {
      console.error("Login failed:", err);
    }
  });

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("regName")?.value;
    const email = document.getElementById("regEmail")?.value;
    const password = document.getElementById("regPassword")?.value;
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (data.success) {
        if (authBtn) authBtn.textContent = \`👤 \${data.user.name.split(" ")[0]}\`;
        if (authModal) authModal.style.display = "none";
      } else {
        const errEl = document.getElementById("regError");
        if (errEl) {
          errEl.style.display = "block";
          errEl.textContent = data.error;
        }
      }
    } catch (err) {
      console.error("Register failed:", err);
    }
  });

  // Admin Modal & Metrics
  async function loadAdminOrders() {
    const listEl = document.getElementById("adminOrdersList");
    if (!listEl) return;
    try {
      const res = await fetch("/api/admin/orders");
      const data = await res.json();
      if (data.success && data.orders) {
        if (data.orders.length === 0) {
          listEl.innerHTML = "<p style='color:var(--text-secondary);font-size:0.85rem;'>No orders placed yet.</p>";
          return;
        }
        listEl.innerHTML = data.orders.map(o => \`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem;border-bottom:1px solid var(--border);font-size:0.85rem;">
            <div>
              <strong>\${o.orderNumber}</strong> (\${o.shippingInfo?.name || 'Customer'}) &bull; $\${o.total.toFixed(2)}
            </div>
            <select onchange="updateAdminOrderStatus('\${o.id}', this.value)" style="padding:4px 8px;border-radius:4px;background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border);">
              <option value="placed" \${o.status==='placed'?'selected':''}>Placed</option>
              <option value="preparing" \${o.status==='preparing'?'selected':''}>Preparing</option>
              <option value="out_for_delivery" \${o.status==='out_for_delivery'?'selected':''}>Out for Delivery</option>
              <option value="delivered" \${o.status==='delivered'?'selected':''}>Delivered</option>
            </select>
          </div>
        \`).join("");
      }
    } catch (err) {
      console.error("Failed to load admin orders:", err);
    }
  }

  window.updateAdminOrderStatus = async (orderId, newStatus) => {
    try {
      const res = await fetch(\`/api/orders/\${orderId}/status\`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        loadAdminOrders();
        window.trackCurrentOrder(orderId);
      }
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  async function loadAdminMetrics() {
    try {
      const res = await fetch("/api/admin/metrics");
      const data = await res.json();
      if (data.success && data.metrics) {
        document.getElementById("metricRevenue").textContent = \`$\${data.metrics.totalRevenue.toFixed(2)}\`;
        document.getElementById("metricOrders").textContent = data.metrics.totalOrders;
        document.getElementById("metricProducts").textContent = data.metrics.productCount;
      }
      loadAdminOrders();
    } catch (err) {
      console.error("Failed to load metrics:", err);
    }
  }

  function openAdmin() {
    loadAdminMetrics();
    if (adminModal) adminModal.style.display = "flex";
  }

  adminBtn?.addEventListener("click", openAdmin);
  openAdminHeroBtn?.addEventListener("click", openAdmin);
  closeAdminBtn?.addEventListener("click", () => {
    if (adminModal) adminModal.style.display = "none";
  });

  newProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("newProdTitle")?.value;
    const price = document.getElementById("newProdPrice")?.value;
    const category = document.getElementById("newProdCat")?.value;
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, price, category }),
      });
      if (res.ok) {
        newProductForm.reset();
        loadProducts();
        loadAdminMetrics();
      }
    } catch (err) {
      console.error("Failed to add product:", err);
    }
  });

  // Initial load
  loadProducts();
  loadCart();
});
`;
    await workspace.write("public/app.js", appJs);
    filesCreated.push("public/app.js");

    // 7. tests/api.test.js - Integration verification tests
    const apiTestJs = `import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";

const BASE_URL = "http://localhost:" + (process.env.PORT || 3000);

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

test("GET /api/products returns product catalog", async () => {
  const res = await request("/api/products");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(Array.isArray(res.body.products));
  assert.ok(res.body.products.length >= 8);
});

test("POST /api/cart adds items to shopping cart", async () => {
  const res = await request("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { productId: 1, quantity: 2 },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.count >= 2);
});

test("POST /api/checkout creates a persistent order", async () => {
  const res = await request("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { shippingInfo: { name: "Test User", address: "100 Innovation Way" } },
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.order.orderNumber.startsWith("#ORD-"));
});

test("POST /api/auth/login verifies user credentials", async () => {
  const res = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { email: "user@store.com", password: "user123" },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.user.email, "user@store.com");
});

test("POST /api/auth/register creates new customer account", async () => {
  const randEmail = "customer_" + Date.now() + "@example.com";
  const res = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { name: "New Customer", email: randEmail, password: "password123" },
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.user.email, randEmail);
});

test("GET /api/restaurants returns partner venues", async () => {
  const res = await request("/api/restaurants");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(Array.isArray(res.body.restaurants));
});

test("GET /api/admin/metrics returns store analytics", async () => {
  const res = await request("/api/admin/metrics");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(res.body.metrics.totalRevenue !== undefined);
  assert.ok(res.body.metrics.totalOrders !== undefined);
});
`;
    await workspace.write("tests/api.test.js", apiTestJs);
    filesCreated.push("tests/api.test.js");

    return { success: true, files: filesCreated, projectRoot: workspace.root };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, files: filesCreated, error };
  }
}
