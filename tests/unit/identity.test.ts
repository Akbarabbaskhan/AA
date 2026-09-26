import { describe, expect, it } from 'vitest';
import { ID_TOKEN_TTL_HOURS, signIdToken, verifyIdToken } from '@/lib/services/identity';

/**
 * The digital ID card's signature.
 *
 * A QR code containing a roll number is trivially forged, so the card carries a signed
 * token. These are the properties that make it worth more than a printed number.
 */
describe('ID tokens', () => {
  const future = Date.now() + 3_600_000;

  it('round-trips a valid token', () => {
    const token = signIdToken('AS1-0042', future);
    expect(verifyIdToken(token)).toEqual({ rollNumber: 'AS1-0042', expiresAt: future });
  });

  it('rejects a token whose roll number was edited', () => {
    const token = signIdToken('AS1-0042', future);
    const forged = token.replace('AS1-0042', 'AS1-0043');
    expect(verifyIdToken(forged)).toBeNull();
  });

  it('rejects a token whose expiry was pushed out', () => {
    const token = signIdToken('AS1-0042', future);
    const parts = token.split('.');
    const forged = `${parts[0]}.${future + 86_400_000}.${parts[2]}`;
    expect(verifyIdToken(forged)).toBeNull();
  });

  it('rejects an expired token, however well signed', () => {
    const token = signIdToken('AS1-0042', Date.now() - 1_000);
    expect(verifyIdToken(token)).toBeNull();
  });

  it('rejects a token with the signature removed', () => {
    expect(verifyIdToken(`AS1-0042.${future}`)).toBeNull();
    expect(verifyIdToken(`AS1-0042.${future}.`)).toBeNull();
  });

  it('rejects rubbish without throwing', () => {
    for (const value of ['', 'x', 'a.b.c', '....', 'AS1-0042.notanumber.sig']) {
      expect(verifyIdToken(value)).toBeNull();
    }
  });

  it('carries nothing but the roll number and the expiry', () => {
    // A QR photographed off a lanyard must hand a stranger no personal detail.
    const token = signIdToken('AS1-0042', future);
    expect(token).not.toMatch(/[A-Za-z]{4,}\s/);
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith('AS1-0042.')).toBe(true);
  });

  it('expires within a day, so a shared screenshot stops working', () => {
    expect(ID_TOKEN_TTL_HOURS).toBeLessThanOrEqual(24);
  });

  it('gives two students different signatures for the same expiry', () => {
    const a = signIdToken('AS1-0001', future);
    const b = signIdToken('AS1-0002', future);
    expect(a.split('.')[2]).not.toBe(b.split('.')[2]);
  });
});

/**
 * Reads back what a scanner would read.
 *
 * The encoder splits a mixed string into alphanumeric and byte segments, and a byte
 * segment's data is raw bytes rather than text — so reassembling it has to decode UTF-8
 * rather than stringify an array.
 */
function decodeSegments(qr: { segments: { data: string | Uint8Array | number[] }[] }): string {
  const decoder = new TextDecoder();
  return qr.segments
    .map((segment) =>
      typeof segment.data === 'string'
        ? segment.data
        : decoder.decode(Uint8Array.from(segment.data as Iterable<number>)),
    )
    .join('');
}

describe('the identity QR code', () => {
  it('encodes the whole token, at a size a phone can read', async () => {
    const { qrModules } = await import('@/components/features/identity/qr-code');
    const token = signIdToken('AS1-0042', Date.now() + 3_600_000);

    const { size, dark } = await qrModules(token);
    // A version large enough for a ~70-character token, and genuinely populated: an
    // encoder that silently truncated or produced an empty grid would fail here.
    expect(size).toBeGreaterThanOrEqual(29);
    expect(dark).toBeGreaterThan(size * 2);
  });

  it('renders at the size it was asked for', async () => {
    /*
     * The other way this component has broken: an SVG with a viewBox and no width or height
     * lays out at nothing, so the card renders with an invisible QR and every other test
     * still passes. The markup is asserted rather than the picture.
     */
    const { qrSvg } = await import('@/components/features/identity/qr-code');
    const svg = await qrSvg(signIdToken('AS1-0042', Date.now() + 3_600_000), 192);

    expect(svg).toMatch(/width="192"/);
    expect(svg).toMatch(/height="192"/);
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    // One image to a screen reader, not a thousand squares.
    expect(svg).toMatch(/role="img"/);
    expect(svg).toMatch(/aria-label="Student identity QR code"/);
  });

  it('round-trips through a real decoder', async () => {
    /*
     * The regression this pins. An earlier hand-rolled encoder in this repo produced a grid
     * differing from a reference implementation in 645 of 1,369 modules — a QR that would
     * not have scanned at a gate, and nothing in the app would have told us. So the encoder
     * is a real library now, and this asserts that what it produces actually decodes.
     */
    const QRCode = (await import('qrcode')).default;
    const token = signIdToken('AS1-0042', Date.now() + 3_600_000);

    expect(decodeSegments(QRCode.create(token, { errorCorrectionLevel: 'Q' }))).toBe(token);
  });

  it('carries the signature intact, so a scan verifies', async () => {
    const QRCode = (await import('qrcode')).default;
    const token = signIdToken('AS1-0001', Date.now() + 3_600_000);
    const decoded = decodeSegments(QRCode.create(token, { errorCorrectionLevel: 'Q' }));
    expect(verifyIdToken(decoded)).not.toBeNull();
  });
});
