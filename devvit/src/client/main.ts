import { navigateTo, showToast as devvitToast } from '@devvit/web/client';
import type { OutboxEntry, SubredditRecord, Subscription } from '../shared/types.js';

interface ClientState {
  view: 'split' | 'new' | 'hot90d' | 'automations';
  category: string;
  timeframe: string;
  minSubscribers: number;
  minVelocity: number;
  sortBy: string;
  sfwOnly: boolean;
  mediaOnly: boolean;
  search: string;
  categories: string[];
  categoryCounts: Record<string, number>;
  newCategoryCounts: Record<string, number>;
  newlyCreated: SubredditRecord[];
  hottest90d: SubredditRecord[];
  lastSyncAt: string | null;
  lastSyncSources: string[];
  stats: {
    totalTracked?: number;
    newMatched?: number;
    hot90dMatched?: number;
    topBreakout?: SubredditRecord | null;
    activeAlerts?: number;
    emailsSentTotal?: number;
  };
  automations: {
    subscriptions: Subscription[];
    outbox: OutboxEntry[];
    providerSummary: string;
  };
}

const state: ClientState = {
  view: 'split',
  category: 'All',
  timeframe: '90d',
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
  lastSyncAt: null,
  lastSyncSources: [],
  stats: {},
  automations: {
    subscriptions: [],
    outbox: [],
    providerSummary: ''
  }
};

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(n: unknown): string {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString('en-US');
}

function formatRelativeAge(createdUtc: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - Number(createdUtc || 0));
  const hours = Math.floor(diffSec / 3600);
  if (hours < 1) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

function notify(title: string, body?: string) {
  try {
    devvitToast({ text: body ? `${title}: ${body}` : title, appearance: 'success' });
  } catch {
    // Fallback inline toast outside Reddit host
  }
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${body ? `<div style="margin-top:3px;color:#d6c2bf;">${escapeHtml(body)}</div>` : ''}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function openSubreddit(name: string) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(name)}/`;
  try {
    navigateTo(url);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function openEmailModal(subject: string, meta: string, html: string) {
  const modal = document.getElementById('email-preview-modal');
  const subjEl = document.getElementById('modal-email-subject');
  const metaEl = document.getElementById('modal-email-meta');
  const iframe = document.getElementById('email-preview-iframe') as HTMLIFrameElement | null;
  if (!modal || !subjEl || !metaEl || !iframe) return;
  subjEl.textContent = subject;
  metaEl.textContent = meta;
  iframe.srcdoc = html;
  modal.classList.add('open');
}

function renderSubredditCard(sub: SubredditRecord, index: number, mode: 'new' | 'hot90d') {
  const ageStr = formatRelativeAge(sub.created_utc);
  const avatarLetter = (sub.display_name || 'R').slice(0, 2).toUpperCase();
  const avatarBg = sub.primary_color && sub.primary_color.startsWith('#') ? sub.primary_color : '#ff4500';
  const rankBadge =
    mode === 'hot90d'
      ? `<span class="sub-rank-badge">#${index + 1}</span>`
      : `<span class="sub-avatar" style="background-color:${escapeHtml(avatarBg)};">${escapeHtml(avatarLetter)}</span>`;
  const primaryBadge =
    mode === 'hot90d'
      ? `<span class="badge badge-heat">HEAT ${sub.heat_score}</span>`
      : `<span class="badge badge-new">Created ${escapeHtml(ageStr)}</span>`;
  const secondaryBadge =
    mode === 'hot90d'
      ? `<span class="badge badge-new">Launched ${escapeHtml(ageStr)}</span>`
      : `<span class="badge badge-heat">HEAT ${sub.heat_score}</span>`;
  const nsfwBadge =
    sub.over18 || sub.category === 'NSFW & Adult'
      ? `<span class="badge badge-nsfw">18+ NSFW</span>`
      : '';
  const hasPosts = sub.num_posts !== null && sub.num_posts !== undefined;
  const hasComments = sub.num_comments !== null && sub.num_comments !== undefined;

  return `
    <article class="subreddit-card">
      <div class="sub-card-top">
        <div class="sub-identity">
          ${rankBadge}
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <button type="button" class="sub-name-link js-open-sub" data-sub="${escapeHtml(sub.display_name)}">r/${escapeHtml(sub.display_name)}</button>
            ${nsfwBadge}
            ${primaryBadge}
            ${secondaryBadge}
            <span class="badge badge-category">${escapeHtml(sub.category)}</span>
          </div>
        </div>
        <button type="button" class="btn btn-sm js-open-sub" data-sub="${escapeHtml(sub.display_name)}">Open &nearr;</button>
      </div>
      <p class="sub-description">${escapeHtml(sub.public_description || sub.title || '')}</p>
      <div class="sub-metrics-row">
        <div class="sub-stats-list">
          <span><strong>${formatNumber(sub.subscribers)}</strong> members</span>
          <span class="stat-velocity">+${formatNumber(sub.subs_per_day)}/day</span>
          ${hasPosts ? `<span><strong>${formatNumber(sub.num_posts)}</strong> posts</span>` : ''}
          ${hasComments ? `<span><strong>${formatNumber(sub.num_comments)}</strong> comments</span>` : ''}
        </div>
        <button type="button" class="btn btn-sm js-alert-cat" data-cat="${escapeHtml(sub.category)}">
          Alert: ${escapeHtml(sub.category.split('&')[0].trim())}
        </button>
      </div>
    </article>
  `;
}

function populateCategoryDropdowns(categories: string[]) {
  const selects = [
    document.getElementById('quick-category-select') as HTMLSelectElement | null,
    document.getElementById('studio-category-select') as HTMLSelectElement | null
  ];
  for (const sel of selects) {
    if (!sel) continue;
    const prev = sel.value || state.category || 'All';
    sel.innerHTML =
      `<option value="All">All Categories</option>` +
      categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }
}

function renderCategoryBar() {
  const bar = document.getElementById('category-filter-bar');
  if (!bar) return;
  const allCats = ['All', ...state.categories];
  const counts = state.view === 'new' ? state.newCategoryCounts : state.categoryCounts;
  bar.innerHTML = allCats
    .map((cat) => {
      const isActive = state.category === cat;
      const count = counts[cat] ?? state.categoryCounts[cat] ?? 0;
      const label = cat === 'All' ? 'All Categories' : cat;
      return `
        <button type="button" class="category-pill ${isActive ? 'active' : ''}" data-category="${escapeHtml(cat)}">
          <span>${escapeHtml(label)}</span>
          <span class="category-pill-count">${count}</span>
        </button>
      `;
    })
    .join('');

  bar.querySelectorAll('.category-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.category = btn.getAttribute('data-category') || 'All';
      if (state.category === 'NSFW & Adult' && state.sfwOnly) {
        state.sfwOnly = false;
        const box = document.getElementById('sfw-only-checkbox') as HTMLInputElement | null;
        if (box) box.checked = false;
      }
      const qSel = document.getElementById('quick-category-select') as HTMLSelectElement | null;
      const sSel = document.getElementById('studio-category-select') as HTMLSelectElement | null;
      if (qSel) qSel.value = state.category;
      if (sSel) sSel.value = state.category;
      fetchRadarData();
    });
  });
}

function renderFeeds() {
  const catLabel = state.category === 'All' ? 'All Categories' : state.category;
  const setTxt = (id: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setTxt('badge-count-new', String(state.newlyCreated.length));
  setTxt('badge-count-hot90d', String(state.hottest90d.length));
  setTxt('stat-total-tracked', formatNumber(state.stats.totalTracked || 0));
  setTxt('stat-new-matched', formatNumber(state.stats.newMatched ?? state.newlyCreated.length));
  setTxt('stat-new-window-label', `Window: ${state.timeframe.toUpperCase()} (${catLabel})`);
  setTxt(
    'stat-sync-source',
    state.lastSyncSources.length > 0 ? state.lastSyncSources.join(' + ') : 'Devvit Live Index'
  );

  if (state.stats.topBreakout) {
    setTxt('stat-top-breakout', `r/${state.stats.topBreakout.display_name}`);
    setTxt(
      'stat-top-breakout-vel',
      `+${formatNumber(state.stats.topBreakout.subs_per_day)}/day (${formatNumber(state.stats.topBreakout.subscribers)} subs)`
    );
  } else {
    setTxt('stat-top-breakout', '—');
    setTxt('stat-top-breakout-vel', 'No match');
  }

  setTxt('split-new-category-badge', `${catLabel} • ${state.timeframe.toUpperCase()}`);
  setTxt('split-hot-category-badge', `${catLabel} • 90 Days`);

  const emptyHtml = `
    <div style="padding:24px;text-align:center;color:var(--text-secondary);">
      <strong>No subreddits matched these exact filters.</strong>
      <div style="font-size:12px;margin:6px 0 12px 0;">Try switching Window to <strong>Last 90 Days</strong> or clicking <strong>Sync Reddit</strong>.</div>
      <button type="button" class="btn btn-sm btn-primary" id="inline-reset-btn">Reset Filters</button>
    </div>
  `;

  const setHtml = (id: string, html: string) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  setHtml(
    'split-new-list',
    state.newlyCreated.length > 0
      ? state.newlyCreated.slice(0, 15).map((s, i) => renderSubredditCard(s, i, 'new')).join('')
      : emptyHtml
  );
  setHtml(
    'split-hot-list',
    state.hottest90d.length > 0
      ? state.hottest90d.slice(0, 15).map((s, i) => renderSubredditCard(s, i, 'hot90d')).join('')
      : emptyHtml
  );
  setTxt('full-new-heading', `Newly Created Subreddits — ${catLabel} (${state.newlyCreated.length})`);
  setHtml(
    'full-new-grid',
    state.newlyCreated.length > 0
      ? state.newlyCreated.map((s, i) => renderSubredditCard(s, i, 'new')).join('')
      : emptyHtml
  );
  setTxt('full-hot-heading', `Hottest New Subreddits (90 Days) — ${catLabel} (${state.hottest90d.length})`);
  setHtml(
    'full-hot-grid',
    state.hottest90d.length > 0
      ? state.hottest90d.map((s, i) => renderSubredditCard(s, i, 'hot90d')).join('')
      : emptyHtml
  );

  document.querySelectorAll('.js-open-sub').forEach((el) => {
    el.addEventListener('click', () => {
      const name = el.getAttribute('data-sub');
      if (name) openSubreddit(name);
    });
  });

  document.querySelectorAll('.js-alert-cat').forEach((el) => {
    el.addEventListener('click', () => {
      const cat = el.getAttribute('data-cat') || 'All';
      const qSel = document.getElementById('quick-category-select') as HTMLSelectElement | null;
      const sSel = document.getElementById('studio-category-select') as HTMLSelectElement | null;
      if (qSel) qSel.value = cat;
      if (sSel) sSel.value = cat;
      document.getElementById('quick-email-input')?.focus();
      notify('Category Selected', `${cat} ready for daily email alert`);
    });
  });

  document.getElementById('inline-reset-btn')?.addEventListener('click', resetFilters);
}

function renderAutomations() {
  const subs = state.automations.subscriptions || [];
  const outbox = state.automations.outbox || [];
  const activeCount = subs.filter((s) => s.status === 'active').length;

  const setTxt = (id: string, val: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setTxt('badge-count-automations', String(activeCount));
  setTxt('stat-active-alerts', `${activeCount} active`);
  setTxt('stat-emails-sent', `${outbox.length} digests sent`);
  setTxt('provider-summary-label', state.automations.providerSummary || 'Devvit Scheduler Active');

  const subContainer = document.getElementById('subscriptions-list-container');
  if (subContainer) {
    subContainer.innerHTML =
      subs.length === 0
        ? `<div style="padding:14px;color:var(--text-muted);font-size:12.5px;">No daily alerts yet. Add your email above to get started.</div>`
        : subs
            .map(
              (sub) => `
            <div class="subscription-item">
              <div>
                <strong>${escapeHtml(sub.email)}</strong>
                <span class="badge badge-new" style="margin-left:6px;">${escapeHtml(sub.category)}</span>
                <span class="badge badge-category" style="margin-left:4px;">${sub.status === 'active' ? 'ACTIVE 08:00 UTC' : 'PAUSED'}</span>
                <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">Sent: ${sub.sendCount || 0} &bull; Min subs: ${sub.minSubscribers}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-sm btn-primary js-send-now" data-id="${escapeHtml(sub.id)}">Send Now</button>
                <button type="button" class="btn btn-sm js-toggle-sub" data-id="${escapeHtml(sub.id)}">${sub.status === 'active' ? 'Pause' : 'Resume'}</button>
                <button type="button" class="btn btn-sm js-del-sub" data-id="${escapeHtml(sub.id)}">Delete</button>
              </div>
            </div>
          `
            )
            .join('');

    subContainer.querySelectorAll('.js-send-now').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-id');
        if (!id) return;
        const r = await fetch(`/api/subscriptions/${encodeURIComponent(id)}/send-now`, { method: 'POST' });
        const d = await r.json();
        await fetchAutomations();
        if (d.outboxEntry) {
          notify('Digest Dispatched', d.outboxEntry.providerUsed);
          openEmailModal(d.outboxEntry.subject, d.outboxEntry.providerUsed, d.outboxEntry.html);
        }
      })
    );
    subContainer.querySelectorAll('.js-toggle-sub').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-id');
        if (!id) return;
        await fetch(`/api/subscriptions/${encodeURIComponent(id)}/toggle`, { method: 'PATCH' });
        await fetchAutomations();
      })
    );
    subContainer.querySelectorAll('.js-del-sub').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.getAttribute('data-id');
        if (!id) return;
        await fetch(`/api/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await fetchAutomations();
        notify('Alert Removed');
      })
    );
  }

  const outboxEl = document.getElementById('outbox-list-container');
  if (outboxEl) {
    outboxEl.innerHTML =
      outbox.length === 0
        ? `<div style="padding:14px;color:var(--text-muted);font-size:12.5px;">Outbox is empty. Create an alert or click Send Now.</div>`
        : outbox
            .map(
              (m) => `
            <div class="outbox-item">
              <div>
                <strong>${escapeHtml(m.subject)}</strong>
                <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">To: ${escapeHtml(m.to)} &bull; ${escapeHtml(m.providerUsed)}</div>
              </div>
              <button type="button" class="btn btn-sm btn-primary js-view-msg" data-id="${escapeHtml(m.id)}">View Email</button>
            </div>
          `
            )
            .join('');

    outboxEl.querySelectorAll('.js-view-msg').forEach((b) =>
      b.addEventListener('click', () => {
        const msg = outbox.find((x) => x.id === b.getAttribute('data-id'));
        if (msg) openEmailModal(msg.subject, `To: ${msg.to} • ${msg.providerUsed}`, msg.html);
      })
    );
  }
}

async function fetchRadarData() {
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

  const res = await fetch(`/api/radar?${params.toString()}`);
  if (!res.ok) return;
  const data = await res.json();

  state.categories = data.categories || [];
  state.categoryCounts = data.categoryCounts || {};
  state.newCategoryCounts = data.newCategoryCounts || {};
  state.newlyCreated = data.newlyCreated || [];
  state.hottest90d = data.hottest90d || [];
  state.lastSyncAt = data.lastSyncAt || null;
  state.lastSyncSources = data.lastSyncSources || [];
  state.stats = data.stats || {};

  if (data.subredditContext) {
    const pill = document.getElementById('hero-context-pill');
    if (pill) {
      pill.textContent = `Running inside r/${data.subredditContext} via Devvit${data.username ? ` • u/${data.username}` : ''}`;
    }
  }

  populateCategoryDropdowns(state.categories);
  renderCategoryBar();
  renderFeeds();
}

async function fetchAutomations() {
  const res = await fetch('/api/automations');
  if (!res.ok) return;
  state.automations = await res.json();
  renderAutomations();
}

function resetFilters() {
  state.category = 'All';
  state.timeframe = '90d';
  state.minSubscribers = 10;
  state.minVelocity = 0;
  state.sortBy = 'default';
  state.sfwOnly = true;
  state.mediaOnly = false;
  state.search = '';

  const setVal = (id: string, v: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = v;
  };
  setVal('search-input', '');
  setVal('timeframe-select', '90d');
  setVal('min-subs-select', '10');
  setVal('min-velocity-select', '0');
  setVal('sort-select', 'default');

  const sfw = document.getElementById('sfw-only-checkbox') as HTMLInputElement | null;
  const media = document.getElementById('media-only-checkbox') as HTMLInputElement | null;
  if (sfw) sfw.checked = true;
  if (media) media.checked = false;

  fetchRadarData();
}

function switchView(view: ClientState['view']) {
  state.view = view;
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
  });
  const filterSec = document.getElementById('explorer-filter-section');
  if (filterSec) filterSec.style.display = view === 'automations' ? 'none' : 'block';

  const setDisplay = (id: string, d: string) => {
    const el = document.getElementById(id);
    if (el) el.style.display = d;
  };
  setDisplay('view-container-split', view === 'split' ? 'grid' : 'none');
  setDisplay('view-container-new', view === 'new' ? 'block' : 'none');
  setDisplay('view-container-hot90d', view === 'hot90d' ? 'block' : 'none');
  setDisplay('view-container-automations', view === 'automations' ? 'block' : 'none');

  renderCategoryBar();
  if (view === 'automations') fetchAutomations();
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = (btn.getAttribute('data-view') || 'split') as ClientState['view'];
      switchView(v);
    });
  });

  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', cur);
  });

  document.getElementById('live-sync-btn')?.addEventListener('click', async () => {
    const label = document.getElementById('live-sync-label');
    if (label) label.textContent = 'Syncing...';
    try {
      const r = await fetch('/api/subreddits/sync', { method: 'POST' });
      const j = await r.json();
      await fetchRadarData();
      notify('Reddit Synced', `${j.total || 0} communities (${j.addedOrUpdated || 0} live updates)`);
    } finally {
      if (label) label.textContent = 'Sync Reddit';
    }
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  document.getElementById('search-input')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = val;
      fetchRadarData();
    }, 180);
  });

  document.getElementById('timeframe-select')?.addEventListener('change', (e) => {
    state.timeframe = (e.target as HTMLSelectElement).value;
    fetchRadarData();
  });
  document.getElementById('min-subs-select')?.addEventListener('change', (e) => {
    state.minSubscribers = Number((e.target as HTMLSelectElement).value) || 0;
    fetchRadarData();
  });
  document.getElementById('min-velocity-select')?.addEventListener('change', (e) => {
    state.minVelocity = Number((e.target as HTMLSelectElement).value) || 0;
    fetchRadarData();
  });
  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    state.sortBy = (e.target as HTMLSelectElement).value;
    fetchRadarData();
  });
  document.getElementById('sfw-only-checkbox')?.addEventListener('change', (e) => {
    state.sfwOnly = (e.target as HTMLInputElement).checked;
    if (state.sfwOnly && state.category === 'NSFW & Adult') state.category = 'All';
    fetchRadarData();
  });
  document.getElementById('media-only-checkbox')?.addEventListener('change', (e) => {
    state.mediaOnly = (e.target as HTMLInputElement).checked;
    fetchRadarData();
  });
  document.getElementById('reset-filters-btn')?.addEventListener('click', resetFilters);

  document.getElementById('lookup-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('lookup-input') as HTMLInputElement | null;
    const rawName = input?.value.trim() || '';
    if (!rawName) return;
    const r = await fetch('/api/subreddits/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: rawName })
    });
    const d = await r.json();
    if (!r.ok) {
      notify('Lookup Notice', d.error || 'Subreddit could not be fetched');
      return;
    }
    if (input) input.value = '';
    await fetchRadarData();
    notify('Fetched Real Subreddit', `r/${d.subreddit.display_name} (${d.subreddit.subscribers} members)`);
  });

  document.getElementById('quick-subscribe-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('quick-email-input') as HTMLInputElement).value.trim();
    const category = (document.getElementById('quick-category-select') as HTMLSelectElement).value;
    const r = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        category,
        minSubscribers: state.minSubscribers || 10,
        newTimeframe: state.timeframe || '90d',
        sfwOnly: category === 'NSFW & Adult' ? false : state.sfwOnly,
        sendImmediate: true
      })
    });
    const d = await r.json();
    if (!r.ok) {
      notify('Subscription Error', d.error);
      return;
    }
    (document.getElementById('quick-email-input') as HTMLInputElement).value = '';
    await fetchAutomations();
    notify('Daily Alert Active', `${email} (${category})`);
    if (d.outboxEntry) {
      openEmailModal(d.outboxEntry.subject, d.outboxEntry.providerUsed, d.outboxEntry.html);
    }
  });

  document.getElementById('studio-subscribe-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('studio-email-input') as HTMLInputElement).value.trim();
    const category = (document.getElementById('studio-category-select') as HTMLSelectElement).value;
    const minSubscribers = Number((document.getElementById('studio-min-subs') as HTMLInputElement).value) || 0;
    const sendImmediate = (document.getElementById('studio-send-immediate') as HTMLInputElement).checked;
    const r = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        category,
        minSubscribers,
        newTimeframe: '90d',
        sfwOnly: category !== 'NSFW & Adult',
        sendImmediate
      })
    });
    const d = await r.json();
    if (!r.ok) {
      notify('Error', d.error);
      return;
    }
    (document.getElementById('studio-email-input') as HTMLInputElement).value = '';
    await fetchAutomations();
    notify('Alert Created', email);
  });

  document.getElementById('quick-preview-email-btn')?.addEventListener('click', async () => {
    const email = (document.getElementById('quick-email-input') as HTMLInputElement).value.trim() || 'you@domain.com';
    const category = (document.getElementById('quick-category-select') as HTMLSelectElement).value || state.category;
    const r = await fetch('/api/automations/preview-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        category,
        minSubscribers: state.minSubscribers || 10,
        newTimeframe: state.timeframe || '90d',
        sfwOnly: state.sfwOnly
      })
    });
    const d = await r.json();
    openEmailModal(d.subject, `Preview for ${email}`, d.html);
  });

  document.getElementById('run-daily-cron-btn')?.addEventListener('click', async () => {
    const r = await fetch('/api/automations/run-cron', { method: 'POST' });
    const d = await r.json();
    await fetchAutomations();
    notify('Daily Digest Executed', `Processed ${d.cronRun?.processedSubscriptions || 0} active alerts`);
  });

  document.getElementById('close-modal-btn')?.addEventListener('click', () => {
    document.getElementById('email-preview-modal')?.classList.remove('open');
  });

  await Promise.all([fetchRadarData(), fetchAutomations()]);
});
