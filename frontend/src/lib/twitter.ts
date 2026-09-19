// twitterapi.io client — server-side only (API routes).
// Endpoint: GET /twitter/tweet/advanced_search?query=…&queryType=Latest|Top
// Auth: X-API-Key header. Returns up to ~20 tweets; we slice to maxItems client-side.

const TWITTER_KEY = process.env.TWITTERAPI_IO_KEY ?? '';

export interface Tweet {
  id: string;
  url: string;
  text: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  viewCount?: number;
  author: {
    userName: string;
    name: string;
    profilePicture: string;
    isVerified: boolean;
    followers: number;
  };
}

interface TwitterApiAuthor {
  userName?: string;
  name?: string;
  profilePicture?: string;
  isVerified?: boolean;
  isBlueVerified?: boolean;
  followers?: number;
}

interface TwitterApiTweet {
  id?: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  createdAt?: string;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  viewCount?: number;
  author?: TwitterApiAuthor;
}

interface TwitterApiResponse {
  tweets?: TwitterApiTweet[];
  has_next_page?: boolean;
  next_cursor?: string;
  status?: string;
  message?: string;
}

function normalize(raw: TwitterApiTweet): Tweet | null {
  if (!raw.id || !raw.text) return null;
  const a = raw.author ?? {};
  return {
    id: String(raw.id),
    url: raw.url ?? raw.twitterUrl ?? `https://x.com/i/status/${raw.id}`,
    text: raw.text,
    createdAt: raw.createdAt ?? '',
    likeCount: Number(raw.likeCount ?? 0),
    retweetCount: Number(raw.retweetCount ?? 0),
    replyCount: Number(raw.replyCount ?? 0),
    viewCount: raw.viewCount != null ? Number(raw.viewCount) : undefined,
    author: {
      userName: String(a.userName ?? ''),
      name: String(a.name ?? ''),
      profilePicture: String(a.profilePicture ?? ''),
      isVerified: Boolean(a.isBlueVerified || a.isVerified),
      followers: Number(a.followers ?? 0),
    },
  };
}

export interface SearchTweetsOpts {
  query: string;
  maxItems?: number;
  queryType?: 'Latest' | 'Top';
}

export async function searchTweets(opts: SearchTweetsOpts): Promise<Tweet[]> {
  if (!TWITTER_KEY) throw new Error('TWITTERAPI_IO_KEY not set');
  const url = new URL('https://api.twitterapi.io/twitter/tweet/advanced_search');
  url.searchParams.set('query', opts.query);
  url.searchParams.set('queryType', opts.queryType ?? 'Latest');
  const res = await fetch(url.toString(), { headers: { 'X-API-Key': TWITTER_KEY } });
  if (!res.ok) throw new Error(`twitterapi.io ${res.status}: ${await res.text()}`);
  const json = await res.json() as TwitterApiResponse;
  const max = Math.max(1, Math.min(opts.maxItems ?? 5, 20));
  return (json.tweets ?? [])
    .map(normalize)
    .filter((t): t is Tweet => t !== null)
    .slice(0, max);
}
