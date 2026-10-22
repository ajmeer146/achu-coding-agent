# Complete Master Website Design Guide — A to Z

Canonical website design and quality reference for the Achu Coding Agent (Local and Cloud).

| Field | Value |
| --- | --- |
| Guide version | 1.0.0 |
| Source document | `Complete_Master_Website_Design_Guide_A_to_Z.pdf` |
| Source SHA-256 | `6C13E87F0D247B7072EEAE0C0B9AFA486236859C0C903B69CE78C637889105C4` |
| Runtime module | `src/quality/website-design-guide.ts` |
| Extracted | 2026-10-21 |

A practical, point-by-point reference for planning, designing, building, testing and launching
premium websites.

Use this as a master checklist. Select the requirements that fit the website's actual purpose; not
every feature or effect belongs in every product.

## How to use this guide

- Start with project planning and structure before choosing decorative effects.
- Build a consistent design system before implementing many pages.
- Treat accessibility, responsiveness, performance and security as core requirements — not final add-ons.
- For an existing website, inspect first and preserve working functionality unless a change is explicitly needed.
- Use the acceptance criteria at the end to verify the finished product.

## 1. Project Planning and Design Strategy

- Define the website purpose, primary goals, target audience, user needs and pain points.
- Map the main user journeys and the actions users should complete.
- Research competitors and design references without copying them.
- Define the unique selling proposition (USP), sitemap, content hierarchy and requirements.
- Write acceptance criteria and implementation priorities before building.
- For an existing website, inspect its architecture, components and working features first.

## 2. Unique Visual Identity and Branding

- Create an original design concept, brand personality and consistent visual language.
- Define logo usage, signature visual elements, illustrations and image art direction.
- Keep all pages within one coherent design system while allowing sections to have their own purpose.
- Use inspiration thoughtfully; avoid generic templates and exact copies.
- Do not add visual effects that do not support the brand or content.

## 3. Color System and Themes

- Define primary, secondary, accent, background, surface, border and text colors.
- Define semantic colors for success, warning, error and information.
- Check text/background contrast and avoid relying on color alone to communicate status.
- Support light and dark themes when appropriate, with consistent colors across every component.
- Make theme switching smooth and persist the user's preference when suitable.
- Centralize colors as design tokens instead of scattering hardcoded values.

## 4. Typography System

- Choose readable, professional font families and compatible display/body fonts.
- Set a hierarchy for H1, H2, H3, body, labels, captions and buttons.
- Define font sizes, weights, line heights and letter spacing consistently.
- Use responsive headings that do not overflow on small screens.
- Keep paragraph widths comfortable and optimize font loading with fallbacks.
- Test multilingual text and fonts when the site needs them.

## 5. Spacing and Layout System

- Use a consistent spacing scale, grid, columns, margins and padding.
- Set sensible content-width limits and repeatable alignment rules.
- Keep card spacing, corner radii, shadows and elevation levels consistent.
- Balance whitespace without leaving unnecessary gaps or overcrowding content.
- Position sticky and fixed elements carefully so they never hide important content.
- Create reusable layout tokens for predictable results.

## 6. Website Structure and Information Architecture

- Plan navigation, hero, trust/credibility, features/services, benefits and showcase sections.
- Add how-it-works, demos, case studies, testimonials, pricing and FAQ only when relevant.
- Include contact/conversion sections, a final CTA and a useful footer.
- Create dedicated About, Contact, Pricing, Privacy and Terms pages when needed.
- Give every section a clear purpose and preserve a logical content flow.

## 7. Header and Navigation

- Provide clear branding, desktop navigation and responsive mobile navigation.
- Show active-page states and use dropdowns only where they improve navigation.
- Use sticky headers only when useful and ensure scrolling does not cover content.
- Include relevant theme, profile or account actions where appropriate.
- Support keyboard navigation, visible focus and correct destinations for every link.

## 8. Hero Section and First Impression

- Use a memorable headline, concise supporting text and a clear primary CTA.
- Add a secondary CTA only when it helps the user's decision.
- Use a relevant product preview, illustration, image or 3D visual.
- Balance text and visuals with a distinctive but readable background.
- Make the main message visible early, keep the layout responsive and optimize loading.

## 9. Creative Layout and Composition

- Consider asymmetric layouts, bento grids, split-screen heroes and editorial typography.
- Use layered cards, overlapping visuals, sticky storytelling and interactive showcases selectively.
- Use horizontal galleries only when they remain usable on touch devices and with keyboards.
- Vary section composition without losing visual consistency.
- Adapt layouts to screen size rather than shrinking a desktop design mechanically.

## 10. Animation and Motion Design

- Use purposeful entrance, fade/slide, staggered reveal and scroll-triggered animations.
- Consider animated gradients, subtle ambient effects, image reveals and section transitions.
- Give buttons, icons, menus, dialogs, loading states and success states meaningful feedback.
- Keep timing and easing consistent; do not delay user actions for decorative motion.
- Respect reduced-motion preferences and ensure content remains usable without animation.
- Test motion performance on real mobile devices.

## 11. Advanced Visual Effects

- Use glassmorphism, soft shadows, layered depth, gradient borders and controlled glow sparingly.
- Consider mesh gradients, blur, image masks, parallax, animated typography and reflections.
- Use 3D objects or custom cursor effects only when they add value.
- Maintain contrast and readability over effects.
- Avoid stacking every effect together or adding expensive effects without a clear purpose.

## 12. Micro-interactions and Hover States

- Design button hover/pressed states, card feedback, link transitions and input focus states.
- Add feedback for copy actions, toggles, tabs, accordions, drag-and-drop and notifications when relevant.
- Use tooltips for unclear controls and accessible labels for icon-only buttons.
- Provide touch-friendly alternatives to hover-only behavior.
- Make each interaction consistent and fast, with clear feedback.

## 13. Design System and Reusable Components

- Build reusable buttons, links, cards, panels, forms, modals, drawers and navigation elements.
- Standardize design tokens, component variants, typography and spacing.
- Define hover, active, focus, disabled, loading, success, empty and error states as applicable.
- Use consistent component names and document important variants.
- Keep components maintainable and avoid unnecessary duplication.

## 14. Buttons, Forms and Inputs

- Provide clear primary, secondary and tertiary actions with consistent sizing.
- Use labels, appropriate input types, required indicators and inline validation.
- Design loading, disabled, success and error states.
- Support password visibility controls and file uploads where needed.
- Prevent duplicate submissions and validate data on both client and server.
- Ensure forms are keyboard accessible and errors are clearly explained.

## 15. Images, Icons and Media

- Use relevant, high-quality, original or properly licensed assets.
- Maintain consistent iconography, aspect ratios and image art direction.
- Use responsive images and modern formats such as WebP or AVIF when supported.
- Lazy-load below-the-fold media and prioritize the main hero visual appropriately.
- Provide meaningful alt text and captions/transcripts for relevant media.
- Avoid blurry, stretched, mismatched or decorative stock imagery that adds no value.

## 16. Responsive Design

- Test small and large phones, tablets, laptops, desktops and ultrawide screens.
- Use flexible grids, responsive typography, adaptive navigation and suitable touch targets.
- Prevent horizontal overflow, overlapping content and clipped dialogs.
- Adapt spacing, images, forms and panels to the viewport.
- Test portrait and landscape orientations and real devices where possible.
- Treat responsive design as a deliberate layout, not merely a scaled desktop page.

## 17. Navigation and Page Transitions

- Verify routes, active states, browser back/forward behavior and deep links.
- Use breadcrumbs for complex navigation and restore scroll position where appropriate.
- Keep page transitions smooth and short, without blocking interaction.
- Provide a helpful 404 page and avoid broken routes or unnecessary full reloads.
- Manage focus and screen-reader announcements after navigation when relevant.

## 18. Interactive UI Components

- Use tabs, accordions, dialogs, drawers, dropdowns, command palettes and tooltips as needed.
- Add search, autocomplete, filters, sorting and pagination when useful.
- Make carousels keyboard-accessible and provide appropriate controls.
- Use date pickers, notifications, confirmations and undo actions where relevant.
- Give each component appropriate loading, empty, error and disabled states.

## 19. User Experience and Usability

- Provide clear onboarding and intuitive navigation.
- Minimize steps for common tasks and use clear action labels.
- Give helpful contextual guidance and feedback after important actions.
- Confirm destructive actions and provide recovery options where possible.
- Avoid unnecessary popups, misleading controls and dark patterns.
- Test real user journeys with representative users and improve confusing steps.

## 20. Accessibility

- Use semantic HTML and a logical heading hierarchy.
- Support keyboard navigation, visible focus indicators and adequate contrast.
- Provide screen-reader labels, meaningful alt text and correct ARIA usage when needed.
- Manage modal focus and associate form errors with their fields.
- Support reduced motion, zoom and text resizing.
- Do not communicate status through color alone.
- Target WCAG 2.2 AA where applicable; combine automated checks with manual testing.

## 21. Loading, Error and Feedback States

- Design initial loading, skeleton screens and progress indicators where useful.
- Provide helpful empty states, network errors, retry actions and success confirmations.
- Handle authentication failures, timeouts, offline states and partial failures where relevant.
- Show progress for long-running tasks and allow safe cancellation when supported.
- Preserve user-entered data where safe and provide a clear recovery path.

## 22. Performance Optimization

- Optimize images, fonts, JavaScript bundles and dependencies.
- Use code splitting, lazy loading and caching appropriately.
- Reduce unnecessary rendering, network requests and memory leaks.
- Prefer efficient animation properties such as transform and opacity when suitable.
- Prevent layout shifts and test on slower connections and mobile devices.
- Measure Core Web Vitals: target LCP <= 2.5 s, INP <= 200 ms and CLS <= 0.1 at the 75th percentile.

## 23. Frontend Architecture and Code Quality

- Use a clear folder structure, reusable components and separation of concerns.
- Centralize design tokens and use typed interfaces where appropriate.
- Choose state management that fits the app; keep naming and styling consistent.
- Reuse API utilities and handle errors predictably.
- Avoid giant components, duplicate logic, unused code and unnecessary dependencies.
- Do not expose secrets in client-side code.
- For existing products, preserve working architecture and make incremental changes unless a redesign is explicitly required.

## 24. Backend and Application Functionality

- Implement authentication, sessions, user profiles and permissions when required.
- Design database schemas, migrations and validated API endpoints.
- Enforce authorization on the server and validate uploads securely.
- Implement persistence, search, filtering and pagination as needed.
- Use rate limiting, timeouts, retries and background jobs where appropriate.
- Add logging, monitoring, database optimization and deployment rollback procedures.

## 25. Security and Privacy

- Use HTTPS, secure session management and server-side permission checks.
- Validate inputs and encode outputs; protect against common XSS, CSRF and injection risks.
- Use secure cookies and environment-based secret management.
- Validate file type, size and content; check dependencies for vulnerabilities.
- Configure appropriate security headers and avoid exposing sensitive data in logs.
- Minimize data collection and provide required privacy disclosures.
- Plan backups, recovery, export and account deletion where applicable.

## 26. SEO and Discoverability

- Use unique page titles, useful meta descriptions and semantic headings.
- Create descriptive URLs, canonical URLs where appropriate and an XML sitemap.
- Configure robots directives correctly.
- Add Open Graph metadata and social preview images.
- Use structured data only when appropriate and accurate.
- Provide descriptive image alt text, internal links and search-friendly content.
- Check redirects, 404 handling and analytics/privacy settings.

## 27. Branding Polish and Premium Details

- Polish logo treatment, icons, illustrations, loading screens and empty/error states.
- Use consistent signature colors, imagery and micro-interactions.
- Make the footer and secondary pages feel as complete as the main page.
- Maintain a cohesive experience across all routes and themes.
- Remove placeholders, inconsistent elements and decorative effects that compete with content.

## 28. Website-Specific Functionality

- AI/SaaS: chat streaming, model selection, file processing, history, voice, usage controls and recovery where required.
- E-commerce: product listings, variants, cart, checkout, secure payments, inventory, order tracking and returns.
- Dashboard: workspace navigation, tables, filters, charts, settings, permissions, notifications and keyboard shortcuts.
- Portfolio/business: project showcases, case studies, service details, genuine testimonials, contact forms and lead capture.
- Choose features based on the product; do not force every feature into every website.

## 29. Testing and Quality Assurance

- Test all buttons, links, forms, validation and authentication flows.
- Test API errors, slow connections, loading states and recovery behavior.
- Test responsive breakpoints, supported browsers, themes and reduced motion.
- Test keyboard navigation and basic screen-reader behavior.
- Check overflow, clipping, console errors and broken routes.
- Run linting, type checks and suitable unit, integration and end-to-end tests.
- Verify critical user journeys, production build, security and performance before launch.

## 30. Deployment and Maintenance

- Configure production environment variables, domain, DNS and HTTPS.
- Verify database migrations, API endpoints and OAuth settings.
- Set up error monitoring and uptime checks where appropriate.
- Configure backups, CI/CD checks and a rollback plan.
- Monitor performance, update dependencies and apply security patches.
- Collect user feedback and maintain the website regularly.

## 31. Final Visual Quality Audit

- Check the first-screen impression, section purpose and overall visual hierarchy.
- Verify typography, spacing, image quality, colors and motion consistency.
- Confirm mobile and desktop layouts both feel intentional.
- Check every interaction state and remove placeholders or dead controls.
- Verify there are no major layout shifts, accessibility blockers or broken routes.
- Confirm performance and security issues have been addressed.

## 32. Design Tokens — Starting Examples

- Spacing: 4, 8, 12, 16, 24, 32 and 48 px.
- Border radii: 8, 12, 16 and 24 px.
- Desktop content width: around 1120–1280 px for many layouts.
- Body text: around 14–18 px depending on context.
- Micro-interaction duration: around 150–350 ms as a starting point.
- Use visible high-contrast focus indicators and consistent elevation levels.
- Choose breakpoints based on content needs. Treat these values as examples, not fixed rules.

## 33. Implementation Workflow

1. Research requirements, audience, user journeys and existing architecture.
2. Establish the visual concept and design system.
3. Plan sitemap, page structure, wireframes and content hierarchy.
4. Implement responsive layouts and reusable components.
5. Add purposeful animations and interaction feedback.
6. Connect real functionality, APIs and data where required.
7. Validate accessibility and edge states.
8. Test responsive behavior, critical journeys, security and performance.
9. Fix issues, verify the production build and deploy.
10. Monitor the live product and improve it from feedback.

## 34. Priority Levels

- P0 — Essential: correct structure, working functionality, responsive design, security, accessibility basics and critical bug fixes.
- P1 — Premium polish: typography, visual identity, consistent components, elegant motion, custom visuals and refined interactions.
- P2 — Advanced extras: 3D scenes, complex parallax, custom cursors, cinematic transitions and immersive storytelling when they add real value.

## 35. Master Acceptance Criteria

- Unique and cohesive visual identity with clear structure and navigation.
- Consistent typography, colors, spacing and purposeful animations.
- Responsive layouts and functional buttons, links, forms and components.
- Correct loading, empty, error and success states.
- Keyboard accessibility, reduced-motion support and readable contrast.
- Optimized performance, secure functionality and appropriate SEO.
- Critical user journeys pass, no critical console errors or broken routes, and production build succeeds.
- Deployment configuration is verified, and existing functionality is preserved during upgrades.

## Final Principle

A master-quality website is not defined by how many animations or effects it contains. It is the result
of a distinctive visual identity, thoughtful structure, purposeful motion, excellent usability,
accessibility, performance, reliable functionality, security and thorough testing working together.

---

# Complete Website Development Guide — 50 Essential Principles

Version: 2.0.0
Runtime implementation: `src/quality/website-design-guide.ts`

The agent evaluates every user request against these 50 principles across 6 phases, determining applicability and executing mandatory quality gates.

### Phase 1 — Planning and Architecture
1. **Purpose and Goals**: Define the website's purpose, target users, goals, and expected outcomes.
2. **Requirements Extraction**: Extract functional requirements, non-functional requirements, technical constraints, and integrations.
3. **Information Architecture**: Establish the required pages, sections, features, user journeys, and application states.
4. **Navigation Structure**: Create a logical sitemap and navigation hierarchy.
5. **Content Planning**: Plan page wireframes and content hierarchy before writing production UI code.

### Phase 2 — UI/UX Design and Visual Consistency
6. **Design System**: Establish a coherent design system with reusable tokens and components.
7. **Color System**: Select an attractive, purpose-appropriate colour palette with accessible contrast.
8. **Typography**: Define consistent typography, heading hierarchy, font sizes, and line heights.
9. **Visual Alignment**: Apply consistent alignment and visual hierarchy across every page.
10. **Spacing Scale**: Use a consistent spacing scale and eliminate arbitrary gaps.
11. **Responsive Containers**: Establish responsive containers, grids, columns, and content-width rules.
12. **Multi-Viewport Design**: Design for mobile phones (320-375px), standard mobile (390-430px), tablets (768px), laptops (1280-1440px), and wide desktop (1920px).
13. **Meaningful Navigation**: Ensure all navigation elements have meaningful destinations and work correctly.
14. **Component Consistency**: Create reusable, consistent buttons, cards, forms, dialogs, menus, and feedback components.
15. **Compelling Hero/Entry**: Design a compelling homepage or primary landing page appropriate to user requirements.

### Phase 3 — Frontend Development and Interactions
16. **Modular Architecture**: Organize components, pages, hooks, utilities, styles, and assets cleanly.
17. **Actionable Controls**: Make every visible button perform its intended action.
18. **Form Validation**: Implement meaningful validation for all applicable forms.
19. **Interactive Widgets**: Implement working tabs, menus, accordions, dialogs, filters, search, pagination.
20. **Purposeful Motion**: Add purposeful transitions, animations, hover effects, and micro-interactions (prefers-reduced-motion).
21. **Theme Switching**: Implement functional light and dark themes when required or when theme switching is offered.
22. **Accessibility Standards**: Follow accessibility principles (semantic HTML, keyboard support, focus states, labels, contrast).
23. **Asset Optimization**: Use appropriate images, optimized assets, consistent icons, and layout-stable containers.
24. **State Consistency**: Keep UI state, navigation state, form values, and server data consistent.
25. **Application States**: Implement loading, success, error, empty, disabled, offline, and no-results states.

### Phase 4 — Backend, Database, and Security
26. **Server Business Logic**: Implement reliable server-side business logic and a clear separation of concerns.
27. **API Design**: Use appropriate API endpoints, HTTP methods, validation, response formats, and status codes.
28. **Database Persistence**: Use a suitable database schema, relationships, constraints, and indexes when persistence is required.
29. **Schema Migrations**: Implement and verify versioned database migrations and production schema compatibility.
30. **Secure Authentication**: Implement secure authentication and session behaviour when required.
31. **Authorization**: Enforce server-side authorization and ownership checks for protected operations.
32. **Threat Controls**: Apply appropriate security controls for injection, XSS, CSRF, and access control.
33. **Secret Protection**: Protect credentials and secrets using appropriate server-side configuration.
34. **Upload Validation**: Validate uploads, file types, sizes, storage permissions, and download access.
35. **Resilient Failure Handling**: Handle network errors, timeouts, database failures, rate limits, and outages safely.

### Phase 5 — Performance, Testing, and Deployment
36. **Performance Optimization**: Optimize loading performance, rendering, assets, database access, and unnecessary JavaScript.
37. **SEO & Metadata**: Implement appropriate page metadata, semantic content, canonical URLs, and sitemap support.
38. **Multi-Viewport Testing**: Test browser compatibility and different viewport sizes (320px to 1920px).
39. **Journey Testing**: Test every important page, link, button, form, API integration, and user journey.
40. **Automated Testing**: Add and run appropriate unit, integration, and end-to-end tests.
41. **Accessibility Verification**: Verify keyboard navigation, form labels, focus order, contrast requirements.
42. **Performance Measurement**: Measure relevant performance indicators and investigate meaningful bottlenecks.
43. **Environment Isolation**: Validate environment-specific configuration for development, testing, preview, and production.
44. **Build Verification**: Verify production builds, environment configuration, migrations, and deployment logs.
45. **Release Quality Gates**: Integrate appropriate automated validation into CI/CD and block releases on critical failures.

### Phase 6 — Reliability, Maintenance, and Final Quality
46. **Sanitized Logging**: Provide useful application logging and monitoring without exposing sensitive information.
47. **Backup and Recovery**: Preserve or establish suitable backup and recovery procedures for persistent data.
48. **Scalable Design**: Design for reasonable scalability and reliability without unnecessary complexity.
49. **Regression Protection**: Maintain dependencies, documentation, error fixes, and regression tests.
50. **Final Quality Audit**: Conduct a final production-quality audit covering 12 independent categories before release.

### 12-Category Quality Scoring System
1. Information architecture and content hierarchy
2. Visual design and design-system consistency
3. Alignment, spacing, typography, and grid quality
4. Colour consistency and visual accessibility
5. Desktop layout quality (1024-1920px)
6. Mobile and tablet layout quality (320-768px)
7. Navigation and interaction completeness
8. Functional correctness and data flow
9. Error handling and application-state coverage
10. Accessibility and keyboard usability
11. Performance and asset optimization
12. Security and deployment readiness

