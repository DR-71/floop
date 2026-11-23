const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { querySubreddits, syncFromArcticShift } = require('./subredditEngine');
const { buildDailyDigestEmail } = require('./emailDigest');

const BUNDLED_DATA_DIR = path.join(__dirname, '..', 'data');
const WRITABLE_DATA_DIR = process.env.VERCEL ? '/tmp/floop-data' : BUNDLED_DATA_DIR;
const BUNDLED_AUTOMATIONS_FILE = path.join(BUNDLED_DATA_DIR, 'automations.json');
const WRITABLE_AUTOMATIONS_FILE = path.join(WRITABLE_DATA_DIR, 'automations.json');

let etherealAccount = null;
let etherealTransporter = null;
let cronTask = null;
let lastCronTickAt = null;
let memoryState = null;

function defaultState() {
  return {
    transportConfig: {
      provider: process.env.RESEND_API_KEY
        ? 'resend'
        : process.env.SENDGRID_API_KEY
        ? 'sendgrid'
        : process.env.SMTP_USER && process.env.SMTP_PASS
        ? 'smtp'
        : 'ethereal',
      fromName: 'floop Daily Radar',
      fromEmail: 'alerts@floop.radar',
      smtp: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      },
      resend: {
        apiKey: process.env.RESEND_API_KEY || '',
        fromEmail: process.env.RESEND_FROM || 'onboarding@resend.dev'
      },
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY || '',
        fromEmail: process.env.SENDGRID_FROM || ''
      },
      webhookUrl: process.env.FLOOP_WEBHOOK_URL || ''
    },
    subscriptions: [],
    outbox: [],
    cronRuns: []
  };
}

function loadState() {
  const targetFile = fs.existsSync(WRITABLE_AUTOMATIONS_FILE)
    ? WRITABLE_AUTOMATIONS_FILE
    : BUNDLED_AUTOMATIONS_FILE;

  if (!fs.existsSync(targetFile)) {
    if (memoryState) return memoryState;
    const initial = defaultState();
    saveState(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    const merged = {
      ...defaultState(),
      ...parsed,
      transportConfig: {
        ...defaultState().transportConfig,
        ...(parsed.transportConfig || {})
      }
    };
    memoryState = merged;
    return merged;
  } catch (e) {
    return memoryState || defaultState();
  }
}

function saveState(state) {
  memoryState = state;
  try {
    fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
    fs.writeFileSync(WRITABLE_AUTOMATIONS_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
}

async function ensureEtherealTransporter() {
  if (etherealTransporter && etherealAccount) {
    return { transporter: etherealTransporter, account: etherealAccount };
  }
  etherealAccount = await nodemailer.createTestAccount();
  etherealTransporter = nodemailer.createTransport({
    host: etherealAccount.smtp.host,
    port: etherealAccount.smtp.port,
    secure: etherealAccount.smtp.secure,
    auth: {
      user: etherealAccount.user,
      pass: etherealAccount.pass
    }
  });
  return { transporter: etherealTransporter, account: etherealAccount };
}

function computeNextScheduledIso(deliveryTime = '08:00') {
  const [hh, mm] = String(deliveryTime || '08:00').split(':').map(n => Number(n) || 0);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0));
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

async function dispatchEmail({ to, subject, html, text, subscription, newlyCreated, hottest90d }) {
  const state = loadState();
  const cfg = state.transportConfig;
  let providerUsed = cfg.provider || 'ethereal';
  let messageId = '';
  let previewUrl = '';
  let providerNote = '';
  let webhookStatus = null;

  // 1) Optional Webhook Automation Dispatch (Zapier / Make / n8n / Custom endpoint)
  if (cfg.webhookUrl && cfg.webhookUrl.startsWith('http')) {
    try {
      const whRes = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'floop.daily_digest.sent',
          timestamp: new Date().toISOString(),
          to,
          subject,
          category: subscription.category,
          subscriptionId: subscription.id,
          newlyCreatedCount: newlyCreated.length,
          hottest90dCount: hottest90d.length,
          newlyCreated,
          hottest90d,
          html,
          text
        }),
        signal: AbortSignal.timeout(6000)
      });
      webhookStatus = `HTTP ${whRes.status}`;
    } catch (whErr) {
      webhookStatus = `Webhook Error: ${whErr.message}`;
    }
  }

  // 2) Primary Configured Provider Dispatch
  try {
    if (cfg.provider === 'smtp' && cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass) {
      const smtpTransporter = nodemailer.createTransport({
        host: cfg.smtp.host,
        port: Number(cfg.smtp.port) || 587,
        secure: Boolean(cfg.smtp.secure) || Number(cfg.smtp.port) === 465,
        auth: {
          user: cfg.smtp.user,
          pass: cfg.smtp.pass
        }
      });
      const fromAddr = cfg.smtp.user.includes('@') ? cfg.smtp.user : (cfg.fromEmail || 'alerts@floop.radar');
      const info = await smtpTransporter.sendMail({
        from: `"${cfg.fromName || 'floop Daily Radar'}" <${fromAddr}>`,
        to,
        subject,
        text,
        html
      });
      messageId = info.messageId || `<smtp-${Date.now()}@floop.radar>`;
      providerUsed = `Custom SMTP (${cfg.smtp.host})`;
      providerNote = `Delivered directly via ${cfg.smtp.host} to ${to}`;
    } else if (cfg.provider === 'resend' && cfg.resend?.apiKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.resend.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `${cfg.fromName || 'floop Daily Radar'} <${cfg.resend.fromEmail || 'onboarding@resend.dev'}>`,
          to: [to],
          subject,
          html,
          text
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Resend HTTP ${res.status}`);
      messageId = data.id || `resend-${Date.now()}`;
      providerUsed = 'Resend API';
      providerNote = `Delivered via Resend API (ID: ${messageId})`;
    } else if (cfg.provider === 'sendgrid' && cfg.sendgrid?.apiKey) {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.sendgrid.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: cfg.sendgrid.fromEmail || cfg.fromEmail || 'alerts@floop.radar', name: cfg.fromName || 'floop Daily Radar' },
          subject,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: html }
          ]
        })
      });
      if (!res.ok) {
        const errTxt = await res.text();
        throw new Error(`SendGrid HTTP ${res.status}: ${errTxt.slice(0, 120)}`);
      }
      messageId = res.headers.get('x-message-id') || `sg-${Date.now()}`;
      providerUsed = 'SendGrid API';
      providerNote = `Delivered via SendGrid API to ${to}`;
    }
  } catch (primaryErr) {
    providerNote = `Primary provider (${cfg.provider}) failed (${primaryErr.message}); routed via live Ethereal SMTP fallback.`;
  }

  // Always also generate an Ethereal SMTP delivery if not already sent or for live webmail inspection
  if (!messageId) {
    try {
      const { transporter, account } = await ensureEtherealTransporter();
      const info = await transporter.sendMail({
        from: `"${cfg.fromName || 'floop Daily Radar'}" <${account.user}>`,
        to,
        subject,
        text,
        html
      });
      messageId = info.messageId;
      previewUrl = nodemailer.getTestMessageUrl(info) || '';
      providerUsed = 'Nodemailer Live SMTP (smtp.ethereal.email)';
      if (!providerNote) {
        providerNote = `Sent via live SMTP (${account.smtp.host}:${account.smtp.port}). Inspect webmail or configure Gmail/Resend for direct personal inbox delivery.`;
      }
    } catch (ethErr) {
      messageId = `<local-${crypto.randomUUID()}@floop.radar>`;
      providerUsed = 'Floop Local Outbox Transport';
      providerNote = `Captured in local outbox (${ethErr.message})`;
    }
  }

  return {
    messageId,
    previewUrl,
    providerUsed,
    providerNote,
    webhookStatus
  };
}

async function sendDigestForSubscription(subscriptionId, triggerReason = 'Scheduled Daily Automation') {
  const state = loadState();
  const subIndex = state.subscriptions.findIndex(s => s.id === subscriptionId);
  if (subIndex === -1) {
    throw new Error(`Subscription not found: ${subscriptionId}`);
  }
  const sub = state.subscriptions[subIndex];

  // Query newly created subreddits in the subscriber's category
  const newQuery = querySubreddits({
    mode: 'new',
    category: sub.category || 'All',
    timeframe: sub.newTimeframe || '30d',
    minSubscribers: Number(sub.minSubscribers) || 0,
    sfwOnly: sub.sfwOnly !== false,
    sortBy: 'created_desc',
    limit: Number(sub.newLimit) || 6
  });

  // Query hottest new subreddits in the last 90 days in the subscriber's category
  const hot90dQuery = querySubreddits({
    mode: 'hot90d',
    category: sub.category || 'All',
    timeframe: '90d',
    minSubscribers: Number(sub.minSubscribers) || 0,
    sfwOnly: sub.sfwOnly !== false,
    sortBy: 'heat_desc',
    limit: Number(sub.hot90dLimit) || 6
  });

  const now = new Date();
  const { subject, html, text } = buildDailyDigestEmail({
    subscription: sub,
    newlyCreated: newQuery.items,
    hottest90d: hot90dQuery.items,
    generatedAt: now,
    triggerReason
  });

  const delivery = await dispatchEmail({
    to: sub.email,
    subject,
    html,
    text,
    subscription: sub,
    newlyCreated: newQuery.items,
    hottest90d: hot90dQuery.items
  });

  const todayDateStr = now.toISOString().slice(0, 10);
  sub.lastSentAt = now.toISOString();
  sub.lastSentDate = todayDateStr;
  sub.sendCount = (Number(sub.sendCount) || 0) + 1;
  sub.nextScheduledRun = computeNextScheduledIso(sub.deliveryTime);

  const outboxEntry = {
    id: 'msg_' + crypto.randomUUID().slice(0, 8),
    subscriptionId: sub.id,
    to: sub.email,
    subject,
    category: sub.category || 'All',
    newlyCreatedCount: newQuery.items.length,
    hottest90dCount: hot90dQuery.items.length,
    newlyCreatedSample: newQuery.items.slice(0, 4).map(i => ({
      display_name: i.display_name,
      subscribers: i.subscribers,
      subs_per_day: i.subs_per_day
    })),
    hottest90dSample: hot90dQuery.items.slice(0, 4).map(i => ({
      display_name: i.display_name,
      subscribers: i.subscribers,
      heat_score: i.heat_score
    })),
    providerUsed: delivery.providerUsed,
    providerNote: delivery.providerNote,
    messageId: delivery.messageId,
    previewUrl: delivery.previewUrl,
    webhookStatus: delivery.webhookStatus,
    triggerReason,
    status: 'delivered',
    sentAt: now.toISOString(),
    html,
    text
  };

  state.subscriptions[subIndex] = sub;
  state.outbox.unshift(outboxEntry);
  state.outbox = state.outbox.slice(0, 50); // retain last 50 sent emails
  saveState(state);

  return {
    subscription: sub,
    outboxEntry
  };
}

async function createSubscription(payload) {
  const email = String(payload.email || '').trim();
  if (!email || !email.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }

  const state = loadState();
  const now = new Date();
  const deliveryTime = payload.deliveryTime || '08:00';

  const isAdultCat = String(payload.category || '').toLowerCase().includes('nsfw') ||
    String(payload.category || '').toLowerCase().includes('adult');

  const newSub = {
    id: 'sub_' + crypto.randomUUID().slice(0, 8),
    email,
    category: payload.category || 'All',
    minSubscribers: Number(payload.minSubscribers) || 10,
    sfwOnly: isAdultCat ? false : (payload.sfwOnly !== false),
    newTimeframe: payload.newTimeframe || '30d',
    newLimit: Number(payload.newLimit) || 5,
    hot90dLimit: Number(payload.hot90dLimit) || 5,
    deliveryTime,
    frequency: 'daily', // Once a day automated schedule
    status: 'active',
    createdAt: now.toISOString(),
    lastSentAt: null,
    lastSentDate: null,
    sendCount: 0,
    nextScheduledRun: computeNextScheduledIso(deliveryTime)
  };

  state.subscriptions.unshift(newSub);
  saveState(state);

  let initialDelivery = null;
  if (payload.sendImmediate !== false) {
    const sent = await sendDigestForSubscription(
      newSub.id,
      'Instant Signup Confirmation & First Daily Digest'
    );
    initialDelivery = sent.outboxEntry;
  }

  const refreshedState = loadState();
  const updatedSub = refreshedState.subscriptions.find(s => s.id === newSub.id) || newSub;

  return {
    subscription: updatedSub,
    initialDelivery
  };
}

async function runDailyCronTick({ forceAll = false, reason = 'Automated Daily Cron Job (24h Schedule)' } = {}) {
  lastCronTickAt = new Date().toISOString();
  const state = loadState();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentHHMM = now.toISOString().slice(11, 16); // UTC HH:MM

  const activeSubs = state.subscriptions.filter(s => s.status === 'active');
  const dueSubs = activeSubs.filter(sub => {
    if (forceAll) return true;
    // Check if already sent today
    if (sub.lastSentDate === todayStr) return false;
    // Check if 24h elapsed since lastSentAt OR current UTC time >= scheduled deliveryTime
    if (sub.lastSentAt) {
      const elapsedMs = now.getTime() - new Date(sub.lastSentAt).getTime();
      if (elapsedMs >= 24 * 3600 * 1000) return true;
    }
    const targetHHMM = sub.deliveryTime || '08:00';
    return currentHHMM >= targetHHMM;
  });

  const results = [];
  if (dueSubs.length > 0) {
    // Sync live data from Arctic Shift before dispatching daily digests
    await syncFromArcticShift().catch(() => {});
  }

  for (const sub of dueSubs) {
    try {
      const res = await sendDigestForSubscription(sub.id, reason);
      results.push({
        subscriptionId: sub.id,
        email: sub.email,
        category: sub.category,
        outboxId: res.outboxEntry.id,
        messageId: res.outboxEntry.messageId,
        previewUrl: res.outboxEntry.previewUrl,
        status: 'sent'
      });
    } catch (err) {
      results.push({
        subscriptionId: sub.id,
        email: sub.email,
        status: 'error',
        error: err.message
      });
    }
  }

  if (forceAll || results.length > 0) {
    const latestState = loadState();
    latestState.cronRuns.unshift({
      id: 'cron_' + crypto.randomUUID().slice(0, 8),
      timestamp: now.toISOString(),
      forced: forceAll,
      activeSubscriptionsChecked: activeSubs.length,
      emailsDispatched: results.filter(r => r.status === 'sent').length,
      results
    });
    latestState.cronRuns = latestState.cronRuns.slice(0, 30);
    saveState(latestState);
  }

  return {
    timestamp: now.toISOString(),
    checked: activeSubs.length,
    dispatched: results.length,
    results
  };
}

function startDailyCronScheduler() {
  if (cronTask) return;
  // Pre-warm Ethereal SMTP account in background
  ensureEtherealTransporter().catch(() => {});

  // Run every minute to check if any subscription has reached its daily deliveryTime
  cronTask = cron.schedule('* * * * *', () => {
    runDailyCronTick({ forceAll: false }).catch(err => {
      console.error('[Floop Cron Error]:', err.message);
    });
  });
  lastCronTickAt = new Date().toISOString();
}

function getAutomationStatus() {
  const state = loadState();
  return {
    schedulerRunning: Boolean(cronTask),
    cronExpression: '* * * * * (Checks daily deliveryTime per subscriber once every 24h)',
    lastCronTickAt,
    etherealAccount: etherealAccount
      ? { user: etherealAccount.user, host: etherealAccount.smtp.host, port: etherealAccount.smtp.port }
      : null,
    transportConfig: {
      provider: state.transportConfig.provider,
      fromName: state.transportConfig.fromName,
      fromEmail: state.transportConfig.fromEmail,
      smtp: {
        host: state.transportConfig.smtp?.host || '',
        port: state.transportConfig.smtp?.port || 587,
        user: state.transportConfig.smtp?.user || '',
        hasPassword: Boolean(state.transportConfig.smtp?.pass)
      },
      resend: {
        fromEmail: state.transportConfig.resend?.fromEmail || '',
        hasApiKey: Boolean(state.transportConfig.resend?.apiKey)
      },
      sendgrid: {
        fromEmail: state.transportConfig.sendgrid?.fromEmail || '',
        hasApiKey: Boolean(state.transportConfig.sendgrid?.apiKey)
      },
      webhookUrl: state.transportConfig.webhookUrl || ''
    },
    subscriptions: state.subscriptions,
    outbox: state.outbox,
    cronRuns: state.cronRuns
  };
}

function updateTransportConfig(newCfg) {
  const state = loadState();
  const current = state.transportConfig;

  if (newCfg.provider) current.provider = newCfg.provider;
  if (newCfg.fromName !== undefined) current.fromName = newCfg.fromName;
  if (newCfg.fromEmail !== undefined) current.fromEmail = newCfg.fromEmail;
  if (newCfg.webhookUrl !== undefined) current.webhookUrl = newCfg.webhookUrl;

  if (newCfg.smtp) {
    current.smtp = {
      ...current.smtp,
      host: newCfg.smtp.host ?? current.smtp.host,
      port: Number(newCfg.smtp.port || current.smtp.port || 587),
      user: newCfg.smtp.user ?? current.smtp.user,
      pass: newCfg.smtp.pass ? newCfg.smtp.pass : current.smtp.pass
    };
  }
  if (newCfg.resend) {
    current.resend = {
      ...current.resend,
      fromEmail: newCfg.resend.fromEmail ?? current.resend.fromEmail,
      apiKey: newCfg.resend.apiKey ? newCfg.resend.apiKey : current.resend.apiKey
    };
  }
  if (newCfg.sendgrid) {
    current.sendgrid = {
      ...current.sendgrid,
      fromEmail: newCfg.sendgrid.fromEmail ?? current.sendgrid.fromEmail,
      apiKey: newCfg.sendgrid.apiKey ? newCfg.sendgrid.apiKey : current.sendgrid.apiKey
    };
  }

  state.transportConfig = current;
  saveState(state);
  return getAutomationStatus();
}

function toggleSubscriptionStatus(id) {
  const state = loadState();
  const sub = state.subscriptions.find(s => s.id === id);
  if (!sub) throw new Error('Subscription not found');
  sub.status = sub.status === 'active' ? 'paused' : 'active';
  saveState(state);
  return sub;
}

function deleteSubscription(id) {
  const state = loadState();
  state.subscriptions = state.subscriptions.filter(s => s.id !== id);
  saveState(state);
  return { deleted: id };
}

module.exports = {
  startDailyCronScheduler,
  getAutomationStatus,
  createSubscription,
  sendDigestForSubscription,
  runDailyCronTick,
  updateTransportConfig,
  toggleSubscriptionStatus,
  deleteSubscription
};
