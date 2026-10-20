import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({mode})=>({plugins:[react()],server:{port:mode==='database-test'?5174:5173,strictPort:true,proxy:{'/api':{target:mode==='database-test'?'http://127.0.0.1:8001':'http://127.0.0.1:8000',changeOrigin:true}}}}));
