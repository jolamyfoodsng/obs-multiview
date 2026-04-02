# UI/UX Build Standards

Always build interfaces with consistency, restraint, and strong visual hierarchy.

## Primary objective
Create modern, clean, production-ready UI that does not look generic or obviously AI-generated.

## Core rules
- Use a consistent spacing scale: 4, 8, 12, 16, 24, 32, 40, 48
- Prefer clear structure and hierarchy before decoration
- Avoid nested cards unless absolutely necessary
- Avoid thick borders, heavy shadows, and visual clutter
- Avoid pure black for large UI surfaces or text unless needed
- Keep layouts clean, balanced, and intentional
- Use typography to create hierarchy, not random font-size changes
- Use consistent border radius across components
- Use restrained colors and avoid over-designing
- Prioritize usability, readability, and alignment

## Layout rules
- Start with layout and spacing first
- Group related content clearly
- Use whitespace deliberately
- Do not overfill sections
- Prefer simple sections over too many containers
- Maintain consistent horizontal and vertical rhythm

## Typography rules
- Keep a clear hierarchy:
  - Heading
  - Subheading
  - Body
  - Supporting text
- Avoid weak contrast between text and background
- Avoid too many font sizes on one screen
- Headings should feel intentional and confident
- Body text should remain readable and calm

## Component rules
### Buttons
- Keep button sizing consistent
- Primary buttons should be visually clear
- Secondary buttons should not compete with primary actions
- Hover, focus, and disabled states must be designed

### Inputs
- Use clear labels
- Maintain good padding and focus states
- Inputs should feel calm and easy to scan

### Cards
- Prefer one clean container over many layered boxes
- Use subtle borders or very soft shadows only when needed
- Card content should have internal hierarchy and spacing

### Tables and lists
- Prioritize readability
- Use alignment and spacing to reduce noise
- Keep actions obvious but not visually loud

## UX rules
- Every screen should make the next action obvious
- Reduce friction and unnecessary decisions
- Prefer clarity over decoration
- Do not sacrifice usability for visual effects
- Design for real users, not just visual appeal

## Workflow
When generating UI, follow this order:
1. Establish layout and hierarchy
2. Apply spacing system
3. Refine typography
4. Style components cleanly
5. Add subtle polish only where useful
6. Review accessibility and interaction states

## Skill usage
- Use UI Skills during structure, layout, and review
- Use Interface Design memory/system rules for consistency
- Use Emil Kowalski’s skill for final polish, micro-interactions, and refinement
- Do not let polish change the established structure unnecessarily

## Anti-patterns to avoid
- Random padding and margin values
- Overuse of cards
- Overuse of gray-on-colored backgrounds
- Weak text contrast
- Thick borders everywhere
- Too many shadows
- Inconsistent radii
- Over-animated interfaces
- Template-looking SaaS blocks with no hierarchy

## Prompt behavior
When asked to build a UI:
- First produce a strong structural layout
- Then refine spacing and hierarchy
- Then polish details
- Keep output clean, modern, and intentional



## Additional visual constraints

### Spacing density
- Keep spacing tight and efficient, especially in dock-style UI and compact interface areas
- Prefer minimal padding over oversized containers
- Reduce unnecessary gaps between related actions and items
- Use small, controlled spacing that still preserves readability
- Default to compact layouts unless the content clearly needs more room

### Border radius
- Keep border radius minimal across the interface
- Prefer a mostly rectangular appearance
- Use very small rounding only where needed
- Standard radius should stay around 3px
- Avoid overly soft, pill-shaped, or heavily rounded components

### Color usage
- Use normal, grounded, professional colors
- Avoid trendy “AI-looking” palettes that feel synthetic or over-styled
- Prefer clean neutrals and believable accent colors
- Keep contrast strong enough for readability without making the UI harsh
- Use color intentionally, not decoratively

### Visual style restrictions
- Do not use glassmorphism
- Avoid blurred translucent panels, frosted backgrounds, and excessive transparency
- Avoid flashy gradient-heavy surfaces unless explicitly requested
- Keep surfaces solid, clear, and practical
- Favor clean, stable, production-style UI over experimental styling

### Component feel
- Buttons, inputs, cards, tables, sidebars, docks, and panels should feel compact and controlled
- Minimize internal padding where possible without hurting usability
- Avoid bulky containers
- Keep the interface sharp, structured, and efficient