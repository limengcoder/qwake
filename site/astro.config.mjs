import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = process.env.PUBLIC_SITE_URL || "https://qwake.top";

export default defineConfig({
  site,
  output: "static",
  integrations: [sitemap()],
  build: {
    assets: "_assets"
  }
});
