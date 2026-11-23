import { reddit, redis, settings } from '@devvit/web/server';
import type { SubredditRecord } from '../shared/types.js';
import { getBundledBaselineSubreddits, normalizeRawSubreddit } from './subredditCore.js';

const REDIS_LIVE_KEY = 'floop:live_subreddits:v1';
const REDIS_SYNC_META_KEY = 'floop:sync_meta:v1';
const REDIS_LAST_ROTATION_KEY = 'floop:sync_rotation:v1';

interface SyncMeta {
  lastSyncAt: string | null;
  sources: string[];
  addedOrUpdated: number;
  lastError?: string;
}

function extractSubredditMentions(text: string): string[] {
  const found: string[] = [];
  const regex = /(?:^|[\s(/])r\/([a-zA-Z0-9_]{3,21})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    found.push(match[1]);
  }
  return found;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const current = items[idx++];
      results.push(await worker(current));
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function loadSubredditIndex(): Promise<{
  subreddits: SubredditRecord[];
  meta: SyncMeta;
}> {
  const map = new Map<string, SubredditRecord>();
  for (const item of getBundledBaselineSubreddits()) {
    if (item && item.display_name) {
      map.set(item.display_name.toLowerCase(), item);
    }
  }

  let meta: SyncMeta = { lastSyncAt: null, sources: ['bundled-reddit-snapshot'], addedOrUpdated: 0 };
  try {
    const [rawLive, rawMeta] = await Promise.all([
      redis.get(REDIS_LIVE_KEY),
      redis.get(REDIS_SYNC_META_KEY)
    ]);
    if (rawLive) {
      const parsed = JSON.parse(rawLive) as SubredditRecord[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.display_name) {
            map.set(item.display_name.toLowerCase(), item);
          }
        }
      }
    }
    if (rawMeta) {
      meta = { ...meta, ...(JSON.parse(rawMeta) as SyncMeta) };
    }
  } catch {
    // Redis optional during isolated unit tests
  }

  const list = Array.from(map.values()).sort((a, b) => b.created_utc - a.created_utc);
  return { subreddits: list, meta };
}

export async function saveLiveOverlay(liveItems: SubredditRecord[], meta: SyncMeta): Promise<void> {
  const trimmed = liveItems
    .slice()
    .sort((a, b) => (b.created_utc - a.created_utc) || (b.heat_score - a.heat_score))
    .slice(0, 1200);
  await Promise.all([
    redis.set(REDIS_LIVE_KEY, JSON.stringify(trimmed)),
    redis.set(REDIS_SYNC_META_KEY, JSON.stringify(meta))
  ]);
}

async function fetchSubredditViaDevvit(
  name: string,
  nowSec: number,
  postMetrics?: { count: number; comments: number }
): Promise<SubredditRecord | null> {
  try {
    const info = await reddit.getSubredditInfoByName(name);
    if (!info || !info.name || !info.createdAt) return null;

    const createdUtc = Math.floor(info.createdAt.getTime() / 1000);
    const allowedTypes = info.allAllowedPostTypes || [];
    const allowImages = allowedTypes.length === 0 || allowedTypes.includes('image') || allowedTypes.includes('gallery');
    const allowVideos = allowedTypes.length === 0 || allowedTypes.includes('video') || allowedTypes.includes('videogif');

    return normalizeRawSubreddit(
      {
        id: info.id,
        display_name: info.name,
        title: info.title || info.name,
        public_description: info.description?.markdown || info.title || '',
        created_utc: createdUtc,
        over18: Boolean(info.isNsfw),
        allow_images: allowImages,
        allow_videos: allowVideos,
        subscribers: Number(info.subscribersCount || 0),
        active_accounts: info.activeCount ?? null,
        num_posts: postMetrics ? postMetrics.count : null,
        num_comments: postMetrics ? postMetrics.comments : null
      },
      'devvit-reddit-api',
      nowSec
    );
  } catch {
    return null;
  }
}

export async function lookupSingleSubreddit(rawName: string): Promise<SubredditRecord | null> {
  const cleanName = String(rawName || '')
    .trim()
    .replace(/^\/?r\//i, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleanName || cleanName.length < 2) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  let postMetrics: { count: number; comments: number } | undefined;
  try {
    const recent = await reddit.getNewPosts({ subredditName: cleanName, limit: 25 }).all();
    const commentSum = recent.reduce((acc, p) => acc + (p.numberOfComments || 0), 0);
    postMetrics = { count: recent.length, comments: commentSum };
  } catch {
    // Subreddit might have zero accessible posts or restricted listing
  }

  const record = await fetchSubredditViaDevvit(cleanName, nowSec, postMetrics);
  if (!record) return null;

  const { subreddits, meta } = await loadSubredditIndex();
  const map = new Map(subreddits.map((s) => [s.display_name.toLowerCase(), s]));
  map.set(record.display_name.toLowerCase(), record);

  const liveOverlay = Array.from(map.values()).filter((s) => s.source !== 'reddit-arctic-live');
  await saveLiveOverlay(liveOverlay, {
    lastSyncAt: new Date().toISOString(),
    sources: Array.from(new Set([...(meta.sources || []), 'devvit-reddit-api'])),
    addedOrUpdated: (meta.addedOrUpdated || 0) + 1
  });

  return record;
}

export async function syncLiveFromDevvitReddit(): Promise<{
  total: number;
  addedOrUpdated: number;
  sources: string[];
}> {
  const nowSec = Math.floor(Date.now() / 1000);
  const minCreatedUtc = nowSec - 90 * 86400;
  const { subreddits } = await loadSubredditIndex();
  const map = new Map<string, SubredditRecord>(
    subreddits.map((s) => [s.display_name.toLowerCase(), s])
  );

  let addedOrUpdated = 0;
  const sourcesUsed = new Set<string>();
  const candidateNames = new Set<string>();
  const postActivityMap = new Map<string, { count: number; comments: number }>();

  // 1) Scan Devvit native Reddit API feeds (no external API keys needed!)
  try {
    const announcementFeeds = ['newreddits', 'promotereddit', 'wowthisexists'];
    for (const feedName of announcementFeeds) {
      try {
        const posts = await reddit.getNewPosts({ subredditName: feedName, limit: 30 }).all();
        for (const p of posts) {
          const mentions = extractSubredditMentions(`${p.title || ''} ${p.body || ''} ${p.url || ''}`);
          for (const m of mentions) {
            if (!['newreddits', 'promotereddit', 'wowthisexists', 'findareddit', 'reddit'].includes(m.toLowerCase())) {
              candidateNames.add(m);
            }
          }
        }
        sourcesUsed.add('devvit-reddit-api');
      } catch {
        // Continue scanning remaining feeds
      }
    }

    // Rotate through discovery streams (all new, rising, search)
    const rotStr = (await redis.get(REDIS_LAST_ROTATION_KEY)) || '0';
    const rot = Number(rotStr) || 0;
    await redis.set(REDIS_LAST_ROTATION_KEY, String((rot + 1) % 3));

    const postBatches = await Promise.allSettled([
      reddit.getNewPosts({ subredditName: 'all', limit: 60 }).all(),
      rot % 2 === 0
        ? reddit.getRisingPosts({ subredditName: 'all', limit: 40 }).all()
        : reddit.searchPosts({ query: 'new subreddit', sort: 'new', timeframe: 'week', limit: 35 }).all()
    ]);

    for (const batch of postBatches) {
      if (batch.status !== 'fulfilled') continue;
      for (const p of batch.value) {
        if (p.subredditName) {
          candidateNames.add(p.subredditName);
          const key = p.subredditName.toLowerCase();
          const prev = postActivityMap.get(key) || { count: 0, comments: 0 };
          prev.count += 1;
          prev.comments += p.numberOfComments || 0;
          postActivityMap.set(key, prev);
        }
        for (const m of extractSubredditMentions(`${p.title || ''} ${p.body || ''}`)) {
          candidateNames.add(m);
        }
      }
      sourcesUsed.add('devvit-reddit-api');
    }
  } catch (err) {
    console.warn('Devvit reddit scan warning:', err);
  }

  // Prioritize unseen candidates or oldest stale candidates, cap at 22 lookups to keep well inside 30s timeout
  const prioritized = Array.from(candidateNames)
    .filter((n) => n && n.length >= 3 && !n.startsWith('u_'))
    .sort((a, b) => {
      const hasA = map.has(a.toLowerCase()) ? 1 : 0;
      const hasB = map.has(b.toLowerCase()) ? 1 : 0;
      return hasA - hasB;
    })
    .slice(0, 22);

  if (prioritized.length > 0) {
    const resolved = await runWithConcurrency(prioritized, 5, async (name) => {
      const activity = postActivityMap.get(name.toLowerCase());
      return fetchSubredditViaDevvit(name, nowSec, activity);
    });
    for (const item of resolved) {
      if (item && item.created_utc >= minCreatedUtc) {
        map.set(item.display_name.toLowerCase(), item);
        addedOrUpdated++;
      }
    }
  }

  // 2) Optionally query Arctic Shift if enabled in subreddit settings & allowed by http allowlist
  let syncArctic = true;
  try {
    const settingVal = await settings.get<boolean>('syncArcticShift');
    if (settingVal === false) syncArctic = false;
  } catch {
    // Use default true
  }

  if (syncArctic) {
    const urls = [
      `https://arctic-shift.photon-reddit.com/api/subreddits/search?after=${minCreatedUtc}&limit=100&sort=desc&sort_type=subscribers`,
      `https://arctic-shift.photon-reddit.com/api/subreddits/search?after=${nowSec - 14 * 86400}&limit=100&sort=desc&sort_type=created_utc`,
      `https://arctic-shift.photon-reddit.com/api/subreddits/search?after=${minCreatedUtc}&over18=true&limit=100&sort=desc&sort_type=subscribers`
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
        const rows = Array.isArray(json?.data) ? json.data : [];
        if (rows.length > 0) sourcesUsed.add('arctic-shift-live');
        for (const r of rows) {
          const norm = normalizeRawSubreddit(r as Parameters<typeof normalizeRawSubreddit>[0], 'reddit-arctic-live', nowSec);
          if (norm && norm.created_utc >= minCreatedUtc) {
            const key = norm.display_name.toLowerCase();
            const existing = map.get(key);
            if (!existing || existing.source !== 'devvit-reddit-api' || norm.subscribers > existing.subscribers) {
              map.set(key, norm);
              addedOrUpdated++;
            }
          }
        }
      } catch {
        // Domain may await allowlist approval or network timeout; non-fatal
      }
    }
  }

  // Re-evaluate rolling 90d window & persist live entries
  const freshList = Array.from(map.values())
    .filter((s) => (nowSec - s.created_utc) <= 95 * 86400)
    .sort((a, b) => b.created_utc - a.created_utc);

  const sourcesArr = Array.from(sourcesUsed);
  const liveToPersist = freshList.filter(
    (s) => s.source === 'devvit-reddit-api' || !getBundledBaselineSubreddits().some((b) => b.display_name.toLowerCase() === s.display_name.toLowerCase())
  );

  await saveLiveOverlay(liveToPersist.length > 0 ? liveToPersist : freshList.slice(0, 400), {
    lastSyncAt: new Date().toISOString(),
    sources: sourcesArr.length > 0 ? sourcesArr : ['bundled-reddit-snapshot'],
    addedOrUpdated
  });

  return {
    total: freshList.length,
    addedOrUpdated,
    sources: sourcesArr
  };
}
