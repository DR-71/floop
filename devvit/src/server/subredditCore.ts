import baselineData from '../data/subreddits.json';
import { CATEGORIES, type Category, type RadarResponse, type SubredditRecord } from '../shared/types.js';

export const BLOCKLIST_REGEX = /(test_sub|testing123|spam|bot_test|private_test|r_[a-z0-9]{18,}|subreddit_test)/i;

const CATEGORY_RULES: Array<{ category: Category; regex: RegExp }> = [
  {
    category: 'NSFW & Adult',
    regex: /\b(nsfw|porn|hentai|lewd|onlyfans|gonewild|erotic|erotica|xxx|bdsm|kink|fetish|boudoir|nude|nudes|18\+|adult|milf|lingerie|sex|rule34|waifu_nsfw|afterdark|spicy|smut)\b/i
  },
  {
    category: 'Technology & AI',
    regex: /\b(ai|llm|gpt|claude|openai|anthropic|gemini|programming|coding|software|developer|dev|rust|python|typescript|javascript|react|nextjs|linux|docker|kubernetes|homelab|selfhosted|cybersecurity|infosec|saas|indiehackers|hardware|tech|technology|robotics|drone|vr|ar|apple|android|mcp|agent|agentic|copilot)\b/i
  },
  {
    category: 'Gaming',
    regex: /\b(game|gaming|gamer|rpg|mmorpg|indiegame|gamedev|steam|nintendo|playstation|ps5|xbox|switch|esports|minecraft|roblox|pokemon|valorant|elden|souls|gta|retro|handheld|boardgame|tabletop|dnd|ttrpg|warcraft|wow|sim|roguelike|deckbuilder|modding)\b/i
  },
  {
    category: 'Science & Engineering',
    regex: /\b(science|physics|chemistry|biology|neuroscience|astronomy|space|rocket|orbital|nasa|math|mathematics|engineering|mechanical|electrical|biotech|genetics|fusion|battery|energy|climate|geology|research|academic|microscopy|plague|epidemiology)\b/i
  },
  {
    category: 'Finance & Business',
    regex: /\b(finance|investing|stocks|stockmarket|etf|options|crypto|bitcoin|ethereum|trading|economics|economy|business|startup|founder|entrepreneur|marketing|ecommerce|shopify|realestate|saas|b2b|pricing|wealth|frugal|fire|tax|accounting|restock)\b/i
  },
  {
    category: 'Entertainment & Media',
    regex: /\b(movie|movies|cinema|film|tv|television|series|netflix|hbo|anime|manga|manhwa|comic|comics|book|books|reading|scifi|fantasy|novel|literature|hollywood|celebrity|oscars|trailer|streaming|documentary)\b/i
  },
  {
    category: 'Art & Design',
    regex: /\b(art|artist|drawing|sketch|painting|illustration|illustrator|design|graphicdesign|typography|ui|ux|figma|blender|3d|pixelart|voxel|sculpture|photography|photo|camera|architecture|aesthetic|craft|crochet|miniatures|motiondesign)\b/i
  },
  {
    category: 'Sports & Fitness',
    regex: /\b(sport|sports|fitness|workout|gym|bodybuilding|running|marathon|cycling|soccer|football|nfl|nba|basketball|baseball|mlb|hockey|nhl|f1|formula1|ufc|mma|boxing|tennis|golf|climbing|bouldering|hiking|yoga|nutrition|triathlon)\b/i
  },
  {
    category: 'Memes & Humor',
    regex: /\b(meme|memes|shitpost|circlejerk|okbuddy|funny|humor|humour|satire|comedy|cursed|blursed|me_irl|greentext|copypasta|snark|gossip)\b/i
  },
  {
    category: 'Lifestyle & Food',
    regex: /\b(food|cooking|baking|sourdough|recipe|recipes|coffee|espresso|tea|wine|beer|whiskey|travel|gardening|plants|houseplants|homedecor|interior|fashion|streetwear|skincare|makeup|minimalism|parenting|pets|cats|dogs)\b/i
  },
  {
    category: 'Music & Audio',
    regex: /\b(music|album|song|songs|hiphop|rap|rock|metal|indie|electronic|edm|jazz|vinyl|turntable|headphones|audiophile|iem|synth|synthesizer|eurorack|daw|ableton|flstudio|guitar|piano|drums|singer|producer)\b/i
  },
  {
    category: 'Career & Education',
    regex: /\b(career|careers|job|jobs|hiring|recruit|interview|resume|remote|remotework|work|salary|education|college|university|student|students|study|studyabroad|phd|gradschool|certifications|mba|law|medschool|nursing|teaching)\b/i
  }
];

export function classifyCategory(raw: {
  display_name?: string;
  title?: string;
  public_description?: string;
  over18?: boolean;
}): Category | null {
  if (raw.over18) return 'NSFW & Adult';
  const haystack = `${raw.display_name || ''} ${raw.title || ''} ${raw.public_description || ''}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.regex.test(haystack)) {
      return rule.category;
    }
  }
  return null;
}

export function extractTags(
  raw: { display_name?: string; title?: string; public_description?: string; allow_images?: boolean; allow_videos?: boolean },
  category: Category
): string[] {
  const tags = new Set<string>();
  const lower = `${raw.display_name || ''} ${raw.title || ''} ${raw.public_description || ''}`.toLowerCase();
  const shortCat = category.split('&')[0].trim().toLowerCase();
  tags.add(shortCat);
  if (category === 'NSFW & Adult') tags.add('18+');

  const keywords = [
    'ai', 'coding', 'github', 'apple', 'rpg', 'indie', 'anime', 'space',
    'investing', 'crypto', 'art', 'design', 'fitness', 'running', 'cooking',
    'recipes', 'coffee', 'music', 'synth', 'study', 'remote', 'memes', 'cats',
    'dogs', 'film', 'tv', 'f1', 'soccer', 'nsfw', '18+'
  ];
  for (const kw of keywords) {
    if (new RegExp(`\\b${kw.replace('+', '\\+')}\\b`, 'i').test(lower)) {
      tags.add(kw);
    }
  }
  if (raw.allow_images || raw.allow_videos) tags.add('media');
  else tags.add('discussion');
  return Array.from(tags).slice(0, 6);
}

export function computeMetrics(
  base: {
    subscribers: number;
    created_utc: number;
    num_posts: number | null;
    num_comments: number | null;
  },
  nowSec: number
): {
  subscribers: number;
  num_posts: number | null;
  num_comments: number | null;
  subs_per_day: number;
  age_days: number;
  heat_score: number;
} {
  const ageSec = Math.max(3600, nowSec - base.created_utc);
  const ageDays = Math.max(0.05, ageSec / 86400);
  const subscribers = Math.max(0, Number(base.subscribers) || 0);
  const subsPerDay = Math.round(subscribers / Math.max(1, ageDays));

  const hasPosts = base.num_posts !== null && base.num_posts !== undefined;
  const hasComments = base.num_comments !== null && base.num_comments !== undefined;
  const numPosts = hasPosts ? Math.max(0, Number(base.num_posts) || 0) : null;
  const numComments = hasComments ? Math.max(0, Number(base.num_comments) || 0) : null;

  const velocityFactor = Math.min(48, Math.log10(subsPerDay + 1) * 16);
  const sizeFactor = Math.min(32, Math.log10(subscribers + 1) * 7.2);
  const activitySum = (numPosts || 0) + (numComments || 0);
  const engagementFactor = activitySum > 0 ? Math.min(20, Math.log10(activitySum + 1) * 4.2) : 0;
  const heatScore = Math.min(99, Math.max(10, Math.round(velocityFactor + sizeFactor + engagementFactor)));

  return {
    subscribers,
    num_posts: numPosts,
    num_comments: numComments,
    subs_per_day: subsPerDay,
    age_days: Number(ageDays.toFixed(1)),
    heat_score: heatScore
  };
}

export function normalizeRawSubreddit(
  r: {
    id?: string;
    display_name?: string;
    title?: string;
    public_description?: string;
    created_utc?: number;
    over18?: boolean;
    allow_images?: boolean;
    allow_videos?: boolean;
    community_icon?: string;
    icon_img?: string;
    primary_color?: string;
    subscribers?: number;
    active_accounts?: number | null;
    num_posts?: number | null;
    num_comments?: number | null;
    _meta?: { num_posts?: number | null; num_comments?: number | null };
  },
  sourceLabel: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): SubredditRecord | null {
  if (!r || !r.display_name || r.display_name.startsWith('u_')) return null;
  const text = `${r.display_name} ${r.title || ''} ${r.public_description || ''}`;
  if (BLOCKLIST_REGEX.test(text)) return null;
  const desc = (r.public_description || r.title || '').trim();
  if (desc.length < 6) return null;

  const category = classifyCategory(r);
  if (!category) return null;

  const createdUtc = Number(r.created_utc);
  if (!createdUtc || Number.isNaN(createdUtc)) return null;

  const isNsfw = category === 'NSFW & Adult';
  const numPostsRaw = r._meta?.num_posts ?? r.num_posts ?? null;
  const numCommentsRaw = r._meta?.num_comments ?? r.num_comments ?? null;

  const base = {
    id: r.id || r.display_name.toLowerCase(),
    display_name: r.display_name,
    title: r.title || r.display_name,
    public_description: desc,
    created_utc: createdUtc,
    over18: Boolean(r.over18) || isNsfw,
    category,
    allow_images: r.allow_images !== false,
    allow_videos: r.allow_videos !== false,
    community_icon: (r.community_icon || r.icon_img || '').split('?')[0],
    primary_color: r.primary_color || (isNsfw ? '#e11d48' : '#ff4500'),
    subscribers: Number(r.subscribers) || 0,
    num_posts: numPostsRaw !== null && numPostsRaw !== undefined ? Number(numPostsRaw) : null,
    num_comments: numCommentsRaw !== null && numCommentsRaw !== undefined ? Number(numCommentsRaw) : null,
    active_accounts: r.active_accounts !== undefined && r.active_accounts !== null ? Number(r.active_accounts) : null,
    source: sourceLabel
  };

  const metrics = computeMetrics(base, nowSec);
  return {
    ...base,
    ...metrics,
    tags: extractTags(base, category)
  };
}

export function getBundledBaselineSubreddits(): SubredditRecord[] {
  const rawList = Array.isArray(baselineData) ? baselineData : [];
  return rawList as SubredditRecord[];
}

export function sortSubreddits(list: SubredditRecord[], sortBy: string): SubredditRecord[] {
  const arr = [...list];
  switch (sortBy) {
    case 'created_desc':
      return arr.sort((a, b) => b.created_utc - a.created_utc);
    case 'subscribers_desc':
      return arr.sort((a, b) => b.subscribers - a.subscribers);
    case 'velocity_desc':
      return arr.sort((a, b) => b.subs_per_day - a.subs_per_day);
    case 'activity_desc':
      return arr.sort(
        (a, b) =>
          ((b.num_comments || 0) + (b.num_posts || 0)) -
          ((a.num_comments || 0) + (a.num_posts || 0))
      );
    case 'heat_desc':
    default:
      return arr.sort((a, b) => (b.heat_score - a.heat_score) || (b.subscribers - a.subscribers));
  }
}

export function querySubreddits(
  all: SubredditRecord[],
  options: {
    category?: string;
    timeframe?: string;
    minSubscribers?: number;
    minVelocity?: number;
    sfwOnly?: boolean;
    mediaOnly?: boolean;
    search?: string;
    sortBy?: string;
    limit?: number;
    lastSyncAt?: string | null;
    lastSyncSources?: string[];
  } = {}
): RadarResponse {
  const {
    category = 'All',
    timeframe = '90d',
    minSubscribers = 0,
    minVelocity = 0,
    sfwOnly = true,
    mediaOnly = false,
    search = '',
    sortBy = 'created_desc',
    limit = 60,
    lastSyncAt = null,
    lastSyncSources = []
  } = options;

  const nowSec = Math.floor(Date.now() / 1000);
  const tfMap: Record<string, number> = {
    '24h': 86400 * 1.5,
    '7d': 86400 * 7,
    '30d': 86400 * 30,
    '90d': 86400 * 90,
    all: 86400 * 3650
  };
  const newMaxAge = tfMap[timeframe] ?? 86400 * 90;
  const hotMaxAge = 86400 * 90;
  const searchLower = String(search || '').trim().toLowerCase();
  const isAdultSelected =
    String(category).toLowerCase().includes('nsfw') ||
    String(category).toLowerCase().includes('adult');

  const matchesNonCategory = (s: SubredditRecord, maxAgeSec: number, enforceSfw: boolean): boolean => {
    if (enforceSfw && s.over18) return false;
    if (mediaOnly && !s.allow_images && !s.allow_videos) return false;
    if ((nowSec - s.created_utc) > maxAgeSec) return false;
    if (minSubscribers > 0 && s.subscribers < minSubscribers) return false;
    if (minVelocity > 0 && s.subs_per_day < minVelocity) return false;
    if (searchLower) {
      const hay = `${s.display_name} ${s.title} ${s.public_description} ${s.category} ${(s.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  };

  const matchCat = (s: SubredditRecord) => category === 'All' || s.category === category;
  const enforceSfwActive = Boolean(sfwOnly) && !isAdultSelected;

  const newlyCreatedAll = sortSubreddits(
    all.filter((s) => matchesNonCategory(s, newMaxAge, enforceSfwActive) && matchCat(s)),
    sortBy || 'created_desc'
  );

  const hottest90dAll = sortSubreddits(
    all.filter((s) => matchesNonCategory(s, hotMaxAge, enforceSfwActive) && matchCat(s)),
    'heat_desc'
  );

  const categoryCounts: Record<string, number> = { All: 0 };
  const newCategoryCounts: Record<string, number> = { All: 0 };
  for (const c of CATEGORIES) {
    categoryCounts[c] = 0;
    newCategoryCounts[c] = 0;
  }

  for (const s of all) {
    const isAdult = s.category === 'NSFW & Adult';
    if (matchesNonCategory(s, hotMaxAge, isAdult ? false : sfwOnly)) {
      if (categoryCounts[s.category] !== undefined) categoryCounts[s.category]++;
    }
    if (matchesNonCategory(s, hotMaxAge, sfwOnly)) {
      categoryCounts.All++;
    }
    if (matchesNonCategory(s, newMaxAge, isAdult ? false : sfwOnly)) {
      if (newCategoryCounts[s.category] !== undefined) newCategoryCounts[s.category]++;
    }
    if (matchesNonCategory(s, newMaxAge, sfwOnly)) {
      newCategoryCounts.All++;
    }
  }

  const slicedNew = limit > 0 ? newlyCreatedAll.slice(0, limit) : newlyCreatedAll;
  const slicedHot = limit > 0 ? hottest90dAll.slice(0, limit) : hottest90dAll;

  return {
    totalMatched: newlyCreatedAll.length,
    newlyCreatedTotal: newlyCreatedAll.length,
    newlyCreated: slicedNew,
    hottest90dTotal: hottest90dAll.length,
    hottest90d: slicedHot,
    categoryCounts,
    newCategoryCounts,
    categories: CATEGORIES,
    lastSyncAt,
    lastSyncSources,
    stats: {
      totalTracked: categoryCounts.All || 0,
      newMatched: newlyCreatedAll.length,
      hot90dMatched: hottest90dAll.length,
      topBreakout: hottest90dAll[0] || null
    }
  };
}
