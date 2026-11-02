/**
 * Design References — brand-style guidance for each DesignDirection.
 *
 * Provides concise, actionable prose references that the agent can embed in
 * its system prompt so generated websites match the feel of well-known
 * product design systems (Linear, Stripe, Vercel, Framer, etc.).
 *
 * All content is analyst-authored inspiration — no proprietary code copied.
 */

import type { DesignDirection } from "../tools/design-planner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DesignReference {
  /** The DesignDirection this reference applies to */
  direction: DesignDirection;
  /** 1–2 sentence summary of the design philosophy */
  philosophy: string;
  /** Comma-separated brands / products that epitomise this direction */
  inspiredBy: string;
  /** Layout and composition guidance */
  layout: string;
  /** Typography guidance */
  typography: string;
  /** Color and surface guidance */
  color: string;
  /** Animation and motion guidance */
  motion: string;
  /** Component / UI pattern guidance */
  components: string;
  /** Imagery and illustration guidance */
  imagery: string;
}

// ---------------------------------------------------------------------------
// Reference library
// ---------------------------------------------------------------------------

const DESIGN_REFERENCES: Record<DesignDirection, DesignReference> = {
  minimal_clean: {
    direction: "minimal_clean",
    philosophy:
      "Ruthless reduction: every element earns its place. White space is the hero; content breathes at generous margins.",
    inspiredBy: "Linear, Notion, Vercel, Raycast, Craft",
    layout:
      "Centered column with max-width 720–1080px. Asymmetric sections alternate text-left / image-right. Generous 80–120px vertical section padding.",
    typography:
      "Inter or Geist at 400/500/600 weights. Hero 3–4rem, tight tracking -0.02em. Body 1rem / 1.6 line-height. No decorative fonts.",
    color:
      "Near-white (#fafafa) or pure white background. Single indigo or violet accent (#6366f1). Muted grays for secondary text. Subtle 1px borders.",
    motion:
      "Subtle fade-in-up on scroll (opacity 0→1, translateY 16→0, 400ms ease-out). Hover: scale(1.02) on cards. No flashy effects.",
    components:
      "Ghost buttons with thin border. Pill badges. Clean data tables. Minimal icon set (Lucide or Heroicons). Card borders instead of heavy shadows.",
    imagery:
      "Abstract geometry, clean mockups, minimal illustrations. No stock photography of people. SVG diagrams preferred.",
  },

  bold_vibrant: {
    direction: "bold_vibrant",
    philosophy:
      "Make an impression in the first 2 seconds. Dark canvas with electric accents, oversized type, and dramatic contrast.",
    inspiredBy: "Figma, Stripe, Framer, Webflow",
    layout:
      "Full-bleed hero with centered headline. Wide 1440px max-width. Feature bento-grid sections. Bold horizontal dividers.",
    typography:
      "Display weight (800–900) for hero. Mixed-size grid for visual hierarchy. Letter-spacing -0.04em on headlines. Body stays readable at 400.",
    color:
      "Near-black #060B18 canvas. Vivid orange, coral, or electric blue accent. Gradient overlays on hero. White text exclusively.",
    motion:
      "Staggered hero text reveal (each word slides up, 60ms delay). Parallax on hero background. Smooth 300ms hover transitions with glow.",
    components:
      "Filled CTA buttons with gradient background. Frosted-glass feature cards. Animated counter stats. Large feature screenshots with drop shadow.",
    imagery:
      "Bold product screenshots, gradient mesh backgrounds, abstract 3D shapes. High contrast illustrations.",
  },

  professional_corporate: {
    direction: "professional_corporate",
    philosophy:
      "Trust through consistency. Every decision signals reliability, structure, and institutional credibility.",
    inspiredBy: "Salesforce, IBM, Atlassian, HubSpot",
    layout:
      "Standard 12-column grid at 1200px max-width. Clear visual hierarchy: nav → hero → alternating feature rows → CTA → footer.",
    typography:
      "Segoe UI or system sans-serif. Conservative sizing (2.5rem hero, 1.875rem h2). Professional weight 500–600 for headings. No decorative fonts.",
    color:
      "Light gray #f0f4f8 base. White card surfaces. Primary blue #2563eb accent. Conservative, no gradients except subtle hero tints.",
    motion:
      "Minimal: fade-in on scroll only. Hover: subtle shadow elevation change. No entrance animations on headings. Keep it serious.",
    components:
      "Standard buttons (solid primary, outline secondary). Data tables with alternating rows. Professional form inputs. Clear icon labels.",
    imagery:
      "Professional team photography, architectural photos, clean product screens. No cartoons or abstract art.",
  },

  warm_organic: {
    direction: "warm_organic",
    philosophy:
      "Warmth, craft, and authenticity. Handmade textures, earthy palette, and serif type evoke care and human touch.",
    inspiredBy: "Airbnb, Food52, Kinfolk, Letterfolk",
    layout:
      "Loose editorial grid with overlapping elements. Organic asymmetry. Wide hero image full-bleed. Section cards with generous rounded corners (20px+).",
    typography:
      "Serif display (Playfair, Lora, or Merriweather) for headings. System serif or Georgia for body. Warm brown ink tones.",
    color:
      "Cream #FEF9F0 base. Warm white cards. Amber/terracotta accent #D97706. Earth tones throughout: deep brown text, golden highlights.",
    motion:
      "Gentle fade-in (600ms). Hover: warm shadow growth. Smooth scroll snapping on gallery sections. Avoid abrupt or mechanical transitions.",
    components:
      "Pill-shaped tags. Rounded image frames. Recipe/product cards with warm photo. Soft-shadow inputs. Hand-drawn style icon accents.",
    imagery:
      "Warm-toned photography, food/nature/people. Grain texture overlays at low opacity. Watercolor illustration accents.",
  },

  tech_cyberpunk: {
    direction: "tech_cyberpunk",
    philosophy:
      "The aesthetic of code and the near-future. Terminal green, neon cyan, and monospace typography signal raw technical power.",
    inspiredBy: "Vercel CLI, GitHub Dark, Linear (dark), Warp terminal",
    layout:
      "Wide dark canvas. Code-block hero. Grid-based bento layout with bordered cells. Terminal-window components.",
    typography:
      "Monospace (Courier New, JetBrains Mono) for hero and code. System sans for body. All-caps utility labels. Tight tracking.",
    color:
      "Near-black #05070F base. Cyan #22D3EE accent. Electric blue secondary. Subtle grid lines. Text glows via text-shadow.",
    motion:
      "Typewriter effect on hero headline. Glitch flicker on hover. Scan-line animation on image hover. Subtle CRT noise at very low opacity.",
    components:
      "Terminal windows with colored dots. Syntax-highlighted code blocks. CLI-style progress bars. Bordered cards with glow shadow.",
    imagery:
      "Code screenshots, network topology diagrams, circuit board textures. No organic imagery.",
  },

  editorial_luxury: {
    direction: "editorial_luxury",
    philosophy:
      "Restraint as luxury. Every element placed with precision. Typography commands the room; color whispers.",
    inspiredBy: "Monocle, Kinfolk, Net-a-Porter, Apple",
    layout:
      "Wide editorial columns (1440px). Large whitespace margins. Portrait full-bleed hero. Asymmetric two-column features.",
    typography:
      "Cormorant Garamond or Didot for display. Tight tracking, generous leading. Mixed italic/roman hierarchy. Gold accent on key words.",
    color:
      "Off-white #FAFAF5 base. Single gold accent #B8963E. Near-black type #1C1C1E. No gradients — flat surfaces only.",
    motion:
      "Slow, deliberate fade-in (800ms). Parallax hero image at 0.3x speed. Hover: underline draw animation. Never rushed.",
    components:
      "Hairline borders. Ghost buttons with gold border. Full-bleed image sections. Pull-quote typography. Category tag in all-caps spaced.",
    imagery:
      "High-fashion photography, architecture, product still life. Black & white with selective color. Film grain overlay.",
  },

  playful_colorful: {
    direction: "playful_colorful",
    philosophy:
      "Joy is the product. Rounded, bright, and full of personality — every interaction should make users smile.",
    inspiredBy: "Duolingo, Notion (colourful), Linear Releases, Lottie",
    layout:
      "Card-heavy grid layout. Lots of color blocks. Playful diagonal sections. Wide cards with 24px+ border radius.",
    typography:
      "Rounded sans (Nunito, Poppins, or DM Sans). Large, friendly hero text. Emoji as accents. Mixed weights for playfulness.",
    color:
      "White base with vivid color blocks. Coral #FF6B6B, teal #4ECDC4, yellow #FFE66D accents. Each feature section uses a different hue.",
    motion:
      "Bounce entrance (spring easing). Wiggle on hover. Confetti on CTA click. Sticker-style elements float gently.",
    components:
      "Pill buttons with shadow. Illustrated feature icons. Mascot character. Toggle switches with satisfying animations. Star/rating displays.",
    imagery:
      "Custom illustration preferred. Flat-style with bold outlines. Lottie animations. Emoji liberally used.",
  },

  dark_saas: {
    direction: "dark_saas",
    philosophy:
      "Power-user aesthetic: dense, information-rich, and confidence-inspiring. Used by builders who mean business.",
    inspiredBy: "Linear, Vercel, Supabase, PlanetScale, Railway",
    layout:
      "Dark sidebar + main content for dashboards. Landing: full-bleed dark hero, stats bar, bento feature grid.",
    typography:
      "Inter at all weights. Dense but readable. Monospace for code/numbers. 3.25rem hero, tight -0.02em tracking.",
    color:
      "Near-black #0F1117 base. Deep surface #1A1F2E. Blue #60a5fa accent. Subtle white/6% borders. Gradient on primary CTA.",
    motion:
      "Fast, precise transitions (200–250ms). Hover: subtle background lightening. Code block: syntax highlight on mount. No bounce.",
    components:
      "Command palette (⌘K). Keyboard shortcut badges. Status indicators (green/red/yellow dots). Dense data tables. Copy-to-clipboard buttons.",
    imagery:
      "Dark-mode product screenshots. Code editor screenshots. Architecture diagrams. Abstract tech SVGs.",
  },

  luxury_brand: {
    direction: "luxury_brand",
    philosophy:
      "Ultra-premium positioning through extreme restraint. Black and gold. Every pixel deliberate. Silence is a feature.",
    inspiredBy: "Rolex, Bottega Veneta, Chanel digital, Bang & Olufsen",
    layout:
      "Full-screen hero with centered logotype. Generous negative space. Single-column editorial scroll. No sidebars.",
    typography:
      "Playfair Display for all headings — italic for emphasis. Jost for body copy at 300 weight. Ultra-wide letter-spacing on subheadings.",
    color:
      "Near-black #0a0a0a base. Pure gold #C9A84C accent. Warm white #F5F5F0 text. Never pure white backgrounds.",
    motion:
      "Ultra-slow fade (1200ms). Horizontal scroll on gallery. Gold underline draws on hover. No bounce, no scale.",
    components:
      "Hairline border buttons (gold). Frosted glass overlays on video. Single-product spotlight cards. Scroll-triggered reveals.",
    imagery:
      "Cinematic product photography on black. Close-up material texture shots. Film grain. No illustrations.",
  },

  startup_growth: {
    direction: "startup_growth",
    philosophy:
      "Move fast and inspire confidence. Gradient energy, social proof, and clear CTAs drive conversion at every scroll depth.",
    inspiredBy: "Loom, Notion, Linear (launch pages), Y Combinator companies",
    layout:
      "Wide 1280px landing. Full-bleed gradient hero. Logo carousel trust bar. Alternating feature rows. Pricing section. FAQ accordion.",
    typography:
      "Plus Jakarta Sans at 700–800 for headlines. Tight tracking, large sizes. Body at 400/1.7. Badge text in 500.",
    color:
      "Deep purple/indigo gradient hero. Light purple card backgrounds. Vibrant #f093fb/magenta accent. White text on dark, dark text on light cards.",
    motion:
      "Parallax hero gradient. Counter animation on stat numbers. Staggered feature card entrance. Hover: card lift + glow.",
    components:
      "Social proof bar (logos). Testimonial carousel. Pricing toggle (monthly/annual). FAQ accordion. Waitlist form with progress bar.",
    imagery:
      "Abstract gradient meshes, product mockups on gradient, team celebration photos, SVG illustrations with gradient fills.",
  },

  creative_agency: {
    direction: "creative_agency",
    philosophy:
      "The work speaks first. Bold, unexpected layouts signal that this team breaks rules — on purpose.",
    inspiredBy: "Resn, Instrument, Fantasy, Wieden+Kennedy digital",
    layout:
      "Asymmetric overlapping grids. Oversized typography bleeds off-screen. Work gallery with hover reveals. Horizontal scroll sections.",
    typography:
      "Space Grotesk at 900 weight for hero. Mixed scales (12px and 96px on the same screen). All-caps section labels.",
    color:
      "Pure black #000000 base. Single bright accent (yellow #FFD60A or electric green). White text. Accent only for key moments.",
    motion:
      "Cursor trail effect. Text scramble on hover. Smooth horizontal scroll. Work card: clip-path reveal on hover. Fast (150–200ms).",
    components:
      "Oversized project thumbnails. Roll-over team member cards. Marquee text ticker. Split-screen hero with video.",
    imagery:
      "Full-bleed project photography. Video backgrounds. Bold typographic posters. No stock imagery.",
  },

  glassmorphism_dark: {
    direction: "glassmorphism_dark",
    philosophy:
      "Depth through translucency. Frosted glass layers over rich gradients create an immersive, spatial interface.",
    inspiredBy: "Apple macOS Sonoma, iOS 17, Windows 11 Mica",
    layout:
      "Full-bleed gradient background (purple to indigo to black). Glass cards float at 8–16px offset. Nested glass panels.",
    typography:
      "Outfit or SF Pro-like round sans. Light 300 weight body against dark glass. White headings.",
    color:
      "Deep #0f0c29 → #302b63 → #24243e gradient. Cards: rgba(255,255,255,0.08) + backdrop-filter blur(24px). Purple/pink accent.",
    motion:
      "Card float-in from below. Glass shimmer on hover (background-position shift). Smooth parallax on background layers.",
    components:
      "Glass cards: border rgba(255,255,255,0.12), backdrop-filter blur(24px). Frosted nav. Gradient border glow on CTA.",
    imagery:
      "Blurred gradient meshes as backgrounds. Abstract bokeh. No sharp photography.",
  },

  brutalist: {
    direction: "brutalist",
    philosophy:
      "Anti-aesthetic as aesthetic. Raw HTML energy, exposed structure, and confrontational contrast. Honesty over beauty.",
    inspiredBy: "Brutalist Websites, Bloomberg, archive.org, raw web art",
    layout:
      "Intentionally broken grid. Overlapping elements. Tables used for layout. Heavy borders everywhere. 100vw full-bleed text.",
    typography:
      "Bebas Neue for display at massive sizes. IBM Plex Mono for body. Mixed sizes, all-caps, underlines. No letter-spacing adjustment.",
    color:
      "Pure white #ffffff background. Pure black #000000 text. Single red #FF0000 or yellow accent. No gradients, no shadows (only hard 4px offsets).",
    motion:
      "Hard cuts, no easing. Hover: immediate color inversion. No transitions — or instant (0ms). Intentionally jarring.",
    components:
      "Bordered tables. Text links underlined always. Form inputs with heavy 2px black border. Buttons with hard shadow offset. No rounded corners anywhere.",
    imagery:
      "Black & white photography with dithering. Pixel art. ASCII art. No polished product shots.",
  },

  modern_saas_light: {
    direction: "modern_saas_light",
    philosophy:
      "Light-mode SaaS done right: clean, friendly, and effortlessly polished. The Product Hunt gold standard.",
    inspiredBy: "Notion, Loom, Figma (marketing), Stripe (light), Cron",
    layout:
      "White base. 1200px container. Clear visual hierarchy. Feature grid (3 columns). Testimonial section. Clean pricing table.",
    typography:
      "Geist or Inter at 400/500/600. 3.25rem hero, -0.02em tracking. Body 1rem / 1.6 line-height. Neutral gray scale.",
    color:
      "White #ffffff base. Light gray #f8fafc sections. Blue #3b82f6 primary accent. Gray border #e2e8f0. Never heavy shadows.",
    motion:
      "Fade-in-up on scroll (300ms, ease-out). Button hover: slight darken. Card hover: 2px lift shadow. Smooth, never flashy.",
    components:
      "Rounded cards (12px). Clear pricing toggle. Feature checklist. Testimonial avatars with star ratings. Integration logo grid.",
    imagery:
      "Light-mode app screenshots. Clean vector illustrations. Product UI mockups. Professional team photos.",
  },

  editorial_magazine: {
    direction: "editorial_magazine",
    philosophy:
      "Print-inspired digital typography. The rigor of editorial layout — grids, pull quotes, and hierarchy — brought to screens.",
    inspiredBy: "The New York Times, The Atlantic, Monocle, Wired digital",
    layout:
      "Newspaper-style multi-column grid. Hero: large image + typographic overlay. Article previews in 2–3 column grids. Category navigation bar.",
    typography:
      "Libre Baskerville for headings (bold, authoritative). Source Sans 3 for body (legible at small sizes). All-caps category labels. Generous leading 1.8.",
    color:
      "Warm off-white #f5f5f0 base. Red #c0392b accent (section labels, links). Near-black #1a1a1a text. Sepia tones for image tints.",
    motion:
      "Minimal — this is content-first. Subtle fade on article load. Hover: red underline appears. No entrance animations.",
    components:
      "Drop caps on first paragraph. Pull quotes with large quotation marks. Author byline with avatar. Category pill tags. Reading time badge.",
    imagery:
      "Editorial photography, documentary style. B&W with single color accent. Duotone image treatment. Large full-bleed section images.",
  },

  neon_futuristic: {
    direction: "neon_futuristic",
    philosophy:
      "The future as imagined in a 2080s city. Neon signs against darkness, electric energy, and digital mystique.",
    inspiredBy: "Cyberpunk 2077 UI, tron aesthetics, synthwave music visuals",
    layout:
      "Near-black full canvas. Neon-bordered sections. Hexagonal or angled clip-paths. Glowing grid lines as section dividers.",
    typography:
      "Orbitron for headings (futuristic, geometric). Share Tech Mono for body/data. All-caps with wide tracking. Neon text-shadow glow.",
    color:
      "Near-black #050508 base. Purple #bf5af2 and pink #ff2d78 neon accents. Glow via box-shadow and text-shadow. Never warm colors.",
    motion:
      "Scan-line flicker animation. Neon pulse (keyframe opacity 1→0.7→1). Glitch effect on hero image. Grid line draw-in animation.",
    components:
      "Neon-border cards (box-shadow glow). HUD-style data displays. Progress bars with glow. Angled/clipped hero sections.",
    imagery:
      "Dark cityscape photography, neon light photography, abstract energy renders. No natural imagery.",
  },
};

// ---------------------------------------------------------------------------
// Accessor functions
// ---------------------------------------------------------------------------

/**
 * Returns the brand-style reference for a given design direction.
 */
export function getDesignReferenceForDirection(
  direction: DesignDirection
): DesignReference {
  return DESIGN_REFERENCES[direction];
}

/**
 * Formats a DesignReference as a concise prompt injection string.
 * Keep this compact — it's embedded in the agent system prompt.
 */
export function formatDesignReference(ref: DesignReference): string {
  return `
**Design Style Reference (${ref.direction.replace(/_/g, " ")}):**
Inspired by: ${ref.inspiredBy}
Philosophy: ${ref.philosophy}
Layout: ${ref.layout}
Typography: ${ref.typography}
Color: ${ref.color}
Motion: ${ref.motion}
Components: ${ref.components}
Imagery: ${ref.imagery}
`.trim();
}
