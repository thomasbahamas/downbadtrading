import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Solana Trading Agent',
  description: 'Autonomous DeFi trading agent dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-surface-0">
        {/* Top nav */}
        <header className="border-b border-surface-border bg-surface-1/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* SVG Logo */}
              <svg viewBox="0 0 32 32" width="28" height="28" fill="none" aria-label="Trading Agent">
                <circle cx="16" cy="16" r="15" stroke="#9945FF" strokeWidth="2" />
                <path d="M8 20 L12 12 L16 17 L20 10 L24 16" stroke="#9945FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="24" cy="16" r="2.5" fill="#9945FF" />
              </svg>
              <span className="font-semibold text-white text-sm tracking-tight">
                SOL Trading Agent
              </span>
            </div>
            <nav className="flex items-center gap-1">
              <a
                href="/"
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-surface-3 rounded-lg transition-colors"
              >
                Dashboard
              </a>
              <a
                href="/trades"
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-surface-3 rounded-lg transition-colors"
              >
                Trades
              </a>
            </nav>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
