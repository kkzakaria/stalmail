import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  server: {
    // Port par défaut personnalisé (3443) pour éviter les collisions avec d'autres projets
    // sur 3000. Surchargé par la variable PORT (ex. dans le conteneur dev → 3000 interne).
    port: Number(process.env.PORT) || 3443,
    // Allow requests from container-internal hostnames (Docker Compose service names)
    allowedHosts: ["app", "localhost"],
  },
})

export default config
