# WSL2 + Docker — corruption / hang des `bun install` en conteneur

> **Bug environnemental** (poste de dev WSL2 + Docker), **pas un bug du projet**.
> Diagnostiqué par bisection le 2026-06-10.

## Symptôme

`bun install` exécuté **dans un conteneur sur le réseau bridge Docker** (typiquement le
service `app` de `compose.dev.yml`) échoue, sur de nombreux paquets, avec :

```
error: IntegrityCheckFailed extracting tarball from <pkg>
error: Fail extracting tarball for "<pkg>"
```

…et/ou **hang** (l'install tourne plusieurs minutes sans finir). Le service `app`
s'arrête alors (la commande `bun install &&` court-circuite).

**Ce qui marche :**
- `bun install` sur le **réseau hôte** (`--network host`, ou hors conteneur).
- Le **build d'image** (`docker build` / BuildKit) — réseau différent du bridge runtime.
- `curl` dans le conteneur (peu de connexions).

## Cause racine

**Le chemin réseau du bridge Docker (veth + NAT/conntrack), sur le NIC virtuel de WSL2,
ne supporte pas la forte concurrence de `bun install`** (≈600 téléchargements
simultanés) : les transferts se corrompent / la connexion hang. C'est **intermittent**
(dépend de l'état du réseau au moment T) et **propre au bridge** — le réseau hôte n'est
pas affecté.

### Preuve (matrice de fiabilité, état réseau dégradé)

| Méthode | Résultat |
|---|---|
| **`--network host`** | ✅ **rc=0, ~600 paquets, 0 échec** (reproductible) |
| bridge nu | ❌ dizaines d'échecs / hang |
| MTU réduit (1400, 1280) | ❌ idem |
| offload veth désactivé (`ethtool -K … off`) | ❌ idem (voir ci-dessous) |
| faible concurrence | ❌ idem |

Pourquoi **bun** et pas **curl** : bun ouvre des centaines de connexions concurrentes
à travers le bridge → il sature/heurte le défaut en permanence ; `curl`, séquentiel,
l'esquive.

### Hypothèses testées et ÉCARTÉES

- **Registry / CDN npm** : `curl` livre des archives parfaites (taille complète,
  `gzip -t` OK, sha512 = lockfile, y compris 12 téléchargements parallèles).
- **Réseau hôte** : l'install y réussit (`--network host`).
- **Version de bun** : identique (1.3.14) hôte et conteneur.
- **io_uring** : bloqué par seccomp → échoue quand même.
- **HTTP/2** : http1.1 et http2 livrent des données identiques et correctes.
- **MTU** : réseaux à 1400 et 1280 → échouent toujours.
- **Offload NIC (TSO/GSO/GRO/checksum) sur la veth** : le désactiver (`ethtool -K eth0
  tx off rx off tso off gso off gro off`, vérifié `off`) **ne corrige PAS de façon
  fiable** — l'install hang quand même quand le réseau est dégradé. (Cela a semblé
  marcher une fois lors d'un moment réseau favorable ; ce n'était pas la cause.)

## Résolutions

### A — Recommandée : installer sur le réseau hôte (bypass du bridge)

C'est le seul correctif **fiable**. Dans le stack dev, un service one-shot `installer`
en `network_mode: host` peuple le volume `node_modules`, puis l'app (sur le bridge)
lance seulement `bun run dev` — déjà câblé dans **`compose.dev.yml`** :

```yaml
  installer:
    image: oven/bun:1
    network_mode: host          # bypass du bridge → bun install fiable
    working_dir: /app
    command: sh -c "bun install"
    volumes: [ ".:/app", "stalmail-dev-modules:/app/node_modules" ]
  app:
    image: oven/bun:1
    command: sh -c "bun run dev --host"   # pas d'install ; réutilise le volume
    depends_on:
      installer: { condition: service_completed_successfully }
```

Le trafic *runtime* de l'app (BFF → `stalwart:8080`) reste sur le bridge sans souci :
c'est la **concurrence massive de l'install** qui pose problème, pas les requêtes
normales.

### Contournements ponctuels

- **Install ad hoc en réseau hôte** :
  ```bash
  docker run --rm --network host -v "$PWD":/app -w /app oven/bun:1 bun install
  ```
- **Copier le `node_modules` de l'hôte** dans le volume du conteneur (local, sans réseau) :
  ```bash
  docker run --rm -v <projet>_stalmail-dev-modules:/dest \
    -v "$PWD/node_modules":/src:ro alpine sh -c 'cp -a /src/. /dest/'
  ```
- **Builder l'app** (BuildKit, non affecté) au lieu d'installer au runtime.

### B — Niveau hôte (optionnel, peut aider globalement)

Désactiver l'offload sur l'hôte **peut** réduire la flakiness selon les versions, mais
**n'a pas été confirmé fiable** ici :
```bash
sudo ethtool -K eth0 tx off rx off tso off gso off gro off
```
À tester ; si ça stabilise, persister via `/etc/wsl.conf` (`[boot] command = …`).
Le bypass du bridge (résolution A) reste la solution sûre.

## Reproduire / re-diagnostiquer

```bash
PKG=$PWD/package.json; LOCK=$PWD/bun.lock
# Échoue (bridge) :
docker run --rm -v "$PKG":/w/package.json:ro -v "$LOCK":/w/bun.lock:ro oven/bun:1 \
  bash -c 'cd /tmp && cp /w/* . && bun install'
# Marche (réseau hôte) :
docker run --rm --network host -v "$PKG":/w/package.json:ro -v "$LOCK":/w/bun.lock:ro \
  oven/bun:1 bash -c 'cd /tmp && cp /w/* . && bun install'
```
