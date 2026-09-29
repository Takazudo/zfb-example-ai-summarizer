import { defineConfig } from "zfb/config";

export default defineConfig({
  adapter: "@takazudo/zfb-adapter-cloudflare",
  // All classes are authored CSS (styles/global.css); no utilities are used.
  // owned-v1 replaces the Tailwind preflight the 2.x `@import "tailwindcss"` supplied.
  wind: { spec: 1, reset: "owned-v1" },
});
