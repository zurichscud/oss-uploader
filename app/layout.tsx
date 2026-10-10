import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'OSS Uploader',
  description: '阿里云 OSS 可视化上传工具，键名规则与 commune-mp 保持一致',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="bg-grid" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
