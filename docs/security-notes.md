# Security notes (known dependency risks)

All app-layer controls are in the code; this file records the two
transitive advisories `npm audit` reports and why CI treats them this way.

## Fixed: multer file-upload DoS chain (GHSA-wc9g-mqfw-jrwm and 3 related)

- `@nestjs/platform-express@11.2.5` pins `multer@2.2.0`, which has 4
  high-severity advisories (crafted multipart DoS, fd leak, size-limit bypass).
- Fix: root `package.json` has `"overrides": { "multer": "^2.4.0" }`, so the
  nested copy dedupes to the patched 2.4.0. Verified with `npm ls multer`
  and the document-upload e2e lifecycle tests.
- Defense in depth (independent of the library fix): 5MB cap
  (`documents.controller.ts` + `documents.service.ts`), PDF/PNG/JPEG
  allowlist + magic-byte check, 20/min upload throttle, 50MB/user quota.

## Accepted risk: deepmerge-ts via Prisma CLI (GHSA-ggr8-5vv4-36mx)

- `deepmerge-ts <8.0.0` (stack exhaustion on recursive graphs) is reachable
  only through `prisma` (the dev-time CLI) via `@prisma/config`. It never
  runs in the API, never touches user input, and never ships to anyone
  cloning this repo — `prisma/` migrations and the generated client are
  unaffected at runtime.
- The published fix is a Prisma **downgrade** to 6.12.0 (breaking), which is
  a worse trade than the advisory itself. Revisit in week-5 if Prisma ships
  a patched 6.x.
- CI reflects this honestly: the full `high+` report runs as an advisory
  step (visible in logs), and the blocking gate fails only on `critical`.

## Reproduce

```bash
npm ls multer                    # must show 2.4.0 deduped, no nested 2.2.0
npm audit --audit-level=high     # expect only the deepmerge-ts chain
npm audit --audit-level=critical # must exit 0 (this is the CI gate)
```
