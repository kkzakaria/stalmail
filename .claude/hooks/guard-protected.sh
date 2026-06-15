#!/usr/bin/env sh
# PreToolUse (Edit|Write) — garde-fou sur les fichiers à ne pas éditer à la main.
# exit 2 => bloque l'appel d'outil et renvoie le message (stderr) au modèle.

input=$(cat)

file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path||"")}catch{process.stdout.write("")}})' 2>/dev/null)

[ -n "$file" ] || exit 0

base=$(basename "$file")
case "$base" in
  bun.lock)
    echo "Bloqué : bun.lock est géré par Bun. Lance 'bun install' au lieu d'éditer le lockfile." >&2
    exit 2
    ;;
esac

exit 0
