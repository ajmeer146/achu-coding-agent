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

  const isReact = Boolean(deps.react || deps["react-dom"] || deps["@vitejs/plugin-react"]);
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
  const isReact = Boolean(deps.react || deps["react-dom"]);

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
        dev: "npx serve . -l 3000",
        build: "echo 'Static site - no build needed'",
        start: "npx serve . -l 3000",
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
  <header>
    <h1>${title}</h1>
    <p>A modern, interactive web application</p>
  </header>
  <main>
    <section class="card">
      <h2>Overview</h2>
      <p>Welcome to ${title}.</p>
    </section>
  </main>
  <script src="script.js"></script>
</body>
</html>
`;
    await workspace.write("index.html", indexHtml);
    filesCreated.push("index.html");

    // 3. styles.css
    const stylesCss = `body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background-color: #0f172a;
  color: #f8fafc;
}
header {
  padding: 3rem 2rem;
  text-align: center;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
}
main {
  max-width: 900px;
  margin: 2rem auto;
  padding: 0 1.5rem;
}
.card {
  background: #1e293b;
  padding: 2rem;
  border-radius: 12px;
}
`;
    await workspace.write("styles.css", stylesCss);
    filesCreated.push("styles.css");

    // 4. script.js
    const scriptJs = `console.log("${title} loaded successfully.");\n`;
    await workspace.write("script.js", scriptJs);
    filesCreated.push("script.js");

    return { success: true, files: filesCreated, projectRoot: workspace.root };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, files: filesCreated, error };
  }
}
