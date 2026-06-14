# Contributing to Stalmail

Thank you for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Docker](https://docs.docker.com/get-docker/) (for running the full stack locally)
- A GitHub account

## Getting Started

```bash
git clone https://github.com/kkzakaria/stalmail.git
cd stalmail
bun install        # also installs git hooks via husky
bun run dev        # starts the dev server on http://localhost:3443 (override with PORT)
```

## Development Workflow

### Branching

Always work on a feature branch, never commit directly to `main`.

```
main              ← protected, CI must pass, no force pushes
└── feat/my-feature
└── fix/some-bug
└── docs/update-readme
```

### Commit Convention

Stalmail uses [Conventional Commits](https://www.conventionalcommits.org/). The format is:

```
<type>(<scope>): <description>

[optional body]

[optional footer: BREAKING CHANGE: ...]
```

| Type | When to use | Version bump |
|---|---|---|
| `feat` | New user-facing feature | minor `0.1.0 → 0.2.0` |
| `fix` | Bug fix | patch `0.1.0 → 0.1.1` |
| `feat!` / `BREAKING CHANGE:` | Breaking API change | minor `0.1.0 → 0.2.0` ¹ |
| `chore` | Tooling, dependencies | none |
| `ci` | CI/CD changes | none |
| `docs` | Documentation | none |
| `refactor` | Refactoring, no behavior change | none |
| `test` | Adding or fixing tests | none |
| `perf` | Performance improvement | none |

¹ Before v1.0.0, breaking changes bump minor, not major.

### Pre-commit Hooks

Husky runs three checks before every commit:

```
lint → typecheck → tests
```

If any check fails, the commit is blocked. Fix the issue and try again.

> **Do not bypass with `git commit --no-verify`** except in a genuine emergency (e.g., fixing a broken hook configuration itself). Every bypass skips quality gates and can break `main` for the rest of the team.

### Available Scripts

```bash
bun run dev          # development server
bun run build        # production build
bun run lint         # ESLint
bun run typecheck    # TypeScript type checking
bun run test         # Vitest test suite
bun run format       # Prettier (write)
bun run check        # Prettier (check)
```

## Pull Request Process

1. Create a branch from `main` with a descriptive name: `feat/wizard-dns-setup`
2. Write your changes with tests where applicable
3. Make sure all pre-commit checks pass locally
4. Open a PR targeting `main`
5. The CI pipeline must pass (lint + typecheck + tests)
6. Request a review if needed

PR titles should follow the same Conventional Commits format as commit messages — this is what release-please reads to generate the changelog.

## Release Process

Releases are fully automated via [release-please](https://github.com/googleapis/release-please):

1. Merge your PR with a `feat:` or `fix:` commit → release-please opens a Release PR
2. Review and merge the Release PR → a git tag `vX.Y.Z` is created automatically
3. The CD pipeline publishes `ghcr.io/kkzakaria/stalmail:X.Y.Z` to GitHub Container Registry

You never create tags or bump versions manually.

## Project Architecture

See [`docs/superpowers/specs/2026-06-08-stalmail-design.md`](docs/superpowers/specs/2026-06-08-stalmail-design.md) for the full design document.
