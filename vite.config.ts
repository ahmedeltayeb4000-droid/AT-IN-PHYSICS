import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { protectedMediaDevPlugin } from "./scripts/dev/protectedMediaDevPlugin.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    protectedMediaDevPlugin(import.meta.dirname),
  ],
});
