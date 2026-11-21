import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { transformSync } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const frontend = dirname(fileURLToPath(import.meta.url));
const repo = resolve(frontend, '..');
const configPath = resolve(repo, 'deployments/local.json');

// Bundle the original frozen CommonJS modules into ESM without changing their
// implementation. Both development and production consume the same sources.
function sharedModules(): Plugin {
  return {
    name: 'frozen-shared-modules',
    resolveId(id) { if (id === '@shared/hash' || id === '@shared/constants') return '\0' + id; },
    load(id) {
      if (!id.startsWith('\0@shared/')) return;
      const filename = id.endsWith('/hash') ? 'hash.js' : 'constants.js';
      const source = resolve(repo, 'shared', filename);
      this.addWatchFile(source);
      const esm = readFileSync(source, 'utf8')
        .replace(/const (\{[^;]+\}) = require\("ethers"\);/, 'import $1 from "ethers";')
        .replace('module.exports =', 'export default');
      return transformSync(esm, { format: 'esm', target: 'es2022' }).code;
    },
  };
}

function deploymentConfig(): Plugin {
  function serveConfig(_req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    try { res.end(readFileSync(configPath, 'utf8')); }
    catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'missing_deployment',
      message: 'Run npm run node and npm run deploy:local at the repository root.' })); }
  }
  return {
    name: 'local-deployment-config',
    configureServer(server) {
      server.middlewares.use('/app-config.json', serveConfig);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/app-config.json', serveConfig);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'app-config.json', source: existsSync(configPath)
        ? readFileSync(configPath, 'utf8') : JSON.stringify({ error: 'missing_deployment' }) });
    },
  };
}

export default defineConfig({
  plugins: [sharedModules(), react(), deploymentConfig()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { allow: [repo] } },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { rollupOptions: { output: { manualChunks: { 'wallet': ['ethers'], 'react': ['react', 'react-dom', 'react-router-dom'] } } } },
});
