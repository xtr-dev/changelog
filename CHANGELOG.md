# Changelog

## [0.0.27](https://github.com/xtr-dev/changelog/compare/v0.0.12...v0.0.27) - 2026-10-02

### Features
- ship JSON schemas for versions.json and the config ([b37f152](https://github.com/xtr-dev/changelog/commit/b37f1523dff6197db39f9089271caad289d76be2))
- **cli:** strict flags, library git steps, notes command ([ef942ac](https://github.com/xtr-dev/changelog/commit/ef942ac87f4f086bd7fc4f165e146977466f9db7))
- **format:** link commits, issues and version comparisons ([77cac7d](https://github.com/xtr-dev/changelog/commit/77cac7d6d2957d9f93bc1aed003f13074f2f1ebf))
- **parse:** cancel reverted commits within a release ([b45f6b6](https://github.com/xtr-dev/changelog/commit/b45f6b680d7f51de489415af23728a5e9bcde147))
- pre-releases, --release-as, and a way out of 0.x ([7044507](https://github.com/xtr-dev/changelog/commit/704450743f91bbd9110114adbbf38aac82f80eca))

### Fixes
- **action:** stop shell injection and pin the CLI to the action's ref ([3b6467c](https://github.com/xtr-dev/changelog/commit/3b6467c778c3ea9f533c1a6626626860412908ff))
- **config:** reject unknown keys and wrong types ([9633496](https://github.com/xtr-dev/changelog/commit/9633496ed4f4287e704e30112fa29873969f6fff))
- **release:** keep CHANGELOG.md history and bump package-lock.json ([6810976](https://github.com/xtr-dev/changelog/commit/68109769b94bd965df83d94a25851650f766cd8e))
- **release:** start untagged scans at the last recorded release ([ab12c4b](https://github.com/xtr-dev/changelog/commit/ab12c4b2520d2101cad9c8e9d6270c88b135592c))
- **git:** only use tags reachable from HEAD and surface git errors ([caa733d](https://github.com/xtr-dev/changelog/commit/caa733de33bebdd805295ffce3eb66637ea54036))

### Other
- give temp repos a local git identity ([ab68131](https://github.com/xtr-dev/changelog/commit/ab6813115547473ecb68b053035d5636e726e124))
- document the new behaviour and options ([9e54788](https://github.com/xtr-dev/changelog/commit/9e54788a54bd8f6b1d596b64128ae300b778b19e))
- **release:** cover releasing one package of a monorepo ([5abf89f](https://github.com/xtr-dev/changelog/commit/5abf89f983359a9bf9172f582c3cc3306fb23771))
- lint, Node 24, an action test, and publish before push ([fe0e2e5](https://github.com/xtr-dev/changelog/commit/fe0e2e521bdd639b044edab542e6d72b66269756))
- add Biome lint/format, coverage, and typecheck the tests ([e224a7a](https://github.com/xtr-dev/changelog/commit/e224a7a8cbd5f6f93c883631a8e4f5c4e82e5de3))

## [0.0.12](https://github.com/xtr-dev/changelog/compare/v0.0.8...v0.0.12) - 2026-10-02

### Fixes
- **release:** anchor the version on versions.json when no tag exists ([f0c7573](https://github.com/xtr-dev/changelog/commit/f0c7573))
- **ci:** run releases on Node 22 so npm@latest installs ([18011af](https://github.com/xtr-dev/changelog/commit/18011af))
- **release:** write each changelog section exactly once ([1348bef](https://github.com/xtr-dev/changelog/commit/1348bef))

### Other
- bump workflow actions to v6 and grant Claude jobs write scopes ([9be79d5](https://github.com/xtr-dev/changelog/commit/9be79d5))

## [0.0.8](https://github.com/xtr-dev/changelog/compare/v0.0.7...v0.0.8) - 2026-05-10

### Other
- tighten README with accurate defaults, clarified flow, and troubleshooting ([33b9bde](https://github.com/xtr-dev/changelog/commit/33b9bde))

## [0.0.7](https://github.com/xtr-dev/changelog/compare/v0.0.6...v0.0.7) - 2026-05-10

### Other
- add npm version, downloads, and license badges to README ([0934f77](https://github.com/xtr-dev/changelog/commit/0934f77))

## [0.0.6](https://github.com/xtr-dev/changelog/compare/v0.0.5...v0.0.6) - 2026-05-10

### Other
- **ci:** drop redundant push trigger on main ([efd2a22](https://github.com/xtr-dev/changelog/commit/efd2a22))

## [0.0.5](https://github.com/xtr-dev/changelog/compare/v0.0.4...v0.0.5) - 2026-05-10

### Fixes
- **git:** use --atomic on push to prevent orphan tags ([e40a389](https://github.com/xtr-dev/changelog/commit/e40a389))

## [0.0.4] - 2026-05-09

### Features
- **cli:** colorful terminal interface ([31753f5](https://github.com/xtr-dev/changelog/commit/31753f5))
- initial implementation of @xtr-dev/changelog ([69c649a](https://github.com/xtr-dev/changelog/commit/69c649a))

### Other
- use npm Trusted Publishing for releases ([809ddba](https://github.com/xtr-dev/changelog/commit/809ddba))
- enable commit-count bump mode for early dev ([3806953](https://github.com/xtr-dev/changelog/commit/3806953))
