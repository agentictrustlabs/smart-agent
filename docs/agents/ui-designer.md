# UI Designer Agent

## Role
Visual design quality, component architecture, and UX consistency across all hub interfaces.

## Architecture Context

Start UX architecture work from `docs/architecture/INDEX.md`, especially
`docs/architecture/09-user-experience-architecture.md` and
`docs/architecture/06-marketplace-funding-flow.md`. Keep navigation, action
center, funding, credential, treasury, and confirmation patterns aligned with
those docs.

Role-specific architecture files:
- `docs/architecture/09-user-experience-architecture.md` — UX mental models, labels, navigation, action center.
- `docs/architecture/06-marketplace-funding-flow.md` — funding, grants, proposals, voting, commitments, pledges.
- `docs/architecture/02-auth-session-delegation.md` — permission and consent UX.
- `docs/architecture/05-persistence-data-stores.md` — source-of-truth concepts that affect labels and states.
- `docs/architecture/10-operational-architecture.md` — readiness and error-state expectations.

## Workflow: Division of Labor

### Creative Visual Design → Cursor / GPT / Lovable
Use design-focused tools for:
- Color palette creation and refinement
- Visual hierarchy and spacing rhythm
- Typography pairings
- Component visual polish (shadows, gradients, border radius)
- Landing page layouts and hero sections
- Card designs, button styles, hover effects
- Overall "feel" and aesthetic direction

### Architecture & Wiring → Claude Code
Claude Code handles:
- Component architecture (shadcn/ui + Tailwind)
- State management and API integration
- Design token system (CSS variables, hub theming)
- Responsive breakpoints and mobile layouts
- Accessibility (WCAG 2.1 AA, aria labels, focus states)
- Playwright click-through tests
- Wiring creative designs into the codebase
- Data flow and server actions

## Design System

### Framework
- **Tailwind CSS v3** — utility-first styling
- **shadcn/ui** — Radix primitives + Tailwind components
- **CSS variables** — hub-specific theming via `[data-hub]`

### Hub Config Properties
Each hub in `lib/hub-routes.ts` defines:
- `color` — primary brand color
- `colorSoft` — light tint for containers/badges
- `surfaceTint` — subtle background tint for selected states
- `heroGradient` — gradient for landing page backgrounds
- `eyebrow` — descriptive label above hub name

### Component Library (`components/ui/`)
- `Button` — filled, tonal, outlined, text, destructive, ghost variants
- `Card` — with Header, Title, Description, Content, Footer
- `Input` — with label, helperText, error states
- `Badge` — agent types, status, .agent name
- `Dialog` — Radix-based with overlay animations
- `Textarea` — with label and error states
- `KpiCard` — metric display cards

### Color System
Colors are defined as CSS variables in `globals.css` `:root` and overridden per hub:
- M3 tonal palette generated from Material Theme Builder
- Each hub has distinct primary color with matched container/surface variants
- WCAG AA contrast ratios enforced (4.5:1 text, 3:1 large text)

## Review Checklist
- [ ] Uses Tailwind classes (no inline `style={}` for layout/spacing/colors)
- [ ] Uses M3 typography scale tokens
- [ ] Uses semantic color tokens from hub config
- [ ] Has visible hover + focus states with contrast
- [ ] Responsive at 375px, 768px, 1024px, 1280px
- [ ] Loading states for async operations
- [ ] Error states for form validation
- [ ] Creative visual refinement done in Cursor/GPT
