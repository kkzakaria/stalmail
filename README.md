# Stalmail

Webmail client et lanceur de serveur pour [Stalwart](https://stalw.art/) — lancez votre propre serveur mail en une commande.

```bash
curl -sSL https://get.stalmail.io | sh
```

Un wizard de configuration prend en charge le domaine, le DNS et les certificats SSL automatiquement.

## Stack

- [TanStack Start](https://tanstack.com/start/latest) — SSR + server functions (BFF)
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- [Stalwart v0.16](https://stalw.art/) — serveur mail (JMAP, IMAP, SMTP)
- Docker + Caddy

## Développement

```bash
bun install
bun run dev
```

## Tests

```bash
bun run test
```

## Architecture

Stack **`docker compose` à trois services** ([`compose.yml`](compose.yml)), chacun dans son propre namespace réseau :

- **`caddy`** — TLS public + reverse-proxy (`:443`/`:80`)
- **`app`** — webmail + BFF du setup-wizard (TanStack Start), sur `:3000`
- **`stalwart`** — Stalwart v0.16 (image **stock**) ; HTTP management sur `:8080` (jamais exposé publiquement), ports mail publiés (25/587/465/993/143/995/4190)

Le BFF pilote Stalwart en JMAP pendant le wizard (collecte → bootstrap → redémarrage → compte → DNS → SSL → terminé). Un volume partagé `/shared` coordonne le redémarrage (sentinelle) et le flag de fin de setup ; après finalisation, le credential recovery-admin est retiré (durcissement). L'installation se fait en une commande (`docker compose up -d`, piloté par `install.sh`).

Détails : design fonctionnel [`docs/superpowers/specs/2026-06-08-stalmail-design.md`](docs/superpowers/specs/2026-06-08-stalmail-design.md) (note de mise à jour en tête) et plan de migration [`docs/superpowers/plans/2026-06-09-compose-two-service-architecture.md`](docs/superpowers/plans/2026-06-09-compose-two-service-architecture.md).

## Licence

MIT
