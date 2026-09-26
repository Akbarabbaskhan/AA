import QRCode from 'qrcode';

/**
 * The identity QR code, rendered as inline SVG on the server.
 *
 * Deliberately encoded here rather than by a third-party image endpoint: the payload is a
 * signed identity token, and an endpoint that draws it would hold every student's card. The
 * token never leaves the server except inside the page that belongs to that student.
 *
 * Error correction level Q (25%), because the realistic failure is a scuffed phone screen at
 * a school gate rather than a clean scan, and a quiet margin because a QR flush against a
 * coloured card does not read.
 *
 * (An earlier version of this file hand-rolled the encoder. It produced a grid that differed
 * from a reference implementation in 645 of 1,369 modules — a code that would not have
 * scanned. Checking it against a real encoder is what caught that, and the lesson is in the
 * test alongside this component.)
 */
/** The markup itself, so a test can assert what the browser is handed. */
export async function qrSvg(value: string, size: number): Promise<string> {
  const svg = await QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'Q',
    margin: 2,
    // The library's own sizing, rather than rewriting its attributes afterwards: an earlier
    // version stripped the width and height it had just inserted, and an SVG with a viewBox
    // and no size renders at nothing — an ID card with an invisible QR code.
    width: size,
    // Literal colours: a PDF and an SVG have no cascade, and a QR must be black on white
    // whatever the card's theme is doing around it.
    color: { dark: '#000000', light: '#ffffff' },
  });

  // Announced to a screen reader as one image, since the modules mean nothing individually.
  return svg.replace(/<svg /, '<svg role="img" aria-label="Student identity QR code" ');
}

export async function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const svg = await qrSvg(value, size);
  return <span className="inline-block bg-white p-1" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The payload a card encodes. Exported so a test can assert what a scanner would read. */
export async function qrModules(value: string): Promise<{ size: number; dark: number }> {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'Q' });
  const data = qr.modules.data;
  return { size: qr.modules.size, dark: data.reduce((sum, bit) => sum + (bit ? 1 : 0), 0) };
}
