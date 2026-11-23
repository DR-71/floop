import fs from 'node:fs';
import path from 'node:path';

const distClientDir = path.resolve('dist', 'client');
fs.mkdirSync(distClientDir, { recursive: true });

for (const file of ['index.html', 'styles.css']) {
  fs.copyFileSync(
    path.resolve('src', 'client', file),
    path.join(distClientDir, file)
  );
}

console.log('Copied client static assets into dist/client/');
