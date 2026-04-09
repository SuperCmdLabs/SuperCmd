# Internationalization Architecture

## Goals

- Keep the first rollout small and reviewable.
- Ship app-level localization for English, Simplified Chinese, Traditional Chinese, Japanese,
  Korean, French, German, and Spanish.
- Make future locale additions a resource-only change whenever possible.

## Current Design

- Persist the user preference as `appLanguage` in `settings.json`.
- Accept `system`, `en`, `zh-Hans`, `zh-Hant`, `ja`, `ko`, `fr`, `de`, and `es`.
- Resolve `system` at runtime from the renderer locale.
- Store translatable copy under `src/renderer/src/i18n/`.
- Use English as the fallback locale for missing keys.
- Keep interpolation simple with `{token}` placeholders.

## Runtime Flow

1. The main process loads and saves `appLanguage` alongside existing app settings.
2. The renderer root wraps every surface with `I18nProvider`.
3. `I18nProvider` listens to `getSettings()` and `settings-updated`.
4. Components call `useI18n().t("namespace.key")`.
5. When a key is missing in the active locale, the runtime falls back to English.

## Adoption Rules

- Add all new user-facing copy through `i18n` resources.
- Keep locale strings inside `src/renderer/src/i18n/` so review scope stays explicit.
- Prefer stable keys grouped by feature (`settings.general.*`, `common.*`).
- Start with shared surfaces first, then expand feature-by-feature.
- Treat Korean (`ko`) as a release-quality locale: no mixed-language strings, no untranslated placeholders, and no obvious machine-translation artifacts on core surfaces.

## Next Suggested Expansions

- Migrate onboarding and prompt surfaces to `useI18n`.
- Add locale-aware date and number formatting helpers that reuse the resolved app locale.
- Run `npm run check:i18n` before shipping locale changes to catch missing or extra keys.
