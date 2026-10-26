# Contributing to Blinkql

Thanks for your interest in Blinkql. Contributions of every size are welcome, and you don't need to write code to make a difference. This file is a summary; the full guide is the [Contributing](https://github.com/Karthik-beta/Blinkql/wiki/Contributing) wiki page.

## Ways to contribute

- **Report bugs.** Open an [issue](https://github.com/Karthik-beta/Blinkql/issues/new/choose) with steps to reproduce, your browser and, if you can, a small synthetic sample file.
- **Suggest features and use cases.** Start a thread in [Discussions](https://github.com/Karthik-beta/Blinkql/discussions).
- **Run the benchmarks on your hardware.** See [bench/README.md](bench/README.md) and [Performance & Benchmarks](https://github.com/Karthik-beta/Blinkql/wiki/Performance-and-Benchmarks), and share your results.
- **Share sample datasets and analysis templates** from your field: manufacturing, logistics, retail, finance or healthcare operations. Synthetic data only.
- **Write code.** Pick an issue labelled [`good first issue`](https://github.com/Karthik-beta/Blinkql/issues?q=is%3Aopen+label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/Karthik-beta/Blinkql/issues?q=is%3Aopen+label%3A%22help+wanted%22).
- **Improve the documentation**, in this repository or the [wiki](https://github.com/Karthik-beta/Blinkql/wiki).
- **Review accessibility.** Try it with a keyboard or a screen reader and report what's hard to use.
- **Review the design and UX** against the [Design Language](https://github.com/Karthik-beta/Blinkql/wiki/Design-Language).

> **Never share real personal or confidential data** in issues, discussions or pull requests. Use synthetic data that reproduces the shape of the problem.

## Development setup

You need Node.js 26 (the version in `.nvmrc`) and pnpm. Node 26 no longer bundles Corepack, so install pnpm yourself, at the version pinned in `package.json`'s `packageManager` field: `npm install --global pnpm@12.11.2`.

```bash
git clone https://github.com/Karthik-beta/Blinkql.git
cd Blinkql
pnpm install
pnpm dev
```

The dev server starts at http://localhost:5173. `pnpm install` also installs the git hooks.

| Script | What it does |
|---|---|
| `pnpm typecheck` | TypeScript, strict mode |
| `pnpm check` | Biome lint, formatting and import order (`pnpm check:fix` applies fixes) |
| `pnpm test` | Unit and integration tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests on Chromium, Firefox and WebKit (Playwright) |
| `pnpm build` | Production build |
| `pnpm size` | Bundle size budgets, after `pnpm build` (size-limit) |
| `pnpm lhci` | LCP and CLS budgets for `/` and `/app/`, after `pnpm build` (Lighthouse CI) |
| `pnpm bench` | Benchmark suite (see [bench/README.md](bench/README.md)) |
| `pnpm bench:data` | Generate the benchmark datasets |
| `pnpm bench:smoke` | A short benchmark run against generous ceilings, after `pnpm build` |

Before your first `pnpm test:e2e`, download Playwright's browsers with `pnpm exec playwright install`. End-to-end tests run against the production build, which Playwright starts for you.

## Workflow

1. **Discuss big changes first.** For anything beyond a small fix, open an issue or a discussion so no effort is wasted.
2. **Fork and branch from `main`**, for example `feat/csv-dialect-override`, `fix/grid-scroll-jump`, `perf/arrow-lazy-cells` or `docs/use-case-logs`.
3. **Commit with [Conventional Commits](https://www.conventionalcommits.org/)**, for example `feat(editor): add schema-aware autocomplete`. The git hooks (Lefthook) reject other commit messages, and messages that credit an AI tool (such as a `Co-authored-by: Claude …` trailer), and run `biome check` on staged files. CI checks every commit in a pull request for AI attribution too.
4. **Open a pull request** and fill in the template. Pull requests are squash-merged, so the PR title must be a Conventional Commit too; CI checks it.
5. **CI must pass**: typecheck, Biome, unit tests, build, end-to-end tests in all three browsers, and the performance budgets (bundle size, Lighthouse and the benchmark smoke test). `main` is protected, so every change lands through a pull request.

Releases are automated. [release-please](https://github.com/googleapis/release-please) reads the commit messages on `main` and keeps a release PR open with the next version and its `CHANGELOG.md` entry: `feat` raises the minor version, and `fix` and `perf` raise the patch version. So pick the commit type that describes the change for users, and don't edit `CHANGELOG.md` by hand.

Changes that are hard to reverse, such as a new core dependency or a change to how data flows or is stored, need an [Architecture Decision Record](https://github.com/Karthik-beta/Blinkql/wiki/Architecture-Decision-Records). Start with a discussion, then add the ADR in your pull request.

## Pull request checklist

- [ ] Tests added or updated for behaviour changes
- [ ] No new `any` without a comment explaining why
- [ ] Screenshots or a short recording for UI changes
- [ ] Performance changes include before and after benchmark numbers ([write-up template](https://github.com/Karthik-beta/Blinkql/wiki/Performance-and-Benchmarks#write-up-template))
- [ ] New interactive UI works by keyboard and is labelled
- [ ] Docs or wiki updated if behaviour changed

## Labels

| Label | Meaning |
|---|---|
| `good first issue` | Small and well scoped, with guidance; ideal for a first contribution |
| `help wanted` | Contributions especially welcome |
| `perf` | Performance work; benchmark results expected |
| `template` | Analysis templates for the use-case packs |
| `dataset` | Sample or benchmark datasets |
| `a11y` | Accessibility |
| `docs` | Documentation and wiki |
| `discussion` | Needs design discussion before implementation |
| `area: …` | The part of the app a change touches, such as `area: engine` or `area: bench` |

## Code of conduct

Everyone taking part in Blinkql follows the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

Blinkql is [MIT licensed](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
