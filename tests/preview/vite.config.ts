import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  root: here("./"),
  server: { host: "127.0.0.1", port: 3001, fs: { allow: [here("../../")] } },
  resolve: {
    alias: [
      { find: "@/app/(workspace)/actions", replacement: here("./actions.ts") },
      { find: "@/app/auth/actions", replacement: here("./actions.ts") },
      { find: "next/navigation", replacement: here("./navigation.ts") },
      { find: "next/link", replacement: here("./link.tsx") },
      { find: "@", replacement: here("../../src") },
    ],
  },
});
