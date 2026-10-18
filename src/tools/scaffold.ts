import path from "node:path";
import fs from "node:fs";
import { Workspace } from "./workspace.js";

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
 */
export async function scaffoldReactViteProject(
  workspace: Workspace,
  projectName = "react-app"
): Promise<ScaffoldResult> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "react-app";
  const title = projectName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesCreated: string[] = [];

  // If workspace already contains files and is not named after this project, scaffold into child folder
  const currentDirName = path.basename(workspace.root).toLowerCase();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(workspace.root).filter((e) => !e.startsWith(".") && e !== "node_modules");
  } catch {}

  if (entries.length > 0 && currentDirName !== slug.toLowerCase()) {
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

    // 4. src/index.css
    const indexCss = `*, *::before, *::after {
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
 */
export async function scaffoldStaticProject(
  workspace: Workspace,
  projectName = "static-website"
): Promise<ScaffoldResult> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "static-website";
  const title = projectName.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesCreated: string[] = [];

  // If workspace already contains files and is not named after this project, scaffold into child folder
  const currentDirName = path.basename(workspace.root).toLowerCase();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(workspace.root).filter((e) => !e.startsWith(".") && e !== "node_modules");
  } catch {}

  if (entries.length > 0 && currentDirName !== slug.toLowerCase()) {
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

    // 2. index.html
    const indexHtml = `<!DOCTYPE html>
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

    // 3. styles.css
    const stylesCss = `/* Design Tokens */
:root {
  --bg-primary: #0b0f19;
  --bg-surface: #131c2e;
  --bg-card: #1e293b;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --accent-primary: #38bdf8;
  --accent-hover: #0ea5e9;
  --border-subtle: rgba(255, 255, 255, 0.08);
  --shadow-card: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
  --radius-md: 12px;
  --radius-sm: 8px;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Navigation */
.navbar {
  background: rgba(11, 15, 25, 0.85);
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
  color: #0b0f19;
}
.btn-primary:hover {
  background-color: var(--accent-hover);
  transform: translateY(-2px);
}
.btn-secondary {
  background-color: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
}
.btn-secondary:hover {
  background-color: rgba(255, 255, 255, 0.1);
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
  padding: 5rem 1.5rem 3.5rem;
  max-width: 800px;
  margin: 0 auto;
}
.hero-badge {
  display: inline-block;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  background: rgba(56, 189, 248, 0.1);
  color: var(--accent-primary);
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
  border: 1px solid rgba(56, 189, 248, 0.2);
}
.hero-title {
  font-size: 2.75rem;
  line-height: 1.2;
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
  padding: 4rem 1.5rem;
}
.section-header {
  text-align: center;
  margin-bottom: 3rem;
}
.section-header h2 {
  font-size: 2rem;
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
  padding: 2rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-card);
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.feature-card:hover {
  transform: translateY(-4px);
  border-color: rgba(56, 189, 248, 0.3);
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
  padding: 2.5rem;
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
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
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
    font-size: 2.1rem;
  }
  .nav-links a:not(.btn) {
    display: none;
  }
}
`;
    await workspace.write("styles.css", stylesCss);
    filesCreated.push("styles.css");

    // 4. script.js
    const scriptJs = `document.addEventListener('DOMContentLoaded', () => {
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
