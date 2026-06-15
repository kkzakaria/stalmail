#!/usr/bin/env sh
# PostToolUse (Edit|Write) — formate + lint le fichier touché.
# Stalmail : Prettier + ESLint via Bun. N'échoue jamais (exit 0) pour ne pas bloquer le flux.

input=$(cat)

# Extrait tool_input.file_path du JSON reçu sur stdin (node est dispo : projet JS/Bun).
file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path||"")}catch{process.stdout.write("")}})' 2>/dev/null)

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
