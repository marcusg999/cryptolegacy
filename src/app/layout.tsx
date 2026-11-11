import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import './globals.css';
import { PersistentDisclaimer } from '@/components/PersistentDisclaimer';
import { Reveal } from '@/components/Reveal';

export const metadata: Metadata = {
  title: 'Crypto Inheritance Vault',
  description:
    'A zero-knowledge vault so your cryptocurrency does not die with you. The passphrase never leaves your browser.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#04070C',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The nonce is minted per request in middleware; Next uses it for the scripts
  // it injects, so a page cannot load a script the policy has not blessed.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en">
      <head>
        {nonce ? <meta property="csp-nonce" content={nonce} nonce={nonce} /> : null}
        {/* Self-hosted, so font-src 'self' holds. Preloaded because the display
            face carries the page's entire first impression. */}
        <link
          rel="preload"
          href="/fonts/archivo-var.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col">
          <main className="flex-1">{children}</main>
          <PersistentDisclaimer />
        </div>
        <Reveal />
      </body>
    </html>
  );
}
