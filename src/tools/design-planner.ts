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
  WEBSITE_50_PRINCIPLES_VERSION,
  buildQualityChecklist,
  evaluatePrinciplesApplicability,
  type QualityChecklistItem,
  type PrincipleEvaluation,
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
  | "dark_saas"
  | "luxury_brand"
  | "startup_growth"
  | "creative_agency"
  | "glassmorphism_dark"
  | "brutalist"
  | "modern_saas_light"
  | "editorial_magazine"
  | "neon_futuristic";

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
  gradientHero: string;
  gradientAccent: string;
}

export interface DesignTypography {
  fontStack: string;
  heroSize: string;
  h2Size: string;
  bodySize: string;
  monoStack?: string;
  fontDisplay?: string;
  googleFontsUrl?: string;
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
  /** Version of the 50 Essential Principles framework */
  principlesVersion?: string;
  /** Task-specific, guide-derived acceptance checklist */
  qualityChecklist: QualityChecklistItem[];
  /** Tailored 50-principles evaluation */
  principlesEvaluations?: PrincipleEvaluation[];
}

// ---------------------------------------------------------------------------
// 1. analyseTaskBrief — infer ProductType from task text
// ---------------------------------------------------------------------------

/**
 * Page archetypes that can be named directly as the subject of a request.
 * The archetype named earliest inside the requested subject phrase wins, so a
 * component keyword that appears later in the brief never hijacks the type.
 */
const SUBJECT_ARCHETYPES: ReadonlyArray<{ type: ProductType; pattern: RegExp }> = [
  { type: "login_auth", pattern: /\b(login|log[\s-]?in|sign[\s-]?in|signin|sign[\s-]?up|signup|register|registration|authentication|auth|password)\b/ },
  { type: "portfolio", pattern: /\b(portfolio|showcase|resume|curriculum|vitae)\b/ },
  { type: "ecommerce", pattern: /\b(e[\s-]?commerce|store|shop|catalog|cart|checkout|marketplace|food\s+delivery)\b/ },
  { type: "dashboard", pattern: /\b(dashboard|admin|kpi|analytics|metrics|reporting)\b/ },
  { type: "blog", pattern: /\b(blog|article|magazine|newsletter|cms)\b/ },
  { type: "documentation", pattern: /\b(docs|documentation|api\s+reference|developer\s+guide|readme|knowledge\s+base)\b/ },
  { type: "landing_page", pattern: /\b(landing|marketing|home\s?page|product\s+page|startup\s+page|hero\s+section)\b/ },
];

/**
 * Resolves the subject of a request — the noun phrase that follows the
 * creation verb (e.g. "create a responsive landing page ..." → "a responsive
 * landing page ..."). Keywords that appear later in the brief describe page
 * components, not the page itself, so they must not decide the product type.
 */
function resolveRequestedSubject(lower: string): string {
  const match = lower.match(
    /\b(?:create|build|design|make|generate|develop|scaffold)\s+(?:a|an|the)?\s*([a-z0-9][a-z0-9\s_+,\-]{0,60})/
  );
  return match ? match[1] : "";
}

/** Returns the archetype named earliest inside the requested subject phrase. */
function resolveSubjectArchetype(subject: string): ProductType | null {
  let best: { type: ProductType; index: number } | null = null;
  for (const { type, pattern } of SUBJECT_ARCHETYPES) {
    const match = pattern.exec(subject);
    if (!match) continue;
    if (!best || match.index < best.index) {
      best = { type, index: match.index };
    }
  }
  return best ? best.type : null;
}

export function analyseTaskBrief(task: string): ProductType {
  const lower = task.toLowerCase();

  // The requested subject decides the product type. A brief such as
  // "landing page for a SaaS analytics product with ... a signup form" is a
  // landing page — the signup form is one of its sections, not its identity.
  const subjectArchetype = resolveSubjectArchetype(resolveRequestedSubject(lower));
  if (subjectArchetype) {
    return subjectArchetype;
  }

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
      if (/\b(creative\s+agency|agency|design\s+studio|studio)\b/.test(lower))
        return "creative_agency";
      if (/\b(luxury|high[\s-]?end|exclusive|refined)\b/.test(lower))
        return "luxury_brand";
      if (/\b(editorial|magazine)\b/.test(lower))
        return "editorial_luxury";
      if (/\b(brutalist|brutalism)\b/.test(lower))
        return "brutalist";
      if (/\b(minimal|clean|white|simple|understated)\b/.test(lower))
        return "minimal_clean";
      return "editorial_luxury"; // portfolios default to editorial feel

    case "landing_page":
      if (/\b(luxury|high[- ]end|premium\s+brand|boutique|exclusive)\b/.test(lower))
        return "luxury_brand";
      if (/\b(growth|founder|vc|pitch|scale|startup[\s_]growth)\b/.test(lower))
        return "startup_growth";
      if (/\b(creative\s+agency|design\s+studio|branding\s+agency)\b/.test(lower))
        return "creative_agency";
      if (/\b(glassmorphism|glass|frosted)\b/.test(lower))
        return "glassmorphism_dark";
      if (/\b(brutalist|brutalism|brutal|raw\s+design)\b/.test(lower))
        return "brutalist";
      if (/\b(saas\s+light|clean\s+saas|light\s+mode|product\s+hunt)\b/.test(lower))
        return "modern_saas_light";
      if (/\b(neon|cyberpunk|futur)\b/.test(lower))
        return "neon_futuristic";
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
      if (/\b(restaurant|cafe|food|coffee|bakery|bistro|kitchen|dining|warm|organic)\b/.test(lower))
        return "warm_organic";
      if (/\b(luxury|high[- ]end|premium|boutique|jewellery|jewelry|exclusive)\b/.test(lower))
        return "luxury_brand";
      if (/\b(minimal|elegant|clean)\b/.test(lower))
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
      if (/\b(luxury|high[- ]end|premium|boutique|jewellery|jewelry|exclusive)\b/.test(lower))
        return "luxury_brand";
      if (/\b(startup|growth|founder|vc|pitch|saas\s+landing)\b/.test(lower))
        return "startup_growth";
      if (/\b(creative\s+agency|design\s+studio|branding\s+agency)\b/.test(lower))
        return "creative_agency";
      if (/\b(glassmorphism|glass|frosted)\b/.test(lower))
        return "glassmorphism_dark";
      if (/\b(brutalist|brutalism|brutal|raw\s+design)\b/.test(lower))
        return "brutalist";
      if (/\b(saas\s+light|clean\s+saas|product\s+hunt)\b/.test(lower))
        return "modern_saas_light";
      if (/\b(magazine|editorial|journalism|newspaper)\b/.test(lower))
        return "editorial_magazine";
      if (/\b(neon|cyberpunk)\b/.test(lower))
        return "neon_futuristic";
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
        gradientHero: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
        gradientAccent: "linear-gradient(90deg, #6366f1, #4f46e5)",
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
        gradientHero: "linear-gradient(135deg, #FF6B35 0%, #ff2d78 100%)",
        gradientAccent: "linear-gradient(90deg, #FF6B35, #ff8c5a)",
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
        gradientHero: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
        gradientAccent: "linear-gradient(90deg, #2563eb, #1d4ed8)",
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
        gradientHero: "linear-gradient(135deg, #D97706 0%, #B45309 100%)",
        gradientAccent: "linear-gradient(90deg, #D97706, #f59e0b)",
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
        gradientHero: "linear-gradient(135deg, #22D3EE 0%, #0891b2 100%)",
        gradientAccent: "linear-gradient(90deg, #22D3EE, #06B6D4)",
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
        gradientHero: "linear-gradient(135deg, #B8963E 0%, #9A7B2E 100%)",
        gradientAccent: "linear-gradient(90deg, #B8963E, #d4a853)",
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
        gradientHero: "linear-gradient(135deg, #FF6B6B 0%, #4ecdc4 100%)",
        gradientAccent: "linear-gradient(90deg, #FF6B6B, #FF4040)",
      };

    case "dark_saas":
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
        gradientHero: "linear-gradient(135deg, #60a5fa 0%, #818cf8 100%)",
        gradientAccent: "linear-gradient(90deg, #60a5fa, #3b82f6)",
      };

    case "luxury_brand":
      return {
        bgPrimary: "#0a0a0a",
        bgSurface: "#121212",
        bgCard: "#1a1410",
        textPrimary: "#F5F5F0",
        textSecondary: "#A8945C",
        accentPrimary: "#C9A84C",
        accentHover: "#E8C97C",
        borderSubtle: "rgba(201,168,76,0.15)",
        shadowCard: "0 4px 24px -6px rgba(201,168,76,0.15), 0 2px 8px rgba(0,0,0,0.06)",
        radiusMd: "4px",
        radiusSm: "2px",
        gradientHero: "linear-gradient(135deg, #C9A84C 0%, #8B6914 100%)",
        gradientAccent: "linear-gradient(90deg, #C9A84C, #E8C97C)",
      };

    case "startup_growth":
      return {
        bgPrimary: "#0f0c1a",
        bgSurface: "#1a1530",
        bgCard: "#241e40",
        textPrimary: "#ffffff",
        textSecondary: "#e2d5f1",
        accentPrimary: "#f093fb",
        accentHover: "#f5576c",
        borderSubtle: "rgba(240,147,251,0.2)",
        shadowCard: "0 8px 32px -8px rgba(240,147,251,0.3), 0 4px 12px -4px rgba(0,0,0,0.4)",
        radiusMd: "6px",
        radiusSm: "4px",
        gradientHero: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        gradientAccent: "linear-gradient(90deg, #f093fb, #f5576c)",
      };

    case "creative_agency":
      return {
        bgPrimary: "#000000",
        bgSurface: "#111111",
        bgCard: "#0a0a0a",
        textPrimary: "#ffffff",
        textSecondary: "#e0e0e0",
        accentPrimary: "#FFD60A",
        accentHover: "#FFB800",
        borderSubtle: "rgba(255,214,10,0.2)",
        shadowCard: "0 8px 32px -8px rgba(255,214,10,0.3), 0 4px 12px -4px rgba(0,0,0,0.4)",
        radiusMd: "4px",
        radiusSm: "2px",
        gradientHero: "linear-gradient(135deg, #FFD60A 0%, #FF6B00 100%)",
        gradientAccent: "linear-gradient(90deg, #FFD60A, #FFB800)",
      };

    case "glassmorphism_dark":
      return {
        bgPrimary: "#0f0c29",
        bgSurface: "#302b63",
        bgCard: "#24243e",
        textPrimary: "#ffffff",
        textSecondary: "#d0d4f0",
        accentPrimary: "#bf5af2",
        accentHover: "#ff2d78",
        borderSubtle: "rgba(255,255,255,0.1)",
        shadowCard: "0 4px 24px -6px rgba(191,90,242,0.15), 0 2px 8px rgba(0,0,0,0.06)",
        radiusMd: "8px",
        radiusSm: "4px",
        gradientHero: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
        gradientAccent: "linear-gradient(90deg, #bf5af2, #ff2d78)",
      };

    case "brutalist":
      return {
        bgPrimary: "#ffffff",
        bgSurface: "#f0f0f0",
        bgCard: "#f5f5f5",
        textPrimary: "#000000",
        textSecondary: "#333333",
        accentPrimary: "#FF0000",
        accentHover: "#CC0000",
        borderSubtle: "rgba(255,0,0,0.15)",
        shadowCard: "4px 4px 0px #000000",
        radiusMd: "0px",
        radiusSm: "0px",
        gradientHero: "none",
        gradientAccent: "none",
      };

    case "modern_saas_light":
      return {
        bgPrimary: "#f8fafc",
        bgSurface: "#e2e8f0",
        bgCard: "#ffffff",
        textPrimary: "#0f172a",
        textSecondary: "#64748b",
        accentPrimary: "#3b82f6",
        accentHover: "#60a5fa",
        borderSubtle: "rgba(59,130,246,0.1)",
        shadowCard: "0 4px 16px -4px rgba(59,130,246,0.12), 0 1px 4px -1px rgba(0,0,0,0.08)",
        radiusMd: "12px",
        radiusSm: "6px",
        gradientHero: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
        gradientAccent: "linear-gradient(90deg, #3b82f6, #60a5fa)",
      };

    case "editorial_magazine":
      return {
        bgPrimary: "#f5f5f0",
        bgSurface: "#ebe9e0",
        bgCard: "#ffffff",
        textPrimary: "#1a1a1a",
        textSecondary: "#333333",
        accentPrimary: "#c0392b",
        accentHover: "#e74c3c",
        borderSubtle: "rgba(26,26,26,0.1)",
        shadowCard: "0 4px 16px -4px rgba(26,26,26,0.1), 0 2px 8px rgba(0,0,0,0.05)",
        radiusMd: "4px",
        radiusSm: "2px",
        gradientHero: "linear-gradient(135deg, #1a1a1a 0%, #c0392b 100%)",
        gradientAccent: "linear-gradient(90deg, #c0392b, #e74c3c)",
      };

    case "neon_futuristic":
      return {
        bgPrimary: "#050508",
        bgSurface: "#0d0520",
        bgCard: "#100a18",
        textPrimary: "#e8d4f0",
        textSecondary: "#bf5af2",
        accentPrimary: "#bf5af2",
        accentHover: "#ff2d78",
        borderSubtle: "rgba(191,90,242,0.2)",
        shadowCard: "0 0 20px rgba(191,90,242,0.3), 0 4px 16px rgba(0,0,0,0.5)",
        radiusMd: "6px",
        radiusSm: "4px",
        gradientHero: "linear-gradient(135deg, #bf5af2 0%, #ff2d78 100%)",
        gradientAccent: "linear-gradient(90deg, #bf5af2, #ff2d78)",
      };

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
        gradientHero: "linear-gradient(135deg, #60a5fa 0%, #818cf8 100%)",
        gradientAccent: "linear-gradient(90deg, #60a5fa, #3b82f6)",
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
        fontDisplay: "'Cormorant Garamond', Georgia, serif",
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Montserrat:wght@300;400;500;600&display=swap",
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
      return {
        fontStack: '"Inter", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        heroSize: "3.25rem",
        h2Size: "2.125rem",
        bodySize: "1rem",
        fontDisplay: '"Inter", system-ui, sans-serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap",
      };

    case "luxury_brand":
      return {
        fontStack: '"Playfair Display", Georgia, serif',
        heroSize: "4rem",
        h2Size: "2.5rem",
        bodySize: "1rem",
        fontDisplay: '"Playfair Display", Georgia, serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Jost:wght@300;400;500&display=swap",
      };

    case "startup_growth":
      return {
        fontStack: '"Plus Jakarta Sans", "Inter", system-ui, sans-serif',
        heroSize: "3.75rem",
        h2Size: "2.25rem",
        bodySize: "1.05rem",
        fontDisplay: '"Plus Jakarta Sans", system-ui, sans-serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
      };

    case "creative_agency":
      return {
        fontStack: '"Space Grotesk", "Arial Black", system-ui, sans-serif',
        heroSize: "5rem",
        h2Size: "3rem",
        bodySize: "1.05rem",
        fontDisplay: '"Space Grotesk", system-ui, sans-serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap",
      };

    case "glassmorphism_dark":
      return {
        fontStack: '"Outfit", "Inter", system-ui, sans-serif',
        heroSize: "3.5rem",
        h2Size: "2.25rem",
        bodySize: "1rem",
        fontDisplay: '"Outfit", system-ui, sans-serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap",
      };

    case "brutalist":
      return {
        fontStack: '"Bebas Neue", "Arial Black", Impact, sans-serif',
        heroSize: "6rem",
        h2Size: "3.5rem",
        bodySize: "1rem",
        fontDisplay: '"Bebas Neue", Impact, sans-serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&display=swap",
        monoStack: '"IBM Plex Mono", monospace',
      };

    case "modern_saas_light":
      return {
        fontStack: '"Geist", "Inter", system-ui, sans-serif',
        heroSize: "3.25rem",
        h2Size: "2rem",
        bodySize: "1rem",
        fontDisplay: '"Geist", "Inter", system-ui, sans-serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap",
      };

    case "editorial_magazine":
      return {
        fontStack: '"Libre Baskerville", Georgia, serif',
        heroSize: "4rem",
        h2Size: "2.5rem",
        bodySize: "1.1rem",
        fontDisplay: '"Libre Baskerville", Georgia, serif',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Source+Sans+3:wght@300;400;600&display=swap",
      };

    case "neon_futuristic":
      return {
        fontStack: '"Orbitron", "Courier New", monospace',
        heroSize: "3.5rem",
        h2Size: "2.25rem",
        bodySize: "0.95rem",
        fontDisplay: '"Orbitron", monospace',
        googleFontsUrl: "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&display=swap",
        monoStack: '"Share Tech Mono", monospace',
      };

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
             direction === "professional_corporate" || direction === "modern_saas_light" ||
             direction === "editorial_magazine" || direction === "brutalist") {
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
    luxury_brand: "Luxury Brand — near-black with gold accents, Playfair Display, ultra-premium feel",
    startup_growth: "Startup Growth — deep purple gradient, vibrant accent, Plus Jakarta Sans",
    creative_agency: "Creative Agency — pure black with yellow accent, bold Space Grotesk, high contrast",
    glassmorphism_dark: "Glassmorphism Dark — deep purple backdrop, frosted glass cards, purple/pink accent",
    brutalist: "Brutalist — stark white/black, red accent, Bebas Neue, zero radius, raw borders",
    modern_saas_light: "Modern SaaS Light — clean white, blue accent, Inter, Product Hunt-style polish",
    editorial_magazine: "Editorial Magazine — warm off-white, Libre Baskerville, red accent, newspaper grid",
    neon_futuristic: "Neon Futuristic — near-black, Orbitron font, purple/pink neon glow effects",
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
    principlesVersion: WEBSITE_50_PRINCIPLES_VERSION,
    qualityChecklist: buildQualityChecklist(productType, task),
    principlesEvaluations: evaluatePrinciplesApplicability(task, productType).evaluations,
  };
}

// ---------------------------------------------------------------------------
// 8. formatDesignSpecForPrompt — human-readable string for system prompt
// ---------------------------------------------------------------------------

export function formatDesignSpecForPrompt(spec: DesignSpec): string {
  const t = spec.tokens;
  const ty = spec.typography;
  const sp = spec.spacing;

  const googleFontsSection = ty.googleFontsUrl
    ? `**Google Fonts Import (add to HTML <head>):**
   <link rel="preconnect" href="https://fonts.googleapis.com">
   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
   <link href="${ty.googleFontsUrl}" rel="stylesheet>`
    : "";

  return `
**Product Type:** ${spec.productType.replace(/_/g, " ")}
**Design Direction:** ${spec.direction.replace(/_/g, " ")} — ${spec.visualSummary}
**Color Scheme:** ${spec.colorScheme}
**Quality Guide Version:** ${spec.qualityGuideVersion}
**50 Principles Framework Version:** ${spec.principlesVersion ?? WEBSITE_50_PRINCIPLES_VERSION}

**CSS Design Tokens (use in :root):**
  --bg-primary:      ${t.bgPrimary}
  --bg-surface:      ${t.bgSurface}
  --bg-card:         ${t.bgCard}
  --text-primary:    ${t.textPrimary}
  --text-secondary:  ${t.textSecondary}
  --accent-primary:  ${t.accentPrimary}
  --accent-hover:    ${t.accentHover}
  --border-subtle:   ${t.borderSubtle}
  --shadow-card:     ${t.shadowCard}
  --radius-md:       ${t.radiusMd}
  --radius-sm:       ${t.radiusSm}
  --gradient-hero:   ${t.gradientHero}
  --gradient-accent: ${t.gradientAccent}

**Typography:**
  Font stack:  ${ty.fontStack}
  Hero:        ${ty.heroSize}
  H2:          ${ty.h2Size}
  Body:        ${ty.bodySize}${ty.monoStack ? `\n  Mono:        ${ty.monoStack}` : ""}${ty.fontDisplay ? `\n  Display:     ${ty.fontDisplay}` : ""}

**Spacing:**
  Hero vertical padding:    ${sp.heroVertical}
  Section vertical padding: ${sp.sectionVertical}
  Card padding:             ${sp.cardPadding}

**Responsive Layout Rules (MANDATORY for 320px to 1920px viewports):**
  Container: .container { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
  Mobile Container: @media (max-width: 480px) { .container { padding: 0 0.75rem; } } (never 2rem/32px on mobile)
  Fluid Heading: h1 { font-size: clamp(2rem, 5vw, ${ty.heroSize}); word-break: break-word; overflow-wrap: break-word; }
  Adaptive Grid: grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); (fits 320px screens)
  Mobile Navigation: @media (max-width: 768px) { .navbar .container { flex-wrap: wrap; } .nav-links { pointer-events: none; visibility: hidden; } .nav-links.open { pointer-events: auto; visibility: visible; transform: translateY(0); } }
  CSS Nesting: Never nest @media blocks inside other @media blocks in standard CSS.

**Expected Sections (verify these exist):**
  ${spec.expectedSections.join(", ")}

**Animations:** ${spec.useAnimations ? "Enabled — add entrance/hover transitions. ALWAYS include:\n  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }" : "Disabled"}

${googleFontsSection}
`.trim();
}

// ---------------------------------------------------------------------------
// 9. isUITask — detect whether a task involves UI work
// ---------------------------------------------------------------------------

export function isUITask(task: string): boolean {
  return /\b(build|create|design|make|scaffold|generate|implement|add)\b.*\b(website|web\s*app|landing\s*page|landing|page|portfolio|dashboard|login|sign[\s-]?up|site|app\b|ui\b|frontend|interface|hero|navbar|header|footer|section|component|form)\b/i
    .test(task);
}
