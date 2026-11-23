const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  CATEGORIES,
  loadSubreddits,
  syncFromArcticShift,
  querySubreddits
} = require('./src/subredditEngine');
const {
  startDailyCronScheduler,
  getAutomationStatus,
  createSubscription,
  sendDigestForSubscription,
  runDailyCronTick,
  updateTransportConfig,
  testTransportConnection,
  toggleSubscriptionStatus,
  deleteSubscription
} = require('./src/automationEngine');
const { buildDailyDigestEmail } = require('./src/emailDigest');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure dataset is initialized and start the daily automated cron scheduler on long-running servers
loadSubreddits();
if (!process.env.VERCEL) {
  startDailyCronScheduler();
}

// 1. Query subreddits with filters
app.get('/api/subreddits', (req, res) => {
  try {
    const result = querySubreddits({
      mode: req.query.mode || 'all',
      category: req.query.category || 'All',
      timeframe: req.query.timeframe || '90d',
      minSubscribers: Number(req.query.minSubscribers) || 0,
      maxSubscribers: Number(req.query.maxSubscribers) || 0,
      minVelocity: Number(req.query.minVelocity) || 0,
      minActivity: Number(req.query.minActivity) || 0,
      sfwOnly: req.query.sfwOnly !== 'false',
      mediaOnly: req.query.mediaOnly === 'true',
      search: req.query.search || '',
      sortBy: req.query.sortBy || 'default',
      limit: Number(req.query.limit) || 100
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Combined Radar Endpoint (Newly Created + Hottest Last 90 Days + Stats)
app.get('/api/radar', (req, res) => {
  try {
    const commonFilters = {
      category: req.query.category || 'All',
      minSubscribers: Number(req.query.minSubscribers) || 0,
      maxSubscribers: Number(req.query.maxSubscribers) || 0,
      minVelocity: Number(req.query.minVelocity) || 0,
      minActivity: Number(req.query.minActivity) || 0,
      sfwOnly: req.query.sfwOnly !== 'false',
      mediaOnly: req.query.mediaOnly === 'true',
      search: req.query.search || ''
    };

    const newlyCreated = querySubreddits({
      ...commonFilters,
      mode: 'new',
      timeframe: req.query.timeframe || '30d',
      sortBy: req.query.newSortBy || 'created_desc',
      limit: Number(req.query.limit) || 60
    });

    const hottest90d = querySubreddits({
      ...commonFilters,
      mode: 'hot90d',
      timeframe: '90d',
      sortBy: req.query.hotSortBy || 'heat_desc',
      limit: Number(req.query.limit) || 60
    });

    const autoStatus = getAutomationStatus();
    const topBreakout = hottest90d.items[0] || null;

    res.json({
      newlyCreated: newlyCreated.items,
      newlyCreatedTotal: newlyCreated.totalMatched,
      hottest90d: hottest90d.items,
      hottest90dTotal: hottest90d.totalMatched,
      categoryCounts: hottest90d.categoryCounts,
      newCategoryCounts: newlyCreated.categoryCounts,
      categories: CATEGORIES,
      stats: {
        totalTracked: hottest90d.categoryCounts.All || 0,
        newMatched: newlyCreated.totalMatched,
        hot90dMatched: hottest90d.totalMatched,
        topBreakout: topBreakout
          ? {
              display_name: topBreakout.display_name,
              subscribers: topBreakout.subscribers,
              subs_per_day: topBreakout.subs_per_day,
              heat_score: topBreakout.heat_score,
              category: topBreakout.category
            }
          : null,
        activeAlerts: autoStatus.subscriptions.filter(s => s.status === 'active').length,
        emailsSentTotal: autoStatus.outbox.length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Live sync with Arctic Shift / Reddit discovery index
app.post('/api/subreddits/sync', async (req, res) => {
  try {
    const syncInfo = await syncFromArcticShift();
    res.json(syncInfo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Get full Email Automation & Cron Scheduler Status
app.get('/api/automations', (req, res) => {
  try {
    res.json(getAutomationStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Subscribe to Daily Email Alerts (and optionally dispatch immediate welcome digest)
app.post('/api/subscriptions', async (req, res) => {
  try {
    const result = await createSubscription(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6. Trigger immediate daily digest email for a specific subscription
app.post('/api/subscriptions/:id/send-now', async (req, res) => {
  try {
    const result = await sendDigestForSubscription(
      req.params.id,
      req.body?.reason || 'Manual 1-Click Test Dispatch',
      req.body?.transportConfig || null
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Pause / Resume a subscription
app.patch('/api/subscriptions/:id/toggle', (req, res) => {
  try {
    const updated = toggleSubscriptionStatus(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. Delete a subscription
app.delete('/api/subscriptions/:id', (req, res) => {
  try {
    const result = deleteSubscription(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 9. Force a Daily Cron Job Execution across all active subscriptions
app.post('/api/automations/run-cron', async (req, res) => {
  try {
    if (req.body?.transportConfig) {
      updateTransportConfig(req.body.transportConfig);
    }
    const result = await runDailyCronTick({
      forceAll: true,
      reason: 'Triggered Daily Cron Batch Run (All Active Subscriptions)'
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Generate a Live Digest Email Preview before or after subscribing
app.post('/api/automations/preview-digest', (req, res) => {
  try {
    const category = req.body.category || 'All';
    const minSubscribers = Number(req.body.minSubscribers) || 10;
    const sfwOnly = req.body.sfwOnly !== false;
    const newLimit = Number(req.body.newLimit) || 5;
    const hot90dLimit = Number(req.body.hot90dLimit) || 5;

    const newlyCreated = querySubreddits({
      mode: 'new',
      category,
      timeframe: req.body.newTimeframe || '30d',
      minSubscribers,
      sfwOnly,
      sortBy: 'created_desc',
      limit: newLimit
    }).items;

    const hottest90d = querySubreddits({
      mode: 'hot90d',
      category,
      timeframe: '90d',
      minSubscribers,
      sfwOnly,
      sortBy: 'heat_desc',
      limit: hot90dLimit
    }).items;

    const preview = buildDailyDigestEmail({
      subscription: {
        id: 'preview_live',
        email: req.body.email || 'you@example.com',
        category,
        minSubscribers,
        sfwOnly,
        deliveryTime: req.body.deliveryTime || '08:00'
      },
      newlyCreated,
      hottest90d,
      generatedAt: new Date(),
      triggerReason: 'Live Interactive Digest Preview'
    });

    res.json({
      ...preview,
      newlyCreatedCount: newlyCreated.length,
      hottest90dCount: hottest90d.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Update Email Transport / Delivery Provider Configuration
app.put('/api/automations/transport', (req, res) => {
  try {
    const status = updateTransportConfig(req.body);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 11b. Verify Email Transport Connection (SMTP / Resend / SendGrid / Ethereal)
app.post('/api/automations/test-transport', async (req, res) => {
  try {
    const result = await testTransportConnection(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 12. Native Vercel Cron Job Endpoint (Invoked automatically once a day by Vercel Crons)
app.get('/api/automations/cron', async (req, res) => {
  try {
    const result = await runDailyCronTick({
      forceAll: true,
      reason: 'Vercel Scheduled Daily Cron Job (24h Automation)'
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`floop server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
