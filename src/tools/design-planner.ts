/**
 * Phase 13 — Design Intelligence & Visual Quality Engine
 *
 * Analyses a UI task brief and produces a structured DesignSpec that guides
 * both code generation (scaffold templates) and visual verification
 * (expected sections, screenshot checks).
 *
 * All functions are pure / synchronous — no API calls, no file I/O.
 */

import {
  WEBSITE_DESIGN_GUIDE_VERSION,
  buildQualityChecklist,
  type QualityChecklistItem,
} from "../quality/website-design-guide.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProductType =
  | "landing_page"
  | "portfolio"
  | "dashboard"
  | "ecommerce"
  | "blog"
  | "login_auth"
  | "saas_app"
  | "documentation"
  | "generic_website";

export type ColorScheme = "dark" | "light" | "auto";

export type DesignDirection =
  | "minimal_clean"
  | "bold_vibrant"
  | "professional_corporate"
  | "warm_organic"
  | "tech_cyberpunk"
  | "editorial_luxury"
  | "playful_colorful"
  | "dark_saas";

export interface DesignTokens {
  bgPrimary: string;
  bgSurface: string;
  bgCard: string;
  textPrimary: string;
  textSecondary: string;
  accentPrimary: string;
  accentHover: string;
  borderSubtle: string;
  shadowCard: string;
  radiusMd: string;
  radiusSm: string;
}

export interface DesignTypography {
  fontStack: string;
  heroSize: string;
  h2Size: string;
  bodySize: string;
  monoStack?: string;
}

export interface DesignSpacing {
  heroVertical: string;
  sectionVertical: string;
  cardPadding: string;
}

export interface DesignSpec {
  productType: ProductType;
  direction: DesignDirection;
  colorScheme: ColorScheme;
  tokens: DesignTokens;
  typography: DesignTypography;
  spacing: DesignSpacing;
  /** Short prose description of intended layout and unique visual features */
  visualSummary: string;
  /** Key sections expected in the HTML — used for browser verification targets */
  expectedSections: string[];
  /** Whether to include entrance animations (prefers-reduced-motion must be respected) */
  useAnimations: boolean;
  /** Version of the website quality standard applied to this task */
  qualityGuideVersion: string;
  /** Task-specific, guide-derived acceptance checklist */
  qualityChecklist: QualityChecklistItem[];
}

// ---------------------------------------------------------------------------
// 1. analyseTaskBrief — infer ProductType from task text
// ---------------------------------------------------------------------------

export function analyseTaskBrief(task: string): ProductType {
  const lower = task.toLowerCase();

  // Ordered from most specific to most generic
  if (/\b(login|sign[\s-]?in|sign[\s-]?up|register|auth|password|forgot\s+password)\b/.test(lower))
    return "login_auth";

  if (/\b(portfolio|projects\s+showcase|my\s+work|resume|curriculum\s+vitae|cv\b|personal\s+site)\b/.test(lower))
    return "portfolio";

  if (/\b(dashboard|analytics|metrics|admin\s+panel|kpi|reporting|data\s+viz)\b/.test(lower))
    return "dashboard";

  if (/\b(e[\s-]?commerce|online\s+store|shop|shopping\s+cart|product\s+list|buy\s+now|shopnova|store|catalog|cart|checkout)\b/.test(lower))
    return "ecommerce";

  if (/\b(blog|article|post|news|cms|magazine|editorial)\b/.test(lower))
    return "blog";

  if (/\b(docs|documentation|api\s+reference|developer\s+guide|readme|technical\s+guide)\b/.test(lower))
    return "documentation";

  if (/\b(saas|app\b|platform|workspace|productivity|tool|software)\b/.test(lower) &&
      !/\blanding\b/.test(lower))
    return "saas_app";

  if (/\b(landing\s+page|landing|hero\s+section|startup|product\s+page|marketing\s+page|features\s+page)\b/.test(lower))
    return "landing_page";

  if (/\b(website|web\s+app|site\b)\b/.test(lower))
    return "generic_website";

  return "generic_website";
}

// ---------------------------------------------------------------------------
// 2. selectDesignDirection — pick a visual direction
// ---------------------------------------------------------------------------

export function selectDesignDirection(productType: ProductType, task: string): DesignDirection {
  const lower = task.toLowerCase();

  switch (productType) {
    case "portfolio":
      if (/\b(luxury|premium|exclusive|high[\s-]?end|elegant|refined)\b/.test(lower))
        return "editorial_luxury";
      if (/\b(minimal|clean|white|simple|understated)\b/.test(lower))
        return "minimal_clean";
      return "editorial_luxury"; // portfolios default to editorial feel

    case "landing_page":
      if (/\b(dark|midnight|night|black)\b/.test(lower) && /\b(saas|startup|tech|software)\b/.test(lower))
        return "dark_saas";
      if (/\b(bold|vibrant|energetic|bright|colorful|vivid)\b/.test(lower))
        return "bold_vibrant";
      if (/\b(minimal|clean|white|simple)\b/.test(lower))
        return "minimal_clean";
      if (/\b(startup|tech|software|api|developer)\b/.test(lower))
        return "dark_saas";
      return "bold_vibrant";

    case "dashboard":
      return "dark_saas";

    case "ecommerce":
      if (/\b(minimal|elegant|luxury|boutique|fashion|clean)\b/.test(lower))
        return "minimal_clean";
      if (/\b(bold|sale|discount|flash|bright|fun)\b/.test(lower))
        return "bold_vibrant";
      return "minimal_clean";

    case "blog":
      return "editorial_luxury";

    case "login_auth":
      if (/\b(dark|night|midnight)\b/.test(lower))
        return "dark_saas";
      return "professional_corporate";

    case "saas_app":
      if (/\b(dark|night|midnight|black)\b/.test(lower))
        return "dark_saas";
      if (/\b(playful|fun|friendly|casual)\b/.test(lower))
        return "playful_colorful";
      return "dark_saas";

    case "documentation":
      return "minimal_clean";

    case "generic_website":
      if (/\b(restaurant|cafe|food|coffee|bakery|bistro|kitchen|eat|dining)\b/.test(lower))
        return "warm_organic";
      if (/\b(tech|cyber|hack|neon|futur)\b/.test(lower))
        return "tech_cyberpunk";
      if (/\b(playful|fun|children|kids|game|cartoon)\b/.test(lower))
        return "playful_colorful";
      if (/\b(corporate|enterprise|professional|business|law|finance|consult)\b/.test(lower))
        return "professional_corporate";
      return "professional_corporate";

    default:
      return "professional_corporate";
  }
}

// ---------------------------------------------------------------------------
// 3. buildDesignTokens — distinct palette per direction
// ---------------------------------------------------------------------------

export function buildDesignTokens(direction: DesignDirection, colorScheme: ColorScheme): DesignTokens {
  // Note: colorScheme "light" overrides dark-direction tokens where it makes sense.
  // For now, most directions already encode their own light/dark preference.

  switch (direction) {
    case "minimal_clean":
      return {
        bgPrimary: colorScheme === "dark" ? "#0f172a" : "#ffffff",
        bgSurface: colorScheme === "dark" ? "#1e293b" : "#f8fafc",
        bgCard: colorScheme === "dark" ? "#334155" : "#f1f5f9",
        textPrimary: colorScheme === "dark" ? "#f8fafc" : "#0f172a",
        textSecondary: colorScheme === "dark" ? "#94a3b8" : "#475569",
        accentPrimary: "#6366f1",
        accentHover: "#4f46e5",
        borderSubtle: colorScheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        shadowCard: "0 4px 16px -4px rgba(99,102,241,0.15), 0 2px 8px -2px rgba(0,0,0,0.1)",
        radiusMd: "16px",
        radiusSm: "8px",
      };

    case "bold_vibrant":
      return {
        bgPrimary: "#060B18",
        bgSurface: "#0D1526",
        bgCard: "#162030",
        textPrimary: "#ffffff",
        textSecondary: "#a8b4c8",
        accentPrimary: "#FF6B35",
        accentHover: "#ff8c5a",
        borderSubtle: "rgba(255,107,53,0.15)",
        shadowCard: "0 8px 32px -8px rgba(255,107,53,0.3), 0 4px 12px -4px rgba(0,0,0,0.4)",
        radiusMd: "6px",
        radiusSm: "4px",
      };

    case "professional_corporate":
      return {
        bgPrimary: colorScheme === "dark" ? "#1a202c" : "#f0f4f8",
        bgSurface: colorScheme === "dark" ? "#2d3748" : "#ffffff",
        bgCard: colorScheme === "dark" ? "#4a5568" : "#ffffff",
        textPrimary: colorScheme === "dark" ? "#f7fafc" : "#1e293b",
        textSecondary: colorScheme === "dark" ? "#a0aec0" : "#64748b",
        accentPrimary: "#2563eb",
        accentHover: "#1d4ed8",
        borderSubtle: colorScheme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        shadowCard: "0 2px 8px -2px rgba(37,99,235,0.12), 0 1px 4px -1px rgba(0,0,0,0.08)",
        radiusMd: "8px",
        radiusSm: "4px",
      };

    case "warm_organic":
      return {
        bgPrimary: "#FEF9F0",
        bgSurface: "#FDF3E3",
        bgCard: "#FFFFFF",
        textPrimary: "#3D2B1F",
        textSecondary: "#7A5C4A",
        accentPrimary: "#D97706",
        accentHover: "#B45309",
        borderSubtle: "rgba(61,43,31,0.1)",
        shadowCard: "0 4px 16px -4px rgba(217,119,6,0.2), 0 2px 8px -2px rgba(0,0,0,0.08)",
        radiusMd: "20px",
        radiusSm: "12px",
      };

    case "tech_cyberpunk":
      return {
        bgPrimary: "#05070F",
        bgSurface: "#0A0E1A",
        bgCard: "#0F1525",
        textPrimary: "#E0F2FE",
        textSecondary: "#7DD3FC",
        accentPrimary: "#22D3EE",
        accentHover: "#06B6D4",
        borderSubtle: "rgba(34,211,238,0.2)",
        shadowCard: "0 0 20px rgba(34,211,238,0.2), 0 4px 16px rgba(0,0,0,0.5)",
        radiusMd: "4px",
        radiusSm: "2px",
      };

    case "editorial_luxury":
      return {
        bgPrimary: "#FAFAF5",
        bgSurface: "#F5F5EE",
        bgCard: "#FFFFFF",
        textPrimary: "#1C1C1E",
        textSecondary: "#6B6B6B",
        accentPrimary: "#B8963E",
        accentHover: "#9A7B2E",
        borderSubtle: "rgba(28,28,30,0.1)",
        shadowCard: "0 4px 24px -6px rgba(184,150,62,0.15), 0 2px 8px rgba(0,0,0,0.06)",
        radiusMd: "4px",
        radiusSm: "2px",
      };

    case "playful_colorful":
      return {
        bgPrimary: "#FFFFFF",
        bgSurface: "#F0FFF4",
        bgCard: "#FFFFFF",
        textPrimary: "#1A1A2E",
        textSecondary: "#4A5568",
        accentPrimary: "#FF6B6B",
        accentHover: "#FF4040",
        borderSubtle: "rgba(255,107,107,0.2)",
        shadowCard: "0 8px 24px -6px rgba(255,107,107,0.25), 0 4px 12px rgba(0,0,0,0.08)",
        radiusMd: "24px",
        radiusSm: "16px",
      };

    case "dark_saas":
    default:
      return {
        bgPrimary: "#0F1117",
        bgSurface: "#1A1F2E",
        bgCard: "#232938",
        textPrimary: "#f8fafc",
        textSecondary: "#94a3b8",
        accentPrimary: "#60a5fa",
        accentHover: "#3b82f6",
        borderSubtle: "rgba(255,255,255,0.06)",
        shadowCard: "0 8px 24px -6px rgba(96,165,250,0.15), 0 4px 12px rgba(0,0,0,0.3)",
        radiusMd: "10px",
        radiusSm: "6px",
      };
  }
}

// ---------------------------------------------------------------------------
// 4. buildTypography — distinct font stacks per direction
// ---------------------------------------------------------------------------

export function buildTypography(direction: DesignDirection): DesignTypography {
  switch (direction) {
    case "editorial_luxury":
      return {
        fontStack: 'Georgia, "Palatino Linotype", Palatino, serif',
        heroSize: "3.5rem",
        h2Size: "2.25rem",
        bodySize: "1.1rem",
      };

    case "minimal_clean":
      return {
        fontStack: '"Inter", "SF Pro Display", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        heroSize: "3rem",
        h2Size: "2rem",
        bodySize: "1rem",
      };

    case "bold_vibrant":
      return {
        fontStack: '"Arial Black", Impact, "Haettenschweiler", system-ui, sans-serif',
        heroSize: "4rem",
        h2Size: "2.5rem",
        bodySize: "1rem",
      };

    case "professional_corporate":
      return {
        fontStack: '"Segoe UI", Arial, Helvetica, "Noto Sans", sans-serif',
        heroSize: "2.5rem",
        h2Size: "1.875rem",
        bodySize: "1rem",
      };

    case "warm_organic":
      return {
        fontStack: 'Georgia, Palatino, "Bookman Old Style", serif',
        heroSize: "2.75rem",
        h2Size: "2rem",
        bodySize: "1.05rem",
      };

    case "tech_cyberpunk":
      return {
        fontStack: '"Courier New", Consolas, "Lucida Console", monospace',
        heroSize: "3.5rem",
        h2Size: "2.25rem",
        bodySize: "0.95rem",
        monoStack: '"Courier New", monospace',
      };

    case "playful_colorful":
      return {
        fontStack: '"Trebuchet MS", "Lucida Grande", Verdana, system-ui, sans-serif',
        heroSize: "3rem",
        h2Size: "2rem",
        bodySize: "1.05rem",
      };

    case "dark_saas":
    default:
      return {
        fontStack: '"Inter", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        heroSize: "3.25rem",
        h2Size: "2.125rem",
        bodySize: "1rem",
      };
  }
}

// ---------------------------------------------------------------------------
// 5. buildSpacing — spacing scale per product type
// ---------------------------------------------------------------------------

export function buildSpacing(productType: ProductType): DesignSpacing {
  switch (productType) {
    case "portfolio":
    case "blog":
      return { heroVertical: "6rem", sectionVertical: "5rem", cardPadding: "2.5rem" };

    case "dashboard":
    case "saas_app":
      return { heroVertical: "3rem", sectionVertical: "3rem", cardPadding: "1.5rem" };

    case "login_auth":
      return { heroVertical: "2rem", sectionVertical: "2rem", cardPadding: "2rem" };

    case "documentation":
      return { heroVertical: "3rem", sectionVertical: "3rem", cardPadding: "1.75rem" };

    case "ecommerce":
      return { heroVertical: "4rem", sectionVertical: "3.5rem", cardPadding: "1.5rem" };

    default:
      return { heroVertical: "5rem", sectionVertical: "4rem", cardPadding: "2rem" };
  }
}

// ---------------------------------------------------------------------------
// 6. expectedSections — sections for browser verification
// ---------------------------------------------------------------------------

function buildExpectedSections(productType: ProductType): string[] {
  switch (productType) {
    case "landing_page": return ["Navigation", "Hero", "Features", "Call to Action", "Footer"];
    case "portfolio":    return ["Navigation", "About", "Projects", "Skills", "Contact"];
    case "dashboard":    return ["Sidebar", "Stats", "Data Table", "Charts"];
    case "ecommerce":    return ["Navigation", "Hero", "Products", "Cart"];
    case "blog":         return ["Navigation", "Hero", "Articles", "Categories"];
    case "login_auth":   return ["Login Form", "Email Input", "Password Input", "Submit Button"];
    case "saas_app":     return ["Navigation", "Hero", "Features", "Pricing", "Footer"];
    case "documentation":return ["Sidebar Navigation", "Content", "Code Examples"];
    default:             return ["Navigation", "Hero", "Content", "Footer"];
  }
}

// ---------------------------------------------------------------------------
// 7. generateDesignSpec — compose the full spec
// ---------------------------------------------------------------------------

export function generateDesignSpec(task: string): DesignSpec {
  const productType = analyseTaskBrief(task);
  const direction = selectDesignDirection(productType, task);
  const lower = task.toLowerCase();
  let colorScheme: ColorScheme = "dark";
  if (/\b(light\s+(theme|mode)|white\s+theme|bright\s+theme|day\s+mode)\b/.test(lower)) {
    colorScheme = "light";
  } else if (direction === "editorial_luxury" || direction === "warm_organic" ||
             direction === "minimal_clean" || direction === "playful_colorful" ||
             direction === "professional_corporate") {
    // These directions have their own light defaults
    colorScheme = "light";
  }

  const tokens = buildDesignTokens(direction, colorScheme);
  const typography = buildTypography(direction);
  const spacing = buildSpacing(productType);
  const expectedSections = buildExpectedSections(productType);

  const directionLabels: Record<DesignDirection, string> = {
    minimal_clean: "Minimal & Clean — generous whitespace, indigo accent, elegant type",
    bold_vibrant: "Bold & Vibrant — dark canvas with vivid orange accent, heavy typography",
    professional_corporate: "Professional Corporate — structured grid, muted blue accent, formal",
    warm_organic: "Warm & Organic — cream background, earthy terracotta tones, serif type",
    tech_cyberpunk: "Tech / Cyberpunk — near-black with cyan neon accents, monospace",
    editorial_luxury: "Editorial Luxury — off-white, gold accent, serif typography, refined spacing",
    playful_colorful: "Playful & Colourful — white canvas, coral/teal accents, rounded corners",
    dark_saas: "Dark SaaS — deep surface, blue/violet accents, utility-focused layout",
  };

  return {
    productType,
    direction,
    colorScheme,
    tokens,
    typography,
    spacing,
    visualSummary: directionLabels[direction],
    expectedSections,
    useAnimations: true,
    qualityGuideVersion: WEBSITE_DESIGN_GUIDE_VERSION,
    qualityChecklist: buildQualityChecklist(productType, task),
  };
}

// ---------------------------------------------------------------------------
// 8. formatDesignSpecForPrompt — human-readable string for system prompt
// ---------------------------------------------------------------------------

export function formatDesignSpecForPrompt(spec: DesignSpec): string {
  const t = spec.tokens;
  const ty = spec.typography;
  const sp = spec.spacing;

  return `
**Product Type:** ${spec.productType.replace(/_/g, " ")}
**Design Direction:** ${spec.direction.replace(/_/g, " ")} — ${spec.visualSummary}
**Color Scheme:** ${spec.colorScheme}
**Quality Guide Version:** ${spec.qualityGuideVersion}

**CSS Design Tokens (use in :root):**
  --bg-primary:    ${t.bgPrimary}
  --bg-surface:    ${t.bgSurface}
  --bg-card:       ${t.bgCard}
  --text-primary:  ${t.textPrimary}
  --text-secondary:${t.textSecondary}
  --accent-primary:${t.accentPrimary}
  --accent-hover:  ${t.accentHover}
  --border-subtle: ${t.borderSubtle}
  --shadow-card:   ${t.shadowCard}
  --radius-md:     ${t.radiusMd}
  --radius-sm:     ${t.radiusSm}

**Typography:**
  Font stack:  ${ty.fontStack}
  Hero:        ${ty.heroSize}
  H2:          ${ty.h2Size}
  Body:        ${ty.bodySize}${ty.monoStack ? `\n  Mono:        ${ty.monoStack}` : ""}

**Spacing:**
  Hero vertical padding:    ${sp.heroVertical}
  Section vertical padding: ${sp.sectionVertical}
  Card padding:             ${sp.cardPadding}

**Expected Sections (verify these exist):**
  ${spec.expectedSections.join(", ")}

**Animations:** ${spec.useAnimations ? "Enabled — add entrance/hover transitions. ALWAYS include:\n  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }" : "Disabled"}
`.trim();
}

// ---------------------------------------------------------------------------
// 9. isUITask — detect whether a task involves UI work
// ---------------------------------------------------------------------------

export function isUITask(task: string): boolean {
  return /\b(build|create|design|make|scaffold|generate|implement|add)\b.*\b(website|web\s*app|landing\s*page|landing|page|portfolio|dashboard|login|sign[\s-]?up|site|app\b|ui\b|frontend|interface|hero|navbar|header|footer|section|component|form)\b/i
    .test(task);
}
