import OSS from 'ali-oss';
import { randomUUID } from 'node:crypto';

export type OssConfig = {
  endpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
  prefix: string;
};

export type BucketInfo = {
  name: string;
  region: string | null;
};

let cachedConfig: OssConfig | null = null;

export function getOssConfig(): OssConfig {
  if (!cachedConfig) {
    cachedConfig = {
      endpoint: (process.env.OSS_ENDPOINT || 'oss-cn-beijing.aliyuncs.com').trim(),
      accessKeyId: (process.env.OSS_ACCESS_KEY_ID || '').trim(),
      accessKeySecret: (process.env.OSS_ACCESS_KEY_SECRET || '').trim(),
      prefix: (process.env.OSS_PREFIX || '').trim(),
    };
  }
  return cachedConfig;
}

export function assertOssConfig(): OssConfig {
  const cfg = getOssConfig();
  if (!cfg.accessKeyId || !cfg.accessKeySecret) {
    throw new Error('缺少 OSS 配置，请参考 .env.example 检查 .env');
  }
  return cfg;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
}

export function endpointHost(): string {
  return new URL(normalizeEndpoint(getOssConfig().endpoint)).host;
}

export function regionFromEndpoint(endpoint: string): string | undefined {
  const host = new URL(normalizeEndpoint(endpoint)).host.toLowerCase();
  const match = host.match(/^oss-([a-z0-9-]+)\.aliyuncs\.com$/);
  return match ? `oss-${match[1]}` : undefined;
}

function baseOptions() {
  const cfg = getOssConfig();
  return {
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    secure: true,
  };
}

let baseClient: OSS | null = null;

function getBaseClient(): OSS {
  if (!baseClient) {
    baseClient = new OSS({ ...baseOptions(), endpoint: normalizeEndpoint(getOssConfig().endpoint) });
  }
  return baseClient;
}

const uploadClients = new Map<string, OSS>();

export function getUploadClient(bucket: string, region?: string): OSS {
  const cacheKey = `${bucket}@${region || 'default'}`;
  let client = uploadClients.get(cacheKey);
  if (!client) {
    client = new OSS({
      ...baseOptions(),
      bucket,
      ...(region ? { region } : { endpoint: normalizeEndpoint(getOssConfig().endpoint) }),
    });
    uploadClients.set(cacheKey, client);
  }
  return client;
}

function normalizePrefix(prefix: string): string {
  const value = (prefix ?? '').trim();
  if (!value) return '';
  return value.endsWith('/') ? value : `${value}/`;
}

/**
 * 与 commune-mp AliyunOssClient.buildObjectKey 规则一致：{prefix}/{yyyy}/{MM}/{uuid}.{ext}
 * uuid 为 32 位去连字符的小写十六进制，等价于 hutool IdUtil.fastSimpleUUID()
 */
export function buildObjectKey(prefix: string, fileExt: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const uuid = randomUUID().replace(/-/g, '');
  const base = `${normalizePrefix(prefix)}${yyyy}/${mm}/${uuid}`;
  const ext = (fileExt || '').replace(/^\./, '').toLowerCase();
  return ext ? `${base}.${ext}` : base;
}

export function buildObjectUrl(bucket: string, objectKey: string): string {
  return `https://${bucket}.${endpointHost()}/${objectKey}`;
}

type RawListBucketsResult = {
  buckets?: Array<{ name: string; region?: string }>;
  isTruncated?: boolean;
  nextMarker?: string;
};

export async function listBuckets(): Promise<{ buckets: BucketInfo[]; error: string | null }> {
  const cfg = assertOssConfig();
  const buckets: BucketInfo[] = [];
  let marker: string | undefined;
  try {
    for (let page = 0; page < 10; page += 1) {
      const result = (await getBaseClient().listBuckets({
        'max-keys': 100,
        ...(marker ? { marker } : {}),
      })) as unknown as RawListBucketsResult;
      for (const item of result.buckets || []) {
        buckets.push({
          name: item.name,
          region: item.region || regionFromEndpoint(cfg.endpoint) || null,
        });
      }
      if (!result.isTruncated) break;
      marker = result.nextMarker;
    }
    return { buckets, error: null };
  } catch (error) {
    return { buckets: [], error: (error as Error).message };
  }
}
