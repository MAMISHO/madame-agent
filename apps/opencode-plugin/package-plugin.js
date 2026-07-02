import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pluginRoot = __dirname;
const workspaceRoot = path.resolve(pluginRoot, '../..');
const outputDir = path.resolve(workspaceRoot, 'dist/apps/opencode-plugin');

console.log('Packaging plugin...');
console.log(`Workspace root: ${workspaceRoot}`);
console.log(`Output directory: ${outputDir}`);

// 1. Clean outputDir
if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

// 2. Copy compiled plugin.json & package.json
fs.copyFileSync(
  path.join(pluginRoot, 'plugin.json'),
  path.join(outputDir, 'plugin.json')
);
fs.copyFileSync(
  path.join(pluginRoot, 'package.json'),
  path.join(outputDir, 'package.json')
);

// 3. Copy compiled plugin TS/JS & source files
const pluginDist = path.join(pluginRoot, 'dist');
if (fs.existsSync(pluginDist)) {
  fs.cpSync(pluginDist, path.join(outputDir, 'dist'), { recursive: true });
} else {
  console.error('Plugin dist folder not found! Build the plugin first.');
  process.exit(1);
}

const pluginSrc = path.join(pluginRoot, 'src');
if (fs.existsSync(pluginSrc)) {
  fs.cpSync(pluginSrc, path.join(outputDir, 'src'), { recursive: true });
}

const pluginTypes = path.join(pluginRoot, 'types');
if (fs.existsSync(pluginTypes)) {
  fs.cpSync(pluginTypes, path.join(outputDir, 'types'), { recursive: true });
}

// 4. Copy backend dist
const backendDist = path.resolve(workspaceRoot, 'apps/backend/dist');
if (fs.existsSync(backendDist)) {
  fs.cpSync(backendDist, path.join(outputDir, 'backend'), { recursive: true });
} else {
  console.error('Backend dist folder not found! Build backend first.');
  process.exit(1);
}

const backendRouting = path.resolve(workspaceRoot, 'apps/backend/routing.yaml');
if (fs.existsSync(backendRouting)) {
  fs.copyFileSync(backendRouting, path.join(outputDir, 'backend/routing.yaml'));
}

// 5. Copy frontend dist
const frontendDist = path.resolve(workspaceRoot, 'apps/frontend/dist/frontend/browser');
if (fs.existsSync(frontendDist)) {
  fs.cpSync(frontendDist, path.join(outputDir, 'frontend'), { recursive: true });
} else {
  console.error('Frontend dist folder not found! Build frontend first.');
  process.exit(1);
}

console.log('Plugin packaged successfully!');
