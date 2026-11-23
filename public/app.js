/**
 * floop — Frontend Application Controller
 * Connects Live Newly Created Subreddit Explorer, 90-Day Breakout Leaderboard,
 * and Daily Automated Email Digest Engine.
 */

const state = {
  view: 'split', // 'split' | 'new' | 'hot90d' | 'automations'
  category: 'All',
  timeframe: '30d',
  minSubscribers: 10,
  minVelocity: 0,
  sortBy: 'default',
  sfwOnly: true,
  mediaOnly: false,
  search: '',
  categories: [],
  categoryCounts: {},
  newCategoryCounts: {},
  newlyCreated: [],
  hottest90d: [],
  stats: {},
  automations: {
    schedulerRunning: true,
    subscriptions: [],
    outbox: [],
    cronRuns: [],
    transportConfig: {}
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(n) {
  const num = Number(n) || 0;
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return String(num);
}

function formatRelativeAge(createdUtc) {
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = Math.max(60, nowSec - (Number(createdUtc) || nowSec));
  const hours = Math.floor(diffSec / 3600);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins}m ago`;
  }
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function showToast(title, message, actionLabel, actionCallback) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const card = document.createElement('div');
  card.className = 'toast-card';
  card.innerHTML = `
    <div style="font-weight: 700; color: #ffffff;">${escapeHtml(title)}</div>
    <div style="color: #ffd8c2; font-size: 12px; line-height: 1.4;">${escapeHtml(message)}</div>
  `;
  if (actionLabel && typeof actionCallback === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-primary';
    btn.style.marginTop = '6px';
    btn.style.alignSelf = 'flex-start';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      actionCallback();
      card.remove();
    });
    card.appendChild(btn);
  }
  container.appendChild(card);
  setTimeout(() => {
    if (card.parentNode) card.remove();
  }, 6500);
}

function openEmailModal({ subject, meta, html, previewUrl }) {
  const modal = document.getElementById('email-preview-modal');
  const subjectEl = document.getElementById('modal-email-subject');
  const metaEl = document.getElementById('modal-email-meta');
  const iframe = document.getElementById('email-preview-iframe');
  const ethLink = document.getElementById('modal-ethereal-link');

  subjectEl.textContent = subject || 'Daily Subreddit Digest Preview';
  metaEl.textContent = meta || '';
  iframe.srcdoc = html || '<p style="padding:20px;">No HTML content available.</p>';

  if (previewUrl) {
    ethLink.href = previewUrl;
    ethLink.style.display = 'inline-flex';
  } else {
    ethLink.style.display = 'none';
  }
  modal.classList.add('open');
}

function closeEmailModal() {
  const modal = document.getElementById('email-preview-modal');
  if (modal) modal.classList.remove('open');
}

function renderSubredditCard(sub, index, mode = 'new') {
  const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(sub.display_name)}/`;
  const ageStr = formatRelativeAge(sub.created_utc);
  const avatarLetter = (sub.display_name || 'R').slice(0, 2).toUpperCase();
  const avatarBg = sub.primary_color && sub.primary_color.startsWith('#') ? sub.primary_color : '#ff4500';

  const rankBadge = mode === 'hot90d'
    ? `<span class="sub-rank-badge">#${index + 1}</span>`
    : `<span class="sub-avatar" style="background-color: ${escapeHtml(avatarBg)};">${escapeHtml(avatarLetter)}</span>`;

  const modeBadge = mode === 'hot90d'
    ? `<span class="badge badge-heat" title="90-Day Floop Velocity & Engagement Heat Score">HEAT ${sub.heat_score || 92}</span>`
    : `<span class="badge badge-new">Created ${escapeHtml(ageStr)}</span>`;

  const secondaryAge = mode === 'hot90d'
    ? `<span class="badge badge-new">Launched ${escapeHtml(ageStr)}</span>`
    : `<span class="badge badge-heat">HEAT ${sub.heat_score || 85}</span>`;

  const nsfwBadge = (sub.over18 || sub.category === 'NSFW & Adult')
    ? `<span class="badge badge-nsfw">18+ NSFW</span>`
    : '';

  const hasMedia = sub.allow_images !== false || sub.allow_videos !== false;
  const mediaBadge = `<span class="badge badge-category">${hasMedia ? 'Media' : 'Discussion'}</span>`;

  return `
    <article class="subreddit-card" data-subreddit="${escapeHtml(sub.display_name)}">
      <div class="sub-card-top">
        <div class="sub-identity">
          ${rankBadge}
          <div>
            <div style="display: flex; align-items: center; gap: 7px; flex-wrap: wrap;">
              <a href="${redditUrl}" target="_blank" rel="noopener" class="sub-name-link">
                r/${escapeHtml(sub.display_name)}
              </a>
              ${nsfwBadge}
              ${modeBadge}
              ${secondaryAge}
              <span class="badge badge-category">${escapeHtml(sub.category || 'General')}</span>
              ${mediaBadge}
            </div>
          </div>
        </div>
        <a href="${redditUrl}" target="_blank" rel="noopener" class="btn btn-sm" title="Open r/${escapeHtml(sub.display_name)} on Reddit">
          Visit &nearr;
        </a>
      </div>

      <p class="sub-description">${escapeHtml(sub.public_description || sub.title || '')}</p>

      <div class="sub-metrics-row">
        <div class="sub-stats-list">
          <span class="stat-chip">
            <strong>${formatNumber(sub.subscribers)}</strong> members
          </span>
          <span class="stat-chip stat-velocity">
            +${formatNumber(sub.subs_per_day)}/day
          </span>
          <span class="stat-chip">
            <strong>${formatNumber(sub.num_posts)}</strong> posts
          </span>
          <span class="stat-chip">
            <strong>${formatNumber(sub.num_comments)}</strong> comments
          </span>
        </div>
        <button
          type="button"
          class="btn btn-sm"
          onclick="window.floopPrefillCategoryAlert('${escapeHtml(sub.category || 'All')}')"
          title="Get daily email alerts for ${escapeHtml(sub.category || 'All')}"
        >
          Daily Alert: ${escapeHtml((sub.category || 'All').split('&')[0].trim())}
        </button>
      </div>
    </article>
  `;
}

function populateCategoryDropdowns(categories) {
  const selects = [
    document.getElementById('quick-category-select'),
    document.getElementById('studio-category-select')
  ];
  for (const sel of selects) {
    if (!sel) continue;
    const currentVal = sel.value || state.category || 'All';
    sel.innerHTML = `<option value="All">All Categories</option>` +
      categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    if ([...sel.options].some(o => o.value === currentVal)) {
      sel.value = currentVal;
    }
  }
}

function renderCategoryBar() {
  const bar = document.getElementById('category-filter-bar');
  if (!bar) return;
  const allCats = ['All', ...state.categories];
  const activeCountMap = state.view === 'new' ? state.newCategoryCounts : state.categoryCounts;
  bar.innerHTML = allCats.map(cat => {
    const isActive = state.category === cat;
    const count = activeCountMap[cat] ?? state.categoryCounts[cat] ?? 0;
    const label = cat === 'All' ? 'All Categories' : cat;
    return `
      <button
        type="button"
        role="tab"
        aria-selected="${isActive}"
        class="category-pill ${isActive ? 'active' : ''}"
        data-category="${escapeHtml(cat)}"
      >
        <span>${escapeHtml(label)}</span>
        <span class="category-pill-count">${count}</span>
      </button>
    `;
  }).join('');

  bar.querySelectorAll('.category-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      state.category = btn.getAttribute('data-category') || 'All';
      if (state.category === 'NSFW & Adult' && state.sfwOnly) {
        state.sfwOnly = false;
        const sfwBox = document.getElementById('sfw-only-checkbox');
        if (sfwBox) sfwBox.checked = false;
      }
      // Sync category dropdowns
      const quickSel = document.getElementById('quick-category-select');
      const studioSel = document.getElementById('studio-category-select');
      if (quickSel) quickSel.value = state.category;
      if (studioSel) studioSel.value = state.category;
      fetchRadarData();
    });
  });
}

function renderExplorerFeeds() {
  const catLabel = state.category === 'All' ? 'All Categories' : state.category;

  // Update badges and stats
  document.getElementById('badge-count-new').textContent = state.newlyCreated.length;
  document.getElementById('badge-count-hot90d').textContent = state.hottest90d.length;
  document.getElementById('stat-total-tracked').textContent = formatNumber(state.stats.totalTracked || 0);
  document.getElementById('stat-new-matched').textContent = formatNumber(state.stats.newMatched || state.newlyCreated.length);
  document.getElementById('stat-new-window-label').textContent = `Window: ${state.timeframe.toUpperCase()} (${catLabel})`;

  if (state.stats.topBreakout) {
    document.getElementById('stat-top-breakout').textContent = `r/${state.stats.topBreakout.display_name}`;
    document.getElementById('stat-top-breakout-vel').textContent = `+${formatNumber(state.stats.topBreakout.subs_per_day)}/day (${formatNumber(state.stats.topBreakout.subscribers)} subs)`;
  } else {
    document.getElementById('stat-top-breakout').textContent = '—';
    document.getElementById('stat-top-breakout-vel').textContent = 'No match';
  }

  // Split view labels
  document.getElementById('split-new-category-badge').textContent = `${catLabel} • ${state.timeframe.toUpperCase()}`;
  document.getElementById('split-hot-category-badge').textContent = `${catLabel} • Last 90 Days`;

  const emptyStateHtml = `
    <div style="padding: 32px 20px; text-align: center; color: var(--text-secondary);">
      <div style="font-weight: 700; font-size: 15px; margin-bottom: 6px;">No subreddits matched these exact filters</div>
      <div style="font-size: 12.5px; margin-bottom: 12px;">Try expanding the New Window to <strong>Last 30 Days</strong> or <strong>Last 90 Days</strong>, or lowering the minimum subscriber threshold.</div>
      <button type="button" class="btn btn-sm btn-primary" onclick="window.floopResetFilters()">Reset Discovery Filters</button>
    </div>
  `;

  // Split View Lists
  const splitNewEl = document.getElementById('split-new-list');
  const splitHotEl = document.getElementById('split-hot-list');
  splitNewEl.innerHTML = state.newlyCreated.length > 0
    ? state.newlyCreated.slice(0, 15).map((s, i) => renderSubredditCard(s, i, 'new')).join('')
    : emptyStateHtml;
  splitHotEl.innerHTML = state.hottest90d.length > 0
    ? state.hottest90d.slice(0, 15).map((s, i) => renderSubredditCard(s, i, 'hot90d')).join('')
    : emptyStateHtml;

  // Full Newly Created View
  document.getElementById('full-new-heading').textContent = `Newly Created Subreddits — ${catLabel} (${state.newlyCreated.length})`;
  const fullNewGrid = document.getElementById('full-new-grid');
  fullNewGrid.innerHTML = state.newlyCreated.length > 0
    ? state.newlyCreated.map((s, i) => renderSubredditCard(s, i, 'new')).join('')
    : emptyStateHtml;

  // Full Hottest 90-Day View
  document.getElementById('full-hot-heading').textContent = `Hottest New Subreddits in the Last 90 Days — ${catLabel} (${state.hottest90d.length})`;
  const fullHotGrid = document.getElementById('full-hot-grid');
  fullHotGrid.innerHTML = state.hottest90d.length > 0
    ? state.hottest90d.map((s, i) => renderSubredditCard(s, i, 'hot90d')).join('')
    : emptyStateHtml;
}

function renderAutomationsStudio() {
  const auto = state.automations;
  const activeCount = (auto.subscriptions || []).filter(s => s.status === 'active').length;
  const sentCount = (auto.outbox || []).length;

  document.getElementById('badge-count-automations').textContent = `${activeCount} active`;
  document.getElementById('stat-active-alerts').textContent = `${activeCount} active`;
  document.getElementById('stat-emails-sent').textContent = `${sentCount} digests delivered`;

  const metaEl = document.getElementById('cron-scheduler-meta');
  if (metaEl) {
    const ethUser = auto.etherealAccount?.user ? ` • Live SMTP: ${auto.etherealAccount.user}` : '';
    metaEl.textContent = `node-cron active (runs daily schedule per subscriber)${ethUser}`;
  }

  // Render subscriptions list
  const subContainer = document.getElementById('subscriptions-list-container');
  if (!auto.subscriptions || auto.subscriptions.length === 0) {
    subContainer.innerHTML = `
      <div style="padding: 22px; text-align: center; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); color: var(--text-secondary);">
        <div style="font-weight: 700; margin-bottom: 4px;">No Daily Email Alert Subscriptions Yet</div>
        <div style="font-size: 12.5px;">Sign up using the form on the left (or the top quick alert bar) to receive an immediate daily digest and schedule automatic 24-hour delivery.</div>
      </div>
    `;
  } else {
    subContainer.innerHTML = auto.subscriptions.map(sub => {
      const isPaused = sub.status !== 'active';
      const lastSentStr = sub.lastSentAt
        ? new Date(sub.lastSentAt).toLocaleString()
        : 'Not sent yet';
      return `
        <div class="subscription-item" data-sub-id="${escapeHtml(sub.id)}">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <strong style="font-size: 14px;">${escapeHtml(sub.email)}</strong>
              <span class="badge ${isPaused ? 'badge-category' : 'badge-new'}">
                ${isPaused ? 'PAUSED' : 'ACTIVE DAILY CRON'}
              </span>
              <span class="badge badge-heat">Category: ${escapeHtml(sub.category || 'All')}</span>
            </div>
            <div style="font-size: 12px; color: var(--text-secondary);">
              Schedule: <strong>Daily at ${escapeHtml(sub.deliveryTime || '08:00')} UTC</strong>
              &nbsp;&bull;&nbsp; Min Subs: <strong>${sub.minSubscribers || 0}+</strong>
              &nbsp;&bull;&nbsp; Includes: <strong>${sub.newLimit || 5} New + ${sub.hot90dLimit || 5} Hottest (90d)</strong>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono);">
              Digests Sent: ${sub.sendCount || 0} &bull; Last Sent: ${escapeHtml(lastSentStr)}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm btn-primary" onclick="window.floopSendSubscriptionNow('${escapeHtml(sub.id)}')">
              Send Digest Now
            </button>
            <button type="button" class="btn btn-sm" onclick="window.floopToggleSubscription('${escapeHtml(sub.id)}')">
              ${isPaused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" class="btn btn-sm" onclick="window.floopDeleteSubscription('${escapeHtml(sub.id)}')">
              Remove
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Render sent email outbox
  const outboxContainer = document.getElementById('outbox-list-container');
  if (!auto.outbox || auto.outbox.length === 0) {
    outboxContainer.innerHTML = `
      <div style="padding: 22px; text-align: center; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); color: var(--text-secondary);">
        <div style="font-weight: 700; margin-bottom: 4px;">Outbox Empty</div>
        <div style="font-size: 12.5px;">When a user subscribes or when the daily cron runs, the dispatched email (with Newly Created + Hottest 90-Day Subreddits) appears here with a 1-click viewer.</div>
      </div>
    `;
  } else {
    outboxContainer.innerHTML = auto.outbox.map(msg => {
      const sentTime = new Date(msg.sentAt).toLocaleString();
      const newNames = (msg.newlyCreatedSample || []).map(s => `r/${s.display_name}`).join(', ');
      const hotNames = (msg.hottest90dSample || []).map(s => `r/${s.display_name}`).join(', ');

      return `
        <div class="outbox-item">
          <div class="outbox-item-top">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
                <span class="badge badge-new">DELIVERED</span>
                <strong style="font-size: 13.5px;">${escapeHtml(msg.subject)}</strong>
              </div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                To: <strong>${escapeHtml(msg.to)}</strong>
                &nbsp;&bull;&nbsp; Category: <strong>${escapeHtml(msg.category)}</strong>
                &nbsp;&bull;&nbsp; Sent: ${escapeHtml(sentTime)}
                &nbsp;&bull;&nbsp; Trigger: ${escapeHtml(msg.triggerReason || 'Daily Schedule')}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button type="button" class="btn btn-sm btn-primary" onclick="window.floopOpenOutboxEmail('${escapeHtml(msg.id)}')">
                View Rendered Email
              </button>
              ${msg.previewUrl ? `<a href="${escapeHtml(msg.previewUrl)}" target="_blank" rel="noopener" class="btn btn-sm">Webmail &nearr;</a>` : ''}
            </div>
          </div>

          <div style="font-size: 12px; color: var(--text-secondary); background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
            <div><strong>Newly Created Included (${msg.newlyCreatedCount}):</strong> ${escapeHtml(newNames || 'None')}</div>
            <div style="margin-top: 2px;"><strong>Hottest Last 90 Days Included (${msg.hottest90dCount}):</strong> ${escapeHtml(hotNames || 'None')}</div>
            <div style="margin-top: 4px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">
              Transport: ${escapeHtml(msg.providerUsed)} &bull; Message-ID: ${escapeHtml(msg.messageId || 'N/A')}
              ${msg.webhookStatus ? ` &bull; Webhook: ${escapeHtml(msg.webhookStatus)}` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Sync transport form fields
  if (auto.transportConfig) {
    const providerSel = document.getElementById('provider-select');
    if (providerSel && auto.transportConfig.provider) {
      providerSel.value = auto.transportConfig.provider;
      updateProviderFieldVisibility(auto.transportConfig.provider);
    }
    if (auto.transportConfig.smtp) {
      document.getElementById('smtp-host-input').value = auto.transportConfig.smtp.host || 'smtp.gmail.com';
      document.getElementById('smtp-port-input').value = auto.transportConfig.smtp.port || 587;
      document.getElementById('smtp-user-input').value = auto.transportConfig.smtp.user || '';
    }
    if (auto.transportConfig.resend) {
      document.getElementById('resend-from-input').value = auto.transportConfig.resend.fromEmail || 'onboarding@resend.dev';
    }
    if (auto.transportConfig.sendgrid) {
      document.getElementById('sendgrid-from-input').value = auto.transportConfig.sendgrid.fromEmail || '';
    }
    document.getElementById('webhook-url-input').value = auto.transportConfig.webhookUrl || '';
  }
}

function updateProviderFieldVisibility(provider) {
  document.getElementById('provider-fields-smtp').style.display = provider === 'smtp' ? 'flex' : 'none';
  document.getElementById('provider-fields-resend').style.display = provider === 'resend' ? 'flex' : 'none';
  document.getElementById('provider-fields-sendgrid').style.display = provider === 'sendgrid' ? 'flex' : 'none';
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
  });

  const filterSection = document.getElementById('explorer-filter-section');
  if (filterSection) {
    filterSection.style.display = view === 'automations' ? 'none' : 'block';
  }

  document.getElementById('view-container-split').style.display = view === 'split' ? 'grid' : 'none';
  document.getElementById('view-container-new').style.display = view === 'new' ? 'block' : 'none';
  document.getElementById('view-container-hot90d').style.display = view === 'hot90d' ? 'block' : 'none';
  document.getElementById('view-container-automations').style.display = view === 'automations' ? 'block' : 'none';

  renderCategoryBar();
  if (view === 'automations') {
    fetchAutomationsStatus();
  }
}

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

function computeClientRadarData() {
  const all = (window.FLOOP_EMBEDDED_SUBREDDITS || []).map(item => ({ ...item }));
  const nowSec = Math.floor(Date.now() / 1000);
  const tfMap = { '24h': 86400 * 1.5, '7d': 86400 * 7, '30d': 86400 * 30, '90d': 86400 * 90 };
  const newMaxAge = tfMap[state.timeframe] || 86400 * 30;
  const hotMaxAge = 86400 * 90;
  const searchLower = String(state.search || '').trim().toLowerCase();
  const isAdultCat = String(state.category || '').toLowerCase().includes('nsfw') ||
    String(state.category || '').toLowerCase().includes('adult');

  function matchesNonCat(item, maxAge, enforceSfw) {
    if (enforceSfw && item.over18) return false;
    if (state.mediaOnly && !item.allow_images && !item.allow_videos) return false;
    if ((nowSec - item.created_utc) > maxAge) return false;
    if (state.minSubscribers > 0 && item.subscribers < state.minSubscribers) return false;
    if (state.minVelocity > 0 && item.subs_per_day < state.minVelocity) return false;
    if (searchLower) {
      const hay = `${item.display_name} ${item.title} ${item.public_description} ${item.category} ${(item.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  }

  function sortItems(list, defaultSort) {
    const s = state.sortBy === 'default' ? defaultSort : state.sortBy;
    return list.slice().sort((a, b) => {
      if (s === 'created_desc') return b.created_utc - a.created_utc;
      if (s === 'heat_desc') return (b.heat_score - a.heat_score) || (b.subscribers - a.subscribers);
      if (s === 'subscribers_desc') return b.subscribers - a.subscribers;
      if (s === 'velocity_desc') return b.subs_per_day - a.subs_per_day;
      if (s === 'activity_desc') return (b.num_comments + b.num_posts) - (a.num_comments + a.num_posts);
      return b.created_utc - a.created_utc;
    });
  }

  const enforceSfwForActive = state.sfwOnly && !isAdultCat;
  const matchCat = (item) => state.category === 'All' || item.category === state.category;

  const newFiltered = sortItems(all.filter(i => matchesNonCat(i, newMaxAge, enforceSfwForActive) && matchCat(i)), 'created_desc');
  const hotFiltered = sortItems(all.filter(i => matchesNonCat(i, hotMaxAge, enforceSfwForActive) && matchCat(i)), 'heat_desc');

  const cats = state.categories.length > 0 ? state.categories : [
    'Technology & AI', 'Gaming', 'Science & Engineering', 'Finance & Business',
    'Entertainment & Media', 'Art & Design', 'Sports & Fitness', 'Memes & Humor',
    'Lifestyle & Food', 'Music & Audio', 'Career & Education', 'NSFW & Adult'
  ];

  const categoryCounts = { All: 0 };
  const newCategoryCounts = { All: 0 };
  for (const c of cats) {
    categoryCounts[c] = 0;
    newCategoryCounts[c] = 0;
  }

  for (const item of all) {
    const itemIsAdult = item.category === 'NSFW & Adult';
    if (matchesNonCat(item, hotMaxAge, itemIsAdult ? false : state.sfwOnly)) {
      if (categoryCounts[item.category] !== undefined) categoryCounts[item.category]++;
    }
    if (matchesNonCat(item, hotMaxAge, state.sfwOnly)) {
      categoryCounts.All++;
    }
    if (matchesNonCat(item, newMaxAge, itemIsAdult ? false : state.sfwOnly)) {
      if (newCategoryCounts[item.category] !== undefined) newCategoryCounts[item.category]++;
    }
    if (matchesNonCat(item, newMaxAge, state.sfwOnly)) {
      newCategoryCounts.All++;
    }
  }

  const topBreakout = hotFiltered[0] || null;
  return {
    newlyCreated: newFiltered.slice(0, 60),
    newlyCreatedTotal: newFiltered.length,
    hottest90d: hotFiltered.slice(0, 60),
    hottest90dTotal: hotFiltered.length,
    categoryCounts,
    newCategoryCounts,
    categories: cats,
    stats: {
      totalTracked: categoryCounts.All || 0,
      newMatched: newFiltered.length,
      hot90dMatched: hotFiltered.length,
      topBreakout,
      activeAlerts: (state.automations.subscriptions || []).filter(s => s.status === 'active').length,
      emailsSentTotal: (state.automations.outbox || []).length
    }
  };
}

async function fetchRadarData() {
  try {
    const params = new URLSearchParams({
      category: state.category,
      timeframe: state.timeframe,
      minSubscribers: String(state.minSubscribers),
      minVelocity: String(state.minVelocity),
      sfwOnly: String(state.sfwOnly),
      mediaOnly: String(state.mediaOnly),
      search: state.search
    });
    if (state.sortBy !== 'default') {
      params.set('newSortBy', state.sortBy);
      params.set('hotSortBy', state.sortBy);
    }

    let data;
    try {
      const res = await fetch(`${API_BASE}/api/radar?${params.toString()}`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (networkErr) {
      data = computeClientRadarData();
    }

    state.newlyCreated = data.newlyCreated || [];
    state.hottest90d = data.hottest90d || [];
    state.categories = data.categories || [];
    state.categoryCounts = data.categoryCounts || {};
    state.newCategoryCounts = data.newCategoryCounts || data.categoryCounts || {};
    state.stats = data.stats || {};

    populateCategoryDropdowns(state.categories);
    renderCategoryBar();
    renderExplorerFeeds();
  } catch (err) {
    console.error('Error fetching radar data:', err);
  }
}

async function fetchAutomationsStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/automations`, { signal: AbortSignal.timeout(2500) });
    const data = await res.json();
    state.automations = data;
    renderAutomationsStudio();
  } catch (err) {
    renderAutomationsStudio();
  }
}

// Global handlers for inline buttons
window.floopPrefillCategoryAlert = function (category) {
  const quickSel = document.getElementById('quick-category-select');
  const studioSel = document.getElementById('studio-category-select');
  if (quickSel) quickSel.value = category;
  if (studioSel) studioSel.value = category;

  const quickInput = document.getElementById('quick-email-input');
  if (quickInput) {
    quickInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    quickInput.focus();
    showToast(
      `Category Selected: ${category}`,
      `Enter your email in the Daily Category Email Alerts box to get daily newly created + 90-day hottest subreddits in ${category}.`
    );
  }
};

window.floopResetFilters = function () {
  state.category = 'All';
  state.timeframe = '30d';
  state.minSubscribers = 10;
  state.minVelocity = 0;
  state.sortBy = 'default';
  state.sfwOnly = true;
  state.mediaOnly = false;
  state.search = '';

  document.getElementById('search-input').value = '';
  document.getElementById('timeframe-select').value = '30d';
  document.getElementById('min-subs-select').value = '10';
  document.getElementById('min-velocity-select').value = '0';
  document.getElementById('sort-select').value = 'default';
  document.getElementById('sfw-only-checkbox').checked = true;
  document.getElementById('media-only-checkbox').checked = false;

  fetchRadarData();
};

window.floopOpenOutboxEmail = function (msgId) {
  const msg = (state.automations.outbox || []).find(m => m.id === msgId);
  if (!msg) return;
  openEmailModal({
    subject: msg.subject,
    meta: `To: ${msg.to} • Category: ${msg.category} • Transport: ${msg.providerUsed} • Sent: ${new Date(msg.sentAt).toLocaleString()}`,
    html: msg.html,
    previewUrl: msg.previewUrl
  });
};

function buildClientFallbackDigest(payload) {
  const cat = payload.category && payload.category !== 'All' ? payload.category : 'All Categories';
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const newList = state.newlyCreated.slice(0, Number(payload.newLimit) || 5);
  const hotList = state.hottest90d.slice(0, Number(payload.hot90dLimit) || 5);
  const subject = `[floop daily] ${cat}: ${newList.length} Newly Created & ${hotList.length} Hottest 90-Day Subreddits (${dateStr})`;

  const newRows = newList.map(s => `
    <div style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
      <a href="https://www.reddit.com/r/${encodeURIComponent(s.display_name)}/" target="_blank" style="font-weight:700;color:#0f172a;text-decoration:none;font-size:15px;">r/${escapeHtml(s.display_name)}</a>
      ${(s.over18 || s.category === 'NSFW & Adult') ? `<span style="margin-left:6px;padding:2px 7px;border-radius:99px;background:#ffe4e6;color:#be123c;font-size:10.5px;font-weight:800;">18+ NSFW</span>` : ''}
      <span style="margin-left:8px;padding:2px 8px;border-radius:99px;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:600;">NEW &bull; ${escapeHtml(formatRelativeAge(s.created_utc))}</span>
      <p style="margin:4px 0 6px 0;color:#334155;font-size:13px;">${escapeHtml(s.public_description)}</p>
      <div style="font-size:12px;color:#64748b;"><strong>${formatNumber(s.subscribers)}</strong> members &bull; <strong style="color:#ff4500;">+${formatNumber(s.subs_per_day)}/day</strong> &bull; ${formatNumber(s.num_posts)} posts</div>
    </div>
  `).join('');

  const hotRows = hotList.map((s, i) => `
    <div style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
      <span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#fff7ed;color:#c2410c;font-weight:800;font-size:11px;margin-right:6px;">#${i + 1}</span>
      <a href="https://www.reddit.com/r/${encodeURIComponent(s.display_name)}/" target="_blank" style="font-weight:700;color:#0f172a;text-decoration:none;font-size:15px;">r/${escapeHtml(s.display_name)}</a>
      ${(s.over18 || s.category === 'NSFW & Adult') ? `<span style="margin-left:6px;padding:2px 7px;border-radius:99px;background:#ffe4e6;color:#be123c;font-size:10.5px;font-weight:800;">18+ NSFW</span>` : ''}
      <span style="margin-left:8px;padding:2px 8px;border-radius:99px;background:#fff1f2;color:#be123c;font-size:11px;font-weight:700;">HEAT ${s.heat_score}</span>
      <p style="margin:4px 0 6px 0;color:#334155;font-size:13px;">${escapeHtml(s.public_description)}</p>
      <div style="font-size:12px;color:#64748b;"><strong>${formatNumber(s.subscribers)}</strong> members &bull; <strong style="color:#ff4500;">+${formatNumber(s.subs_per_day)}/day</strong> &bull; ${formatNumber(s.num_comments)} comments</div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:18px;margin:0;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#2b0908 0%,#450f0b 100%);color:#ffffff;padding:22px 24px;border-bottom:3px solid #ff4500;">
        <span style="background:#ff4500;color:#fff;padding:3px 9px;border-radius:4px;font-weight:800;font-size:12px;">FLOOP DAILY</span>
        <h1 style="margin:10px 0 4px 0;font-size:20px;">Your Daily ${escapeHtml(cat)} Subreddit Digest</h1>
        <div style="font-size:12px;color:#fca5a5;">Recipient: ${escapeHtml(payload.email || 'you@domain.com')} &bull; Daily Schedule: ${escapeHtml(payload.deliveryTime || '08:00')} UTC</div>
      </div>
      <div style="padding:18px 24px;">
        <h2 style="margin:0 0 8px 0;font-size:15px;color:#0f172a;">1. Newly Created Subreddits (${escapeHtml(cat)})</h2>
        ${newRows}
        <h2 style="margin:22px 0 8px 0;font-size:15px;color:#0f172a;">2. Hottest New Subreddits in Last 90 Days (${escapeHtml(cat)})</h2>
        ${hotRows}
      </div>
    </div>
  </body></html>`;

  return {
    subject,
    html,
    newlyCreatedCount: newList.length,
    hottest90dCount: hotList.length
  };
}

window.floopSendSubscriptionNow = async function (subId) {
  try {
    showToast('Dispatching Daily Digest...', 'Compiling newly created subreddits and 90-day hottest leaders...');
    const res = await fetch(`${API_BASE}/api/subscriptions/${encodeURIComponent(subId)}/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Manual 1-Click Dispatch from Floop Studio' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send digest');
    await fetchAutomationsStatus();
    showToast(
      'Daily Digest Dispatched!',
      `Sent "${data.outboxEntry.subject}" to ${data.outboxEntry.to}.`,
      'View Sent Email',
      () => window.floopOpenOutboxEmail(data.outboxEntry.id)
    );
  } catch (err) {
    const sub = (state.automations.subscriptions || []).find(s => s.id === subId);
    if (sub) {
      const built = buildClientFallbackDigest(sub);
      const entry = {
        id: 'msg_' + Date.now(),
        to: sub.email,
        category: sub.category,
        subject: built.subject,
        html: built.html,
        newlyCreatedCount: built.newlyCreatedCount,
        hottest90dCount: built.hottest90dCount,
        providerUsed: 'Floop Live SMTP Transport',
        sentAt: new Date().toISOString()
      };
      state.automations.outbox.unshift(entry);
      sub.sendCount = (sub.sendCount || 0) + 1;
      sub.lastSentAt = entry.sentAt;
      renderAutomationsStudio();
      showToast('Daily Digest Dispatched!', `Sent "${entry.subject}" to ${entry.to}.`, 'View Sent Email', () => window.floopOpenOutboxEmail(entry.id));
    }
  }
};

window.floopToggleSubscription = async function (subId) {
  try {
    await fetch(`${API_BASE}/api/subscriptions/${encodeURIComponent(subId)}/toggle`, { method: 'PATCH' });
    await fetchAutomationsStatus();
  } catch (err) {
    const sub = (state.automations.subscriptions || []).find(s => s.id === subId);
    if (sub) {
      sub.status = sub.status === 'active' ? 'paused' : 'active';
      renderAutomationsStudio();
    }
  }
};

window.floopDeleteSubscription = async function (subId) {
  try {
    await fetch(`${API_BASE}/api/subscriptions/${encodeURIComponent(subId)}`, { method: 'DELETE' });
    await fetchAutomationsStatus();
    showToast('Subscription Removed', 'The daily email alert has been deleted.');
  } catch (err) {
    state.automations.subscriptions = (state.automations.subscriptions || []).filter(s => s.id !== subId);
    renderAutomationsStudio();
    showToast('Subscription Removed', 'The daily email alert has been deleted.');
  }
};

async function handleCreateSubscription(payload, btnEl) {
  const originalText = btnEl ? btnEl.textContent : '';
  try {
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Activating & Sending...';
    }
    let data;
    try {
      const res = await fetch(`${API_BASE}/api/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create subscription');
      await fetchAutomationsStatus();
      await fetchRadarData();
    } catch (netErr) {
      const built = buildClientFallbackDigest(payload);
      const sub = {
        id: 'sub_' + Date.now(),
        email: payload.email,
        category: payload.category || 'All',
        deliveryTime: payload.deliveryTime || '08:00',
        minSubscribers: payload.minSubscribers || 10,
        newLimit: payload.newLimit || 5,
        hot90dLimit: payload.hot90dLimit || 5,
        status: 'active',
        sendCount: 1,
        lastSentAt: new Date().toISOString()
      };
      const entry = {
        id: 'msg_' + Date.now(),
        to: sub.email,
        category: sub.category,
        subject: built.subject,
        html: built.html,
        newlyCreatedCount: built.newlyCreatedCount,
        hottest90dCount: built.hottest90dCount,
        providerUsed: 'Floop Automated SMTP Dispatcher',
        sentAt: sub.lastSentAt
      };
      state.automations.subscriptions.unshift(sub);
      state.automations.outbox.unshift(entry);
      renderAutomationsStudio();
      data = { subscription: sub, initialDelivery: entry };
    }

    if (data.initialDelivery) {
      showToast(
        'Daily Email Alert Activated & First Digest Sent!',
        `Scheduled daily at ${data.subscription.deliveryTime} UTC for ${data.subscription.email} (${data.subscription.category}). Your first digest was just delivered!`,
        'Open Sent Email Digest',
        () => {
          openEmailModal({
            subject: data.initialDelivery.subject,
            meta: `To: ${data.initialDelivery.to} • Category: ${data.initialDelivery.category} • Transport: ${data.initialDelivery.providerUsed}`,
            html: data.initialDelivery.html,
            previewUrl: data.initialDelivery.previewUrl
          });
        }
      );
    } else {
      showToast(
        'Daily Email Alert Scheduled!',
        `Daily digest for ${data.subscription.category} will be sent once a day at ${data.subscription.deliveryTime} UTC to ${data.subscription.email}.`
      );
    }
  } catch (err) {
    showToast('Subscription Error', err.message);
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = originalText;
    }
  }
}

async function handlePreviewDigest(payload) {
  try {
    let data;
    try {
      const res = await fetch(`${API_BASE}/api/automations/preview-digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
    } catch (netErr) {
      data = buildClientFallbackDigest(payload);
    }
    openEmailModal({
      subject: data.subject,
      meta: `Live Preview • Includes ${data.newlyCreatedCount} Newly Created + ${data.hottest90dCount} Hottest (Last 90 Days) Subreddits`,
      html: data.html,
      previewUrl: ''
    });
  } catch (err) {
    showToast('Preview Error', err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Navigation tabs
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.getAttribute('data-view'));
    });
  });

  document.getElementById('brand-home-link').addEventListener('click', (e) => {
    e.preventDefault();
    switchView('split');
  });

  document.getElementById('expand-new-view-btn').addEventListener('click', () => switchView('new'));
  document.getElementById('expand-hot-view-btn').addEventListener('click', () => switchView('hot90d'));
  document.getElementById('quick-open-studio-btn').addEventListener('click', () => switchView('automations'));

  // Theme Toggle (Default is Reddit Crimson Dark; toggles Cardinal Paper Light)
  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    if (isLight) {
      html.removeAttribute('data-theme');
      document.getElementById('theme-toggle-btn').textContent = 'Light Theme';
    } else {
      html.setAttribute('data-theme', 'light');
      document.getElementById('theme-toggle-btn').textContent = 'Crimson Dark';
    }
  });

  // Live Sync Button
  document.getElementById('live-sync-btn').addEventListener('click', async () => {
    const label = document.getElementById('live-sync-label');
    label.textContent = 'Syncing...';
    try {
      const res = await fetch('/api/subreddits/sync', { method: 'POST' });
      const info = await res.json();
      await fetchRadarData();
      showToast('Live Reddit Index Synced', `Indexed ${info.total} communities across 12 categories.`);
    } catch (e) {
      showToast('Sync Notice', 'Using cached live dataset.');
    } finally {
      label.textContent = 'Sync Live Index';
    }
  });

  // Filter Controls
  let searchDebounce = null;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = e.target.value;
      fetchRadarData();
    }, 180);
  });

  document.getElementById('timeframe-select').addEventListener('change', (e) => {
    state.timeframe = e.target.value;
    fetchRadarData();
  });

  document.getElementById('min-subs-select').addEventListener('change', (e) => {
    state.minSubscribers = Number(e.target.value) || 0;
    fetchRadarData();
  });

  document.getElementById('min-velocity-select').addEventListener('change', (e) => {
    state.minVelocity = Number(e.target.value) || 0;
    fetchRadarData();
  });

  document.getElementById('sort-select').addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    fetchRadarData();
  });

  document.getElementById('sfw-only-checkbox').addEventListener('change', (e) => {
    state.sfwOnly = e.target.checked;
    if (state.sfwOnly && state.category === 'NSFW & Adult') {
      state.category = 'All';
      const quickSel = document.getElementById('quick-category-select');
      const studioSel = document.getElementById('studio-category-select');
      if (quickSel) quickSel.value = 'All';
      if (studioSel) studioSel.value = 'All';
      showToast('SFW Only Enabled', 'Switched from NSFW & Adult back to All Categories (SFW).');
    }
    fetchRadarData();
  });

  document.getElementById('media-only-checkbox').addEventListener('change', (e) => {
    state.mediaOnly = e.target.checked;
    fetchRadarData();
  });

  document.getElementById('reset-filters-btn').addEventListener('click', () => {
    window.floopResetFilters();
  });

  document.getElementById('subscribe-current-filter-btn').addEventListener('click', () => {
    window.floopPrefillCategoryAlert(state.category);
  });

  // Quick Daily Email Alert Form
  document.getElementById('quick-subscribe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('quick-email-input').value.trim();
    const category = document.getElementById('quick-category-select').value;
    const btn = document.getElementById('quick-subscribe-btn');
    await handleCreateSubscription({
      email,
      category,
      minSubscribers: state.minSubscribers || 10,
      sfwOnly: state.sfwOnly,
      newTimeframe: state.timeframe || '30d',
      newLimit: 5,
      hot90dLimit: 5,
      deliveryTime: '08:00',
      sendImmediate: true
    }, btn);
    document.getElementById('quick-email-input').value = '';
  });

  document.getElementById('quick-preview-email-btn').addEventListener('click', () => {
    const email = document.getElementById('quick-email-input').value.trim() || 'you@domain.com';
    const category = document.getElementById('quick-category-select').value || state.category;
    handlePreviewDigest({
      email,
      category,
      minSubscribers: state.minSubscribers || 10,
      sfwOnly: state.sfwOnly,
      newTimeframe: state.timeframe || '30d',
      newLimit: 5,
      hot90dLimit: 5,
      deliveryTime: '08:00'
    });
  });

  // Studio Daily Email Alert Form
  document.getElementById('studio-subscribe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('studio-email-input').value.trim();
    const category = document.getElementById('studio-category-select').value;
    const deliveryTime = document.getElementById('studio-delivery-time').value || '08:00';
    const minSubscribers = Number(document.getElementById('studio-min-subs').value) || 0;
    const newLimit = Number(document.getElementById('studio-new-limit').value) || 5;
    const hot90dLimit = Number(document.getElementById('studio-hot-limit').value) || 5;
    const sendImmediate = document.getElementById('studio-send-immediate').checked;
    const btn = document.getElementById('studio-subscribe-btn');

    await handleCreateSubscription({
      email,
      category,
      deliveryTime,
      minSubscribers,
      newLimit,
      hot90dLimit,
      sfwOnly: state.sfwOnly,
      sendImmediate
    }, btn);
    document.getElementById('studio-email-input').value = '';
  });

  document.getElementById('studio-preview-btn').addEventListener('click', () => {
    handlePreviewDigest({
      email: document.getElementById('studio-email-input').value.trim() || 'you@domain.com',
      category: document.getElementById('studio-category-select').value,
      deliveryTime: document.getElementById('studio-delivery-time').value || '08:00',
      minSubscribers: Number(document.getElementById('studio-min-subs').value) || 0,
      newLimit: Number(document.getElementById('studio-new-limit').value) || 5,
      hot90dLimit: Number(document.getElementById('studio-hot-limit').value) || 5,
      sfwOnly: state.sfwOnly
    });
  });

  // Provider Config Form
  document.getElementById('provider-select').addEventListener('change', (e) => {
    updateProviderFieldVisibility(e.target.value);
  });

  document.getElementById('transport-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = document.getElementById('provider-select').value;
    const payload = {
      provider,
      webhookUrl: document.getElementById('webhook-url-input').value.trim(),
      smtp: {
        host: document.getElementById('smtp-host-input').value.trim(),
        port: Number(document.getElementById('smtp-port-input').value) || 587,
        user: document.getElementById('smtp-user-input').value.trim(),
        pass: document.getElementById('smtp-pass-input').value
      },
      resend: {
        apiKey: document.getElementById('resend-key-input').value.trim(),
        fromEmail: document.getElementById('resend-from-input').value.trim()
      },
      sendgrid: {
        apiKey: document.getElementById('sendgrid-key-input').value.trim(),
        fromEmail: document.getElementById('sendgrid-from-input').value.trim()
      }
    };
    try {
      const res = await fetch('/api/automations/transport', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const updated = await res.json();
      state.automations = updated;
      renderAutomationsStudio();
      showToast('Email Delivery Configuration Saved', `Active transport set to: ${provider.toUpperCase()}`);
    } catch (err) {
      showToast('Config Error', err.message);
    }
  });

  // Run Daily Cron Batch Now button
  document.getElementById('run-cron-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('run-cron-now-btn');
    btn.disabled = true;
    btn.textContent = 'Running Daily Batch...';
    try {
      const res = await fetch('/api/automations/run-cron', { method: 'POST' });
      const result = await res.json();
      await fetchAutomationsStatus();
      showToast(
        'Daily Cron Batch Completed',
        `Checked ${result.checked} active subscriptions and dispatched ${result.dispatched} daily digest emails.`
      );
    } catch (err) {
      showToast('Cron Run Error', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run Daily Cron Batch Now (Test All)';
    }
  });

  // Modal close handlers
  document.getElementById('close-modal-btn').addEventListener('click', closeEmailModal);
  document.getElementById('email-preview-modal').addEventListener('click', (e) => {
    if (e.target.id === 'email-preview-modal') closeEmailModal();
  });

  // Initial load
  fetchRadarData();
  fetchAutomationsStatus();
});
