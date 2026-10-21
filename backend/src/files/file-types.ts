import { CampaignFileKind } from '@prisma/client';

export interface FileType {
  kind: CampaignFileKind;
  mime: string;
  ext: string;
}

// Largest file of each kind, in bytes.
export const MAX_FILE_BYTES: Record<CampaignFileKind, number> = {
  IMAGE: 10 * 1024 * 1024,
  PDF: 10 * 1024 * 1024,
  AUDIO: 20 * 1024 * 1024,
  VIDEO: 100 * 1024 * 1024,
};

export const MAX_UPLOAD_BYTES = Math.max(...Object.values(MAX_FILE_BYTES));

const ascii = (b: Buffer, from: number, to: number) =>
  b.subarray(from, to).toString('latin1');

/**
 * The file type, read from its first bytes rather than trusted from the
 * client: images, PDF, MP4/MOV/WebM videos, MP3/M4A/OGG/WAV audio.
 */
export function sniffFile(b: Buffer): FileType | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { kind: 'IMAGE', mime: 'image/jpeg', ext: 'jpg' };
  }
  if (ascii(b, 1, 4) === 'PNG' && b[0] === 0x89) {
    return { kind: 'IMAGE', mime: 'image/png', ext: 'png' };
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    return { kind: 'IMAGE', mime: 'image/webp', ext: 'webp' };
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WAVE') {
    return { kind: 'AUDIO', mime: 'audio/wav', ext: 'wav' };
  }
  if (ascii(b, 0, 5) === '%PDF-') {
    return { kind: 'PDF', mime: 'application/pdf', ext: 'pdf' };
  }
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (brand === 'M4A ' || brand === 'M4B ') {
      return { kind: 'AUDIO', mime: 'audio/mp4', ext: 'm4a' };
    }
    if (brand === 'qt  ') {
      return { kind: 'VIDEO', mime: 'video/quicktime', ext: 'mov' };
    }
    return { kind: 'VIDEO', mime: 'video/mp4', ext: 'mp4' };
  }
  // Matroska/WebM: browsers record voice notes in it too.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { kind: 'VIDEO', mime: 'video/webm', ext: 'webm' };
  }
  if (ascii(b, 0, 4) === 'OggS') {
    return { kind: 'AUDIO', mime: 'audio/ogg', ext: 'ogg' };
  }
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) {
    return { kind: 'AUDIO', mime: 'audio/mpeg', ext: 'mp3' };
  }
  return null;
}
