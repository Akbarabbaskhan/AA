import { describe, expect, it } from 'vitest';
import { detectFileType, isAcceptableVideoLink, MAX_UPLOAD_BYTES } from '@/lib/storage/mime';
import { signStorageToken, storageKey, verifyStorageToken } from '@/lib/storage';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** A minimal ZIP local file header whose first entry has the given name. */
function zipWithFirstEntry(name: string, trailing = ''): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const trailingBytes = encoder.encode(trailing);
  const header = new Uint8Array(30 + nameBytes.length + trailingBytes.length);
  header.set([0x50, 0x4b, 0x03, 0x04], 0);
  header[26] = nameBytes.length & 0xff;
  header[27] = (nameBytes.length >> 8) & 0xff;
  header.set(nameBytes, 30);
  header.set(trailingBytes, 30 + nameBytes.length);
  return header;
}

describe('file type detection', () => {
  it('identifies the formats the spec allows', () => {
    expect(detectFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))?.contentType).toBe(
      'application/pdf',
    );
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.contentType).toBe(
      'image/png',
    );
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))?.contentType).toBe('image/jpeg');
    expect(detectFileType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))?.kind).toBe('image');
  });

  it('identifies a WEBP by its RIFF container, not just the first four bytes', () => {
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(detectFileType(webp)?.contentType).toBe('image/webp');

    // A RIFF that is not a WEBP (an AVI, say) is refused.
    const avi = new Uint8Array(16);
    avi.set([0x52, 0x49, 0x46, 0x46], 0);
    avi.set([0x41, 0x56, 0x49, 0x20], 8);
    expect(detectFileType(avi)).toBeNull();
  });

  it('tells Office formats apart by what is inside the archive', () => {
    expect(detectFileType(zipWithFirstEntry('[Content_Types].xml', 'word/document.xml'))?.kind).toBe(
      'document',
    );
    expect(detectFileType(zipWithFirstEntry('[Content_Types].xml', 'ppt/slides/'))?.kind).toBe(
      'presentation',
    );
    expect(detectFileType(zipWithFirstEntry('[Content_Types].xml', 'xl/workbook.xml'))?.kind).toBe(
      'spreadsheet',
    );
  });

  it('refuses a plain zip dressed up as a worksheet', () => {
    // This is how an executable arrives: right extension, right magic number, wrong contents.
    const plainZip = zipWithFirstEntry('payload.exe');
    expect(detectFileType(plainZip, 'worksheet.docx')).toBeNull();
  });

  it('refuses executables and scripts outright', () => {
    // ELF, Mach-O, Windows PE, and a shell script.
    expect(detectFileType(bytes(0x7f, 0x45, 0x4c, 0x46))).toBeNull();
    expect(detectFileType(bytes(0xcf, 0xfa, 0xed, 0xfe))).toBeNull();
    expect(detectFileType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
    expect(detectFileType(bytes(0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e))).toBeNull();
  });

  it('never lets an extension promote a file onto the allowlist', () => {
    // The whole point of sniffing: the name says PDF, the bytes say otherwise.
    expect(detectFileType(bytes(0x4d, 0x5a, 0x90, 0x00), 'past-paper.pdf')).toBeNull();
    expect(detectFileType(bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c), 'notes.pdf')).toBeNull();
  });

  it('refuses an empty or truncated file', () => {
    expect(detectFileType(new Uint8Array(0))).toBeNull();
    expect(detectFileType(bytes(0x25, 0x50))).toBeNull();
  });

  it('caps uploads at 25MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe('video links', () => {
  it('accepts the hosts a teacher actually uses, over HTTPS', () => {
    expect(isAcceptableVideoLink('https://www.youtube.com/watch?v=abc')).toBe(true);
    expect(isAcceptableVideoLink('https://youtu.be/abc')).toBe(true);
    expect(isAcceptableVideoLink('https://vimeo.com/123')).toBe(true);
  });

  it('refuses plain HTTP and unknown hosts', () => {
    expect(isAcceptableVideoLink('http://youtube.com/watch?v=abc')).toBe(false);
    expect(isAcceptableVideoLink('https://example.com/video.mp4')).toBe(false);
    expect(isAcceptableVideoLink('javascript:alert(1)')).toBe(false);
    expect(isAcceptableVideoLink('not a url')).toBe(false);
  });

  it('is not fooled by a lookalike host', () => {
    expect(isAcceptableVideoLink('https://youtube.com.evil.test/x')).toBe(false);
    expect(isAcceptableVideoLink('https://notyoutube.com/x')).toBe(false);
  });
});

describe('signed storage URLs', () => {
  const key = 'school-1/past-papers/abc.pdf';

  it('accepts a signature it issued', () => {
    const expiresAt = Date.now() + 60_000;
    const token = signStorageToken(key, 'get', expiresAt);
    expect(verifyStorageToken(key, 'get', expiresAt, token)).toBe(true);
  });

  it('refuses an expired signature', () => {
    const expiresAt = Date.now() - 1;
    const token = signStorageToken(key, 'get', expiresAt);
    expect(verifyStorageToken(key, 'get', expiresAt, token)).toBe(false);
  });

  it('refuses a signature for a different key, action or deadline', () => {
    const expiresAt = Date.now() + 60_000;
    const token = signStorageToken(key, 'get', expiresAt);

    // A read token must not authorise a write, or anyone with a download link could
    // overwrite the paper it points at.
    expect(verifyStorageToken(key, 'put', expiresAt, token)).toBe(false);
    expect(verifyStorageToken('school-2/past-papers/abc.pdf', 'get', expiresAt, token)).toBe(false);
    expect(verifyStorageToken(key, 'get', expiresAt + 1000, token)).toBe(false);
    expect(verifyStorageToken(key, 'get', expiresAt, 'forged')).toBe(false);
  });

  it('namespaces keys by tenant', () => {
    const generated = storageKey('school-1', 'past-papers', 'Paper 1.PDF');
    expect(generated.startsWith('school-1/past-papers/')).toBe(true);
    expect(generated.endsWith('.pdf')).toBe(true);
    // Two uploads of the same filename never collide.
    expect(generated).not.toBe(storageKey('school-1', 'past-papers', 'Paper 1.PDF'));
  });
});
