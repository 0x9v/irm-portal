import React from 'react';
import { STATIC_STICKERS } from '@/lib/discussion';

interface StickerAssetProps {
  stickerId: string;
  name?: string;
  className?: string;
  size?: number;
}

export function StickerAsset({
  stickerId,
  name,
  className = '',
  size = 96,
}: StickerAssetProps) {
  const catalogSticker = STATIC_STICKERS.find((s) => s.id === stickerId);
  const accessibleName = name || (catalogSticker ? `${catalogSticker.name} sticker` : stickerId);

  switch (stickerId) {
    case 'pepe_thumbs_up':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className={`shrink-0 ${className}`}
          role="img"
          aria-label={accessibleName}
        >
          <title>{accessibleName}</title>
          {/* Head & Smile */}
          <circle cx="50" cy="50" r="42" fill="#86EFAC" stroke="#16A34A" strokeWidth="4" />
          {/* Big happy eyes */}
          <ellipse cx="38" cy="38" rx="8" ry="12" fill="#FFFFFF" stroke="#16A34A" strokeWidth="2" />
          <ellipse cx="62" cy="38" rx="8" ry="12" fill="#FFFFFF" stroke="#16A34A" strokeWidth="2" />
          <circle cx="40" cy="39" r="4" fill="#15803D" />
          <circle cx="64" cy="39" r="4" fill="#15803D" />
          {/* Broad smile */}
          <path
            d="M 30 58 Q 50 78 70 58"
            fill="none"
            stroke="#15803D"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {/* Thumbs up badge in corner */}
          <circle cx="78" cy="74" r="18" fill="#FBBF24" stroke="#D97706" strokeWidth="2" />
          <text x="78" y="80" textAnchor="middle" fontSize="16" fill="#78350F">👍</text>
        </svg>
      );

    case 'cat_heart_eyes':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className={`shrink-0 ${className}`}
          role="img"
          aria-label={accessibleName}
        >
          <title>{accessibleName}</title>
          {/* Cat ears */}
          <polygon points="20,40 32,10 46,30" fill="#FDBA74" stroke="#EA580C" strokeWidth="3" />
          <polygon points="26,35 34,18 42,28" fill="#FED7AA" />
          <polygon points="80,40 68,10 54,30" fill="#FDBA74" stroke="#EA580C" strokeWidth="3" />
          <polygon points="74,35 66,18 58,28" fill="#FED7AA" />
          {/* Cat face */}
          <ellipse cx="50" cy="55" rx="40" ry="36" fill="#FDBA74" stroke="#EA580C" strokeWidth="3" />
          {/* Whiskers */}
          <line x1="12" y1="55" x2="32" y2="58" stroke="#9A3412" strokeWidth="2" strokeLinecap="round" />
          <line x1="12" y1="65" x2="32" y2="64" stroke="#9A3412" strokeWidth="2" strokeLinecap="round" />
          <line x1="88" y1="55" x2="68" y2="58" stroke="#9A3412" strokeWidth="2" strokeLinecap="round" />
          <line x1="88" y1="65" x2="68" y2="64" stroke="#9A3412" strokeWidth="2" strokeLinecap="round" />
          {/* Heart eyes */}
          <path
            d="M 32 40 A 5 5 0 0 1 42 45 Q 42 54 36 60 Q 30 54 30 45 A 5 5 0 0 1 32 40 Z"
            fill="#EF4444"
          />
          <path
            d="M 58 40 A 5 5 0 0 1 68 45 Q 68 54 62 60 Q 56 54 56 45 A 5 5 0 0 1 58 40 Z"
            fill="#EF4444"
          />
          {/* Nose & mouth */}
          <polygon points="50,65 46,62 54,62" fill="#BE185D" />
          <path d="M 44 68 Q 50 72 50 66 Q 50 72 56 68" fill="none" stroke="#9A3412" strokeWidth="2" />
        </svg>
      );

    case 'blob_party':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className={`shrink-0 ${className}`}
          role="img"
          aria-label={accessibleName}
        >
          <title>{accessibleName}</title>
          {/* Party hat */}
          <polygon points="35,32 50,2 65,32" fill="#F43F5E" stroke="#BE123C" strokeWidth="2" />
          <circle cx="50" cy="2" r="4" fill="#FDE047" />
          <line x1="40" y1="22" x2="60" y2="22" stroke="#FDE047" strokeWidth="2" />
          <line x1="45" y1="12" x2="55" y2="12" stroke="#FDE047" strokeWidth="2" />
          {/* Blob body */}
          <path
            d="M 20 60 C 15 35 35 30 50 30 C 65 30 85 35 80 60 C 80 85 65 92 50 92 C 35 92 20 85 20 60 Z"
            fill="#FACC15"
            stroke="#CA8A04"
            strokeWidth="3"
          />
          {/* Cheerful eyes */}
          <circle cx="38" cy="50" r="5" fill="#713F12" />
          <circle cx="62" cy="50" r="5" fill="#713F12" />
          <circle cx="40" cy="48" r="1.5" fill="#FFFFFF" />
          <circle cx="64" cy="48" r="1.5" fill="#FFFFFF" />
          {/* Open mouth */}
          <path d="M 42 62 Q 50 76 58 62 Z" fill="#DC2626" />
          {/* Confetti sparks */}
          <circle cx="15" cy="25" r="3" fill="#3B82F6" />
          <polygon points="82,20 86,24 82,28 78,24" fill="#10B981" />
          <polygon points="18,78 22,82 18,86 14,82" fill="#A855F7" />
          <circle cx="85" cy="75" r="3" fill="#EC4899" />
        </svg>
      );

    case 'doge_classic':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className={`shrink-0 ${className}`}
          role="img"
          aria-label={accessibleName}
        >
          <title>{accessibleName}</title>
          {/* Doge ears */}
          <polygon points="25,35 15,10 40,25" fill="#F59E0B" stroke="#B45309" strokeWidth="3" />
          <polygon points="75,35 85,10 60,25" fill="#F59E0B" stroke="#B45309" strokeWidth="3" />
          {/* Doge head */}
          <circle cx="50" cy="55" r="38" fill="#FCD34D" stroke="#B45309" strokeWidth="3" />
          {/* White muzzle */}
          <ellipse cx="50" cy="65" rx="22" ry="18" fill="#FEF3C7" />
          {/* Eyes with sideways glance */}
          <circle cx="36" cy="45" r="5" fill="#1F2937" />
          <circle cx="64" cy="45" r="5" fill="#1F2937" />
          <circle cx="38" cy="43" r="1.5" fill="#FFFFFF" />
          <circle cx="66" cy="43" r="1.5" fill="#FFFFFF" />
          {/* Nose */}
          <ellipse cx="50" cy="60" rx="6" ry="4" fill="#1F2937" />
          {/* Gentle smile */}
          <path d="M 44 67 Q 50 72 56 67" fill="none" stroke="#1F2937" strokeWidth="2" strokeLinecap="round" />
          {/* Wow star badge */}
          <polygon points="80,72 84,62 94,62 86,56 89,46 80,52 71,46 74,56 66,62 76,62" fill="#EC4899" />
          <text x="80" y="60" textAnchor="middle" fontSize="6" fontWeight="bold" fill="#FFFFFF">WOW</text>
        </svg>
      );

    case 'programmer_coffee':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className={`shrink-0 ${className}`}
          role="img"
          aria-label={accessibleName}
        >
          <title>{accessibleName}</title>
          {/* Steam curls */}
          <path
            d="M 38 24 Q 42 16 38 8"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M 50 22 Q 54 14 50 6"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M 62 24 Q 66 16 62 8"
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* Coffee Mug Body */}
          <rect
            x="25"
            y="30"
            width="50"
            height="52"
            rx="8"
            fill="#3B82F6"
            stroke="#1D4ED8"
            strokeWidth="3"
          />
          {/* Mug Handle */}
          <path
            d="M 75 40 Q 92 40 92 56 Q 92 72 75 72"
            fill="none"
            stroke="#1D4ED8"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {/* Code badge inside mug */}
          <rect x="33" y="44" width="34" height="24" rx="4" fill="#1E3A8A" />
          <text
            x="50"
            y="60"
            textAnchor="middle"
            fontSize="12"
            fontWeight="bold"
            fontFamily="monospace"
            fill="#60A5FA"
          >
            &lt;/&gt;
          </text>
          {/* Saucer */}
          <ellipse cx="50" cy="86" rx="36" ry="6" fill="#93C5FD" stroke="#1D4ED8" strokeWidth="2" />
        </svg>
      );

    case 'rubber_duck_coding':
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          className={`shrink-0 ${className}`}
          role="img"
          aria-label={accessibleName}
        >
          <title>{accessibleName}</title>
          {/* Duck body */}
          <ellipse cx="52" cy="65" rx="32" ry="24" fill="#FACC15" stroke="#CA8A04" strokeWidth="3" />
          {/* Duck tail */}
          <path d="M 20 62 Q 10 52 14 44 Q 26 50 26 62 Z" fill="#FACC15" stroke="#CA8A04" strokeWidth="2" />
          {/* Duck wing */}
          <ellipse cx="46" cy="66" rx="14" ry="10" fill="#EAB308" stroke="#CA8A04" strokeWidth="2" />
          {/* Duck head */}
          <circle cx="68" cy="42" r="18" fill="#FACC15" stroke="#CA8A04" strokeWidth="3" />
          {/* Eye */}
          <circle cx="74" cy="38" r="4" fill="#1F2937" />
          <circle cx="75" cy="37" r="1.5" fill="#FFFFFF" />
          {/* Orange Beak */}
          <path
            d="M 84 42 Q 98 44 94 50 Q 82 52 80 44 Z"
            fill="#F97316"
            stroke="#C2410C"
            strokeWidth="2"
          />
          {/* Coding nerd glasses */}
          <rect x="66" y="34" width="14" height="10" rx="3" fill="none" stroke="#1E293B" strokeWidth="2" />
          <line x1="66" y1="38" x2="60" y2="38" stroke="#1E293B" strokeWidth="2" />
          {/* Water wave base */}
          <path
            d="M 12 88 Q 30 84 50 88 Q 70 92 88 88"
            fill="none"
            stroke="#38BDF8"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      );

    default:
      // Honest, clean fallback for unknown sticker ID
      return (
        <div
          style={{ width: size, height: size }}
          className={`shrink-0 inline-flex flex-col items-center justify-center p-2 rounded-surface bg-surface-secondary border border-control-border text-text-muted ${className}`}
          role="img"
          aria-label={`Sticker: ${accessibleName}`}
        >
          <span className="text-2xl" aria-hidden="true">🖼️</span>
          <span className="text-[10px] font-mono text-center truncate max-w-full px-1 text-text-subtle mt-1">
            {stickerId}
          </span>
        </div>
      );
  }
}
