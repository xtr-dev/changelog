# Changelog

## [0.0.12] - 2026-10-02

### Fixes
- **release:** anchor the version on versions.json when no tag exists (f0c7573)
- **ci:** run releases on Node 22 so npm@latest installs (18011af)
- **release:** write each changelog section exactly once (1348bef)

### Other
- bump workflow actions to v6 and grant Claude jobs write scopes (9be79d5)

## [0.0.8] - 2026-05-10

### Other
- tighten README with accurate defaults, clarified flow, and troubleshooting (33b9bde)

## [0.0.7] - 2026-05-10

### Other
- add npm version, downloads, and license badges to README (0934f77)

## [0.0.6] - 2026-05-10

### Other
- **ci:** drop redundant push trigger on main (efd2a22)

## [0.0.5] - 2026-05-10

### Fixes
- **git:** use --atomic on push to prevent orphan tags (e40a389)

## [0.0.4] - 2026-05-09

### Features
- **cli:** colorful terminal interface (31753f5)
- initial implementation of @xtr-dev/changelog (69c649a)

### Other
- use npm Trusted Publishing for releases (809ddba)
- enable commit-count bump mode for early dev (3806953)
