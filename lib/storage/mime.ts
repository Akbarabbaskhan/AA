/**
 * Server-side file type detection.
 *
 * "Server-side MIME sniffing — never trust the extension" and "accept PDF, images, DOCX,
 * PPTX and MP4 links only".
 *
 * A browser's `Content-Type` header and a filename's extension are both attacker-supplied.
 * The only trustworthy signal is the bytes, so every upload is identified from its magic
 * number before it is accepted or given a content type to be served back with.
 */

export type DetectedType = {
  /** The content type the file will be stored and served as. */
  contentType: string;
  /** A short family name for the UI and for validation messages. */
  kind: 'pdf' | 'image' | 'document' | 'presentation' | 'spreadsheet';
  extension: string;
};

/** "25MB limit per file." */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/**
 * DOCX, PPTX and XLSX are all ZIP archives, so the magic number alone cannot tell them
 * apart — or tell them from any other zip, which is how an executable gets uploaded as a
 * "worksheet". The first entry's name inside the archive is what distinguishes them.
 */
function readFirstZipEntryName(bytes: Uint8Array): string | null {
  // Local file header: name length at offset 26 (u16 LE), name at offset 30.
  if (bytes.length < 30) return null;
  const nameLength = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);
  if (nameLength === 0 || bytes.length < 30 + nameLength) return null;
  return new TextDecoder('utf-8').decode(bytes.subarray(30, 30 + nameLength));
}

function detectOoxml(bytes: Uint8Array, declaredExtension: string): DetectedType | null {
  const firstEntry = readFirstZipEntryName(bytes);
  if (!firstEntry) return null;

  // Office writes `[Content_Types].xml` first; OpenDocument writes `mimetype`. Anything
  // else is a plain zip and is refused.
  const looksOoxml = firstEntry === '[Content_Types].xml' || firstEntry.startsWith('_rels/');
  if (!looksOoxml) return null;

  // The archive's own directory layout is the only in-band clue to which Office format it
  // is. Where the bytes are ambiguous the declared extension breaks the tie — but only
  // between formats that are already confirmed to be Office documents.
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  if (text.includes('word/')) {
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'document',
      extension: 'docx',
    };
  }
  if (text.includes('ppt/')) {
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      kind: 'presentation',
      extension: 'pptx',
    };
  }
  if (text.includes('xl/')) {
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      kind: 'spreadsheet',
      extension: 'xlsx',
    };
  }

  const fallback: Record<string, DetectedType> = {
    docx: {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'document',
      extension: 'docx',
    },
    pptx: {
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      kind: 'presentation',
      extension: 'pptx',
    },
    xlsx: {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      kind: 'spreadsheet',
      extension: 'xlsx',
    },
  };
  return fallback[declaredExtension.toLowerCase()] ?? null;
}

/**
 * Identifies a file from its leading bytes. Returns null for anything not on the allowlist,
 * which includes every executable format — the spec's floor is that "no file is ever served
 * from the app's own domain with an executable content type", and the way to guarantee that
 * is never to accept one.
 *
 * `declaredExtension` is used only to disambiguate between Office formats already confirmed
 * from the bytes; it can never promote a file onto the allowlist by itself.
 */
export function detectFileType(bytes: Uint8Array, fileName = ''): DetectedType | null {
  const declaredExtension = fileName.split('.').pop() ?? '';

  if (startsWith(bytes, PDF)) return { contentType: 'application/pdf', kind: 'pdf', extension: 'pdf' };
  if (startsWith(bytes, PNG)) return { contentType: 'image/png', kind: 'image', extension: 'png' };
  if (startsWith(bytes, JPEG)) return { contentType: 'image/jpeg', kind: 'image', extension: 'jpg' };
  if (startsWith(bytes, GIF)) return { contentType: 'image/gif', kind: 'image', extension: 'gif' };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return { contentType: 'image/webp', kind: 'image', extension: 'webp' };
  }
  if (startsWith(bytes, ZIP)) return detectOoxml(bytes, declaredExtension);

  return null;
}

export class UnsupportedFileTypeError extends Error {
  override readonly name = 'UnsupportedFileTypeError';
  readonly status = 415;
  constructor() {
    super('That file type is not accepted. Upload a PDF, an image, a Word file or a slide deck.');
  }
}

export class FileTooLargeError extends Error {
  override readonly name = 'FileTooLargeError';
  readonly status = 413;
  constructor(readonly maxBytes: number = MAX_UPLOAD_BYTES) {
    super(`Files must be ${Math.round(maxBytes / 1024 / 1024)}MB or smaller.`);
  }
}

/**
 * A video is a link, never an upload — "accept … and MP4 links only". Hosting video on the
 * school's own storage is a bandwidth bill nobody budgeted for.
 */
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'drive.google.com'];

export function isAcceptableVideoLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.replace(/^www\./, '');
    return VIDEO_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}
