import { AutoRejection, SocialNetwork } from '@prisma/client';
import { parseHandle, profileUrl } from './handle';
import { judge } from './profile-checks';

describe('parseHandle', () => {
  it.each([
    ['@Ama.Togo', 'Ama.Togo'],
    ['ama_tg', 'ama_tg'],
    ['https://www.tiktok.com/@ama_tg?lang=fr', 'ama_tg'],
    ['instagram.com/ama/', 'ama'],
  ])('reads %s', (raw, name) => {
    expect(parseHandle(SocialNetwork.TIKTOK, raw)).toEqual({
      name,
      key: name.toLowerCase(),
    });
  });

  it('skips the path part before the name in profile links', () => {
    expect(
      parseHandle(SocialNetwork.LINKEDIN, 'https://www.linkedin.com/in/ama-k/'),
    ).toEqual({ name: 'ama-k', key: 'ama-k' });
    expect(
      parseHandle(
        SocialNetwork.FACEBOOK,
        'https://www.facebook.com/profile.php?id=1000123',
      ),
    ).toEqual({ name: '1000123', key: '1000123' });
  });

  it('keys WhatsApp numbers by their digits', () => {
    expect(
      parseHandle(SocialNetwork.WHATSAPP_STATUS, '+228 91 00 00 01'),
    ).toEqual({ name: '+228 91 00 00 01', key: '22891000001' });
    expect(parseHandle(SocialNetwork.WHATSAPP_STATUS, '12345')).toBeNull();
  });

  it('refuses text that is not an account name', () => {
    expect(parseHandle(SocialNetwork.TIKTOK, 'not a name!')).toBeNull();
    expect(parseHandle(SocialNetwork.TIKTOK, '@')).toBeNull();
  });
});

describe('profileUrl', () => {
  it('links to the public profile', () => {
    expect(profileUrl(SocialNetwork.TIKTOK, 'ama')).toBe(
      'https://www.tiktok.com/@ama',
    );
    expect(profileUrl(SocialNetwork.YOUTUBE, 'UC1234567890123456789012')).toBe(
      'https://www.youtube.com/channel/UC1234567890123456789012',
    );
    expect(profileUrl(SocialNetwork.WHATSAPP_STATUS, '+228')).toBeNull();
  });
});

describe('judge', () => {
  it('refuses accounts that do not exist or show no name and no picture', () => {
    expect(judge({ found: false })).toEqual({
      rejection: AutoRejection.NOT_FOUND,
    });
    expect(
      judge({ found: true, hasName: false, hasPicture: false, followers: 3 }),
    ).toEqual({ rejection: AutoRejection.ANONYMOUS, followers: 3 });
  });

  it('keeps the follower count and leaves unknown cases to the team', () => {
    expect(judge({ found: true, hasName: true, followers: 1200 })).toEqual({
      rejection: null,
      followers: 1200,
    });
    // A name alone is enough, an unknown picture is not a reason to refuse.
    expect(judge({ found: true, hasName: false })).toEqual({
      rejection: null,
      followers: undefined,
    });
    expect(judge(null)).toEqual({ rejection: null });
  });
});
