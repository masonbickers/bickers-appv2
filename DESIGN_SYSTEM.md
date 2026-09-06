# Bickers visual language

This contract governs every employee and workshop interface. The shared
foundations live in `lib/design`, `providers/ThemeProvider.tsx`,
`components/layout/PageShell.tsx`, and `components/ui/AppPrimitives.js`.
Screens compose those foundations; they do not create competing visual rules.

## Principles

- Light and dark appearance are equally supported.
- Use the native system font on every platform. Do not add a screen-level
  `fontFamily`.
- `#ED1C25` is the sole primary brand accent. Interface code uses semantic
  theme names such as `accent`, `text`, `surface`, `danger`, and `success`.
- Employee routes use standard density. Workshop routes under `/service/*`
  use compact density.
- Flat sections are the default. Cards represent independent records,
  selectable actions, or self-contained summaries—not ordinary form steps.
- All interactive targets are at least 44pt.

## Foundations

### Spacing

Use only the shared scale: `0, 2, 4, 8, 12, 16, 20, 24, 32, 40`.
Values above 40 are reserved for structural clearances such as safe areas,
navigation, large media, and scroll endings.

### Density and controls

| Density | Routes | Control height | Card padding | Section gap |
| --- | --- | ---: | ---: | ---: |
| Standard | Employee | 48 | 16 | 16 |
| Compact | Workshop/service | 44 | 12 | 12 |

Compact layouts reduce whitespace, never touch-target size. `PageShell`
resolves the workspace default; explicit overrides are temporary migration
exceptions and must be named in the design-system test allowlist.

### Corner radius by purpose

| Purpose | Radius |
| --- | ---: |
| Nested compact control | 8 |
| Button or field | 12 |
| Independent record/action card | 14 |
| Modal or hero surface | 18 |
| Circular icon button | Circle |
| Chip, badge, or bottom navigation | Pill |

Screens must not choose radii decoratively. Use the component for the intended
purpose and let it apply the mapped radius.

### Typography

Use `AppText` variants. `tone` and `align` are the only appearance choices.
`layoutStyle` may control layout and truncation, but must not redefine colour,
font size, line height, letter spacing, weight, or family.

| Variant | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `micro` | 9 / 11 | 700 | Dense auxiliary labels |
| `caption` | 11 / 14 | 600 | Supporting copy |
| `metadata` | 12 / 16 | 600 | Dates, counts, identifiers |
| `formLabel` | 13 / 18 | 700 | Persistent field labels |
| `body`, `bodyStrong` | 14 / 20 | 400 / 700 | Default content |
| `bodyLarge` | 16 / 22 | 400 | Emphasised body content |
| `sectionTitle` | 17 / 22 | 800 | Section headings |
| `titleSmall` | 20 / 26 | 800 | Compact page titles |
| `pageTitle` | 24 / 30 | 900 | Hero page titles |
| `display` | 30 / 36 | 900 | Rare dashboard emphasis |
| `button` | 14 / 20 | 800 | All labelled buttons |

## Component contracts

### Pages and surfaces

- Use `PageShell` for safe areas, responsive gutters, width constraints,
  scrolling, keyboard avoidance, refresh, and asynchronous page states.
- Use `PageSection` for continuous content. It may use a heading and divider,
  but has no surrounding card surface.
- Use `FormStep` for numbered workflows. Its rail connects related fields
  without wrapping each step in a card.
- Use `SectionCard` only for an independent record, selectable action, or
  self-contained summary. Default cards are flat, bordered, and shadow-free.
- Use `ListRow` for record-shaped list content. It owns selected, disabled,
  divider, status, metadata, trailing content, chevron, and full-row action
  behaviour; screens only arrange rows.
- Shadows are reserved for modals, floating navigation, and transient overlays.

### Buttons

Use `AppButton` or `IconButton`; do not rebuild button visuals in a screen.

- `primary`: accent fill with inverse text.
- `secondary`: alternate surface, standard border, primary text.
- `ghost`: transparent surface and border with accent text.
- `danger`: danger fill with inverse text.
- Standard buttons are 48pt; compact and icon buttons are 44pt.
- Icon buttons are circular; screens must not stretch or reshape them.
- Loading, disabled, pressed, focus, icon sizing, and action locking belong to
  the shared component.
- Both button types await asynchronous actions and reject duplicate taps.
  Handle rejected actions through `onError(error)`; do not recreate pending
  state solely to lock a shared button.

### Forms

- Use `FormField`, `TextArea`, `SelectField`, `DateField`, and
  `SegmentedControl`.
- Every field has a persistent label; placeholder text never replaces a label.
- Fields use a 1pt semantic border, 12pt radius, density-based height, and a 2pt
  focus ring. Errors use `danger`; disabled fields retain readable contrast.
- `SelectField` owns its selector when given controlled `value`, `onChange`, and
  `{ label, value, description?, disabled?, keywords? }[]` options. Search,
  loading, empty, long-list, and disabled-option states stay inside the field.
- `DateField` owns its calendar and exchanges local dates only as canonical
  `YYYY-MM-DD` strings. Minimum, maximum, disabled, and clearable states belong
  to the field; screens must not apply timezone conversion.
- Screen styles may position fields but must not restyle their typography,
  colours, radius, border, or height.
- Use `AppCalendar` for calendar grids and `ToggleRow` for labelled boolean
  settings. Calendar theme objects and local switch colours are not screen APIs.

### Media and identity

- Use `Avatar`, `IconBadge`, and `MediaThumbnail` for identity, icon, and media
  presentation. Screens may own media dimensions and aspect ratio through
  `layoutStyle`; borders, overlays, fallbacks, and badges belong to the shared
  primitive.
- Fixed brand artwork belongs in `components/renderers`. A renderer may contain
  the exact colours required by an artwork, chart, or document canvas, but it
  must not export a general-purpose palette to application code.

### Feedback, status, and modals

- Use `Banner` for semantic information, success, warning, and danger feedback.
  Actions and dismissal use its shared affordances.
- Use `StatusChip` and the central status palette for workflow state. Never
  infer status colours in a screen.
- Use `StateView` or `PageShell.state` for loading, empty, error, success, and
  retry UI.
- Use `AppModal` and `ConfirmDialog` for editor, picker, detail, and
  confirmation overlays. Use `MediaViewerModal` for full-screen receipt and
  inspection media; media must not be forced into a dialog-shaped surface.
- Modals use the elevated surface, 18pt radius, semantic overlay, shared
  header, scrollable body, and ordered actions. Presentation is a bottom sheet
  on phones and a centred dialog on tablet/web. Busy confirmations cannot
  dismiss or submit twice.

### Interaction states

- Visual state resolves in one order: `error → focused → selected → default`.
- Disabled and loading states block input, expose the matching accessibility
  state, and apply the shared inactive opacity.
- Screens may provide business validation and action callbacks; they must not
  reproduce shared pressed, focused, disabled, loading, or error visuals.

### Navigation

- Employee and service workspaces use one opaque floating-pill bottom bar.
- The bar is 68pt high, no wider than 520pt, and supports at most five tabs.
- Icons, labels, badges, selected state, focus, and haptics belong to
  `BottomNavigationBar`.
- Navigation always uses semantic theme surfaces in both appearances.

## Approved examples

```jsx
<PageShell mode="form" width="form" header={header}>
  <PageSection title="Asset details">
    <FormStep number={1} title="Vehicle" hint="Select the affected asset">
      <SelectField
        label="Vehicle"
        value={vehicleId}
        options={vehicleOptions}
        onChange={setVehicleId}
        searchable
      />
    </FormStep>
    <FormStep number={2} title="Issue" last>
      <TextArea label="Description" value={issue} onChangeText={setIssue} />
    </FormStep>
    <AppButton label="Report issue" icon="send" onPress={submit} fullWidth />
  </PageSection>
</PageShell>
```

```jsx
<SectionCard accessibilityLabel="Vehicle AB12 CDE">
  <AppText variant="bodyStrong">AB12 CDE</AppText>
  <StatusChip label="Maintenance" tone="maintenance" />
</SectionCard>
```

## Prohibited patterns

- Local `COLORS` or general-purpose palettes.
- `staticColors` for ordinary interface styling.
- Raw or screen-selected colours, font metrics, radii, control heights, or
  standard spacing.
- Directly styled generic buttons, inputs, cards, status pills, or modals.
- React Native `TextInput` or `Modal` imports in screens; shared controls own
  field states, async locking, focus, errors, and adaptive overlays.
- Cards used only to separate consecutive fields or text sections.
- Platform-specific visual variants that weaken light/dark parity.
- Passing arbitrary visual `style` overrides into shared primitives. Use
  explicit semantic props plus `layoutStyle`.

## Screen styling boundary

Screen-owned styles are layout only. Approved properties cover flex/grid
arrangement, alignment, positioning, token-based spacing, responsive
dimensions, aspect ratio, overflow, and transforms. Colours, borders, shadows,
opacity, radii, font metrics, and component chrome belong to the semantic theme
or a shared primitive.

The local ESLint design-system rules apply immediately to new routes and every
route marked complete in `tests/designSystemMigrationManifest.js`. Pending
routes may retain only the exact exceptions already named in
`tests/designSystemLegacyBaseline.js`; those sets can shrink but cannot grow. A
route cannot be marked complete until all of its exception categories are gone.

Existing legacy exceptions are recorded by exact file path in the automated
design-system baseline. The baseline may shrink during migration and must never
grow without an explicit contract change.

## Automated enforcement

- Every UI-bearing route must import and render `PageShell`. Structural routes
  such as layouts, redirects, aliases, and full-screen media viewers must be
  listed with a reason in `scripts/design-system/enforcement-config.cjs`.
- Routes never pass a `density` prop. `resolvePageDensity` selects standard for
  employee routes and compact for `/service/*` routes, and repository tests
  verify every registered route.
- React Native `TextInput` is owned only by the exact shared implementation
  paths in the enforcement registry. Direct, aliased, namespace, and JSX access
  elsewhere fails lint.
- Screens may use only semantic `colors.<name>` members and literal approved
  `AppText` variants. Computed colour access, unknown semantic names, dynamic
  screen variants, fixed interface colours, and local generic control chrome
  fail lint.
- Permanent fixed-colour renderers require an exact path, one of the approved
  `chart`, `document`, or `brandArtwork` categories, and a justification. An
  application screen can never be a permanent renderer exception.

## Visual regression checks

`npm run test:visual` builds the deterministic visual export and compares the
five fixture scenarios in light and dark at 390×844 and 820×1180. Chromium uses
device scale factor 1, disables animations, hides carets, and waits for fonts.
The resulting 20 committed baselines fail when more than 0.5% of pixels differ.

Baselines never update during normal tests. Use
`npm run test:visual:update` deliberately, then review every changed image and
diff artifact before committing. Visual-test authentication bypass is limited
to the two exact showcase routes and is enabled only when
`EXPO_PUBLIC_VISUAL_TEST_MODE=1`; ordinary and production exports fail closed.
