import { NextResponse, type NextRequest } from 'next/server';
import { acceptUpload, getStorage, verifyStorageToken } from '@/lib/storage';
import { FileTooLargeError, MAX_UPLOAD_BYTES, UnsupportedFileTypeError } from '@/lib/storage/mime';

export const dynamic = 'force-dynamic';

/**
 * The local storage adapter's endpoint.
 *
 * In production the browser talks to R2 directly with a presigned URL and this route is
 * never used. Locally it stands in, with the same signed-and-expiring contract, so a demo
 * exercises the real upload and download paths rather than a shortcut.
 *
 * Authorisation is the signature, not the session: the URL is issued to a specific key for
 * a specific action with a deadline, exactly as a presigned S3 URL is.
 */
function readToken(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  return {
    token: params.get('token') ?? '',
    expiresAt: Number(params.get('expires') ?? 0),
    download: params.get('download') === '1',
  };
}

export async function PUT(request: NextRequest, { params }: { params: { key: string[] } }) {
  const key = params.key.join('/');
  const { token, expiresAt } = readToken(request);

  if (!verifyStorageToken(key, 'put', expiresAt, token)) {
    return NextResponse.json(
      { error: { code: 'invalidUploadUrl', message: 'That upload link is not valid any more.' } },
      { status: 403 },
    );
  }

  const body = Buffer.from(await request.arrayBuffer());

  try {
    // Re-validated here as well as at ticket time: the ticket says what the client intended
    // to upload, these are the bytes it actually sent.
    const result = await acceptUpload({
      schoolId: key.split('/')[0] ?? 'unknown',
      folder: key.split('/')[1] ?? 'misc',
      fileName: key,
      body,
    });
    return NextResponse.json({ key: result.key, size: result.size, contentType: result.contentType });
  } catch (error) {
    if (error instanceof UnsupportedFileTypeError || error instanceof FileTooLargeError) {
      return NextResponse.json(
        { error: { code: error.name, message: error.message } },
        { status: error.status },
      );
    }
    throw error;
  }
}

export async function GET(request: NextRequest, { params }: { params: { key: string[] } }) {
  const key = params.key.join('/');
  const { token, expiresAt, download } = readToken(request);

  if (!verifyStorageToken(key, 'get', expiresAt, token)) {
    return NextResponse.json(
      { error: { code: 'invalidDownloadUrl', message: 'That link has expired.' } },
      { status: 403 },
    );
  }

  const file = await getStorage().read(key);
  if (!file) {
    return NextResponse.json({ error: { code: 'notFound', message: 'Not found' } }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      // The stored content type was detected from the bytes at upload, so it can never be
      // an executable one — see lib/storage/mime.ts.
      'content-type': file.contentType,
      'content-length': String(file.body.byteLength),
      'content-disposition': download ? 'attachment' : 'inline',
      // Belt and braces: even if a type slipped through, the browser must not sniff it.
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=600',
    },
  });
}

export const maxDuration = 60;
export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';
export const preferredRegion = 'auto';
