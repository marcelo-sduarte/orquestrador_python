import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api é redirecionado para a API Node: o navegador vê tudo na mesma origem (sem CORS)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});
