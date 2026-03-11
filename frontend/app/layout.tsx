import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wealth Support — ゴールベース資産形成アドバイザー',
  description: '「いつまでにいくら欲しいか」を入力するだけで、あなた専用のポートフォリオとシナリオ分析を提案します。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
