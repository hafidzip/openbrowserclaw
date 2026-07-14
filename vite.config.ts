import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { splashScreen } from "vite-plugin-splash-screen";
import tsconfigPaths from "vite-tsconfig-paths";

const ignoredDirs = [
    '.cache',
    'openchad-webview',
    'openchadpy',
    'python',
    'hafidz',
    'Backend',
    'Settings',
    'SKILLS',
    'Models',
    'Pipeline',
    'Tools',
    'ModelProvider',
    'Workspaces',
    'build',
    'frontend',
    "Extensions"
].map(dir => path.resolve(__dirname, dir).replace(/\\/g, '/'))

export default defineConfig(({ mode }) => ({
    plugins: [
        splashScreen({
            logoSrc: 'logo.svg',
            splashBg: 'black',
            loaderType: "dots",
            loaderBg: "white"
        }),
        react(),
        tailwindcss(),
        tsconfigPaths(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
        dedupe: [
            'react',
            'react-dom',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            // 'sonner',
        ]
    },
    server: {
        port: 3000,
        open: false,
        watch: {
            ignored: (p) => {
                const normalized = p.replace(/\\/g, '/');
                if (normalized.includes('/.git/') || normalized.includes('/__pycache__/') || normalized.includes('/.venv/')) {
                    return true;
                }
                if (normalized.endsWith('/settings.db') || normalized.endsWith('/settings.db-wal') || normalized.endsWith('/settings.db-shm')) {
                    return true;
                }
                return ignoredDirs.some(dir => normalized === dir || normalized.startsWith(dir + '/'));
            }
        },
        proxy: {
            '/ws': {
                target: 'http://127.0.0.1:2048',
                ws: true,
                changeOrigin: true,
            },
            '/Apps': {
                target: 'http://127.0.0.1:2048',
                changeOrigin: true,
            },
            '/api': {
                target: 'http://127.0.0.1:2048',
                changeOrigin: true,
            },
            '/file': {
                target: 'http://127.0.0.1:2048',
                changeOrigin: true,
            },
            '/health': {
                target: 'http://127.0.0.1:2048',
                changeOrigin: true,
            },
        }
    },
    build: {
        outDir: 'frontend',
        sourcemap: true,
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'index.html'),
            },
        }
    },
}))