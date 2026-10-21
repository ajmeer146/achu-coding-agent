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
