#!/usr/bin/env sh
# PreToolUse (Edit|Write) — garde-fou sur les fichiers à ne pas éditer à la main.
# exit 2 => bloque l'appel d'outil et renvoie le message (stderr) au modèle.

input=$(cat)

# Extrait tool_input.file_path du JSON stdin. Bun d'abord (standard du repo),
# repli node, puis repli shell — pour ne dépendre d'aucun runtime en particulier.
extract_file_path() {
  if command -v bun >/dev/null 2>&1; then
    printf '%s' "$1" | bun -e 'const s=await Bun.stdin.text();try{process.stdout.write(JSON.parse(s).tool_input?.file_path||"")}catch{process.stdout.write("")}' 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path||"")}catch{process.stdout.write("")}})' 2>/dev/null
  else
    printf '%s' "$1" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//; s/"$//'
  fi
}

file=$(extract_file_path "$input")

[ -n "$file" ] || exit 0

base=$(basename "$file")
case "$base" in
  bun.lock)
    echo "Bloqué : bun.lock est géré par Bun. Lance 'bun install' au lieu d'éditer le lockfile." >&2
    exit 2
    ;;
esac

exit 0
