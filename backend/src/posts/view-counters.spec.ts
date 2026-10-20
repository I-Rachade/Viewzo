import {
  facebookVideoId,
  instagramCode,
  parseCompactCount,
  telegramPost,
  threadsCode,
  tiktokVideoId,
  xPostId,
  youtubeVideoId,
} from './view-counters';

describe('post links', () => {
  it('reads YouTube watch, short, shorts and embed links', () => {
    expect(
      youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'),
    ).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=x')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(youtubeVideoId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
    expect(youtubeVideoId('https://www.youtube.com/@chaine')).toBeNull();
    expect(youtubeVideoId('pas un lien')).toBeNull();
  });

  it('reads the other platforms', () => {
    expect(
      tiktokVideoId(
        'https://www.tiktok.com/@ama/video/7300000000000000001?lang=fr',
      ),
    ).toBe('7300000000000000001');
    expect(xPostId('https://x.com/ama/status/1850000000000000000')).toBe(
      '1850000000000000000',
    );
    expect(
      instagramCode('https://www.instagram.com/reel/C9xYz_12AB/?igsh=1'),
    ).toBe('C9xYz_12AB');
    expect(instagramCode('https://www.instagram.com/p/C9xYz_12AB/')).toBe(
      'C9xYz_12AB',
    );
    expect(threadsCode('https://www.threads.net/@ama/post/C9abcDEF')).toBe(
      'C9abcDEF',
    );
    expect(
      facebookVideoId('https://www.facebook.com/viewzo/videos/123456789/'),
    ).toBe('123456789');
    expect(facebookVideoId('https://www.facebook.com/reel/987654321')).toBe(
      '987654321',
    );
    expect(facebookVideoId('https://www.facebook.com/watch/?v=555')).toBe(
      '555',
    );
    expect(telegramPost('https://t.me/viewzo_news/42')).toEqual({
      channel: 'viewzo_news',
      id: '42',
    });
    expect(telegramPost('https://t.me/+invite')).toBeNull();
  });

  it('parses Telegram counts', () => {
    expect(parseCompactCount('950')).toBe(950);
    expect(parseCompactCount('1.2K')).toBe(1200);
    expect(parseCompactCount('3,4M')).toBe(3_400_000);
    expect(parseCompactCount('abc')).toBeNull();
  });
});
