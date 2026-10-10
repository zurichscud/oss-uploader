import { NextResponse } from 'next/server';
import { getOssConfig, listBuckets } from '@/lib/oss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cfg = getOssConfig();
  const { buckets, error } = await listBuckets();
  return NextResponse.json({
    endpoint: cfg.endpoint,
    defaultPrefix: cfg.prefix,
    maxFileSizeMb: cfg.maxFileSizeMb,
    buckets,
    warning: error ? `获取桶列表失败（${error}）` : null,
  });
}
