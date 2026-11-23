import type { SubredditRecord, Subscription } from '../shared/types.js';

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(n: number | null | undefined): string {
  const num = Number(n);
  if (Number.isNaN(num)) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString('en-US');
}

export function formatRelativeAge(createdUtc: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - createdUtc);
  const hours = Math.floor(diffSec / 3600);
  if (hours < 1) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function buildDailyDigestEmail(params: {
  subscription: Partial<Subscription>;
  newlyCreated: SubredditRecord[];
  hottest90d: SubredditRecord[];
  dateLabel?: string;
}): {
  subject: string;
  html: string;
  text: string;
  markdown: string;
} {
  const { subscription, newlyCreated, hottest90d } = params;
  const dateLabel =
    params.dateLabel ||
    new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  const catLabel =
    subscription.category && subscription.category !== 'All'
      ? subscription.category
      : 'All Categories';

  const subject = `[floop daily] ${catLabel}: ${newlyCreated.length} Newly Created & ${hottest90d.length} Hottest 90-Day Subreddits (${dateLabel})`;

  const renderNewRow = (sub: SubredditRecord) => {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub.display_name)}/`;
    const isNsfw = sub.over18 || sub.category === 'NSFW & Adult';
    const hasPosts = sub.num_posts !== null && sub.num_posts !== undefined;
    return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
          <div style="margin-bottom:4px;">
            <a href="${url}" target="_blank" style="font-size:15px;font-weight:700;color:#0f172a;text-decoration:none;">r/${escapeHtml(sub.display_name)}</a>
            ${isNsfw ? `<span style="display:inline-block;margin-left:6px;padding:2px 7px;border-radius:999px;background:#ffe4e6;color:#be123c;font-size:10px;font-weight:800;">18+ NSFW</span>` : ''}
            <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:700;">NEW &bull; ${escapeHtml(formatRelativeAge(sub.created_utc))}</span>
          </div>
          <div style="font-size:13px;line-height:1.45;color:#334155;margin-bottom:6px;">${escapeHtml(sub.public_description)}</div>
          <div style="font-size:12px;color:#64748b;">
            <strong style="color:#0f172a;">${formatNumber(sub.subscribers)}</strong> members &bull;
            <strong style="color:#ff4500;">+${formatNumber(sub.subs_per_day)}/day</strong>
            ${hasPosts ? ` &bull; ${formatNumber(sub.num_posts)} posts` : ''} &bull;
            ${escapeHtml(sub.category)}
          </div>
        </td>
      </tr>`;
  };

  const renderHotRow = (sub: SubredditRecord, idx: number) => {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub.display_name)}/`;
    const isNsfw = sub.over18 || sub.category === 'NSFW & Adult';
    const hasComments = sub.num_comments !== null && sub.num_comments !== undefined;
    return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
          <div style="margin-bottom:4px;">
            <span style="display:inline-block;margin-right:6px;padding:2px 6px;border-radius:4px;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:800;">#${idx + 1}</span>
            <a href="${url}" target="_blank" style="font-size:15px;font-weight:700;color:#0f172a;text-decoration:none;">r/${escapeHtml(sub.display_name)}</a>
            ${isNsfw ? `<span style="display:inline-block;margin-left:6px;padding:2px 7px;border-radius:99px;background:#ffe4e6;color:#be123c;font-size:10px;font-weight:800;">18+ NSFW</span>` : ''}
            <span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;background:#fff1f2;color:#be123c;font-size:11px;font-weight:700;">HEAT ${sub.heat_score}</span>
          </div>
          <div style="font-size:13px;line-height:1.45;color:#334155;margin-bottom:6px;">${escapeHtml(sub.public_description)}</div>
          <div style="font-size:12px;color:#64748b;">
            <strong style="color:#0f172a;">${formatNumber(sub.subscribers)}</strong> members &bull;
            <strong style="color:#ff4500;">+${formatNumber(sub.subs_per_day)}/day</strong>
            ${hasComments ? ` &bull; ${formatNumber(sub.num_comments)} comments` : ''} &bull;
            Launched ${escapeHtml(formatRelativeAge(sub.created_utc))}
          </div>
        </td>
      </tr>`;
  };

  const emptyRow = `<tr><td style="padding:16px;color:#64748b;font-size:13px;">No subreddits matched the current filters for this window.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:linear-gradient(135deg,#2b0908 0%,#450f0b 100%);padding:24px;color:#ffffff;border-bottom:3px solid #ff4500;">
              <span style="display:inline-block;background:#ff4500;color:#ffffff;font-weight:800;font-size:12px;letter-spacing:0.06em;padding:4px 10px;border-radius:6px;text-transform:uppercase;">floop &bull; Devvit Radar</span>
              <h1 style="margin:12px 0 6px 0;font-size:21px;line-height:1.25;color:#ffffff;">Daily ${escapeHtml(catLabel)} Subreddit Digest</h1>
              <p style="margin:0;font-size:13px;color:#fca5a5;">Real Reddit communities &bull; ${escapeHtml(dateLabel)} &bull; Scheduled ${escapeHtml(subscription.deliveryTime || '08:00')} UTC</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px 6px 24px;">
              <h2 style="margin:0;font-size:16px;color:#0f172a;">1. Newly Created Subreddits (${escapeHtml(catLabel)})</h2>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 24px 12px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                ${newlyCreated.length > 0 ? newlyCreated.map(renderNewRow).join('') : emptyRow}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 24px 6px 24px;">
              <h2 style="margin:0;font-size:16px;color:#0f172a;">2. Hottest New Subreddits in Last 90 Days (${escapeHtml(catLabel)})</h2>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 24px 22px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                ${hottest90d.length > 0 ? hottest90d.map((s, i) => renderHotRow(s, i)).join('') : emptyRow}
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
              Sent automatically by <strong>floop</strong> via Reddit Devvit Scheduler to ${escapeHtml(subscription.email || 'subscriber')}.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const markdownLines: string[] = [
    `# floop Daily Subreddit Radar — ${catLabel} (${dateLabel})`,
    '',
    `## 1. Newly Created Subreddits (${catLabel})`,
    ...newlyCreated.map(
      (s) =>
        `- **r/${s.display_name}** (${formatRelativeAge(s.created_utc)}, ${formatNumber(s.subscribers)} members, +${formatNumber(s.subs_per_day)}/day) — ${s.public_description.slice(0, 140)}`
    ),
    '',
    `## 2. Hottest New Subreddits in Last 90 Days (${catLabel})`,
    ...hottest90d.map(
      (s, i) =>
        `${i + 1}. **r/${s.display_name}** (Heat ${s.heat_score}, ${formatNumber(s.subscribers)} members, +${formatNumber(s.subs_per_day)}/day, launched ${formatRelativeAge(s.created_utc)}) — ${s.public_description.slice(0, 140)}`
    )
  ];

  const markdown = markdownLines.join('\n');
  return { subject, html, text: markdown, markdown };
}
