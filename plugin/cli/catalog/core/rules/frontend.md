---
id: core-frontend
title: Frontend, UI and i18n
categories: [frontend, fullstack]
---
# Frontend, UI and i18n

## Essentials

- Meet WCAG 2.1 AA: semantic HTML and full keyboard navigation.
- Use design tokens for colors and spacing; never hardcode them.
- Handle loading, empty and error states for every async UI.
- Route all user-facing text through an i18n catalog (keys, not literals), even for a single language.
- Use ICU MessageFormat for plurals and gender, and never concatenate translated fragments.
- Format dates, numbers, currency and units with locale APIs (`Intl`), never by hand.
- Support RTL with logical CSS properties (`margin-inline`, `text-align: start`) and the `dir` attribute.
- Let layouts tolerate roughly 30-40% text expansion; avoid fixed-width controls that clip translations.
- Use UTF-8 everywhere, correct `lang` attributes, and no text baked into images.
- Give translators context per key and never reuse one key across contexts.

## Detail

- Fail the build on literal UI text with a lint rule.
- Use pseudolocalization in QA to catch hardcoded strings and truncation before real locales exist.
- Test RTL with Arabic or Hebrew.
