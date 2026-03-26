# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-26
**Commit:** beta
**Branch:** maintain/beta

## OVERVIEW

Obsidian plugin for customizing attachment file locations using tokens like `${noteFileName}`, `${date:format}`, etc (typora-like behavior).

## STRUCTURE

```
./
├── src/
│   ├── main.ts              # Entry point → exports Plugin
│   ├── Plugin.ts            # Core (~821 lines)
│   ├── PluginSettings*.ts   # Settings system (3 files)
│   ├── Attachment*.ts       # Core attachment logic
│   ├── Substitutions.ts     # Token system (~708 lines)
│   ├── Commands/            # 4 Obsidian commands
│   ├── Modals/              # 2 modal dialogs
│   ├── i18n/                # 40 locales
│   └── styles/
├── .agents/skills/          # OpenCode agent skills (obsidian-dev)
├── manifest.json            # Plugin manifest
├── eslint.config.mts        # ESLint (obsidian-dev-utils)
├── commitlint.config.ts    # Conventional commits
└── tsconfig.json            # @tsconfig/strictest
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Plugin lifecycle | `src/Plugin.ts` | `onloadImpl()`, `onLayoutReady()` |
| Settings UI | `src/PluginSettingsTab.ts` | ~1000 lines, SettingEx pattern |
| Token substitution | `src/Substitutions.ts` | `${var}` parsing |
| Attachment path | `src/AttachmentPath.ts` | `getAttachmentFolderFullPathForPath()` |
| Attachment collection | `src/AttachmentCollector.ts` | 460 lines, core logic |
| Commands | `src/Commands/` | 4 files, AbstractFileCommandBase pattern |
| i18n | `src/i18n/locales/` | 40 languages |

## BUILD & DEV

```bash
npm run dev              # Development mode
npm run build            # Build plugin
npm run lint:fix         # Auto-fix ESLint
npm run format           # Format code
npm run commit           # Interactive commit (commitizen)
npm run version beta     # Release beta (auto tags git)
```

## OBSIDIAN PLUGIN PATTERNS

**Entry (main.ts)**:
```typescript
export default Plugin;  // MUST be default export
```

**Core class**: `Plugin extends PluginBase<PluginTypes>`

**Settings**: `PluginSettingsManager` + `PluginSettingsTab` + `PluginSettings` triple pattern

**Commands**: Extend `AbstractFileCommandBase<Plugin>`

**Events**: `registerEvent(this.app.workspace.on(...))`

**Monkey patching**: `registerPatch()` from obsidian-dev-utils

## CONVENTIONS (THIS PROJECT)

- ESLint via `obsidian-dev-utils` (not standalone config)
- `@tsconfig/strictest` TypeScript (strict mode)
- Conventional Commits (`type(scope): subject`)
- Husky pre-commit hooks
- ESM modules (`"type": "module"` in package.json)
- No barrel files (index.ts) - direct imports only
- No tests

## ANTI-PATTERNS (ACKNOWLEDGED)

- **Race conditions**: 3 acknowledged in `AttachmentCollector.ts`, `AttachmentPath.ts`
- **Infinite loop**: `getAvailablePath()` in Plugin.ts uses infinite loop for retry
- **eval()**: `new Function()` in `Substitutions.ts` for dynamic token evaluation
- **Magic numbers**: `0.8` (JPEG quality), `5` (timeout) in `PluginSettings.ts`

## I18N

- **40 locales**: ar, be, ca, cs, da, de, en, es, fa, fr, he, hu, id, it, ja, ko, nl, no, pl, pt, ro, ru, th, tr, uk, uz, vi, zh, zh-TW + 12 more
- **Central**: `translationsMap.ts` registers all locales
- **Default**: `default.ts` (English fallback)
- **Import**: `import { t } from 'obsidian-dev-utils/obsidian/i18n/i18n'`

## DEPRECATIONS

- `markdownUrlFormat` tokens `${generatedAttachmentFilePath}`, `${noteFilePath}` deprecated in v9.0.0
- Custom tokens format changed in v9.0.0
