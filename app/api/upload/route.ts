import Busboy from 'busboy';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  assertOssConfig,
  buildObjectKey,
  buildObjectUrl,
  getUploadClient,
  regionFromEndpoint,
} from '@/lib/oss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UploadPayload = {
  bucket: string;
  key: string;
  url: string;
  size: number;
  name: string;
};

/**
 * 流式上传：multipart 请求体经 busboy 解析，文件流直接写入 OSS，不落盘、不进内存。
 * 约定：客户端必须把 bucket / prefix / region / size 字段放在 file 之前（FormData 顺序）。
 */
export async function POST(request: Request) {
  let cfg;
  try {
    cfg = assertOssConfig();
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: '请求必须是 multipart/form-data' }, { status: 400 });
  }
  if (!request.body) {
    return NextResponse.json({ error: '请求体为空' }, { status: 400 });
  }

  const busboy = Busboy({
    headers: { 'content-type': contentType },
    defParamCharset: 'utf8',
  });

  const fields: Record<string, string> = {};
  let payload: UploadPayload | null = null;
  let uploadError: Error | null = null;
  let badRequest: string | null = null;
  let uploadPromise: Promise<void> | null = null;

  const parsed = new Promise<void>((resolve, reject) => {
    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (_name, stream, info) => {
      if (uploadPromise) {
        stream.resume();
        return;
      }

      const bucket = (fields.bucket || '').trim();
      if (!bucket) {
        badRequest = '缺少 bucket 参数';
        stream.resume();
        return;
      }

      const ext = path.extname(info.filename || '');
      const prefix = fields.prefix === undefined ? cfg.prefix : fields.prefix;
      const region = fields.region || regionFromEndpoint(cfg.endpoint);
      const size = Number(fields.size || 0);
      const objectKey = buildObjectKey(prefix, ext);

      const client = getUploadClient(bucket, region);
      uploadPromise = client
        .put(objectKey, stream, {
          mime: info.mimeType,
          ...(size > 0 ? { contentLength: size } : {}),
        })
        .then(() => {
          payload = {
            bucket,
            key: objectKey,
            url: buildObjectUrl(bucket, objectKey),
            size: size || 0,
            name: info.filename,
          };
        })
        .catch((error: Error) => {
          uploadError = error;
        });
    });

    busboy.on('error', reject);
    busboy.on('close', () => {
      if (!uploadPromise) {
        resolve();
        return;
      }
      uploadPromise.then(resolve, reject);
    });
  });

  try {
    const nodeStream = Readable.fromWeb(request.body as unknown as WebReadableStream);
    nodeStream.on('error', (error) => busboy.destroy(error));
    nodeStream.pipe(busboy);
    await parsed;
  } catch (error) {
    console.error('[oss-uploader] 解析上传请求失败:', (error as Error).message);
    return NextResponse.json({ error: (error as Error).message || '解析上传请求失败' }, { status: 500 });
  }

  if (badRequest) {
    return NextResponse.json({ error: badRequest }, { status: 400 });
  }

  const failed = uploadError as Error | null;
  if (failed) {
    console.error('[oss-uploader] OSS 上传失败:', failed.message);
    return NextResponse.json({ error: failed.message || 'OSS 上传失败' }, { status: 500 });
  }
  if (!payload) {
    return NextResponse.json({ error: '缺少上传文件' }, { status: 400 });
  }

  const result: UploadPayload = payload;
  return NextResponse.json(result);
}
