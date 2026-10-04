import { defineConfig } from 'vite';

const apiProxy = process.env.WIKIMF_API_PROXY || 'http://127.0.0.1:8000';

export default defineConfig({
  server: { proxy: { '/api': apiProxy } },
  preview: { proxy: { '/api': apiProxy } },
});
