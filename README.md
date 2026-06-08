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

Voir [`docs/superpowers/specs/2026-06-08-stalmail-design.md`](docs/superpowers/specs/2026-06-08-stalmail-design.md).

## Licence

MIT
