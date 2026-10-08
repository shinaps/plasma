# Shared UI components

Plasma uses the Radix edition of shadcn/ui, adapted to the existing design tokens. Tailwind Preflight stays disabled because Monaco and xterm own their styles. Application controls live in `src/components/ui`; feature code composes these controls rather than recreating native inputs, dialogs, or menus.

## Migration coverage

- Button: React views and imperative editor/terminal controllers share variants and sizing.
- Input / Textarea / Label / Field: project and file search, commit search/message, settings, rename/create dialogs, structure search, annotations.
- Checkbox: Changes tree (including mixed state) and diff hunk inclusion.
- Dialog: file operations, unsaved-edit confirmation, broad-folder confirmation. Cancelling never performs the operation.
- ContextMenu: explorer, editor tabs, recent projects, tool-dock layout menu. Keyboard context-menu invocation is shared.
- Popover / Breadcrumb: code navigation and structure panel.
- ToggleGroup / Toggle styles: layout selection, document preview modes, diff preview/wrapping.
- Alert / Badge / Tooltip: notifications, inline errors, branch labels, React icon actions. TooltipProvider covers imperative-controller portals too.
- Select / Switch / Tabs: existing shared controls remain the source for settings and project/branch selection.

Imperative adapters are limited to DOM owned by a controller. `createTextarea` shares annotation field styles; Toggle adapters share diff-toolbar styling and pressed state. The tool-dock adapter passes the existing header's context-menu event to Radix, which owns placement, dismissal, and keyboard navigation. Diff controls use keyed elements in the existing React portal root rather than a React root per marker.

## Intentional boundaries

- Monaco and xterm internals, diff SVG/overview/scroll mapping, the file TreeView, draggable file/terminal tabs and dock splitters have IDE-specific behavior without an equivalent shadcn component. Replacing them with Tabs, Separator, or Resizable would change content ownership or interaction rather than consolidate duplicate controls.
- Native scrolling containers are not custom ScrollArea implementations. Keep Monaco/xterm scroll ownership and sticky headers.
- Containers and simple spacing do not need Card/Sheet abstractions. File search is a filter, not a Command palette.
- Native `title` remains for full paths/text metadata and controller-owned DOM tooltips. React icon actions opt into the shared Tooltip with `tooltip`. Controller-updated titles and ToggleGroup items retain native titles; Toggle state and Tooltip state must not share the same trigger DOM. File rows do not instantiate a Tooltip for every metadata label.
- Markdown/HTML preview content is user content, not application UI.

`scripts/check-design.ts` rejects raw buttons, form fields, dialogs, native confirm calls, and native popover menus outside the shared UI layer. Keep Radix packages on compatible releases: duplicate focus-scope/dismissable-layer instances can leave the page pointer-locked after a menu opens a dialog.
