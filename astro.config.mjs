// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

// Server code reads process.env (Docker passes real env vars); in dev, fill it from .env.
Object.assign(process.env, { ...loadEnv(process.env.NODE_ENV || 'development', process.cwd(), ''), ...process.env });

export default defineConfig({
  site: 'https://lightbox.polytronx.com',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  // Behind Nginx Proxy Manager + Cloudflare: trust X-Forwarded-Host/Proto for our own domain so the CSRF origin check matches.
  security: { checkOrigin: true, allowedDomains: [{ hostname: 'lightbox.polytronx.com', protocol: 'https' }] },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  image: { responsiveStyles: true },
  vite: { plugins: [tailwindcss()] },
  devToolbar: { enabled: false },
});
