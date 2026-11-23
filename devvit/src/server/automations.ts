import { reddit, redis, settings } from '@devvit/web/server';
import type { CronRunRecord, OutboxEntry, SubredditRecord, Subscription } from '../shared/types.js';
import { buildDailyDigestEmail } from './emailDigest.js';
import { loadSubredditIndex } from './redditDiscovery.js';
import { querySubreddits } from './subredditCore.js';

const REDIS_SUBS_KEY = 'floop:subscriptions:v1';
const REDIS_OUTBOX_KEY = 'floop:outbox:v1';
const REDIS_CRON_KEY = 'floop:cron_runs:v1';

async function readJsonArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await redis.get(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(key: string, items: T[], maxItems = 100): Promise<void> {
  await redis.set(key, JSON.stringify(items.slice(0, maxItems)));
}

export async function getAutomationSnapshot(): Promise<{
  subscriptions: Subscription[];
  outbox: OutboxEntry[];
  cronRuns: CronRunRecord[];
  emailConfigured: boolean;
  providerSummary: string;
}> {
  const [subscriptions, outbox, cronRuns] = await Promise.all([
    readJsonArray<Subscription>(REDIS_SUBS_KEY),
    readJsonArray<OutboxEntry>(REDIS_OUTBOX_KEY),
    readJsonArray<CronRunRecord>(REDIS_CRON_KEY)
  ]);

  let resendKey = '';
  let sendgridKey = '';
  let fromEmail = 'floop <onboarding@resend.dev>';
  try {
    resendKey = (await settings.get<string>('resendApiKey')) || '';
    sendgridKey = (await settings.get<string>('sendgridApiKey')) || '';
    fromEmail = (await settings.get<string>('fromEmail')) || fromEmail;
  } catch {
    // Ignore outside Devvit runtime
  }

  const emailConfigured = Boolean(resendKey || sendgridKey);
  const providerSummary = resendKey
    ? `Resend HTTPS API (${fromEmail})`
    : sendgridKey
      ? `SendGrid HTTPS API (${fromEmail})`
      : 'Devvit Outbox + Reddit PM (Add Resend/SendGrid key in App Settings for direct inbox email)';

  return {
    subscriptions,
    outbox,
    cronRuns,
    emailConfigured,
    providerSummary
  };
}

export async function compileDigestForSubscription(
  sub: Partial<Subscription>,
  allSubreddits?: SubredditRecord[]
) {
  const list = allSubreddits || (await loadSubredditIndex()).subreddits;
  const isAdult = String(sub.category || '').toLowerCase().includes('nsfw') ||
    String(sub.category || '').toLowerCase().includes('adult');

  const newRes = querySubreddits(list, {
    category: sub.category || 'All',
    timeframe: sub.newTimeframe || '90d',
    minSubscribers: Number(sub.minSubscribers) || 0,
    sfwOnly: isAdult ? false : sub.sfwOnly !== false,
    sortBy: 'created_desc',
    limit: Number(sub.newLimit) || 5
  });

  const hotRes = querySubreddits(list, {
    category: sub.category || 'All',
    timeframe: '90d',
    minSubscribers: Number(sub.minSubscribers) || 0,
    sfwOnly: isAdult ? false : sub.sfwOnly !== false,
    sortBy: 'heat_desc',
    limit: Number(sub.hot90dLimit) || 5
  });

  const built = buildDailyDigestEmail({
    subscription: sub,
    newlyCreated: newRes.newlyCreated,
    hottest90d: hotRes.hottest90d
  });

  return {
    ...built,
    newlyCreatedCount: newRes.newlyCreated.length,
    hottest90dCount: hotRes.hottest90d.length
  };
}

async function dispatchDigestViaHttpsOrReddit(params: {
  toEmail: string;
  redditUsername?: string;
  subject: string;
  html: string;
  text: string;
  markdown: string;
}): Promise<{
  providerUsed: string;
  deliveredToRealInbox: boolean;
  error?: string;
}> {
  let resendKey = '';
  let sendgridKey = '';
  let fromEmail = 'floop <onboarding@resend.dev>';

  try {
    resendKey = (await settings.get<string>('resendApiKey')) || '';
    sendgridKey = (await settings.get<string>('sendgridApiKey')) || '';
    fromEmail = (await settings.get<string>('fromEmail')) || fromEmail;
  } catch {
    // Ignore outside Devvit runtime
  }

  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [params.toEmail],
          subject: params.subject,
          html: params.html,
          text: params.text
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        return {
          providerUsed: 'Resend HTTPS API',
          deliveredToRealInbox: true
        };
      }
      const errBody = await res.text();
      return {
        providerUsed: 'Resend Error -> In-App Outbox',
        deliveredToRealInbox: false,
        error: `Resend HTTP ${res.status}: ${errBody.slice(0, 180)}`
      };
    } catch (err) {
      return {
        providerUsed: 'Resend Timeout/Blocked -> In-App Outbox',
        deliveredToRealInbox: false,
        error: err instanceof Error ? err.message : 'Resend request failed'
      };
    }
  }

  if (sendgridKey) {
    try {
      const match = fromEmail.match(/^(.*)<([^>]+)>$/);
      const fromObj = match
        ? { name: match[1].trim(), email: match[2].trim() }
        : { name: 'floop', email: fromEmail.trim() };

      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: params.toEmail }] }],
          from: fromObj,
          subject: params.subject,
          content: [
            { type: 'text/plain', value: params.text },
            { type: 'text/html', value: params.html }
          ]
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        return {
          providerUsed: 'SendGrid HTTPS API',
          deliveredToRealInbox: true
        };
      }
      const errBody = await res.text();
      return {
        providerUsed: 'SendGrid Error -> In-App Outbox',
        deliveredToRealInbox: false,
        error: `SendGrid HTTP ${res.status}: ${errBody.slice(0, 180)}`
      };
    } catch (err) {
      return {
        providerUsed: 'SendGrid Error -> In-App Outbox',
        deliveredToRealInbox: false,
        error: err instanceof Error ? err.message : 'SendGrid request failed'
      };
    }
  }

  // Fallback: send Reddit Private Message if Reddit username is known, always log to Redis Outbox
  if (params.redditUsername) {
    try {
      await reddit.sendPrivateMessage({
        to: params.redditUsername,
        subject: params.subject.slice(0, 95),
        text: params.markdown
      });
      return {
        providerUsed: `Reddit PM (@u/${params.redditUsername}) + Outbox`,
        deliveredToRealInbox: true
      };
    } catch {
      // Fall through to Outbox
    }
  }

  return {
    providerUsed: 'Devvit Redis Outbox (Configure resendApiKey in App Settings for email)',
    deliveredToRealInbox: false
  };
}

export async function createSubscription(input: {
  email: string;
  redditUsername?: string;
  category?: string;
  deliveryTime?: string;
  minSubscribers?: number;
  newTimeframe?: '24h' | '7d' | '30d' | '90d';
  newLimit?: number;
  hot90dLimit?: number;
  sfwOnly?: boolean;
  sendImmediate?: boolean;
}): Promise<{ subscription: Subscription; outboxEntry: OutboxEntry | null }> {
  const email = String(input.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please provide a valid email address.');
  }

  const subs = await readJsonArray<Subscription>(REDIS_SUBS_KEY);
  const newSub: Subscription = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    email,
    redditUsername: input.redditUsername || undefined,
    category: input.category || 'All',
    deliveryTime: input.deliveryTime || '08:00',
    minSubscribers: Number(input.minSubscribers) || 0,
    newTimeframe: input.newTimeframe || '90d',
    newLimit: Number(input.newLimit) || 5,
    hot90dLimit: Number(input.hot90dLimit) || 5,
    sfwOnly: input.sfwOnly !== false,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastSentAt: null,
    sendCount: 0
  };

  subs.unshift(newSub);
  await writeJsonArray(REDIS_SUBS_KEY, subs, 100);

  let outboxEntry: OutboxEntry | null = null;
  if (input.sendImmediate !== false) {
    outboxEntry = await sendDigestForSubscriptionId(newSub.id, 'Welcome Digest');
  }

  return { subscription: newSub, outboxEntry };
}

export async function sendDigestForSubscriptionId(
  subId: string,
  reason = 'Daily Cron Schedule'
): Promise<OutboxEntry | null> {
  const subs = await readJsonArray<Subscription>(REDIS_SUBS_KEY);
  const sub = subs.find((s) => s.id === subId);
  if (!sub) return null;

  const digest = await compileDigestForSubscription(sub);
  const delivery = await dispatchDigestViaHttpsOrReddit({
    toEmail: sub.email,
    redditUsername: sub.redditUsername,
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
    markdown: digest.markdown
  });

  const entry: OutboxEntry = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    subscriptionId: sub.id,
    to: sub.email,
    category: sub.category,
    subject: digest.subject,
    providerUsed: delivery.providerUsed,
    deliveredToRealInbox: delivery.deliveredToRealInbox,
    reason,
    newlyCreatedCount: digest.newlyCreatedCount,
    hottest90dCount: digest.hottest90dCount,
    sentAt: new Date().toISOString(),
    html: digest.html,
    ...(delivery.error ? { error: delivery.error } : {})
  };

  sub.lastSentAt = entry.sentAt;
  sub.sendCount = (sub.sendCount || 0) + 1;

  const outbox = await readJsonArray<OutboxEntry>(REDIS_OUTBOX_KEY);
  outbox.unshift(entry);

  await Promise.all([
    writeJsonArray(REDIS_SUBS_KEY, subs, 100),
    writeJsonArray(REDIS_OUTBOX_KEY, outbox, 30)
  ]);

  return entry;
}

export async function toggleSubscriptionStatus(subId: string): Promise<Subscription | null> {
  const subs = await readJsonArray<Subscription>(REDIS_SUBS_KEY);
  const sub = subs.find((s) => s.id === subId);
  if (!sub) return null;
  sub.status = sub.status === 'active' ? 'paused' : 'active';
  await writeJsonArray(REDIS_SUBS_KEY, subs, 100);
  return sub;
}

export async function deleteSubscriptionById(subId: string): Promise<boolean> {
  const subs = await readJsonArray<Subscription>(REDIS_SUBS_KEY);
  const filtered = subs.filter((s) => s.id !== subId);
  if (filtered.length === subs.length) return false;
  await writeJsonArray(REDIS_SUBS_KEY, filtered, 100);
  return true;
}

export async function runDailyDigestCron(trigger = 'Scheduled 24h Cron'): Promise<CronRunRecord> {
  const subs = await readJsonArray<Subscription>(REDIS_SUBS_KEY);
  const active = subs.filter((s) => s.status === 'active');
  let deliveredCount = 0;

  for (const sub of active) {
    const entry = await sendDigestForSubscriptionId(sub.id, trigger);
    if (entry) deliveredCount++;
  }

  const record: CronRunRecord = {
    id: `cron_${Date.now()}`,
    ranAt: new Date().toISOString(),
    trigger,
    processedSubscriptions: active.length,
    deliveredCount
  };

  const runs = await readJsonArray<CronRunRecord>(REDIS_CRON_KEY);
  runs.unshift(record);
  await writeJsonArray(REDIS_CRON_KEY, runs, 30);
  return record;
}
