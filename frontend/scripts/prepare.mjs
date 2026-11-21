import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const hardhat = resolve(repo, 'node_modules/hardhat/internal/cli/cli.js');
if (!existsSync(hardhat)) {
  console.error('Install the repository dependencies first: cd .. && npm ci');
  process.exit(1);
}
const result = spawnSync(process.execPath, [hardhat, 'compile'], { cwd: repo, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(resolve(root, 'src/generated'), { recursive: true });
for (const name of ['ProductRegistry', 'WarrantyManager']) {
  const candidates = [
    `artifacts/contracts/${name}.sol/${name}.json`,
    `artifacts/contracts/interfaces/I${name}.sol/I${name}.json`,
  ];
  const source = candidates.map(p => resolve(repo, p)).find(existsSync);
  if (!source) throw new Error(`Missing compiled ABI for ${name}`);
  const { abi } = JSON.parse(readFileSync(source, 'utf8'));
  writeFileSync(resolve(root, `src/generated/${name}.json`), JSON.stringify({ abi }, null, 2) + '\n');
}
console.log('Frontend ABIs synchronized from the current contract build.');
