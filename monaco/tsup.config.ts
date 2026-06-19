import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "index.ts",
    "ui/index": "ui/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  external: [
    // React ecosystem — MUST be external
    "react",
    "react-dom",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    // Shared with consuming app
    "tailwindcss",
    "@tailwindcss/vite",
    "clsx",
    "tailwind-merge",
    "lucide-react",
    "class-variance-authority",
    "valtio",
    // Tauri — host app provides these
    "@tauri-apps/api",
    "@tauri-apps/plugin-clipboard-manager",
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-fs",
    "@tauri-apps/plugin-opener",
  ],
});