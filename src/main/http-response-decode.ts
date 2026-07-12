import * as zlib from 'zlib';

function zlibDecode(
  decoder: (input: Buffer, callback: (error: Error | null, result: Buffer) => void) => void,
  bodyBuffer: Buffer
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    decoder(bodyBuffer, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

export async function decodeHttpResponseBodyBuffer(
  bodyBuffer: Buffer,
  contentEncoding: string
): Promise<Buffer> {
  const normalizedEncoding = String(contentEncoding || '').toLowerCase();
  try {
    if (normalizedEncoding.includes('br')) {
      return await zlibDecode(zlib.brotliDecompress, bodyBuffer);
    }
    if (normalizedEncoding.includes('gzip')) {
      return await zlibDecode(zlib.gunzip, bodyBuffer);
    }
    if (normalizedEncoding.includes('deflate')) {
      return await zlibDecode(zlib.inflate, bodyBuffer);
    }
  } catch {
    // If decompression fails, keep raw buffer to avoid hard-failing requests.
    return bodyBuffer;
  }
  return bodyBuffer;
}
