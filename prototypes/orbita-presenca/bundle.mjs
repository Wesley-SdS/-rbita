import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const [html, css, orb, orb3d, research, app] = await Promise.all(['index.html', 'styles.css', 'orb.js', 'orb-3d.js', 'research.js', 'app.js'].map(file => readFile(join(root, file), 'utf8')));
const safeScript = script => script.replace(/<\/script/gi, '<\\/script');
const bundle = html
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('  <script defer src="orb.js"></script>\n', '')
  .replace('  <script defer src="orb-3d.js"></script>\n', '')
  .replace('  <script defer src="research.js"></script>\n', '')
  .replace('  <script defer src="app.js"></script>\n', '')
  // Inline scripts execute after the DOM, whereas the source files use defer.
  .replace('</body>', () => [orb, orb3d, research, app].map(script => `<script>\n${safeScript(script)}\n</script>`).join('\n') + '\n</body>');
await writeFile(join(root, 'orbita-presenca.html'), bundle, 'utf8');
console.log('HTML portátil gerado: prototypes/orbita-presenca/orbita-presenca.html');
