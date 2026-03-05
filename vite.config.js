import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Configuração do motor de build para React
export default defineConfig({
  plugins: [react()],
})
