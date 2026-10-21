import { sniffFile } from './file-types';

const bytes = (head: number[] | string, size = 16) => {
  const b = Buffer.alloc(size);
  (typeof head === 'string'
    ? Buffer.from(head, 'latin1')
    : Buffer.from(head)
  ).copy(b);
  return b;
};

describe('sniffFile', () => {
  it('reads the type from the first bytes', () => {
    expect(sniffFile(bytes([0xff, 0xd8, 0xff]))?.mime).toBe('image/jpeg');
    expect(sniffFile(bytes([0x89, 0x50, 0x4e, 0x47]))?.mime).toBe('image/png');
    expect(sniffFile(bytes('RIFF\0\0\0\0WEBP'))?.mime).toBe('image/webp');
    expect(sniffFile(bytes('RIFF\0\0\0\0WAVE'))?.kind).toBe('AUDIO');
    expect(sniffFile(bytes('%PDF-1.7'))?.kind).toBe('PDF');
    expect(sniffFile(bytes('\0\0\0\x18ftypisom'))?.mime).toBe('video/mp4');
    expect(sniffFile(bytes('\0\0\0\x14ftypqt  '))?.mime).toBe(
      'video/quicktime',
    );
    expect(sniffFile(bytes('\0\0\0\x1cftypM4A '))?.mime).toBe('audio/mp4');
    expect(sniffFile(bytes([0x1a, 0x45, 0xdf, 0xa3]))?.mime).toBe('video/webm');
    expect(sniffFile(bytes('OggS'))?.mime).toBe('audio/ogg');
    expect(sniffFile(bytes('ID3\x04'))?.mime).toBe('audio/mpeg');
  });

  it('refuses anything else', () => {
    expect(sniffFile(bytes('<html><script>'))).toBeNull();
    expect(sniffFile(bytes('MZ\x90\0'))).toBeNull();
    expect(sniffFile(Buffer.from('tiny'))).toBeNull();
  });
});
