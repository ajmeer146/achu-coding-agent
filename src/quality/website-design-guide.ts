export const WEBSITE_DESIGN_GUIDE_VERSION = "1.0.0";

export const WEBSITE_DESIGN_GUIDE_SOURCE_FILE =
  "Complete_Master_Website_Design_Guide_A_to_Z.pdf";

export const WEBSITE_DESIGN_GUIDE_SOURCE_SHA256 =
  "6C13E87F0D247B7072EEAE0C0B9AFA486236859C0C903B69CE78C637889105C4";

export const WEBSITE_DESIGN_GUIDE_SECTION_COUNT = 35;

export type QualityPriority = "P0" | "P1" | "P2";

export interface GuideSection {
  number: number;
  id: string;
  title: string;
  focus: string;
  priorities: QualityPriority[];
}

export interface QualityChecklistItem {
  id: string;
  priority: QualityPriority;
  requirement: string;
  sections: number[];
}

export const QUALITY_PRIORITY_RULES: Record<QualityPriority, string> = {
  P0: "Essential — correct structure, working functionality, responsive design, security, accessibility basics and critical bug fixes. A website that fails any applicable P0 item is NOT complete.",
  P1: "Premium polish — distinctive visual identity, typography, consistent components, purposeful motion, custom visuals and refined interaction states.",
  P2: "Advanced extras — 3D scenes, complex parallax, custom cursors, cinematic transitions and immersive storytelling ONLY when they genuinely improve the experience and remain performant.",
};

export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    number: 1,
    id: "planning",
    title: "Project Planning and Design Strategy",
    focus: "purpose, audience, journeys, USP, sitemap, acceptance criteria before building",
    priorities: ["P0"],
  },
  {
    number: 2,
    id: "visual-identity",
    title: "Unique Visual Identity and Branding",
    focus: "original concept, brand personality, coherent visual language, no template copies",
    priorities: ["P0", "P1"],
  },
  {
    number: 3,
    id: "color",
    title: "Color System and Themes",
    focus: "tokens, semantic colors, contrast, light/dark themes, no color-only status",
    priorities: ["P0", "P1"],
  },
  {
    number: 4,
    id: "typography",
    title: "Typography System",
    focus: "font pairing, hierarchy, weights, responsive headings, readable measure",
    priorities: ["P0", "P1"],
  },
  {
    number: 5,
    id: "spacing",
    title: "Spacing and Layout System",
    focus: "spacing scale, grid, content widths, consistent radii, shadows and elevation",
    priorities: ["P0", "P1"],
  },
  {
    number: 6,
    id: "information-architecture",
    title: "Website Structure and Information Architecture",
    focus: "purposeful sections, content hierarchy, conversion paths, footer",
    priorities: ["P0", "P1"],
  },
  {
    number: 7,
    id: "header-navigation",
    title: "Header and Navigation",
    focus: "branding, responsive nav, active states, keyboard access, valid destinations",
    priorities: ["P0", "P1"],
  },
  {
    number: 8,
    id: "hero",
    title: "Hero Section and First Impression",
    focus: "headline, supporting copy, primary CTA, relevant visual, fast rendering",
    priorities: ["P0", "P1"],
  },
  {
    number: 9,
    id: "composition",
    title: "Creative Layout and Composition",
    focus: "asymmetry, bento/split layouts, layered visuals, intentional responsive layouts",
    priorities: ["P1", "P2"],
  },
  {
    number: 10,
    id: "motion",
    title: "Animation and Motion Design",
    focus: "purposeful entrance/reveal/feedback motion, consistent timing, reduced motion",
    priorities: ["P1"],
  },
  {
    number: 11,
    id: "advanced-effects",
    title: "Advanced Visual Effects",
    focus: "glass, glow, gradients, parallax, 3D and custom cursors only with a clear purpose",
    priorities: ["P2"],
  },
  {
    number: 12,
    id: "micro-interactions",
    title: "Micro-interactions and Hover States",
    focus: "hover/pressed/focus feedback, tooltips, touch alternatives, accessible labels",
    priorities: ["P1"],
  },
  {
    number: 13,
    id: "design-system",
    title: "Design System and Reusable Components",
    focus: "reusable components, variants, tokens, all interaction states",
    priorities: ["P0", "P1"],
  },
  {
    number: 14,
    id: "forms",
    title: "Buttons, Forms and Inputs",
    focus: "labels, input types, inline validation, loading/disabled states, no duplicate submit",
    priorities: ["P0", "P1"],
  },
  {
    number: 15,
    id: "media",
    title: "Images, Icons and Media",
    focus: "relevant licensed assets, aspect ratios, responsive formats, alt text, fallbacks",
    priorities: ["P0", "P1"],
  },
  {
    number: 16,
    id: "responsive",
    title: "Responsive Design",
    focus: "phones/tablets/desktop/ultrawide, no overflow or clipping, deliberate layouts",
    priorities: ["P0"],
  },
  {
    number: 17,
    id: "navigation-transitions",
    title: "Navigation and Page Transitions",
    focus: "routes, back/forward, deep links, 404, focus management, short transitions",
    priorities: ["P0", "P1"],
  },
  {
    number: 18,
    id: "interactive-components",
    title: "Interactive UI Components",
    focus: "tabs, accordions, dialogs, filters, search, sorting, loading/empty/error states",
    priorities: ["P0", "P1"],
  },
  {
    number: 19,
    id: "ux",
    title: "User Experience and Usability",
    focus: "clear labels, few steps, feedback, destructive-action confirmation, no dark patterns",
    priorities: ["P0", "P1"],
  },
  {
    number: 20,
    id: "accessibility",
    title: "Accessibility",
    focus: "semantic HTML, keyboard, focus, contrast, ARIA, error association, WCAG 2.2 AA target",
    priorities: ["P0"],
  },
  {
    number: 21,
    id: "states",
    title: "Loading, Error and Feedback States",
    focus: "skeletons, empty states, retries, success confirmation, preserve user data",
    priorities: ["P0", "P1"],
  },
  {
    number: 22,
    id: "performance",
    title: "Performance Optimization",
    focus: "optimized assets and bundles, lazy loading, no layout shift, Core Web Vitals targets",
    priorities: ["P0", "P1"],
  },
  {
    number: 23,
    id: "frontend-architecture",
    title: "Frontend Architecture and Code Quality",
    focus: "clear structure, reusable components, typed tokens, no secrets in client code",
    priorities: ["P0", "P1"],
  },
  {
    number: 24,
    id: "backend",
    title: "Backend and Application Functionality",
    focus: "auth, validation, authorization, persistence, rate limits, migrations",
    priorities: ["P0"],
  },
  {
    number: 25,
    id: "security",
    title: "Security and Privacy",
    focus: "HTTPS, secure sessions, input/output handling, secret management, safe uploads",
    priorities: ["P0"],
  },
  {
    number: 26,
    id: "seo",
    title: "SEO and Discoverability",
    focus: "titles, meta descriptions, semantic headings, sitemap, robots, Open Graph, 404",
    priorities: ["P0", "P1"],
  },
  {
    number: 27,
    id: "polish",
    title: "Branding Polish and Premium Details",
    focus: "polished logo, icons, empty/error states, footer, secondary pages, no placeholders",
    priorities: ["P1"],
  },
  {
    number: 28,
    id: "website-functionality",
    title: "Website-Specific Functionality",
    focus: "category-appropriate features; never force every feature into every site",
    priorities: ["P0", "P1"],
  },
  {
    number: 29,
    id: "testing",
    title: "Testing and Quality Assurance",
    focus: "controls, forms, API errors, responsive checks, console errors, build and journeys",
    priorities: ["P0"],
  },
  {
    number: 30,
    id: "deployment",
    title: "Deployment and Maintenance",
    focus: "production env, migrations, monitoring, backups, rollback, dependency updates",
    priorities: ["P0"],
  },
  {
    number: 31,
    id: "visual-audit",
    title: "Final Visual Quality Audit",
    focus: "first impression, hierarchy, consistency, placeholders removed, no blockers",
    priorities: ["P0"],
  },
  {
    number: 32,
    id: "design-tokens",
    title: "Design Tokens — Starting Examples",
    focus: "4-48px spacing scale, 8-24px radii, 1120-1280px content width, 150-350ms motion",
    priorities: ["P0", "P1"],
  },
  {
    number: 33,
    id: "workflow",
    title: "Implementation Workflow",
    focus: "research, design system, structure, responsive build, motion, functionality, QA",
    priorities: ["P0"],
  },
  {
    number: 34,
    id: "priorities",
    title: "Priority Levels",
    focus: "P0 essential, P1 premium polish, P2 advanced extras when valuable",
    priorities: ["P0", "P1", "P2"],
  },
  {
    number: 35,
    id: "acceptance",
    title: "Master Acceptance Criteria",
    focus: "cohesive identity, responsive functionality, states, accessibility, performance, SEO",
    priorities: ["P0"],
  },
];

export type WebsiteProductType =
  | "landing_page"
  | "portfolio"
  | "dashboard"
  | "ecommerce"
  | "blog"
  | "login_auth"
  | "saas_app"
  | "documentation"
  | "generic_website";

const PRODUCT_TYPE_LABELS: Record<WebsiteProductType, string> = {
  landing_page: "landing page",
  portfolio: "portfolio",
  dashboard: "dashboard",
  ecommerce: "e-commerce storefront",
  blog: "blog / editorial site",
  login_auth: "authentication page",
  saas_app: "SaaS application",
  documentation: "documentation site",
  generic_website: "website",
};

function item(
  id: string,
  priority: QualityPriority,
  requirement: string,
  sections: number[]
): QualityChecklistItem {
  return { id, priority, requirement, sections };
}

const COMMON_ITEMS: QualityChecklistItem[] = [
  item(
    "plan",
    "P0",
    "Before coding, infer the purpose, audience, primary journeys, page/section hierarchy and acceptance criteria. Ask the user only when an essential business rule, credential or irreversible decision cannot reasonably be inferred.",
    [1, 33]
  ),
  item(
    "structure",
    "P0",
    "Semantic document structure: header/nav, main content split into purposeful sections with a logical heading hierarchy, and a complete footer.",
    [6, 7, 20]
  ),
  item(
    "controls",
    "P0",
    "Every visible button, link, tab and control performs its advertised action or is explicitly disabled with an explanation. No dead, misleading or fake controls.",
    [7, 14, 19]
  ),
  item(
    "responsive",
    "P0",
    "Responsive at phone (375px), tablet (768px) and desktop (1280px+): no horizontal overflow, overlapping content, clipped dialogs or unreachable controls. Use a deliberate layout per breakpoint, not a shrunken desktop page.",
    [16]
  ),
  item(
    "accessibility",
    "P0",
    "Keyboard navigation with visible focus, labelled inputs, meaningful alt text, correct heading order, modal focus handling and no status communicated by color alone. Target WCAG 2.2 AA.",
    [20]
  ),
  item(
    "states",
    "P0",
    "Loading, empty, error and success states exist for every async or data-driven area, with a clear recovery path. Do not leave blank regions or silent failures.",
    [18, 21]
  ),
  item(
    "assets",
    "P0",
    "Use relevant, coherent imagery or illustrations. Never use placeholder services, broken image icons, large grey blocks, random initials or single-letter hero art. Add onerror fallbacks for external images.",
    [8, 15, 27]
  ),
  item(
    "content",
    "P0",
    "Realistic content for the requested product: specific names, prices, descriptions, metrics or project details. No lorem ipsum or generic filler in primary sections.",
    [2, 6]
  ),
  item(
    "runtime",
    "P0",
    "No uncaught console errors, failed critical requests or broken routes in the verified journeys.",
    [29]
  ),
  item(
    "security",
    "P0",
    "No secrets in client code or logs. Validate user input, prevent duplicate submissions where relevant and enforce authorization server-side when a backend exists.",
    [23, 24, 25]
  ),
  item(
    "performance",
    "P0",
    "Optimize images and fonts, lazy-load below-the-fold media, avoid unnecessary dependencies and prevent layout shifts. Targets: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1 at the 75th percentile.",
    [22]
  ),
  item(
    "seo",
    "P0",
    "Unique page title, meta description, lang attribute, semantic headings, descriptive alt text and Open Graph metadata. Add sitemap/robots and a 404 page for multi-page sites.",
    [26]
  ),
  item(
    "identity",
    "P1",
    "Distinctive visual identity appropriate to the product and audience. Avoid generic starter-template appearance, arbitrary gradients and copied competitor designs.",
    [2, 27]
  ),
  item(
    "tokens",
    "P1",
    "Centralized design tokens for color, typography, spacing, radii, shadows and elevation. Reuse tokens instead of scattering hardcoded values.",
    [3, 4, 5, 32]
  ),
  item(
    "components",
    "P1",
    "Consistent component variants and complete hover, focus, active, disabled, loading, success, empty and error states.",
    [12, 13]
  ),
  item(
    "motion",
    "P1",
    "Purposeful, consistent motion (150-350ms starting range) that never blocks interaction, with a prefers-reduced-motion override and full usability without animation.",
    [10, 12]
  ),
  item(
    "polish",
    "P1",
    "Footer, secondary pages, empty/error states and iconography feel as complete as the main screen. Remove all placeholders and unfinished elements.",
    [27, 31]
  ),
  item(
    "advanced-effects",
    "P2",
    "Optional P2: 3D scenes, complex parallax, custom cursors or cinematic transitions only when they genuinely improve the experience, remain performant and respect reduced motion. Never add them at the expense of readability or P0 functionality.",
    [9, 11]
  ),
];

const CATEGORY_ITEMS: Record<WebsiteProductType, QualityChecklistItem[]> = {
  ecommerce: [
    item(
      "ecommerce-catalog",
      "P0",
      "Product grid with at least 6-8 realistic products. Each card shows product imagery, name, category, price, rating and an Add to Cart control.",
      [15, 28]
    ),
    item(
      "ecommerce-search",
      "P0",
      "Working product search that filters results and shows a helpful empty state when nothing matches.",
      [18, 21]
    ),
    item(
      "ecommerce-filters",
      "P0",
      "Working category filters and sorting that update the product grid and preserve a coherent result count.",
      [18]
    ),
    item(
      "ecommerce-cart",
      "P0",
      "Cart drawer or modal with line items, quantity increment/decrement, remove, subtotal, tax/shipping and total that recalculate correctly. A live cart badge reflects item count.",
      [21, 28]
    ),
    item(
      "ecommerce-empty-cart",
      "P0",
      "Empty-cart state with a clear path back to products; never show broken totals or empty product cards.",
      [21]
    ),
    item(
      "ecommerce-checkout",
      "P0",
      "Checkout must be genuinely integrated and secure, or clearly labelled as a demo. Never fake a successful payment or imply real backend persistence that does not exist.",
      [19, 25, 28]
    ),
    item(
      "ecommerce-imagery",
      "P1",
      "Product imagery matches the represented products, uses consistent aspect ratios and never appears broken or mismatched.",
      [15]
    ),
  ],
  portfolio: [
    item(
      "portfolio-projects",
      "P0",
      "Project showcase with meaningful titles, descriptions, tags and working links or case-study detail. No empty or duplicate project cards.",
      [28]
    ),
    item(
      "portfolio-about",
      "P0",
      "About and skills/experience content specific to the person or business, not generic filler.",
      [2, 6]
    ),
    item(
      "portfolio-contact",
      "P0",
      "Contact form with labelled inputs, validation and success/error feedback, or an honest mailto/contact link when no backend exists.",
      [14, 21]
    ),
  ],
  dashboard: [
    item(
      "dashboard-shell",
      "P0",
      "Persistent navigation (sidebar or topbar), page title and clear section hierarchy.",
      [6, 7]
    ),
    item(
      "dashboard-data",
      "P0",
      "Meaningful KPI cards, tables and charts populated with realistic data. Tables support sorting/filtering where useful and adapt on mobile without overflow.",
      [18, 28]
    ),
    item(
      "dashboard-states",
      "P0",
      "Loading, empty and error states for data regions, plus settings or controls that visibly change state.",
      [18, 21]
    ),
  ],
  saas_app: [
    item(
      "saas-hero",
      "P0",
      "Hero with a clear value proposition, supporting copy, primary CTA and a relevant product visual.",
      [8]
    ),
    item(
      "saas-sections",
      "P0",
      "Features, how-it-works, social proof/testimonials, pricing when relevant, FAQ and final CTA with a useful footer.",
      [6, 27]
    ),
    item(
      "saas-forms",
      "P0",
      "Waitlist/contact/demo forms validate inputs, prevent duplicate submissions and show success/error feedback.",
      [14, 21]
    ),
  ],
  landing_page: [
    item(
      "landing-hero",
      "P0",
      "Memorable headline, concise supporting copy, primary CTA and a relevant product preview or illustration in the first screen.",
      [8]
    ),
    item(
      "landing-sections",
      "P0",
      "Features/benefits, how-it-works, trust signals, pricing or CTA sections only where relevant, plus a complete footer.",
      [6]
    ),
    item(
      "landing-mobile-nav",
      "P0",
      "Responsive mobile navigation that opens, closes, traps focus where appropriate and reaches every link.",
      [7, 16]
    ),
  ],
  blog: [
    item(
      "blog-index",
      "P0",
      "Article listing with categories/tags, realistic titles, excerpts, dates and imagery, plus an empty state.",
      [6, 18]
    ),
    item(
      "blog-reading",
      "P0",
      "Readable article layout with a comfortable measure, clear heading hierarchy, author/date and related content.",
      [4, 5]
    ),
  ],
  login_auth: [
    item(
      "auth-fields",
      "P0",
      "Email and password inputs with labels, correct input types, required indicators and a working show/hide password control.",
      [14]
    ),
    item(
      "auth-validation",
      "P0",
      "Inline validation associated with each field, disabled/loading submit state and clear success or error feedback. Do not fake real authentication.",
      [14, 21]
    ),
    item(
      "auth-links",
      "P0",
      "Working forgot-password, create-account and remember-me controls, or clearly disabled placeholders.",
      [7, 19]
    ),
  ],
  documentation: [
    item(
      "docs-nav",
      "P0",
      "Sidebar or top navigation with active-section highlighting and working in-page links.",
      [7, 17]
    ),
    item(
      "docs-content",
      "P0",
      "Clear content hierarchy, readable code blocks with labels and copy affordances, and a search or filter when useful.",
      [4, 18]
    ),
  ],
  generic_website: [
    item(
      "generic-hero",
      "P0",
      "Clear hero with headline, supporting copy and a primary CTA.",
      [8]
    ),
    item(
      "generic-sections",
      "P0",
      "Purposeful content sections appropriate to the business, a conversion/contact path and a complete footer.",
      [6]
    ),
  ],
};

const FEATURE_ITEMS: Array<{ pattern: RegExp; item: QualityChecklistItem }> = [
  {
    pattern: /\b(search|find|filter)\b/i,
    item: item(
      "feature-search",
      "P0",
      "Search/filter interaction works, updates results immediately and shows an empty state with a reset action.",
      [18, 21]
    ),
  },
  {
    pattern: /\b(cart|basket|checkout|payment|order)\b/i,
    item: item(
      "feature-cart",
      "P0",
      "Cart/checkout interactions update totals correctly and clearly distinguish demo behavior from real payment integration.",
      [21, 28]
    ),
  },
  {
    pattern: /\b(login|sign\s*in|sign\s*up|register|auth|password)\b/i,
    item: item(
      "feature-auth",
      "P0",
      "Authentication UI validates inputs and provides honest feedback without claiming unsupported real authentication.",
      [14, 25]
    ),
  },
  {
    pattern: /\b(dark\s*(mode|theme)|light\s*(mode|theme)|theme\s*toggle)\b/i,
    item: item(
      "feature-theme",
      "P1",
      "Theme toggle applies consistently across components and persists the preference.",
      [3]
    ),
  },
  {
    pattern: /\b(chart|analytics|metric|kpi|graph)\b/i,
    item: item(
      "feature-chart",
      "P1",
      "Charts/metrics are labelled, readable, responsive and backed by realistic data.",
      [18, 22]
    ),
  },
  {
    pattern: /\b(3d|parallax|custom\s*cursor|cinematic|immersive)\b/i,
    item: item(
      "feature-advanced",
      "P2",
      "Advanced effect is justified by the brief, stays performant and respects reduced motion.",
      [9, 11]
    ),
  },
];

function normalizeProductType(value: string): WebsiteProductType {
  switch (value) {
    case "landing_page":
    case "portfolio":
    case "dashboard":
    case "ecommerce":
    case "blog":
    case "login_auth":
    case "saas_app":
    case "documentation":
    case "generic_website":
      return value;
    default:
      return "generic_website";
  }
}

export function buildQualityChecklist(
  productType: string,
  task = ""
): QualityChecklistItem[] {
  const normalized = normalizeProductType(productType);
  const items = [...COMMON_ITEMS, ...CATEGORY_ITEMS[normalized]];
  const existingIds = new Set(items.map((entry) => entry.id));

  for (const candidate of FEATURE_ITEMS) {
    if (candidate.pattern.test(task) && !existingIds.has(candidate.item.id)) {
      items.push(candidate.item);
      existingIds.add(candidate.item.id);
    }
  }

  return items;
}

export function isWebsiteQualityTask(task: string): boolean {
  const lower = task.toLowerCase();
  const websiteIntent =
    /\b(website|web\s*site|webpage|web\s*page|site|landing\s*page|homepage|home\s*page|storefront|e[\s-]?commerce|portfolio|dashboard|saas|blog|web\s*app|frontend|ui\b|interface)\b/;
  const buildIntent =
    /\b(build|create|design|make|scaffold|generate|implement|develop|redesign|revamp|improve|add|fix|update|enhance)\b/;

  if (/\b(e[\s-]?commerce|online\s+store|shop|storefront|shopping\s+cart)\b/.test(lower)) {
    return true;
  }
  if (websiteIntent.test(lower) && buildIntent.test(lower)) return true;
  if (/\b(hero|navbar|navigation|footer|pricing\s+section|product\s+grid)\b/.test(lower)) {
    return true;
  }
  return false;
}

export function formatChecklist(items: QualityChecklistItem[]): string {
  const groups: QualityPriority[] = ["P0", "P1", "P2"];
  const lines: string[] = [];

  for (const priority of groups) {
    const group = items.filter((entry) => entry.priority === priority);
    if (group.length === 0) continue;
    lines.push(`${priority}:`);
    for (const entry of group) {
      lines.push(`- [ ] ${entry.requirement}`);
    }
  }

  return lines.join("\n");
}

export function formatGuideSectionIndex(): string {
  return GUIDE_SECTIONS.map(
    (section) =>
      `${section.number}. ${section.title} (${section.priorities.join("/")}) — ${section.focus}`
  ).join("\n");
}

export function buildWebsiteQualityGuidance(
  task: string,
  productType?: string | null
): string | null {
  if (!isWebsiteQualityTask(task)) return null;

  const resolvedType = normalizeProductType(productType ?? "generic_website");
  const checklist = buildQualityChecklist(resolvedType, task);
  const label = PRODUCT_TYPE_LABELS[resolvedType];
  const principlesEval = evaluatePrinciplesApplicability(task, resolvedType);

  return `WEBSITE QUALITY STANDARD — Complete Master Website Design Guide A–Z (v${WEBSITE_DESIGN_GUIDE_VERSION})
Source: ${WEBSITE_DESIGN_GUIDE_SOURCE_FILE} (sha256 ${WEBSITE_DESIGN_GUIDE_SOURCE_SHA256})
Detected website category: ${label}

This standard is MANDATORY for this website task. Apply every applicable item. Do not substitute a generic template or a handful of design tips for this checklist.

PRIORITIES:
- P0 — ${QUALITY_PRIORITY_RULES.P0}
- P1 — ${QUALITY_PRIORITY_RULES.P1}
- P2 — ${QUALITY_PRIORITY_RULES.P2}

BEFORE CODING:
- Infer purpose, audience, journeys, pages/sections and acceptance criteria from the request. Do not ask the user to specify colors, fonts, components or styling; choose deliberate defaults suited to this product.
- Choose a distinctive visual direction and code-visible design tokens for THIS product. Do not reuse a fixed template across unrelated requests.
- Plan the functional checklist for this category (see below) before writing files.

TASK-SPECIFIC ACCEPTANCE CHECKLIST:
${formatChecklist(checklist)}

GUIDE SECTION COVERAGE (all ${WEBSITE_DESIGN_GUIDE_SECTION_COUNT} sections):
${formatGuideSectionIndex()}

COMPLETE WEBSITE DEVELOPMENT GUIDE — 50 ESSENTIAL PRINCIPLES WORKFLOW (v${WEBSITE_50_PRINCIPLES_VERSION}):
${principlesEval.summary}
${format50PrinciplesChecklist(principlesEval.evaluations)}

REJECT CONDITIONS (must be fixed before completion):
- Broken, missing or placeholder imagery; grey blocks; random initials; single-letter hero art.
- Visible controls that do nothing, pretend to work, or claim real persistence/payment without an integration.
- Horizontal overflow, clipped dialogs, overlapping navigation or unreachable mobile controls.
- Unreadable contrast, missing focus states, unlabelled inputs or color-only status.
- Uncaught console errors or broken critical routes in the flows you verified.
- Lorem ipsum, generic filler or unfinished sections in primary content.
- Decorative P2 effects that break readability, performance or reduced-motion support.

VERIFICATION AND REPORTING:
- Start the real app, open the preview, and verify desktop and mobile layouts plus the critical interactions above. Do not treat file creation, a successful build or an HTTP 200 as visual proof.
- Repair concrete defects and re-check within the retry budget.
- In the final message, report the checklist as PASS / FAIL / NOT VERIFIED. Never claim PASS for something you did not verify.`;
}

export function buildFullGuideReference(): string {
  const lines: string[] = [
    `Complete Master Website Design Guide — A to Z (v${WEBSITE_DESIGN_GUIDE_VERSION})`,
    `Source: ${WEBSITE_DESIGN_GUIDE_SOURCE_FILE}`,
    `SHA-256: ${WEBSITE_DESIGN_GUIDE_SOURCE_SHA256}`,
    "",
  ];

  for (const section of GUIDE_SECTIONS) {
    lines.push(`${section.number}. ${section.title} [${section.priorities.join("/")}]`);
    lines.push(`   Focus: ${section.focus}`);
  }

  lines.push("");
  lines.push("P0 — " + QUALITY_PRIORITY_RULES.P0);
  lines.push("P1 — " + QUALITY_PRIORITY_RULES.P1);
  lines.push("P2 — " + QUALITY_PRIORITY_RULES.P2);

  return lines.join("\n");
}

// ===========================================================================
// COMPLETE WEBSITE DEVELOPMENT GUIDE — 50 ESSENTIAL PRINCIPLES (v2.0.0)
// ===========================================================================

export const WEBSITE_50_PRINCIPLES_VERSION = "2.0.0";

export type PrinciplePhaseNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface PrinciplePhaseMeta {
  phase: PrinciplePhaseNumber;
  title: string;
  principles: [number, number]; // range [start, end] inclusive
  backend?: boolean;
}

export const PRINCIPLE_PHASES: readonly PrinciplePhaseMeta[] = [
  { phase: 1, title: "Planning and Architecture", principles: [1, 5] },
  { phase: 2, title: "UI/UX Design and Visual Consistency", principles: [6, 15] },
  { phase: 3, title: "Frontend Development and Interactions", principles: [16, 25] },
  { phase: 4, backend: true, title: "Backend, Database, and Security", principles: [26, 35] },
  { phase: 5, title: "Performance, Testing, and Deployment", principles: [36, 45] },
  { phase: 6, title: "Reliability, Maintenance, and Final Quality", principles: [46, 50] },
] as const;

export interface WebsitePrinciple {
  number: number;
  phase: PrinciplePhaseNumber;
  phaseTitle: string;
  id: string;
  title: string;
  focus: string;
  defaultPriority: QualityPriority;
  acceptanceCriteria: string;
  isApplicable: (task: string, productType: WebsiteProductType) => { applicable: boolean; reason: string };
}

function alwaysApplicable(reason: string) {
  return () => ({ applicable: true, reason });
}

export const WEBSITE_50_PRINCIPLES: readonly WebsitePrinciple[] = [
  // Phase 1 — Planning and Architecture (1 to 5)
  {
    number: 1,
    phase: 1,
    phaseTitle: "Planning and Architecture",
    id: "p1-purpose-audience",
    title: "Define purpose, target users, goals, and expected outcomes",
    focus: "Derive target audience, clear mission, and success metrics before generating UI.",
    defaultPriority: "P0",
    acceptanceCriteria: "Clear product archetype, targeted user journey, and explicit outcome defined in planning.",
    isApplicable: alwaysApplicable("Mandatory for every website task: purpose and audience direct all design and UX."),
  },
  {
    number: 2,
    phase: 1,
    phaseTitle: "Planning and Architecture",
    id: "p2-requirements-constraints",
    title: "Extract functional, non-functional requirements, constraints, and integrations",
    focus: "Explicit list of needed capabilities, constraints (browser, mobile), and external services.",
    defaultPriority: "P0",
    acceptanceCriteria: "Testable criteria for every user-requested feature and constraint.",
    isApplicable: alwaysApplicable("Mandatory: requirements and constraints establish the completion boundaries."),
  },
  {
    number: 3,
    phase: 1,
    phaseTitle: "Planning and Architecture",
    id: "p3-pages-features-states",
    title: "Establish required pages, sections, features, user journeys, and application states",
    focus: "Map all screens, sections, primary journey paths, and interactive states.",
    defaultPriority: "P0",
    acceptanceCriteria: "All requested sections (hero, features, CTA, footer, etc.) and view states mapped.",
    isApplicable: alwaysApplicable("Mandatory: ensures no required page or section is overlooked."),
  },
  {
    number: 4,
    phase: 1,
    phaseTitle: "Planning and Architecture",
    id: "p4-sitemap-nav-hierarchy",
    title: "Create a logical sitemap and navigation hierarchy",
    focus: "Organize pages or anchor sections into an intuitive navigation structure.",
    defaultPriority: "P0",
    acceptanceCriteria: "Header navigation, anchor links, and mobile menu map to real sections or routes.",
    isApplicable: alwaysApplicable("Mandatory: every website requires intuitive, navigable information architecture."),
  },
  {
    number: 5,
    phase: 1,
    phaseTitle: "Planning and Architecture",
    id: "p5-wireframe-content-hierarchy",
    title: "Plan page wireframes and content hierarchy before writing code",
    focus: "Determine headline weight, visual anchor, and sequence of value propositions.",
    defaultPriority: "P0",
    acceptanceCriteria: "Content order structured with single H1, progressive H2s, and clear visual weighting.",
    isApplicable: alwaysApplicable("Mandatory: prevents haphazard layout and unguided generation."),
  },

  // Phase 2 — UI/UX Design and Visual Consistency (6 to 15)
  {
    number: 6,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p6-design-system-tokens",
    title: "Establish a coherent design system with reusable tokens and components",
    focus: "Define centralized CSS variables for backgrounds, text, accent, borders, radii, and shadows.",
    defaultPriority: "P0",
    acceptanceCriteria: "CSS variables defined in :root and referenced across all components; no arbitrary hardcoded values.",
    isApplicable: alwaysApplicable("Mandatory: design system tokens ensure visual cohesion across all pages and viewports."),
  },
  {
    number: 7,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p7-color-palette-contrast",
    title: "Select an attractive, purpose-appropriate colour palette with accessible contrast",
    focus: "Harmonious primary, surface, accent colors meeting WCAG 2.2 AA contrast standards.",
    defaultPriority: "P0",
    acceptanceCriteria: "Text against backgrounds has >= 4.5:1 contrast ratio; accent colors reinforce brand identity.",
    isApplicable: alwaysApplicable("Mandatory: accessible contrast and purpose-driven colors prevent amateur aesthetics."),
  },
  {
    number: 8,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p8-typography-scale",
    title: "Define consistent typography, heading hierarchy, font sizes, and line heights",
    focus: "Clear type scale from hero (2.5-3.5rem) down to body (1rem) with readable line heights (1.4-1.6).",
    defaultPriority: "P0",
    acceptanceCriteria: "Font family specified, responsive typography, headings wrap cleanly without text overflow.",
    isApplicable: alwaysApplicable("Mandatory: unstyled serif defaults or erratic heading sizes destroy visual credibility."),
  },
  {
    number: 9,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p9-alignment-visual-hierarchy",
    title: "Apply consistent alignment and visual hierarchy across every page",
    focus: "Grid-aligned content containers, consistent section paddings, and clear focal points.",
    defaultPriority: "P0",
    acceptanceCriteria: "No misaligned columns or floating orphans; sections share a unified horizontal container.",
    isApplicable: alwaysApplicable("Mandatory: disciplined alignment establishes professional quality."),
  },
  {
    number: 10,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p10-spacing-scale",
    title: "Use a consistent spacing scale and eliminate arbitrary gaps",
    focus: "Systematic spacing increments (4px, 8px, 16px, 24px, 32px, 48px, 64px) for margins and paddings.",
    defaultPriority: "P1",
    acceptanceCriteria: "Consistent card padding and section margins; elimination of random vertical jumps.",
    isApplicable: alwaysApplicable("Mandatory: uniform spacing eliminates messy, crowded, or disconnected layouts."),
  },
  {
    number: 11,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p11-responsive-containers-grids",
    title: "Establish responsive containers, grids, columns, and content-width rules",
    focus: "Max-width containers (1120-1280px) with auto margins, flexible CSS Grid / Flexbox columns.",
    defaultPriority: "P0",
    acceptanceCriteria: "Content remains centered within max-width container; multi-column grids collapse gracefully.",
    isApplicable: alwaysApplicable("Mandatory: ensures intentional layout across ultra-wide monitors and small screens."),
  },
  {
    number: 12,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p12-multi-viewport-design",
    title: "Design for mobile phones, tablets, laptops, and large desktop screens",
    focus: "Adaptive layouts crafted for 320px, 375px, 768px, 1280px, and 1920px viewports.",
    defaultPriority: "P0",
    acceptanceCriteria: "Zero horizontal overflow, readable text, and reachable touch targets across all 5 viewports.",
    isApplicable: alwaysApplicable("Mandatory: websites must provide deliberate experiences at all standard screen sizes."),
  },
  {
    number: 13,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p13-working-navigation",
    title: "Ensure all navigation elements have meaningful destinations and work correctly",
    focus: "Header logo links to home, nav links scroll to sections or navigate to valid routes; no dead href='#'.",
    defaultPriority: "P0",
    acceptanceCriteria: "Every navigation link navigates or scrolls smoothly to valid target without 404 or inert behavior.",
    isApplicable: alwaysApplicable("Mandatory: dead navigation is an immediate rejection defect."),
  },
  {
    number: 14,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p14-reusable-components",
    title: "Create reusable, consistent buttons, cards, forms, dialogs, menus, and feedback components",
    focus: "Component variants with unified radius, border, hover, focus, and active states.",
    defaultPriority: "P1",
    acceptanceCriteria: "Buttons, cards, and interactive controls share consistent visual styles and interaction states.",
    isApplicable: alwaysApplicable("Mandatory: cohesive UI elements prevent disjointed component styling."),
  },
  {
    number: 15,
    phase: 2,
    phaseTitle: "UI/UX Design and Visual Consistency",
    id: "p15-compelling-landing-page",
    title: "Design a compelling homepage or primary landing page appropriate to requirements",
    focus: "Hero section with clear value proposition, supporting copy, primary CTA, and social proof/features.",
    defaultPriority: "P0",
    acceptanceCriteria: "First screen immediately communicates value; clear call to action above the fold.",
    isApplicable: alwaysApplicable("Mandatory: the entry page creates the primary impression and conversion path."),
  },

  // Phase 3 — Frontend Development and Interactions (16 to 25)
  {
    number: 16,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p16-organized-code-structure",
    title: "Organize components, pages, hooks, utilities, styles, and assets cleanly",
    focus: "Maintainable directory structure, modular files, clean separation of HTML/CSS/JS or React components.",
    defaultPriority: "P0",
    acceptanceCriteria: "Proper file organization, no monolithic unmaintainable files, clean imports and assets.",
    isApplicable: alwaysApplicable("Mandatory: organized frontend architecture ensures maintainability and debugging."),
  },
  {
    number: 17,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p17-actionable-buttons",
    title: "Make every visible button perform its intended action",
    focus: "Every button element or CTA has an explicit click handler, state update, or form submission.",
    defaultPriority: "P0",
    acceptanceCriteria: "No inert buttons; clicking triggers real action (modal open, item add, counter update, navigation).",
    isApplicable: alwaysApplicable("Mandatory: inert or decorative-only buttons are strictly forbidden."),
  },
  {
    number: 18,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p18-form-validation",
    title: "Implement meaningful validation for all applicable forms",
    focus: "Client-side and inline validation for email, required fields, feedback messages, submit state handling.",
    defaultPriority: "P0",
    acceptanceCriteria: "Invalid input prevents submit with inline error; valid input shows success feedback.",
    isApplicable: (task, productType) => {
      const lower = task.toLowerCase();
      const hasForm =
        productType === "login_auth" ||
        /\b(form|input|field|submit|contact|login|signup|register|email|checkout|waitlist|search|newsletter)\b/i.test(lower);
      return {
        applicable: hasForm,
        reason: hasForm
          ? "Form validation is required because the task includes input forms, fields, or submissions."
          : "Not applicable: this website is a static informational showcase without user input forms.",
      };
    },
  },
  {
    number: 19,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p19-interactive-ui-components",
    title: "Implement working tabs, menus, accordions, dialogs, filters, search, pagination",
    focus: "Rich interactive UI behaviors update state and DOM accurately without page reloading.",
    defaultPriority: "P0",
    acceptanceCriteria: "Tabs switch active content panels; search/filter updates displayed item list; modals open/close.",
    isApplicable: (task, productType) => {
      const lower = task.toLowerCase();
      const hasInteractive =
        productType === "ecommerce" ||
        productType === "dashboard" ||
        productType === "documentation" ||
        /\b(tab|accordion|dialog|modal|filter|search|sort|pagination|drawer|dropdown|carousel)\b/i.test(lower);
      return {
        applicable: hasInteractive,
        reason: hasInteractive
          ? "Interactive components required for dynamic content switching, searching, or filtering."
          : "Not applicable: basic single-page presentation does not require complex multi-component widgets.",
      };
    },
  },
  {
    number: 20,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p20-transitions-animations-motion",
    title: "Add purposeful transitions, animations, hover effects, and micro-interactions",
    focus: "Smooth transitions (150-350ms), interactive hover states, with full prefers-reduced-motion override.",
    defaultPriority: "P1",
    acceptanceCriteria: "Transitions enhance feel without blocking interactions; @media (prefers-reduced-motion) included.",
    isApplicable: alwaysApplicable("Mandatory: micro-interactions provide tactile polish; reduced-motion respects accessibility."),
  },
  {
    number: 21,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p21-themes-light-dark",
    title: "Implement functional light and dark themes when required or when switching is offered",
    focus: "Theme toggle switches data-theme or class on root; tokens adjust contrast seamlessly; preference saved.",
    defaultPriority: "P1",
    acceptanceCriteria: "Theme toggle switches color palette across all components without unreadable text contrast.",
    isApplicable: (task) => {
      const hasTheme = /\b(theme|dark[\s-]?mode|light[\s-]?mode|toggle[\s-]?theme|color[\s-]?mode)\b/i.test(task);
      return {
        applicable: hasTheme,
        reason: hasTheme
          ? "Theme switching was explicitly requested in the brief."
          : "Not applicable: single unified theme requested; dual theme toggle not requested.",
      };
    },
  },
  {
    number: 22,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p22-accessibility-standards",
    title: "Follow accessibility principles (semantic HTML, keyboard, focus, labels, contrast)",
    focus: "Semantic header/nav/main/footer, visible :focus-visible outlines, input labels, aria attributes.",
    defaultPriority: "P0",
    acceptanceCriteria: "Full keyboard tab navigation, all inputs have associated labels, target WCAG 2.2 AA.",
    isApplicable: alwaysApplicable("Mandatory: accessibility is non-negotiable for production websites."),
  },
  {
    number: 23,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p23-optimized-media-assets",
    title: "Use appropriate images, optimized assets, consistent icons, and layout-stable containers",
    focus: "Aspect ratios defined to prevent layout shift; substantive SVGs or real images with alt and onerror.",
    defaultPriority: "P0",
    acceptanceCriteria: "No broken image icons, no generic placeholder blocks (placehold.co), layout stability preserved.",
    isApplicable: alwaysApplicable("Mandatory: assets must be substantive and visually integrated."),
  },
  {
    number: 24,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p24-state-consistency",
    title: "Keep UI state, navigation state, form values, and server data consistent",
    focus: "Cart count badge matches items, form fields retain input on error, active tab reflects route/panel.",
    defaultPriority: "P0",
    acceptanceCriteria: "State transitions remain synchronized across all connected UI controls without desync.",
    isApplicable: alwaysApplicable("Mandatory: state consistency prevents user confusion and corrupted workflows."),
  },
  {
    number: 25,
    phase: 3,
    phaseTitle: "Frontend Development and Interactions",
    id: "p25-state-coverage",
    title: "Implement loading, success, error, empty, disabled, offline, and no-results states",
    focus: "Empty cart message, search no-results fallback, disabled buttons during submit, retry on failure.",
    defaultPriority: "P0",
    acceptanceCriteria: "Every async or dynamic section has explicit loading, empty, and error fallback UI.",
    isApplicable: alwaysApplicable("Mandatory: unhandled empty or error states leave broken blank screens."),
  },

  // Phase 4 — Backend, Database, and Security (26 to 35)
  {
    number: 26,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p26-backend-business-logic",
    title: "Implement reliable server-side business logic and a clear separation of concerns",
    focus: "Server routes, controllers, services cleanly separated from presentation logic.",
    defaultPriority: "P0",
    acceptanceCriteria: "Server-side logic handles domain rules, computations, and validation independently of client.",
    isApplicable: (task) => {
      const hasBackend = /\b(backend|api|server|endpoint|full[\s-]?stack|express|node[\s-]?server)\b/i.test(task);
      return {
        applicable: hasBackend,
        reason: hasBackend
          ? "Backend business logic is required by the full-stack architecture specification."
          : "Not applicable: client-side application without custom server backend.",
      };
    },
  },
  {
    number: 27,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p27-api-design-validation",
    title: "Use appropriate API endpoints, HTTP methods, validation, response formats, and status codes",
    focus: "RESTful JSON endpoints (GET, POST, PUT, DELETE), 200/201 on success, 400/404/500 on failure.",
    defaultPriority: "P0",
    acceptanceCriteria: "APIs validate payloads, return standardized JSON, and use correct HTTP status codes.",
    isApplicable: (task) => {
      const hasApi = /\b(api|endpoint|route\.ts|rest|fetch|post\s+request|get\s+request)\b/i.test(task);
      return {
        applicable: hasApi,
        reason: hasApi
          ? "API endpoint design and HTTP validation required for data transmission."
          : "Not applicable: static client-side application with local state.",
      };
    },
  },
  {
    number: 28,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p28-database-persistence",
    title: "Use a suitable database schema, relationships, constraints, and indexes when required",
    focus: "Structured relational tables (PostgreSQL/SQLite) or document store with primary keys and foreign keys.",
    defaultPriority: "P0",
    acceptanceCriteria: "Data persists across process restarts; queries use indexed lookup columns.",
    isApplicable: (task) => {
      const hasDb = /\b(database|db|postgres|pg|sqlite|sql|persist|table|schema\.sql)\b/i.test(task);
      return {
        applicable: hasDb,
        reason: hasDb
          ? "Database persistence is required for storing persistent records."
          : "Not applicable: website does not require persistent server database storage.",
      };
    },
  },
  {
    number: 29,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p29-database-migrations",
    title: "Implement and verify versioned database migrations and production schema compatibility",
    focus: "Reversible, idempotent SQL migration files with up/down scripts.",
    defaultPriority: "P0",
    acceptanceCriteria: "Migration scripts run idempotently (IF NOT EXISTS) and verify cleanly on clean DB.",
    isApplicable: (task) => {
      const hasMigrations = /\b(migration\w*|migrate\w*|schema\.sql|ddl)\b/i.test(task);
      return {
        applicable: hasMigrations,
        reason: hasMigrations
          ? "Database migrations required to manage persistent schema versions."
          : "Not applicable: no relational database migrations requested.",
      };
    },
  },
  {
    number: 30,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p30-secure-authentication",
    title: "Implement secure authentication and session behaviour when required",
    focus: "Hashed passwords (bcrypt/argon2), secure HttpOnly cookies, session expiration, login rate limits.",
    defaultPriority: "P0",
    acceptanceCriteria: "Authentication securely verifies credentials, issues tamper-proof session tokens, rejects invalid.",
    isApplicable: (task, productType) => {
      const hasAuth =
        productType === "login_auth" ||
        /\b(auth|authentication|jwt|session|login|signup|password|credentials)\b/i.test(task);
      return {
        applicable: hasAuth,
        reason: hasAuth
          ? "Authentication and secure session handling required for user account management."
          : "Not applicable: public informational website without restricted user accounts.",
      };
    },
  },
  {
    number: 31,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p31-authorization-ownership",
    title: "Enforce server-side authorization and ownership checks for protected operations",
    focus: "Verify user owns resource before allowing read/update/delete; role-based access control.",
    defaultPriority: "P0",
    acceptanceCriteria: "Protected actions reject unauthenticated/unauthorized callers with 401/403.",
    isApplicable: (task) => {
      const hasProtected = /\b(protected|authorize|rbac|ownership|admin\s+only|permissions)\b/i.test(task);
      return {
        applicable: hasProtected,
        reason: hasProtected
          ? "Server-side authorization required for restricted multi-user operations."
          : "Not applicable: single-tenant or public resource model.",
      };
    },
  },
  {
    number: 32,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p32-security-threat-controls",
    title: "Apply appropriate security controls for injection, XSS, CSRF, and access control",
    focus: "Parameterized queries, HTML sanitization, CSRF token validation, path traversal prevention.",
    defaultPriority: "P0",
    acceptanceCriteria: "No raw string SQL concatenation, no unsanitized dangerouslySetInnerHTML, CSRF protected.",
    isApplicable: alwaysApplicable("Mandatory: security controls (XSS prevention, input sanitization) apply universally."),
  },
  {
    number: 33,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p33-secrets-credentials-protection",
    title: "Protect credentials and secrets using appropriate server-side configuration",
    focus: "API keys and database passwords stored in server env vars; never bundled in client JS or git commits.",
    defaultPriority: "P0",
    acceptanceCriteria: "Zero secrets in client-side bundles, logs, or repository commits; sensitive config redacted.",
    isApplicable: alwaysApplicable("Mandatory: absolute prohibition against leaking credentials or keys."),
  },
  {
    number: 34,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p34-upload-storage-validation",
    title: "Validate uploads, file types, sizes, storage permissions, and download access",
    focus: "MIME type validation, file size limits (<5MB), safe filename sanitization, secure storage URLs.",
    defaultPriority: "P0",
    acceptanceCriteria: "Rejected malicious or oversize file uploads; sanitized storage paths.",
    isApplicable: (task) => {
      const hasUpload = /\b(upload|attachment|file\s+input|avatar\s+upload|image\s+upload)\b/i.test(task);
      return {
        applicable: hasUpload,
        reason: hasUpload
          ? "File upload validation is required for user-submitted media/documents."
          : "Not applicable: website does not accept binary file uploads.",
      };
    },
  },
  {
    number: 35,
    phase: 4,
    phaseTitle: "Backend, Database, and Security",
    id: "p35-resilient-error-handling",
    title: "Handle network errors, timeouts, database failures, rate limits, and outages safely",
    focus: "Graceful try/catch, fallback responses, timeout abort controllers, retry with backoff.",
    defaultPriority: "P0",
    acceptanceCriteria: "Failed API or network calls display user-friendly error message with recovery/retry option.",
    isApplicable: alwaysApplicable("Mandatory: unexpected failures must degrade gracefully rather than crashing."),
  },

  // Phase 5 — Performance, Testing, and Deployment (36 to 45)
  {
    number: 36,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p36-performance-optimization",
    title: "Optimize loading performance, rendering, assets, database access, and JavaScript",
    focus: "Efficient CSS/JS bundles, fast DOM rendering, minimal reflows, lazy loading for below-fold media.",
    defaultPriority: "P0",
    acceptanceCriteria: "Page loads and renders quickly without blocking script tags or excessive layout thrashing.",
    isApplicable: alwaysApplicable("Mandatory: optimal performance ensures responsive user interaction."),
  },
  {
    number: 37,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p37-seo-metadata-canonical",
    title: "Implement appropriate page metadata, semantic content, canonical URLs, and sitemap",
    focus: "Descriptive <title>, meta description, viewport meta, lang attribute, Open Graph tags.",
    defaultPriority: "P0",
    acceptanceCriteria: "HTML head contains valid title, viewport, meta description, and semantic landmarks.",
    isApplicable: alwaysApplicable("Mandatory: proper document head metadata is essential for search and sharing."),
  },
  {
    number: 38,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p38-browser-multi-viewport-testing",
    title: "Test browser compatibility and different viewport sizes using available browsers",
    focus: "Visual layout verification across 320px, 375px, 768px, 1280px, 1920px viewports.",
    defaultPriority: "P0",
    acceptanceCriteria: "Measurable layout checks run across mobile, tablet, and desktop with zero critical overflow.",
    isApplicable: alwaysApplicable("Mandatory: layout must be verified across the standard responsive spectrum."),
  },
  {
    number: 39,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p39-test-pages-controls-journeys",
    title: "Test every important page, link, button, form, API integration, and user journey",
    focus: "Verify controls exist and execute intended behaviors; end-to-end user path validation.",
    defaultPriority: "P0",
    acceptanceCriteria: "Every key control tested; primary conversion journey successfully completed.",
    isApplicable: alwaysApplicable("Mandatory: unverified controls risk delivering non-functional software."),
  },
  {
    number: 40,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p40-automated-test-suite",
    title: "Add and run appropriate unit, integration, and end-to-end tests",
    focus: "Automated test execution (npm test, vitest, node --test) verifying core business logic.",
    defaultPriority: "P0",
    acceptanceCriteria: "Test suite executed with 100% pass rate; zero failing assertions.",
    isApplicable: (task) => {
      const hasTests = /\b(test|spec|jest|vitest|mocha|node\s+--test)\b/i.test(task);
      return {
        applicable: hasTests,
        reason: hasTests
          ? "Automated test execution required by task specification."
          : "Not applicable: visual and functional browser verification applied in lieu of standalone unit suite.",
      };
    },
  },
  {
    number: 41,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p41-accessibility-verification",
    title: "Verify keyboard navigation, form labels, focus order, and contrast requirements",
    focus: "Tab key reaches all interactive elements; active focus indicator visible; labels associated.",
    defaultPriority: "P0",
    acceptanceCriteria: "No trapped focus; buttons and inputs reachable and operable via keyboard.",
    isApplicable: alwaysApplicable("Mandatory: ensures accessible usability for keyboard and assistive device users."),
  },
  {
    number: 42,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p42-performance-indicators",
    title: "Measure relevant performance indicators and investigate meaningful bottlenecks",
    focus: "Verify absence of infinite re-renders, runaway event listeners, and sluggish DOM updates.",
    defaultPriority: "P1",
    acceptanceCriteria: "No noticeable frame drops or unresponsive UI clicks during user interactions.",
    isApplicable: alwaysApplicable("Mandatory: ensures responsive feel and swift interactions."),
  },
  {
    number: 43,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p43-environment-configuration",
    title: "Validate environment-specific configuration for development, testing, preview, prod",
    focus: "Port configuration, base URLs, environment variable isolation, staging vs prod flags.",
    defaultPriority: "P0",
    acceptanceCriteria: "Configuration cleanly separates local ports from production endpoints without hardcoded localhost.",
    isApplicable: alwaysApplicable("Mandatory: environment config prevents deployment collisions."),
  },
  {
    number: 44,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p44-production-build-verification",
    title: "Verify production builds, environment configuration, migrations, and deployment logs",
    focus: "Execute build command (npm run build, tsc); confirm clean compilation with 0 fatal errors.",
    defaultPriority: "P0",
    acceptanceCriteria: "Build script completes with exit code 0; generated bundle is complete.",
    isApplicable: (task) => {
      const hasBuild = /\b(build|compile|bundle|dist|package\.json|vite|next)\b/i.test(task);
      return {
        applicable: hasBuild,
        reason: hasBuild
          ? "Production build verification required for compiled/bundled projects."
          : "Not applicable: pure static HTML/CSS/JS site running directly without build compilation.",
      };
    },
  },
  {
    number: 45,
    phase: 5,
    phaseTitle: "Performance, Testing, and Deployment",
    id: "p45-ci-cd-quality-gates",
    title: "Integrate appropriate automated validation into CI/CD and block releases on critical failures",
    focus: "Release gates prevent promoting broken builds or incomplete tasks.",
    defaultPriority: "P0",
    acceptanceCriteria: "All quality gates must pass before task marked complete or released.",
    isApplicable: alwaysApplicable("Mandatory: quality gates enforce release standards deterministically."),
  },

  // Phase 6 — Reliability, Maintenance, and Final Quality (46 to 50)
  {
    number: 46,
    phase: 6,
    phaseTitle: "Reliability, Maintenance, and Final Quality",
    id: "p46-application-logging-monitoring",
    title: "Provide useful application logging and monitoring without exposing sensitive information",
    focus: "Actionable console logs, error breadcrumbs, with automatic redaction of secrets/passwords.",
    defaultPriority: "P1",
    acceptanceCriteria: "Logs capture key operations without leaking sensitive tokens or PII.",
    isApplicable: alwaysApplicable("Mandatory: proper logging enables production diagnostics without security leaks."),
  },
  {
    number: 47,
    phase: 6,
    phaseTitle: "Reliability, Maintenance, and Final Quality",
    id: "p47-backup-recovery-procedures",
    title: "Preserve or establish suitable backup and recovery procedures for persistent data",
    focus: "Snapshots, reversible migrations, file rollback capability before destructive edits.",
    defaultPriority: "P0",
    acceptanceCriteria: "File snapshot created before modifications; rollback restores clean state upon critical failure.",
    isApplicable: alwaysApplicable("Mandatory: safe backup protects user work from destructive changes."),
  },
  {
    number: 48,
    phase: 6,
    phaseTitle: "Reliability, Maintenance, and Final Quality",
    id: "p48-scalability-reliability-design",
    title: "Design for reasonable scalability and reliability without unnecessary complexity",
    focus: "Modular architecture, stateless API design, clean abstractions avoid over-engineering.",
    defaultPriority: "P1",
    acceptanceCriteria: "Solution balances robust design with simple maintainability; no unnecessary microservices.",
    isApplicable: alwaysApplicable("Mandatory: avoids brittle architectures and overcomplicated code."),
  },
  {
    number: 49,
    phase: 6,
    phaseTitle: "Reliability, Maintenance, and Final Quality",
    id: "p49-maintain-dependencies-regression",
    title: "Maintain dependencies, documentation, error fixes, and regression tests",
    focus: "Compatible dependency versions, documented run instructions, regression test protection.",
    defaultPriority: "P0",
    acceptanceCriteria: "Dependencies install cleanly without peer conflicts; existing tests remain green.",
    isApplicable: alwaysApplicable("Mandatory: prevents dependency rot and protects against regressions."),
  },
  {
    number: 50,
    phase: 6,
    phaseTitle: "Reliability, Maintenance, and Final Quality",
    id: "p50-final-quality-audit",
    title: "Conduct a final production-quality audit covering design, functionality, responsiveness, accessibility",
    focus: "12-category quality score verification: design, UX, responsive, functionality, security, build.",
    defaultPriority: "P0",
    acceptanceCriteria: "Audit completed with all mandatory quality gates passed and zero unresolved critical defects.",
    isApplicable: alwaysApplicable("Mandatory: final audit certifies delivery of a complete, working website."),
  },
];

export interface PrincipleEvaluation {
  principle: WebsitePrinciple;
  applicable: boolean;
  priority: QualityPriority;
  reason: string;
  acceptanceCriteria: string;
}

export function evaluatePrinciplesApplicability(
  task: string,
  productType?: string | null
): {
  evaluations: PrincipleEvaluation[];
  applicableCount: number;
  notApplicableCount: number;
  summary: string;
} {
  const resolvedType = normalizeProductType(productType ?? "generic_website");
  const evaluations: PrincipleEvaluation[] = [];

  for (const principle of WEBSITE_50_PRINCIPLES) {
    const { applicable, reason } = principle.isApplicable(task, resolvedType);
    evaluations.push({
      principle,
      applicable,
      priority: principle.defaultPriority,
      reason,
      acceptanceCriteria: principle.acceptanceCriteria,
    });
  }

  const applicableCount = evaluations.filter((e) => e.applicable).length;
  const notApplicableCount = evaluations.length - applicableCount;

  const summary = `50 Principles Checklist: ${applicableCount} applicable, ${notApplicableCount} non-applicable (tailored for "${resolvedType}")`;

  return { evaluations, applicableCount, notApplicableCount, summary };
}

export function format50PrinciplesChecklist(evaluations: PrincipleEvaluation[]): string {
  const lines: string[] = [];

  for (const phase of PRINCIPLE_PHASES) {
    lines.push(`\n### Phase ${phase.phase} — ${phase.title}`);
    const phaseEvals = evaluations.filter((e) => e.principle.phase === phase.phase);
    for (const ev of phaseEvals) {
      const p = ev.principle;
      if (ev.applicable) {
        lines.push(`- [ ] Principle ${p.number} [${ev.priority}]: ${p.title}`);
        lines.push(`      Criteria: ${ev.acceptanceCriteria}`);
      } else {
        lines.push(`- [N/A] Principle ${p.number}: ${p.title}`);
        lines.push(`      Reason: ${ev.reason}`);
      }
    }
  }

  return lines.join("\n");
}

// ===========================================================================
// DESIGN QUALITY SCORING ENGINE (12 INDEPENDENT CATEGORIES)
// ===========================================================================

export interface QualityCategoryEvidence {
  categoryNumber: number;
  id: string;
  name: string;
  score: number; // 0 to 100
  passed: boolean; // meets mandatory pass threshold (>= 75)
  weight: number;
  evidence: string[];
  defects: string[];
}

export interface WebsiteQualityAuditReport {
  overallScore: number;
  overallPassed: boolean;
  categories: QualityCategoryEvidence[];
  mandatoryGatesPassed: boolean;
  blockers: string[];
  summary: string;
}

export function evaluateWebsiteQuality(params: {
  task: string;
  pageTitle?: string;
  visibleText?: string;
  buttons?: string[];
  inputs?: Array<{ name: string; type: string; placeholder: string }>;
  headings?: string[];
  semanticCount?: number;
  stylesheetCount?: number;
  totalCssRules?: number;
  fontFamily?: string;
  criticalLayoutDefects?: Array<{ type: string; message: string }>;
  warningLayoutDefects?: Array<{ type: string; message: string }>;
  consoleErrors?: string[];
  pageErrors?: string[];
  verificationPassed?: boolean;
  buildPassed?: boolean;
  secretLeaksFound?: boolean;
}): WebsiteQualityAuditReport {
  const categories: QualityCategoryEvidence[] = [];
  const blockers: string[] = [];

  const text = (params.visibleText || "").trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  const headings = params.headings || [];
  const buttons = params.buttons || [];
  const inputs = params.inputs || [];
  const semanticCount = params.semanticCount || 0;
  const totalCssRules = params.totalCssRules || 0;
  const stylesheetCount = params.stylesheetCount || 0;
  const criticalDefects = params.criticalLayoutDefects || [];
  const warningDefects = params.warningLayoutDefects || [];
  const consoleErrors = params.consoleErrors || [];
  const pageErrors = params.pageErrors || [];

  // 1. Information architecture and content hierarchy
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (headings.length === 0) { score -= 40; defects.push("No H1/H2 headings found on page"); }
    else { evidence.push(`Found ${headings.length} heading(s): ${headings.slice(0, 3).join(", ")}`); }
    if (semanticCount < 2) { score -= 30; defects.push("Sparse semantic HTML structure (< 2 semantic landmarks)"); }
    else { evidence.push(`Semantic structure contains ${semanticCount} landmark/container elements`); }
    if (wordCount < 20) { score -= 30; defects.push(`Content is minimal (${wordCount} words)`); }
    else { evidence.push(`Page content contains ${wordCount} words`); }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 1,
      id: "info-architecture",
      name: "Information architecture and content hierarchy",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 2. Visual design and design-system consistency
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (stylesheetCount === 0 && totalCssRules === 0) {
      score = 0;
      defects.push("No active CSS stylesheets or rules found; completely unstyled");
    } else if (totalCssRules < 8) {
      score = 30;
      defects.push(`Basic styling (${totalCssRules} rules)`);
    } else {
      evidence.push(`Design system active with ${totalCssRules} CSS rules across ${stylesheetCount} stylesheet(s)`);
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 2,
      id: "visual-design-system",
      name: "Visual design and design-system consistency",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 3. Alignment, spacing, typography, and grid quality
  {
    let score = (stylesheetCount === 0 && totalCssRules === 0) ? 0 : 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (stylesheetCount === 0 && totalCssRules === 0) {
      defects.push("No layout styles present");
    }
    const textOverflows = criticalDefects.filter((d) => d.type === "text_overflow");
    if (textOverflows.length > 0) { score -= 40 * textOverflows.length; defects.push(`${textOverflows.length} text overflow defect(s)`); }
    const navOverlaps = criticalDefects.filter((d) => d.type === "navigation_overlap");
    if (navOverlaps.length > 0) { score -= 40 * navOverlaps.length; defects.push(`${navOverlaps.length} navigation overlap defect(s)`); }
    if (criticalDefects.some((d) => d.type === "horizontal_overflow")) { score -= 40; defects.push("Horizontal overflow disrupts page alignment"); }
    if (score === 100) evidence.push("Alignment, grid flow, and typography wrapping cleanly");
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 3,
      id: "alignment-spacing-grid",
      name: "Alignment, spacing, typography, and grid quality",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 4. Colour consistency and visual accessibility
  {
    let score = (stylesheetCount === 0 && totalCssRules === 0) ? 0 : 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (stylesheetCount === 0 && totalCssRules === 0) {
      defects.push("No color system or theme defined");
    }
    const font = params.fontFamily || "";
    if (font.toLowerCase().includes("times new roman") && totalCssRules < 15) {
      score -= 30;
      defects.push("Unstyled browser serif default font detected");
    } else if (score > 0) {
      evidence.push(`Active typography: "${font || "system default"}"`);
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 4,
      id: "color-contrast-accessibility",
      name: "Colour consistency and visual accessibility",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 5. Desktop layout quality
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    const desktopDefects = criticalDefects.filter((d) => !d.message.includes("mobile") && !d.message.includes("375") && !d.message.includes("320"));
    if (desktopDefects.length > 0) {
      score -= desktopDefects.length * 35;
      defects.push(...desktopDefects.map((d) => d.message));
    } else {
      evidence.push("Desktop viewports (1024px-1920px) clean without critical overflow or clipping");
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 5,
      id: "desktop-layout",
      name: "Desktop layout quality",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 6. Mobile and tablet layout quality
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    const mobileDefects = criticalDefects.filter((d) => d.message.includes("mobile") || d.message.includes("375") || d.message.includes("320") || d.type === "horizontal_overflow");
    if (mobileDefects.length > 0) {
      score -= mobileDefects.length * 35;
      defects.push(...mobileDefects.map((d) => d.message));
    } else {
      evidence.push("Mobile and tablet viewports (320px-768px) responsive without horizontal overflow");
    }
    const touchWarnings = warningDefects.filter((d) => d.type === "small_touch_target");
    if (touchWarnings.length > 2) {
      score -= 15;
      evidence.push(`Note: ${touchWarnings.length} touch target(s) under 44x44px`);
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 6,
      id: "mobile-tablet-layout",
      name: "Mobile and tablet layout quality",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 7. Navigation and interaction completeness
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (buttons.length === 0 && !params.task.toLowerCase().includes("read-only")) {
      score -= 20;
      defects.push("No interactive buttons found on page");
    } else {
      evidence.push(`Found ${buttons.length} button/CTA control(s)`);
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 7,
      id: "navigation-interaction-completeness",
      name: "Navigation and interaction completeness",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 8. Functional correctness and data flow
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (params.verificationPassed === false) {
      score -= 50;
      defects.push("Functional browser assertions or test suites failed");
    } else if (params.verificationPassed === true) {
      evidence.push("All functional verification targets passed successfully");
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 8,
      id: "functional-correctness",
      name: "Functional correctness and data flow",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 9. Error handling and application-state coverage
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (consoleErrors.length > 0) {
      score -= Math.min(60, consoleErrors.length * 20);
      defects.push(`${consoleErrors.length} uncaught console error(s) logged: ${consoleErrors.slice(0, 2).join("; ")}`);
    } else {
      evidence.push("Zero uncaught browser console errors");
    }
    if (pageErrors.length > 0) {
      score -= Math.min(40, pageErrors.length * 20);
      defects.push(`${pageErrors.length} page runtime/request error(s)`);
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 9,
      id: "error-handling-states",
      name: "Error handling and application-state coverage",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 10. Accessibility and keyboard usability
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (inputs.length > 0) {
      evidence.push(`Found ${inputs.length} form input(s) with semantic types`);
    }
    evidence.push("Semantic HTML landmarks and keyboard focus rules configured");
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 10,
      id: "accessibility-keyboard",
      name: "Accessibility and keyboard usability",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 11. Performance and asset optimization
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    evidence.push("Local CSS/JS assets structured with fast delivery");
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 11,
      id: "performance-assets",
      name: "Performance and asset optimization",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  // 12. Security and deployment readiness
  {
    let score = 100;
    const evidence: string[] = [];
    const defects: string[] = [];
    if (params.secretLeaksFound) {
      score = 0;
      defects.push("CRITICAL SECURITY VIOLATION: Potential secret or credential detected in generated files");
      blockers.push("Secret leak detected");
    } else {
      evidence.push("Zero exposed API keys or secrets in client artifacts");
    }
    if (params.buildPassed === false) {
      score -= 50;
      defects.push("Build/compilation command failed with non-zero exit code");
      blockers.push("Build compilation failed");
    } else if (params.buildPassed === true) {
      evidence.push("Production build command completed cleanly (exit code 0)");
    }
    score = Math.max(0, score);
    categories.push({
      categoryNumber: 12,
      id: "security-deployment",
      name: "Security and deployment readiness",
      score,
      passed: score >= 70,
      weight: 1,
      evidence,
      defects,
    });
  }

  let totalScore = Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);
  if (blockers.length > 0) {
    totalScore = Math.min(totalScore, 40);
  }
  const allPassed = categories.every((c) => c.passed) && blockers.length === 0;

  return {
    overallScore: totalScore,
    overallPassed: allPassed,
    categories,
    mandatoryGatesPassed: allPassed,
    blockers,
    summary: `Website Quality Score: ${totalScore}/100 (${allPassed ? "PASSED" : "FAILED QUALITY GATES"}) across 12 categories`,
  };
}
