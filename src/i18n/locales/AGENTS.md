# i18n Locales Knowledge

**Scope:** `src/i18n/locales/`

## OVERVIEW

40 language translation files. Central registry in `translationsMap.ts`.

## STRUCTURE

```
src/i18n/locales/
├── translationsMap.ts    # Central locale registry (DO NOT edit manually)
├── default.ts            # English fallback translations
├── en.ts                 # English (alias to default)
└── [locale].ts           # 38 other languages
```

## WHERE TO LOOK

| File | Purpose |
|------|---------|
| `translationsMap.ts` | Register new locales here |
| `default.ts` | Add/edit English strings here |
| `[locale].ts` | Translate existing keys |

## CONVENTIONS

- **Key format**: `section.subsection.keyName`
- **Accessor pattern**: `t($ => $.section.subsection.keyName)`
- **Deprecated keys**: Mark with `deprecated: true` in translation object
- **Migration warnings**: Use `migrationWarning` field for breaking changes

## ADDING NEW TRANSLATION KEYS

1. Add to `src/i18n/locales/default.ts` (English)
2. Add key accessor to `PluginTypes.ts` interface
3. Run `npm run i18n` or rebuild to sync
4. All other locales auto-generate placeholder

## DO NOT

- Edit `translationsMap.ts` manually
- Add keys directly to non-English files (they get overwritten)
- Use complex nested objects (flat key structure preferred)
