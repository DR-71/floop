import express, { type Request, type Response } from 'express';
import {
  context,
  createServer,
  getServerPort,
  reddit,
  settings,
  type TaskRequest,
  type TaskResponse
} from '@devvit/web/server';
import type {
  TriggerResponse,
  UiResponse
} from '@devvit/web/shared';
import { CATEGORIES } from '../shared/types.js';
import {
  compileDigestForSubscription,
  createSubscription,
  deleteSubscriptionById,
  getAutomationSnapshot,
  runDailyDigestCron,
  sendDigestForSubscriptionId,
  toggleSubscriptionStatus
} from './automations.js';
import { buildDailyDigestEmail } from './emailDigest.js';
import {
  loadSubredditIndex,
  lookupSingleSubreddit,
  syncLiveFromDevvitReddit
} from './redditDiscovery.js';
import { querySubreddits } from './subredditCore.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Devvit Custom Post Helper ──────────────────────────────────────────────

async function createRadarCustomPost(subredditName: string) {
  return reddit.submitCustomPost({
    subredditName,
    title: 'floop — Live Newly Created & Hottest 90-Day Subreddit Explorer',
    entry: 'default',
    textFallback: {
      text: 'Open this post in the Reddit app or modern web to explore newly created subreddits live by category, inspect the hottest 90-day communities, and subscribe to daily digests.'
    }
  });
}

// ─── Devvit Triggers ────────────────────────────────────────────────────────

app.post('/internal/triggers/on-app-install', async (_req: Request, res: Response) => {
  try {
    await syncLiveFromDevvitReddit();
    if (context.subredditName) {
      await createRadarCustomPost(context.subredditName);
    }
  } catch (err) {
    console.error('on-app-install error:', err);
  }
  const resp: TriggerResponse = {};
  res.json(resp);
});

app.post('/internal/triggers/on-app-upgrade', async (_req: Request, res: Response) => {
  try {
    await syncLiveFromDevvitReddit();
  } catch (err) {
    console.error('on-app-upgrade error:', err);
  }
  const resp: TriggerResponse = {};
  res.json(resp);
});

// ─── Devvit Menu Actions ────────────────────────────────────────────────────

app.post('/internal/menu/launch-floop-post', async (_req: Request, res: Response) => {
  try {
    const subName = context.subredditName;
    if (!subName) {
      res.json({ showToast: 'Run this menu action inside a subreddit.' } satisfies UiResponse);
      return;
    }
    const post = await createRadarCustomPost(subName);
    res.json({
      navigateTo: post.url,
      showToast: { text: `Launched floop Subreddit Radar in r/${subName}!`, appearance: 'success' }
    } satisfies UiResponse);
  } catch (err) {
    console.error('launch-floop-post error:', err);
    res.json({ showToast: 'Could not launch floop Radar post.' } satisfies UiResponse);
  }
});

app.post('/internal/menu/post-daily-digest', async (_req: Request, res: Response) => {
  try {
    const subName = context.subredditName;
    if (!subName) {
      res.json({ showToast: 'Run this menu action inside a subreddit.' } satisfies UiResponse);
      return;
    }
    const { subreddits } = await loadSubredditIndex();
    const newRes = querySubreddits(subreddits, {
      category: 'All',
      timeframe: '90d',
      minSubscribers: 10,
      sfwOnly: true,
      sortBy: 'created_desc',
      limit: 5
    });
    const hotRes = querySubreddits(subreddits, {
      category: 'All',
      timeframe: '90d',
      minSubscribers: 10,
      sfwOnly: true,
      sortBy: 'heat_desc',
      limit: 5
    });

    const digest = buildDailyDigestEmail({
      subscription: { category: 'All', deliveryTime: '08:00' },
      newlyCreated: newRes.newlyCreated,
      hottest90d: hotRes.hottest90d
    });

    const post = await reddit.submitPost({
      subredditName: subName,
      title: digest.subject,
      text: digest.markdown
    });

    res.json({
      navigateTo: post.url,
      showToast: { text: 'Posted today\'s floop Subreddit Digest thread!', appearance: 'success' }
    } satisfies UiResponse);
  } catch (err) {
    console.error('post-daily-digest error:', err);
    res.json({ showToast: 'Failed to post daily digest thread.' } satisfies UiResponse);
  }
});

app.post('/internal/menu/subscribe-alert', async (_req: Request, res: Response) => {
  const categoryOptions = [
    { label: 'All Categories', value: 'All' },
    ...CATEGORIES.map((c) => ({ label: c, value: c }))
  ];

  res.json({
    showForm: {
      name: 'subscribeForm',
      form: {
        title: 'Subscribe to floop Daily Subreddit Alerts',
        description: 'Receive daily newly created subreddits in your chosen category plus the hottest subreddits from the last 90 days.',
        acceptLabel: 'Activate Daily Alert',
        cancelLabel: 'Cancel',
        fields: [
          {
            name: 'email',
            label: 'Email Address',
            type: 'string',
            required: true,
            helpText: 'Daily digest target email'
          },
          {
            name: 'category',
            label: 'Category Focus',
            type: 'select',
            options: categoryOptions,
            defaultValue: ['All'],
            required: true
          },
          {
            name: 'minSubscribers',
            label: 'Minimum Subscribers',
            type: 'number',
            defaultValue: 10
          },
          {
            name: 'sendImmediate',
            label: 'Send First Digest Immediately',
            type: 'boolean',
            defaultValue: true
          }
        ]
      }
    }
  } satisfies UiResponse);
});

app.post('/internal/menu/sync-now', async (_req: Request, res: Response) => {
  try {
    const report = await syncLiveFromDevvitReddit();
    res.json({
      showToast: {
        text: `Synced ${report.total} real subreddits (${report.addedOrUpdated} live updates).`,
        appearance: 'success'
      }
    } satisfies UiResponse);
  } catch (err) {
    console.error('menu sync-now error:', err);
    res.json({ showToast: 'Sync failed — check Devvit logs.' } satisfies UiResponse);
  }
});

// ─── Devvit Form Submission ─────────────────────────────────────────────────

app.post('/internal/form/subscribe-submit', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      email?: string;
      category?: string[] | string;
      minSubscribers?: number;
      sendImmediate?: boolean;
    };

    const email = String(body.email || '').trim();
    const category = Array.isArray(body.category)
      ? body.category[0] || 'All'
      : String(body.category || 'All');
    const currentUser = await reddit.getCurrentUsername().catch(() => undefined);

    const result = await createSubscription({
      email,
      redditUsername: currentUser,
      category,
      minSubscribers: Number(body.minSubscribers ?? 10),
      newTimeframe: '90d',
      sfwOnly: category !== 'NSFW & Adult',
      sendImmediate: body.sendImmediate !== false
    });

    const deliveryNote = result.outboxEntry?.deliveredToRealInbox
      ? `First digest sent (${result.outboxEntry.providerUsed}).`
      : 'Saved daily alert & compiled welcome digest in floop Outbox.';

    res.json({
      showToast: {
        text: `Subscribed ${result.subscription.email} (${category}). ${deliveryNote}`,
        appearance: 'success'
      }
    } satisfies UiResponse);
  } catch (err) {
    res.json({
      showToast: err instanceof Error ? err.message : 'Subscription failed.'
    } satisfies UiResponse);
  }
});

// ─── Devvit Scheduler Cron Endpoints ────────────────────────────────────────

app.post('/internal/scheduler/daily-digest', async (_req: Request, res: Response) => {
  try {
    await syncLiveFromDevvitReddit();
    await runDailyDigestCron('Devvit 24h Scheduler (08:00 UTC)');

    const postThread = await settings.get<boolean>('autoPostDailyThread').catch(() => false);
    if (postThread && context.subredditName) {
      const { subreddits } = await loadSubredditIndex();
      const newRes = querySubreddits(subreddits, {
        category: 'All',
        timeframe: '90d',
        minSubscribers: 10,
        sfwOnly: true,
        sortBy: 'created_desc',
        limit: 5
      });
      const hotRes = querySubreddits(subreddits, {
        category: 'All',
        timeframe: '90d',
        minSubscribers: 10,
        sfwOnly: true,
        sortBy: 'heat_desc',
        limit: 5
      });
      const digest = buildDailyDigestEmail({
        subscription: { category: 'All', deliveryTime: '08:00' },
        newlyCreated: newRes.newlyCreated,
        hottest90d: hotRes.hottest90d
      });
      await reddit.submitPost({
        subredditName: context.subredditName,
        title: digest.subject,
        text: digest.markdown
      });
    }
  } catch (err) {
    console.error('daily-digest scheduler error:', err);
  }
  const resp: TaskResponse = {};
  res.json(resp);
});

app.post('/internal/scheduler/discovery-sync', async (req: Request, res: Response) => {
  const task = req.body as TaskRequest;
  console.log('Running Devvit hourly discovery sync:', task?.name);
  try {
    await syncLiveFromDevvitReddit();
  } catch (err) {
    console.error('discovery-sync scheduler error:', err);
  }
  const resp: TaskResponse = {};
  res.json(resp);
});

// ─── Devvit Web Client API Endpoints (/api/*) ───────────────────────────────

app.get('/api/radar', async (req: Request, res: Response) => {
  try {
    const {
      category = 'All',
      timeframe = '90d',
      minSubscribers = '0',
      minVelocity = '0',
      sfwOnly = 'true',
      mediaOnly = 'false',
      search = '',
      newSortBy = 'created_desc',
      hotSortBy = 'heat_desc'
    } = req.query as Record<string, string>;

    const { subreddits, meta } = await loadSubredditIndex();
    const sfwFlag = sfwOnly !== 'false' && sfwOnly !== '0';
    const mediaFlag = mediaOnly === 'true' || mediaOnly === '1';

    const newRes = querySubreddits(subreddits, {
      category,
      timeframe,
      minSubscribers: Number(minSubscribers) || 0,
      minVelocity: Number(minVelocity) || 0,
      sfwOnly: sfwFlag,
      mediaOnly: mediaFlag,
      search,
      sortBy: newSortBy,
      limit: 60,
      lastSyncAt: meta.lastSyncAt,
      lastSyncSources: meta.sources
    });

    const hotRes = querySubreddits(subreddits, {
      category,
      timeframe: '90d',
      minSubscribers: Number(minSubscribers) || 0,
      minVelocity: Number(minVelocity) || 0,
      sfwOnly: sfwFlag,
      mediaOnly: mediaFlag,
      search,
      sortBy: hotSortBy,
      limit: 60
    });

    const [auto, username] = await Promise.all([
      getAutomationSnapshot(),
      reddit.getCurrentUsername().catch(() => undefined)
    ]);

    res.json({
      categories: CATEGORIES,
      subredditContext: context.subredditName || null,
      username: username || null,
      categoryCounts: hotRes.categoryCounts,
      newCategoryCounts: newRes.categoryCounts,
      newlyCreated: newRes.newlyCreated,
      newlyCreatedTotal: newRes.newlyCreatedTotal,
      hottest90d: hotRes.hottest90d,
      hottest90dTotal: hotRes.hottest90dTotal,
      lastSyncAt: meta.lastSyncAt,
      lastSyncSources: meta.sources,
      stats: {
        totalTracked: hotRes.stats.totalTracked,
        newMatched: newRes.newlyCreatedTotal,
        hot90dMatched: hotRes.hottest90dTotal,
        topBreakout: hotRes.stats.topBreakout,
        activeAlerts: auto.subscriptions.filter((s) => s.status === 'active').length,
        emailsSentTotal: auto.outbox.length
      }
    });
  } catch (err) {
    console.error('/api/radar error:', err);
    res.status(500).json({ error: 'Failed to load live subreddit radar.' });
  }
});

app.post('/api/subreddits/sync', async (_req: Request, res: Response) => {
  try {
    const report = await syncLiveFromDevvitReddit();
    res.json({ ok: true, ...report });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Live Reddit sync failed.'
    });
  }
});

app.post('/api/subreddits/lookup', async (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: 'Subreddit name is required.' });
      return;
    }
    const record = await lookupSingleSubreddit(name);
    if (!record) {
      res.status(404).json({
        error: `Could not resolve r/${name} via Reddit API (it may be private, banned, or uncategorized).`
      });
      return;
    }
    res.json({ ok: true, subreddit: record });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed.' });
  }
});

app.get('/api/automations', async (_req: Request, res: Response) => {
  try {
    const snap = await getAutomationSnapshot();
    res.json(snap);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load automations.' });
  }
});

app.post('/api/automations/preview-digest', async (req: Request, res: Response) => {
  try {
    const payload = (req.body || {}) as Partial<{
      email: string;
      category: string;
      minSubscribers: number;
      newTimeframe: '24h' | '7d' | '30d' | '90d';
      newLimit: number;
      hot90dLimit: number;
      sfwOnly: boolean;
      deliveryTime: string;
    }>;
    const digest = await compileDigestForSubscription({
      email: payload.email || 'you@domain.com',
      category: payload.category || 'All',
      minSubscribers: Number(payload.minSubscribers) || 0,
      newTimeframe: payload.newTimeframe || '90d',
      newLimit: Number(payload.newLimit) || 5,
      hot90dLimit: Number(payload.hot90dLimit) || 5,
      sfwOnly: payload.sfwOnly !== false,
      deliveryTime: payload.deliveryTime || '08:00'
    });
    res.json(digest);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compile digest preview.' });
  }
});

app.post('/api/subscriptions', async (req: Request, res: Response) => {
  try {
    const username = await reddit.getCurrentUsername().catch(() => undefined);
    const result = await createSubscription({
      ...(req.body || {}),
      redditUsername: username
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create alert.'
    });
  }
});

app.post('/api/subscriptions/:id/send-now', async (req: Request, res: Response) => {
  try {
    const entry = await sendDigestForSubscriptionId(String(req.params.id), 'Manual 1-Click Dispatch');
    if (!entry) {
      res.status(404).json({ error: 'Subscription not found.' });
      return;
    }
    res.json({ ok: true, outboxEntry: entry });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dispatch digest.' });
  }
});

app.patch('/api/subscriptions/:id/toggle', async (req: Request, res: Response) => {
  const updated = await toggleSubscriptionStatus(String(req.params.id));
  if (!updated) {
    res.status(404).json({ error: 'Subscription not found.' });
    return;
  }
  res.json({ subscription: updated });
});

app.delete('/api/subscriptions/:id', async (req: Request, res: Response) => {
  const deleted = await deleteSubscriptionById(String(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: 'Subscription not found.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/automations/run-cron', async (_req: Request, res: Response) => {
  try {
    const cronRun = await runDailyDigestCron('Manual Daily Cron Trigger');
    res.json({ ok: true, cronRun });
  } catch (err) {
    res.status(500).json({ error: 'Cron trigger failed.' });
  }
});

const server = createServer(app);
server.on('error', (err) => console.error(`Devvit server error: ${err.stack || err.message}`));
server.listen(getServerPort());
