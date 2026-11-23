import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAppConfig } from '@devvit/shared-types/schemas/config-file.v1.js';

test('devvit.json parses cleanly against official Devvit v1 schema', () => {
  const raw = fs.readFileSync(new URL('../devvit.json', import.meta.url), 'utf8');
  const cfg = parseAppConfig(raw, true);
  assert.equal(cfg.name, 'floop-radar');
  assert.equal(cfg.permissions.reddit.enable, true);
  assert.equal(cfg.permissions.redis, true);
  assert.ok(cfg.scheduler?.tasks['daily-floop-digest']);
  assert.equal(cfg.scheduler.tasks['daily-floop-digest'].cron, '0 8 * * *');
  assert.ok(cfg.permissions.http.domains.includes('api.resend.com'));
});

test('bundled subreddit snapshot contains real Reddit communities across all 12 categories', () => {
  const data = JSON.parse(
    fs.readFileSync(new URL('../src/data/subreddits.json', import.meta.url), 'utf8')
  );
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 693);

  const cats = new Set(data.map((s) => s.category));
  assert.ok(cats.has('Technology & AI'));
  assert.ok(cats.has('NSFW & Adult'));
  assert.equal(cats.size, 12);

  // Ensure zero fabricated curated test names exist
  const names = new Set(data.map((s) => s.display_name));
  assert.equal(names.has('AgenticCoding'), false);
  assert.equal(names.has('LocalLLMAgents'), false);
  assert.equal(names.has('AfterDarkIntimacy'), false);
});

test('dist build artifacts exist and client HTML has zero external CDN links', () => {
  const html = fs.readFileSync(new URL('../dist/client/index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('fonts.googleapis.com'), false);
  assert.equal(fs.existsSync(new URL('../dist/client/main.js', import.meta.url)), true);
  assert.equal(fs.existsSync(new URL('../dist/client/styles.css', import.meta.url)), true);
  assert.equal(fs.existsSync(new URL('../dist/server/index.cjs', import.meta.url)), true);
});
