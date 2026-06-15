#!/usr/bin/env sh
# PostToolUse (Edit|Write) — formate + lint le fichier touché.
# Stalmail : Prettier + ESLint via Bun. N'échoue jamais (exit 0) pour ne pas bloquer le flux.

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
[ -f "$file" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx)
    cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
    bunx prettier --write "$file" >/dev/null 2>&1
    bunx eslint --fix "$file" >/dev/null 2>&1
    ;;
esac

exit 0
