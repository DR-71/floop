/**
 * Floop Daily Subreddit Digest Email Builder
 * Generates rich HTML and plain-text emails containing:
 * 1) Newly Created Subreddits in the subscriber's selected category & filters
 * 2) Hottest New Subreddits in the Last 90 Days in that category
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatRelativeAge(createdUtc, nowSec) {
  const diffSec = Math.max(60, (nowSec || Math.floor(Date.now() / 1000)) - createdUtc);
  const hours = Math.floor(diffSec / 3600);
  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins}m old`;
  }
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

function buildDailyDigestEmail({
  subscription,
  newlyCreated = [],
  hottest90d = [],
  generatedAt = new Date(),
  triggerReason = 'Scheduled Daily Automation'
}) {
  const categoryLabel = subscription.category && subscription.category !== 'All'
    ? subscription.category
    : 'All Categories';
  const dateStr = generatedAt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const nowSec = Math.floor(generatedAt.getTime() / 1000);

  const subject = `[floop daily] ${categoryLabel}: ${newlyCreated.length} Newly Created & ${hottest90d.length} Hottest 90-Day Subreddits (${dateStr})`;

  const newRowsHtml = newlyCreated.length === 0
    ? `<tr><td style="padding: 18px; color: #64748b; font-size: 14px;">No newly created subreddits matched your strict filters today. Try lowering your minimum subscriber threshold.</td></tr>`
    : newlyCreated.map((sub, idx) => {
        const ageLabel = formatRelativeAge(sub.created_utc, nowSec);
        const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(sub.display_name)}/`;
        const nsfwPill = (sub.over18 || sub.category === 'NSFW & Adult')
          ? `<span style="display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 999px; background: #ffe4e6; color: #be123c; font-size: 10.5px; font-weight: 800;">18+ NSFW</span>`
          : '';
        return `
        <tr>
          <td style="padding: 16px 18px; border-bottom: 1px solid #e2e8f0;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <div>
                <a href="${redditUrl}" target="_blank" style="color: #0f172a; font-weight: 700; font-size: 16px; text-decoration: none; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;">
                  r/${escapeHtml(sub.display_name)}
                </a>
                ${nsfwPill}
                <span style="display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 11px; font-weight: 600;">
                  NEW &bull; ${escapeHtml(ageLabel)}
                </span>
                <span style="display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600;">
                  ${escapeHtml(sub.category || categoryLabel)}
                </span>
              </div>
            </div>
            <p style="margin: 6px 0 10px 0; color: #334155; font-size: 13.5px; line-height: 1.5;">
              ${escapeHtml(sub.public_description || sub.title || 'Newly launched community on Reddit.')}
            </p>
            <div style="font-size: 12px; color: #64748b;">
              <strong style="color: #0f172a;">${formatNumber(sub.subscribers)}</strong> members
              &nbsp;&bull;&nbsp;
              <strong style="color: #0284c7;">+${formatNumber(sub.subs_per_day)}/day</strong> velocity
              &nbsp;&bull;&nbsp;
              <strong>${formatNumber(sub.num_posts)}</strong> posts
              &nbsp;&bull;&nbsp;
              <strong>${formatNumber(sub.num_comments)}</strong> comments
              &nbsp;&bull;&nbsp;
              <a href="${redditUrl}" target="_blank" style="color: #ea580c; font-weight: 600; text-decoration: none;">Explore on Reddit &rarr;</a>
            </div>
          </td>
        </tr>`;
      }).join('');

  const hotRowsHtml = hottest90d.length === 0
    ? `<tr><td style="padding: 18px; color: #64748b; font-size: 14px;">No 90-day breakout subreddits matched your current filter criteria.</td></tr>`
    : hottest90d.map((sub, idx) => {
        const ageLabel = formatRelativeAge(sub.created_utc, nowSec);
        const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(sub.display_name)}/`;
        const nsfwPill = (sub.over18 || sub.category === 'NSFW & Adult')
          ? `<span style="display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 999px; background: #ffe4e6; color: #be123c; font-size: 10.5px; font-weight: 800;">18+ NSFW</span>`
          : '';
        return `
        <tr>
          <td style="padding: 16px 18px; border-bottom: 1px solid #e2e8f0;">
            <div style="margin-bottom: 6px;">
              <span style="display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 6px; background: #fff7ed; color: #c2410c; font-weight: 800; font-size: 12px; margin-right: 8px; border: 1px solid #fed7aa;">
                #${idx + 1}
              </span>
              <a href="${redditUrl}" target="_blank" style="color: #0f172a; font-weight: 700; font-size: 16px; text-decoration: none;">
                r/${escapeHtml(sub.display_name)}
              </a>
              ${nsfwPill}
              <span style="display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: #fff1f2; color: #be123c; font-size: 11px; font-weight: 700;">
                HEAT ${sub.heat_score || 95}
              </span>
              <span style="display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600;">
                ${escapeHtml(sub.category || categoryLabel)} &bull; ${escapeHtml(ageLabel)}
              </span>
            </div>
            <p style="margin: 6px 0 10px 0; color: #334155; font-size: 13.5px; line-height: 1.5;">
              ${escapeHtml(sub.public_description || sub.title || 'Fast-growing breakout community in the last 90 days.')}
            </p>
            <div style="font-size: 12px; color: #64748b;">
              <strong style="color: #0f172a;">${formatNumber(sub.subscribers)}</strong> subscribers
              &nbsp;&bull;&nbsp;
              <strong style="color: #ea580c;">+${formatNumber(sub.subs_per_day)} subs/day</strong>
              &nbsp;&bull;&nbsp;
              <strong>${formatNumber(sub.num_posts)}</strong> posts
              &nbsp;&bull;&nbsp;
              <strong>${formatNumber(sub.num_comments)}</strong> comments
              &nbsp;&bull;&nbsp;
              <a href="${redditUrl}" target="_blank" style="color: #ea580c; font-weight: 600; text-decoration: none;">Visit Subreddit &rarr;</a>
            </div>
          </td>
        </tr>`;
      }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 660px; margin: 0 auto; background: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 28px 28px 22px 28px; background: #0f172a; color: #ffffff;">
        <table width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              <div style="display: inline-block; padding: 4px 10px; border-radius: 6px; background: #ea580c; color: #ffffff; font-weight: 800; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">
                floop
              </div>
              <span style="margin-left: 10px; color: #94a3b8; font-size: 13px;">Daily Subreddit Radar &bull; ${escapeHtml(dateStr)}</span>
              <h1 style="margin: 14px 0 6px 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
                Your Daily ${escapeHtml(categoryLabel)} Subreddit Digest
              </h1>
              <p style="margin: 0; color: #cbd5e1; font-size: 13.5px; line-height: 1.5;">
                Automated daily report for <strong>${escapeHtml(subscription.email)}</strong> &bull; Schedule: Daily at ${escapeHtml(subscription.deliveryTime || '08:00')} UTC
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Summary Strip -->
    <tr>
      <td style="padding: 14px 28px; background: #fff7ed; border-bottom: 1px solid #fed7aa; font-size: 12.5px; color: #9a3412;">
        <strong>Active Filters:</strong> Category: <strong>${escapeHtml(categoryLabel)}</strong>
        &nbsp;|&nbsp; Min Subscribers: <strong>${formatNumber(subscription.minSubscribers || 0)}</strong>
        &nbsp;|&nbsp; Safety: <strong>${subscription.sfwOnly !== false ? 'SFW Only' : 'All (SFW + 18+)'}</strong>
        &nbsp;|&nbsp; Trigger: <strong>${escapeHtml(triggerReason)}</strong>
      </td>
    </tr>

    <!-- Section 1: Newly Created Subreddits -->
    <tr>
      <td style="padding: 24px 28px 8px 28px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <h2 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em;">
            1. Newly Created Subreddits (${escapeHtml(categoryLabel)})
          </h2>
        </div>
        <p style="margin: 4px 0 12px 0; font-size: 13px; color: #64748b;">
          Freshly launched communities matching your category and growth filters.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 10px;">
        <table width="100%" cellspacing="0" cellpadding="0">
          ${newRowsHtml}
        </table>
      </td>
    </tr>

    <!-- Section 2: Hottest New Subreddits in Last 90 Days -->
    <tr>
      <td style="padding: 28px 28px 8px 28px;">
        <h2 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a; letter-spacing: -0.01em;">
          2. Hottest New Subreddits in the Last 90 Days (${escapeHtml(categoryLabel)})
        </h2>
        <p style="margin: 4px 0 12px 0; font-size: 13px; color: #64748b;">
          Highest-velocity breakout communities created within the past 90 days ranked by Floop Heat Score &amp; subscriber velocity.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 10px 16px 10px;">
        <table width="100%" cellspacing="0" cellpadding="0">
          ${hotRowsHtml}
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 20px 28px; background: #f1f5f9; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; line-height: 1.6;">
        <div>
          Sent automatically by <strong>floop</strong> Daily Subreddit Discovery Engine.
          Subscription ID: <code>${escapeHtml(subscription.id)}</code> &bull; Recipient: <strong>${escapeHtml(subscription.email)}</strong>
        </div>
        <div style="margin-top: 4px;">
          To change your tracked categories, adjust minimum subscriber thresholds, or pause daily alerts, open the <strong>Email Alerts &amp; Automations</strong> tab in floop.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    `FLOOP DAILY SUBREDDIT DIGEST — ${dateStr}`,
    `Category: ${categoryLabel} | Recipient: ${subscription.email}`,
    `Schedule: Daily at ${subscription.deliveryTime || '08:00'} UTC | Trigger: ${triggerReason}`,
    ``,
    `================================================================`,
    `1. NEWLY CREATED SUBREDDITS (${categoryLabel.toUpperCase()})`,
    `================================================================`,
    ...newlyCreated.map((s, i) =>
      `${i + 1}. r/${s.display_name} (${formatNumber(s.subscribers)} subs, +${formatNumber(s.subs_per_day)}/day, ${formatRelativeAge(s.created_utc, nowSec)})\n   ${s.public_description || s.title || ''}\n   https://www.reddit.com/r/${s.display_name}/`
    ),
    ``,
    `================================================================`,
    `2. HOTTEST NEW SUBREDDITS IN THE LAST 90 DAYS (${categoryLabel.toUpperCase()})`,
    `================================================================`,
    ...hottest90d.map((s, i) =>
      `#${i + 1} r/${s.display_name} [HEAT ${s.heat_score || 95}] (${formatNumber(s.subscribers)} subs, +${formatNumber(s.subs_per_day)}/day, ${s.num_posts || 0} posts, ${s.num_comments || 0} comments)\n   ${s.public_description || s.title || ''}\n   https://www.reddit.com/r/${s.display_name}/`
    ),
    ``,
    `--`,
    `Sent by floop Automated Subreddit Discovery Engine (Subscription ID: ${subscription.id})`
  ];

  return {
    subject,
    html,
    text: textLines.join('\n')
  };
}

module.exports = { buildDailyDigestEmail };
