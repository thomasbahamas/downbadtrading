'use client';

import { useState } from 'react';

interface Props {
  text: string;
  // Number of characters to show before truncating. Default tuned for ~2 lines.
  previewChars?: number;
  // Optional label shown above the text (e.g. "Why").
  label?: string;
  // Optional signal breakdown rendered inside the expanded body.
  signals?: Array<[string, string]>;
}

/**
 * Renders a trade thesis collapsed by default, expanded on click.
 * Keeps the dashboard dense while still letting users read full reasoning
 * when they want to. The component is client-only so it can track its own
 * expanded state without a round trip.
 */
export default function CollapsibleThesis({
  text,
  previewChars = 180,
  label,
  signals,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const needsCollapse = text.length > previewChars;
  const preview = needsCollapse ? `${text.slice(0, previewChars).trim()}…` : text;

  return (
    <div>
      {label && (
        <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-1.5">
          {label}
        </p>
      )}
      <p className="text-sm text-gray-200 leading-relaxed">
        {expanded ? text : preview}
        {needsCollapse && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="ml-2 text-xs text-solana-light hover:text-solana font-medium transition-colors"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </p>

      {/* Signal breakdown is only visible when expanded — keeps the default
          view focused on the one-liner while still surfacing detail on demand. */}
      {expanded && signals && signals.length > 0 && (
        <div className="mt-3 pt-3 border-t border-surface-border/30 animate-fade-in">
          <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">
            Signal Breakdown
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {signals.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-600 min-w-[85px] pt-0.5 flex-shrink-0">
                  {formatSignalLabel(key)}
                </span>
                <span className="text-xs text-gray-400 leading-relaxed">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatSignalLabel(key: string): string {
  const map: Record<string, string> = {
    priceAction: 'Price',
    volume: 'Volume',
    socialSentiment: 'Sentiment',
    onChainMetrics: 'On-Chain',
  };
  return map[key] || key.replace(/([A-Z])/g, ' $1').trim();
}
