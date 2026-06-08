# Stalmail CI/CD — Design Document

**Date :** 2026-06-08  
**Repo :** https://github.com/kkzakaria/stalmail

---

## 1. Vision

Pipeline CI/CD automatisé sur GitHub Actions :
- **CI** : valider chaque PR et push (lint, typecheck, tests)
- **CD** : publier l'image Docker multi-plateforme sur ghcr.io
- **Release** : versionner automatiquement via Conventional Commits + release-please

---

## 2. Structure des workflows

```
.github/workflows/
  ci.yml              → lint + typecheck + tests
  release-please.yml  → gestion des Release PRs et tags
  cd.yml              → build + push image Docker
```

---

## 3. Workflow CI (`.github/workflows/ci.yml`)

**Déclencheurs :**
- `push` sur `main`
- `pull_request` ciblant `main`

**Job `ci` sur `ubuntu-latest` :**

| Étape | Détail |
|---|---|
| Checkout | `actions/checkout@v4` |
| Setup Bun | `oven-sh/setup-bun@v2` |
| Cache Bun | `~/.bun/install/cache` keyed sur hash de `bun.lock` |
| Install | `bun install --frozen-lockfile` |
| Lint | `bun run lint` |
| Typecheck | `bun run typecheck` |
| Tests | `bun run test` |

**Notifications :** GitHub envoie un email automatiquement à l'auteur du commit en cas d'échec (comportement par défaut, aucune config supplémentaire).

**Branch protection (à activer manuellement) :** exiger que le job `ci` passe avant tout merge sur `main`. Note : sur un push direct sur `main` (force push), CI et CD tournent en parallèle sans dépendance — la branch protection est la seule garde-fou contre du code invalide en production.

---

## 4. Workflow Release Please (`.github/workflows/release-please.yml`)

**Déclencheur :** `push` sur `main`

**Action :** `googleapis/release-please-action@v4`

**Comportement :**
1. Analyse les commits depuis la dernière release au format Conventional Commits
2. Crée ou met à jour une PR "chore: release vX.Y.Z" contenant :
   - Bump de version dans `package.json`
   - `CHANGELOG.md` généré et mis à jour
3. Quand la Release PR est mergée : crée le tag git `vX.Y.Z`
4. Le tag déclenche le workflow CD

**Règles de bump de version :**

| Type de commit | Exemple | Effet sur la version |
|---|---|---|
| `feat:` | `feat: add snooze action` | minor `0.1.0 → 0.2.0` |
| `fix:` | `fix: JMAP token refresh loop` | patch `0.1.0 → 0.1.1` |
| `feat!:` / `BREAKING CHANGE:` | `feat!: rework wizard API` | major `0.1.0 → 1.0.0` |
| `chore:` `docs:` `refactor:` `test:` | `docs: update readme` | aucune release |

**Fichier de config requis : `release-please-config.json`**
```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "stalmail",
      "changelog-path": "CHANGELOG.md"
    }
  }
}
```

**Fichier manifest : `.release-please-manifest.json`**
```json
{
  ".": "0.0.0"
}
```

**Permissions requises dans le workflow :**
- `contents: write` — créer les tags et commits de release
- `pull-requests: write` — ouvrir et mettre à jour les Release PRs

Aucun secret supplémentaire — `GITHUB_TOKEN` suffit.

---

## 5. Workflow CD (`.github/workflows/cd.yml`)

**Déclencheurs :**
- `push` sur `main` → publie le tag `latest`
- `push` de tags `v*.*.*` → publie les tags versionnés (créés par release-please)

**Permissions :** `packages: write` pour pousser sur ghcr.io via `GITHUB_TOKEN`.

**Job `build-and-push` sur `ubuntu-latest` :**

| Étape | Action |
|---|---|
| Checkout | `actions/checkout@v4` |
| Setup QEMU | `docker/setup-qemu-action@v3` |
| Setup Buildx | `docker/setup-buildx-action@v3` |
| Login ghcr.io | `docker/login-action@v3` avec `GITHUB_TOKEN` |
| Générer les tags | `docker/metadata-action@v5` |
| Build + Push | `docker/build-push-action@v6` |

**Plateformes :** `linux/amd64,linux/arm64`

**Cache Docker :** `type=gha` (GitHub Actions cache) — réutilise les layers entre builds.

**Stratégie de tags (`docker/metadata-action`) :**

| Événement | Tags publiés sur ghcr.io |
|---|---|
| Push sur `main` | `ghcr.io/kkzakaria/stalmail:latest` |
| Tag `v0.1.0` | `0.1.0` · `0.1` · `0` · `latest` |
| Tag `v1.2.3` | `1.2.3` · `1.2` · `1` · `latest` |

---

## 6. Flux complet

```
Developer: git commit -m "feat: add DNS provider selection"
  → push sur main (via PR mergée après CI vert)
      → CI : lint + typecheck + tests  ✓
      → CD : publie ghcr.io/kkzakaria/stalmail:latest
      → release-please : met à jour la Release PR "chore: release v0.2.0"

Developer: merge la Release PR
  → release-please : crée le tag v0.2.0
      → CD : publie ghcr.io/kkzakaria/stalmail:0.2.0 · 0.2 · 0 · latest
```

---

## 7. Références

- [GitHub Actions — Bun](https://bun.sh/guides/runtime/cicd)
- [release-please-action](https://github.com/googleapis/release-please-action)
- [docker/metadata-action](https://github.com/docker/metadata-action)
- [docker/build-push-action](https://github.com/docker/build-push-action)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [ghcr.io — GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
