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
      fromEmail: process.env.SMTP_USER || 'alerts@floop.radar',
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

function getKvCredentials() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function mergeWithEnvDefaults(parsed = {}) {
  const def = defaultState();
  const savedCfg = parsed.transportConfig || {};
  const savedProvider = savedCfg.provider || 'ethereal';
  const effectiveProvider = (savedProvider === 'ethereal' && def.transportConfig.provider !== 'ethereal')
    ? def.transportConfig.provider
    : savedProvider;

  return {
    ...def,
    ...parsed,
    transportConfig: {
      ...def.transportConfig,
      ...savedCfg,
      provider: effectiveProvider,
      fromName: process.env.FLOOP_FROM_NAME || savedCfg.fromName || def.transportConfig.fromName,
      fromEmail: process.env.SMTP_FROM || process.env.FLOOP_FROM_EMAIL || def.transportConfig.smtp.user || savedCfg.fromEmail || def.transportConfig.fromEmail,
      smtp: {
        ...def.transportConfig.smtp,
        ...(savedCfg.smtp || {}),
        host: process.env.SMTP_HOST || savedCfg.smtp?.host || def.transportConfig.smtp.host,
        port: Number(process.env.SMTP_PORT || savedCfg.smtp?.port || def.transportConfig.smtp.port || 587),
        user: savedCfg.smtp?.user || def.transportConfig.smtp.user,
        pass: savedCfg.smtp?.pass || def.transportConfig.smtp.pass,
        fromEmail: process.env.SMTP_FROM || process.env.FLOOP_FROM_EMAIL || savedCfg.smtp?.fromEmail || ''
      },
      resend: {
        ...def.transportConfig.resend,
        ...(savedCfg.resend || {}),
        apiKey: savedCfg.resend?.apiKey || def.transportConfig.resend.apiKey,
        fromEmail: process.env.RESEND_FROM || savedCfg.resend?.fromEmail || def.transportConfig.resend.fromEmail
      },
      sendgrid: {
        ...def.transportConfig.sendgrid,
        ...(savedCfg.sendgrid || {}),
        apiKey: savedCfg.sendgrid?.apiKey || def.transportConfig.sendgrid.apiKey,
        fromEmail: process.env.SENDGRID_FROM || savedCfg.sendgrid?.fromEmail || def.transportConfig.sendgrid.fromEmail
      },
      webhookUrl: process.env.FLOOP_WEBHOOK_URL || savedCfg.webhookUrl || def.transportConfig.webhookUrl
    }
  };
}

function loadState() {
  if (memoryState) return memoryState;
  const targetFile = fs.existsSync(WRITABLE_AUTOMATIONS_FILE)
    ? WRITABLE_AUTOMATIONS_FILE
    : BUNDLED_AUTOMATIONS_FILE;

  if (!fs.existsSync(targetFile)) {
    const initial = defaultState();
    saveState(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    const merged = mergeWithEnvDefaults(parsed);
    memoryState = merged;
    return merged;
  } catch (e) {
    return memoryState || defaultState();
  }
}

async function hydrateStateFromKV() {
  const kv = getKvCredentials();
  if (!kv) return loadState();
  try {
    const res = await fetch(`${kv.url}/get/floop_automations_state`, {
      headers: { Authorization: `Bearer ${kv.token}` },
      signal: AbortSignal.timeout(4000)
    });
    const json = await res.json();
    if (json && json.result) {
      const parsed = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
      const merged = mergeWithEnvDefaults(parsed);
      memoryState = merged;
      try {
        fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
        fs.writeFileSync(WRITABLE_AUTOMATIONS_FILE, JSON.stringify(merged, null, 2));
      } catch (e) {}
      return merged;
    }
  } catch (e) {}
  return loadState();
}

async function persistStateToKV(state) {
  const kv = getKvCredentials();
  if (!kv) return;
  try {
    await fetch(`${kv.url}/set/floop_automations_state`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kv.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(JSON.stringify(state)),
      signal: AbortSignal.timeout(4000)
    });
  } catch (e) {}
}

function saveState(state) {
  memoryState = state;
  try {
    fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
    fs.writeFileSync(WRITABLE_AUTOMATIONS_FILE, JSON.stringify(state, null, 2));
  } catch (e) {}
  persistStateToKV(state).catch(() => {});
}

// Sync client-provided transportConfig on stateless serverless invocations
function applyInlineTransportOverride(inlineCfg) {
  if (!inlineCfg || typeof inlineCfg !== 'object') return;
  updateTransportConfig(inlineCfg);
}

function isRealInboxProviderConfigured(cfg) {
  if (!cfg) return false;
  if (cfg.provider === 'smtp' && cfg.smtp?.host && cfg.smtp?.user && cfg.smtp?.pass) return true;
  if (cfg.provider === 'resend' && cfg.resend?.apiKey) return true;
  if (cfg.provider === 'sendgrid' && cfg.sendgrid?.apiKey) return true;
  return false;
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
  let deliveryMode = 'sandbox_ethereal'; // 'real_inbox' | 'sandbox_ethereal'
  let messageId = '';
  let previewUrl = '';
  let providerNote = '';
  let primaryError = null;
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

  // 2) Primary Real Inbox Provider Dispatch (Gmail/Custom SMTP, Resend API, SendGrid API)
  try {
    if (cfg.provider === 'smtp') {
      if (!cfg.smtp?.host || !cfg.smtp?.user || !cfg.smtp?.pass) {
        throw new Error('SMTP username or App Password is missing. Enter your Gmail/SMTP credentials in Email Delivery Provider Config.');
      }
      const cleanPass = String(cfg.smtp.pass).replace(/\s+/g, '');
      const smtpTransporter = nodemailer.createTransport({
        host: cfg.smtp.host,
        port: Number(cfg.smtp.port) || 587,
        secure: Boolean(cfg.smtp.secure) || Number(cfg.smtp.port) === 465,
        auth: {
          user: cfg.smtp.user.trim(),
          pass: cleanPass
        }
      });
      const fromAddr = (
        cfg.smtp.fromEmail ||
        process.env.SMTP_FROM ||
        process.env.FLOOP_FROM_EMAIL ||
        (cfg.smtp.user.includes('@') ? cfg.smtp.user.trim() : '') ||
        cfg.fromEmail ||
        'alerts@floop.radar'
      ).trim();
      const info = await smtpTransporter.sendMail({
        from: `"${cfg.fromName || 'floop Daily Radar'}" <${fromAddr}>`,
        to,
        subject,
        text,
        html
      });
      messageId = info.messageId || `<smtp-${Date.now()}@floop.radar>`;
      providerUsed = `Direct SMTP (${cfg.smtp.host})`;
      deliveryMode = 'real_inbox';
      providerNote = `Delivered directly to ${to} via ${cfg.smtp.host} (${fromAddr}).`;
    } else if (cfg.provider === 'resend') {
      if (!cfg.resend?.apiKey) {
        throw new Error('Resend API Key is missing. Paste your re_... key in Email Delivery Provider Config.');
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.resend.apiKey.trim()}`,
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
      providerUsed = 'Resend Email API (Real Inbox)';
      deliveryMode = 'real_inbox';
      providerNote = `Delivered to ${to} via Resend API (ID: ${messageId}).`;
    } else if (cfg.provider === 'sendgrid') {
      if (!cfg.sendgrid?.apiKey) {
        throw new Error('SendGrid API Key is missing. Paste your SG... key in Email Delivery Provider Config.');
      }
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.sendgrid.apiKey.trim()}`,
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
        throw new Error(`SendGrid HTTP ${res.status}: ${errTxt.slice(0, 140)}`);
      }
      messageId = res.headers.get('x-message-id') || `sg-${Date.now()}`;
      providerUsed = 'SendGrid v3 API (Real Inbox)';
      deliveryMode = 'real_inbox';
      providerNote = `Delivered to ${to} via SendGrid API.`;
    }
  } catch (err) {
    primaryError = err.message;
  }

  // 3) Sandbox Catch-All (Ethereal SMTP) when no real provider is configured or if primary failed
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
      deliveryMode = 'sandbox_ethereal';
      providerUsed = 'Ethereal Sandbox Test SMTP (Webmail Only — Not Real Inbox)';
      providerNote = primaryError
        ? `Real provider (${cfg.provider}) failed: ${primaryError}. Captured in Ethereal test webmail instead.`
        : `Captured in Ethereal test webmail (${account.smtp.host}). Note: Ethereal is a test catch-all and does NOT deliver to external Gmail/Outlook inboxes. Configure Gmail SMTP or Resend in the Automations tab for real inbox delivery.`;
    } catch (ethErr) {
      messageId = `<local-${crypto.randomUUID()}@floop.radar>`;
      deliveryMode = 'sandbox_ethereal';
      providerUsed = 'Floop Local Outbox Preview';
      providerNote = primaryError || `Captured in local outbox (${ethErr.message})`;
    }
  }

  return {
    messageId,
    previewUrl,
    providerUsed,
    deliveryMode,
    providerNote,
    primaryError,
    webhookStatus
  };
}

async function sendDigestForSubscription(subscriptionId, triggerReason = 'Scheduled Daily Automation', inlineTransportConfig = null) {
  await hydrateStateFromKV();
  if (inlineTransportConfig) {
    applyInlineTransportOverride(inlineTransportConfig);
  }
  const state = loadState();
  const subIndex = state.subscriptions.findIndex(s => s.id === subscriptionId);
  if (subIndex === -1) {
    throw new Error(`Subscription not found: ${subscriptionId}`);
  }
  const sub = state.subscriptions[subIndex];

  const newQuery = querySubreddits({
    mode: 'new',
    category: sub.category || 'All',
    timeframe: sub.newTimeframe || '30d',
    minSubscribers: Number(sub.minSubscribers) || 0,
    sfwOnly: sub.sfwOnly !== false,
    sortBy: 'created_desc',
    limit: Number(sub.newLimit) || 6
  });

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
    deliveryMode: delivery.deliveryMode,
    providerNote: delivery.providerNote,
    primaryError: delivery.primaryError,
    messageId: delivery.messageId,
    previewUrl: delivery.previewUrl,
    webhookStatus: delivery.webhookStatus,
    triggerReason,
    status: delivery.deliveryMode === 'real_inbox' ? 'delivered_to_inbox' : 'captured_in_sandbox',
    sentAt: now.toISOString(),
    html,
    text
  };

  state.subscriptions[subIndex] = sub;
  state.outbox.unshift(outboxEntry);
  state.outbox = state.outbox.slice(0, 50);
  saveState(state);
  await persistStateToKV(state);

  return {
    subscription: sub,
    outboxEntry
  };
}

async function createSubscription(payload) {
  await hydrateStateFromKV();
  if (payload.transportConfig) {
    applyInlineTransportOverride(payload.transportConfig);
  }
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
    frequency: 'daily',
    status: 'active',
    createdAt: now.toISOString(),
    lastSentAt: null,
    lastSentDate: null,
    sendCount: 0,
    nextScheduledRun: computeNextScheduledIso(deliveryTime)
  };

  state.subscriptions.unshift(newSub);
  saveState(state);
  await persistStateToKV(state);

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

async function testTransportConnection(testPayload = {}) {
  if (testPayload.transportConfig) {
    applyInlineTransportOverride(testPayload.transportConfig);
  }
  const state = loadState();
  const cfg = state.transportConfig;

  if (cfg.provider === 'smtp') {
    if (!cfg.smtp?.host || !cfg.smtp?.user || !cfg.smtp?.pass) {
      throw new Error('Please enter your SMTP Host, Username (Gmail address), and App Password.');
    }
    const cleanPass = String(cfg.smtp.pass).replace(/\s+/g, '');
    const transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: Number(cfg.smtp.port) || 587,
      secure: Boolean(cfg.smtp.secure) || Number(cfg.smtp.port) === 465,
      auth: { user: cfg.smtp.user.trim(), pass: cleanPass }
    });
    await transporter.verify();
    return {
      ok: true,
      deliveryMode: 'real_inbox',
      provider: 'smtp',
      message: `SMTP connection to ${cfg.smtp.host}:${cfg.smtp.port} verified for ${cfg.smtp.user}. Real emails will now deliver directly to your inbox.`
    };
  }

  if (cfg.provider === 'resend') {
    if (!cfg.resend?.apiKey || !cfg.resend.apiKey.startsWith('re_')) {
      throw new Error('Please enter a valid Resend API key starting with "re_".');
    }
    return {
      ok: true,
      deliveryMode: 'real_inbox',
      provider: 'resend',
      message: `Resend API key configured (sender: ${cfg.resend.fromEmail || 'onboarding@resend.dev'}). Real emails will deliver via Resend.`
    };
  }

  if (cfg.provider === 'sendgrid') {
    if (!cfg.sendgrid?.apiKey) {
      throw new Error('Please enter a valid SendGrid API key.');
    }
    return {
      ok: true,
      deliveryMode: 'real_inbox',
      provider: 'sendgrid',
      message: 'SendGrid API key configured for real inbox delivery.'
    };
  }

  const { account } = await ensureEtherealTransporter();
  return {
    ok: true,
    deliveryMode: 'sandbox_ethereal',
    provider: 'ethereal',
    message: `Currently using Ethereal Sandbox Test SMTP (${account.user}). Emails are captured in the webmail preview and NOT sent to external Gmail/Outlook inboxes.`
  };
}

async function runDailyCronTick({ forceAll = false, reason = 'Automated Daily Cron Job (24h Schedule)' } = {}) {
  lastCronTickAt = new Date().toISOString();
  await hydrateStateFromKV();
  const state = loadState();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentHHMM = now.toISOString().slice(11, 16);

  const activeSubs = state.subscriptions.filter(s => s.status === 'active');
  const dueSubs = activeSubs.filter(sub => {
    if (forceAll) return true;
    if (sub.lastSentDate === todayStr) return false;
    if (sub.lastSentAt) {
      const elapsedMs = now.getTime() - new Date(sub.lastSentAt).getTime();
      if (elapsedMs >= 24 * 3600 * 1000) return true;
    }
    const targetHHMM = sub.deliveryTime || '08:00';
    return currentHHMM >= targetHHMM;
  });

  const results = [];
  if (dueSubs.length > 0) {
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
        deliveryMode: res.outboxEntry.deliveryMode,
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
    await persistStateToKV(latestState);
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
  ensureEtherealTransporter().catch(() => {});

  cronTask = cron.schedule('* * * * *', () => {
    runDailyCronTick({ forceAll: false }).catch(err => {
      console.error('[Floop Cron Error]:', err.message);
    });
  });
  lastCronTickAt = new Date().toISOString();
}

function getAutomationStatus() {
  const state = loadState();
  const realInboxActive = isRealInboxProviderConfigured(state.transportConfig);
  return {
    schedulerRunning: Boolean(cronTask) || Boolean(process.env.VERCEL),
    realInboxActive,
    kvConfigured: Boolean(getKvCredentials()),
    deliveryMode: realInboxActive ? 'real_inbox' : 'sandbox_ethereal',
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
        host: state.transportConfig.smtp?.host || 'smtp.gmail.com',
        port: state.transportConfig.smtp?.port || 587,
        user: state.transportConfig.smtp?.user || '',
        hasPassword: Boolean(state.transportConfig.smtp?.pass)
      },
      resend: {
        fromEmail: state.transportConfig.resend?.fromEmail || 'onboarding@resend.dev',
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
  hydrateStateFromKV,
  persistStateToKV,
  createSubscription,
  sendDigestForSubscription,
  runDailyCronTick,
  updateTransportConfig,
  testTransportConnection,
  toggleSubscriptionStatus,
  deleteSubscription
};
