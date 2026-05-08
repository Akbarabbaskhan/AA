import { WeatherCondition } from './types'
import { MASCOT } from './constants'

interface Props {
  condition: WeatherCondition
  onClick: () => void
}

const ANIM_CSS: Record<string, string> = {
  bounce: 'bounce 1s ease-in-out infinite',
  float:  'float 4s ease-in-out infinite',
  shake:  'shake 1.2s ease-in-out infinite',
  shiver: 'shiver 0.18s linear infinite',
  sway:   'sway 1.2s ease-in-out infinite',
  idle:   'idle 5s ease-in-out infinite',
}

export default function Mascot({ condition, onClick }: Props) {
  const state = MASCOT[condition]

  const isHappy   = state.mood === 'happy' || state.mood === 'cozy'
  const isScared  = state.mood === 'scared'
  const isSleepy  = state.mood === 'sleepy'
  const isSad     = state.mood === 'sad'
  const isAnnoyed = state.mood === 'annoyed'

  // Squiggle mouth path — varies by mood
  // The real character has a distinctive wavy embroidered mouth
  const mouthPath = isHappy
    ? 'M96,128 C100,132 106,134 110,133 C114,132 120,129 124,131'   // gentle upward wave
    : isSad
    ? 'M96,133 C100,129 106,127 110,128 C114,129 120,132 124,130'   // downward wave
    : isAnnoyed
    ? 'M97,130 C101,126 105,133 110,130 C115,127 119,133 123,130'   // tighter squiggle
    : isSleepy
    ? 'M100,130 C105,132 115,132 120,130'                            // soft flat curve
    : isScared
    ? null                                                            // open mouth instead
    : 'M97,130 C101,127 106,133 110,130 C114,127 119,133 123,130'   // default squiggle

  return (
    <svg
      width="240" height="240"
      viewBox="0 0 220 220"
      onClick={onClick}
      style={{
        cursor: 'pointer',
        filter: 'drop-shadow(0 14px 28px rgba(0,0,0,0.22))',
        animation: ANIM_CSS[state.animation],
        transformOrigin: 'center bottom',
      }}
    >
      <defs>
        {/* Body gradient — soft warm yellow like the plush */}
        <radialGradient id="bodyY" cx="45%" cy="38%" r="62%">
          <stop offset="0%"   stopColor="#FEFAC8" />
          <stop offset="40%"  stopColor="#F5E86B" />
          <stop offset="85%"  stopColor="#E8D040" />
          <stop offset="100%" stopColor="#D4BC2A" />
        </radialGradient>

        {/* Fur highlight — lighter patch in centre */}
        <radialGradient id="furSheen" cx="42%" cy="35%" r="45%">
          <stop offset="0%"   stopColor="#FFFDE0" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FFFDE0" stopOpacity="0" />
        </radialGradient>

        {/* Brown chocolate underbody */}
        <radialGradient id="bodyBrown" cx="50%" cy="50%" r="55%">
          <stop offset="0%"   stopColor="#A07050" />
          <stop offset="100%" stopColor="#7A5035" />
        </radialGradient>

        {/* Lace wing — white with slight blue tint */}
        <radialGradient id="wingL" cx="70%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="60%"  stopColor="#EEF5FF" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#D8ECFF" stopOpacity="0.45" />
        </radialGradient>

        {/* Cream swirl */}
        <radialGradient id="cream" cx="50%" cy="30%" r="60%">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F2EBE0" />
        </radialGradient>

        {/* Blush */}
        <radialGradient id="blush" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#FFB3C6" stopOpacity="1" />
          <stop offset="100%" stopColor="#FF8FAB" stopOpacity="0" />
        </radialGradient>

        {/* Scarf */}
        <linearGradient id="scarf" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#4A7FFF" />
          <stop offset="50%"  stopColor="#9B7FFA" />
          <stop offset="100%" stopColor="#4A7FFF" />
        </linearGradient>

        {/* Umbrella */}
        <radialGradient id="umb" cx="50%" cy="20%" r="75%">
          <stop offset="0%"   stopColor="#FFD0E4" />
          <stop offset="100%" stopColor="#FF5F9E" />
        </radialGradient>

        <style>{`
          @keyframes blink2 {
            0%,88%,100% { ry: 5px; }
            93%          { ry: 0.5px; }
          }
          .eye { animation: blink2 4.5s ease-in-out infinite; }
          .eye2 { animation: blink2 4.5s ease-in-out 0.15s infinite; }
        `}</style>
      </defs>

      {/* ── BROWN BACK STAR (peeks around edges like the real plush) ── */}
      <path
        d="M110,168 C100,166 82,162 68,152 C54,142 44,128 44,112 C44,96 52,84 64,74 C70,68 76,62 82,56 C90,48 98,42 110,40 C122,42 130,48 138,56 C144,62 150,68 156,74 C168,84 176,96 176,112 C176,128 166,142 152,152 C138,162 120,166 110,168 Z"
        fill="url(#bodyBrown)"
        transform="translate(3,5) scale(1.04)"
        opacity="0.9"
      />

      {/* ── LACE WINGS ── */}
      {/* Left wing — upper lobe */}
      <path
        d="M72,95 C48,78 28,82 30,100 C32,116 52,118 68,112 C72,110 74,106 72,102 Z"
        fill="url(#wingL)" stroke="#CBD8F0" strokeWidth="0.8" opacity="0.92"
      />
      {/* Left wing — lower lobe */}
      <path
        d="M68,112 C46,118 36,130 44,140 C52,150 68,144 74,132 C76,126 74,118 68,112 Z"
        fill="url(#wingL)" stroke="#CBD8F0" strokeWidth="0.8" opacity="0.78"
      />
      {/* Lace vein lines — left */}
      <path d="M70,97 C56,90 42,92 36,100" fill="none" stroke="#D8E8FF" strokeWidth="0.7" opacity="0.7" />
      <path d="M68,107 C54,106 42,110 38,118" fill="none" stroke="#D8E8FF" strokeWidth="0.7" opacity="0.7" />
      <path d="M66,117 C56,120 48,128 46,136" fill="none" stroke="#D8E8FF" strokeWidth="0.6" opacity="0.6" />
      {/* Scallop edge detail — left */}
      {[84,92,100,108,116,124,130].map((y,i) => (
        <circle key={i} cx={30 + i*1.5} cy={y} r="2.2" fill="none" stroke="#C8D8EE" strokeWidth="0.7" opacity="0.55" />
      ))}

      {/* Right wing — upper lobe */}
      <path
        d="M148,95 C172,78 192,82 190,100 C188,116 168,118 152,112 C148,110 146,106 148,102 Z"
        fill="url(#wingL)" stroke="#CBD8F0" strokeWidth="0.8" opacity="0.92"
      />
      {/* Right wing — lower lobe */}
      <path
        d="M152,112 C174,118 184,130 176,140 C168,150 152,144 146,132 C144,126 146,118 152,112 Z"
        fill="url(#wingL)" stroke="#CBD8F0" strokeWidth="0.8" opacity="0.78"
      />
      {/* Lace vein lines — right */}
      <path d="M150,97 C164,90 178,92 184,100" fill="none" stroke="#D8E8FF" strokeWidth="0.7" opacity="0.7" />
      <path d="M152,107 C166,106 178,110 182,118" fill="none" stroke="#D8E8FF" strokeWidth="0.7" opacity="0.7" />
      <path d="M154,117 C164,120 172,128 174,136" fill="none" stroke="#D8E8FF" strokeWidth="0.6" opacity="0.6" />
      {/* Scallop edge detail — right */}
      {[84,92,100,108,116,124,130].map((y,i) => (
        <circle key={i} cx={190 - i*1.5} cy={y} r="2.2" fill="none" stroke="#C8D8EE" strokeWidth="0.7" opacity="0.55" />
      ))}

      {/* ── MAIN STAR BODY — plush rounded star shape ── */}
      {/*
        6-point star approximating the plush shape:
        top spike, upper-left, lower-left, bottom, lower-right, upper-right
        Each spike is rounded and plump like a stuffed plush
      */}
      <path
        d="
          M110,38
          C106,46 100,52 92,58
          C82,64 68,66 62,76
          C56,86 60,100 58,110
          C56,122 48,132 52,144
          C56,154 68,158 78,162
          C88,166 96,172 110,172
          C124,172 132,166 142,162
          C152,158 164,154 168,144
          C172,132 164,122 162,110
          C160,100 164,86 158,76
          C152,66 138,64 128,58
          C120,52 114,46 110,38 Z
        "
        fill="url(#bodyY)"
        stroke="#DFC830"
        strokeWidth="1.2"
      />

      {/* Fur sheen overlay */}
      <path
        d="
          M110,38 C106,46 100,52 92,58 C82,64 68,66 62,76
          C56,86 60,100 58,110 C56,122 48,132 52,144
          C56,154 68,158 78,162 C88,166 96,172 110,172
          C124,172 132,166 142,162 C152,158 164,154 168,144
          C172,132 164,122 162,110 C160,100 164,86 158,76
          C152,66 138,64 128,58 C120,52 114,46 110,38 Z
        "
        fill="url(#furSheen)"
      />

      {/* ── STAR TIPS — slightly lighter ear-like spikes ── */}
      {/* Top-left spike */}
      <path d="M92,58 C86,50 80,42 84,36 C87,30 96,34 98,42 C99,48 96,54 92,58 Z" fill="#F8EE70" />
      {/* Top-right spike */}
      <path d="M128,58 C134,50 140,42 136,36 C133,30 124,34 122,42 C121,48 124,54 128,58 Z" fill="#F8EE70" />
      {/* Inner ear pink */}
      <path d="M93,56 C88,50 84,43 87,38 C89,34 95,36 96,42 C97,47 95,52 93,56 Z" fill="#FFD8E8" opacity="0.55" />
      <path d="M127,56 C132,50 136,43 133,38 C131,34 125,36 124,42 C123,47 125,52 127,56 Z" fill="#FFD8E8" opacity="0.55" />

      {/* ── CHOCOLATE DRIZZLE MARKINGS (like the embroidered squiggle on body) ── */}
      <path
        d="M88,72 C84,82 86,92 82,102 C80,108 78,114 80,120"
        fill="none" stroke="#8B6040" strokeWidth="2.8" strokeLinecap="round" opacity="0.55"
      />
      <path
        d="M132,70 C136,80 134,90 138,100 C140,107 140,114 138,120"
        fill="none" stroke="#8B6040" strokeWidth="2.2" strokeLinecap="round" opacity="0.45"
      />

      {/* ── WHIPPED CREAM SWIRL ON TOP ── */}
      {/* Base mound */}
      <ellipse cx="110" cy="52" rx="16" ry="10" fill="url(#cream)" />
      {/* Swirl body */}
      <path
        d="M97,52 C97,44 102,38 110,36 C118,38 123,44 123,52 C123,56 120,58 116,57 C112,56 110,52 110,48 C110,44 112,42 114,43"
        fill="none" stroke="url(#cream)" strokeWidth="6" strokeLinecap="round"
      />
      <path
        d="M97,52 C97,44 102,38 110,36 C118,38 123,44 123,52 C123,56 120,58 116,57 C112,56 110,52 110,48 C110,44 112,42 114,43"
        fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round"
      />
      {/* Swirl peak */}
      <path d="M114,43 C115,40 114,37 113,35 C112,33 111,31 112,29" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="112" cy="28" r="3" fill="white" opacity="0.95" />

      {/* ── BLUSH CIRCLES ── */}
      <ellipse cx="88" cy="118" rx="15" ry="10" fill="url(#blush)" opacity="0.75" />
      <ellipse cx="132" cy="118" rx="15" ry="10" fill="url(#blush)" opacity="0.75" />

      {/* ── EYES — small black ovals, very close together like the plush ── */}
      {isScared ? (
        <>
          {/* Scared: wide round eyes */}
          <circle cx="100" cy="104" r="8" fill="white" />
          <circle cx="120" cy="104" r="8" fill="white" />
          <circle cx="100" cy="104" r="5.5" fill="#111" />
          <circle cx="120" cy="104" r="5.5" fill="#111" />
          <circle cx="102" cy="101" r="2" fill="white" />
          <circle cx="122" cy="101" r="2" fill="white" />
        </>
      ) : isSleepy ? (
        <>
          {/* Sleepy: half-closed crescents */}
          <path d="M94,106 C94,100 106,100 106,106 Z" fill="#1a1a2e" />
          <path d="M114,106 C114,100 126,100 126,106 Z" fill="#1a1a2e" />
        </>
      ) : isAnnoyed ? (
        <>
          {/* Annoyed: horizontal squint slashes */}
          <rect x="93" y="102" width="13" height="5" rx="2.5" fill="#1a1a2e" transform="rotate(-8,99,104)" />
          <rect x="114" y="102" width="13" height="5" rx="2.5" fill="#1a1a2e" transform="rotate(8,120,104)" />
          {/* Furrowed brows */}
          <path d="M92,97 C96,94 104,95 106,97" fill="none" stroke="#5D4037" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M114,97 C116,95 124,94 128,97" fill="none" stroke="#5D4037" strokeWidth="2.2" strokeLinecap="round" />
        </>
      ) : (
        <>
          {/* Normal: small oval eyes — plush-accurate */}
          <ellipse className="eye"  cx="100" cy="104" rx="5.5" ry="5.5" fill="#111" />
          <ellipse className="eye2" cx="120" cy="104" rx="5.5" ry="5.5" fill="#111" />
          <circle cx="102" cy="101" r="1.8" fill="white" opacity="0.9" />
          <circle cx="122" cy="101" r="1.8" fill="white" opacity="0.9" />
        </>
      )}

      {/* ── MOUTH — the signature squiggly embroidered line ── */}
      {isScared ? (
        <ellipse cx="110" cy="130" rx="10" ry="8" fill="#2D1A0E" />
      ) : mouthPath ? (
        <path
          d={mouthPath}
          fill="none"
          stroke="#4A2E1A"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}

      {/* ── STUBBY ARMS ── */}
      {/* Left arm — little rounded nub */}
      <ellipse cx="62" cy="118" rx="12" ry="9" fill="#F0DC58" stroke="#D4BC2A" strokeWidth="1" transform="rotate(-30,62,118)" />
      {/* Right arm */}
      <ellipse cx="158" cy="118" rx="12" ry="9" fill="#F0DC58" stroke="#D4BC2A" strokeWidth="1" transform="rotate(30,158,118)" />

      {/* ── UMBRELLA (rainy) ── */}
      {state.accessory === 'umbrella' && (
        <g transform="translate(56,18)">
          {/* Canopy */}
          <path d="M2,34 C2,4 52,4 52,34 C44,22 10,22 2,34 Z" fill="url(#umb)" stroke="#FF5F9E" strokeWidth="1.5" />
          {/* Ribs */}
          <line x1="27" y1="5"  x2="27" y2="34" stroke="#FFB0D0" strokeWidth="0.8" opacity="0.7" />
          <line x1="8"  y1="22" x2="27" y2="34" stroke="#FFB0D0" strokeWidth="0.8" opacity="0.7" />
          <line x1="46" y1="22" x2="27" y2="34" stroke="#FFB0D0" strokeWidth="0.8" opacity="0.7" />
          {/* Handle */}
          <line x1="27" y1="34" x2="27" y2="78" stroke="#FF5F9E" strokeWidth="3" strokeLinecap="round" />
          <path d="M27,78 C27,90 18,96 15,88" fill="none" stroke="#FF5F9E" strokeWidth="3" strokeLinecap="round" />
          {/* Polka dots on canopy */}
          <circle cx="18" cy="18" r="3" fill="white" opacity="0.4" />
          <circle cx="34" cy="12" r="2.5" fill="white" opacity="0.4" />
          <circle cx="42" cy="22" r="2.5" fill="white" opacity="0.35" />
        </g>
      )}

      {/* ── SCARF (snow) ── */}
      {state.accessory === 'scarf' && (
        <g>
          {/* Main wrap */}
          <path
            d="M72,138 C76,128 92,124 110,124 C128,124 144,128 148,138 C148,146 138,150 110,150 C82,150 72,146 72,138 Z"
            fill="url(#scarf)" opacity="0.96"
          />
          {/* Stripe */}
          <path d="M74,138 C84,134 96,133 110,133 C124,133 136,134 146,138" fill="none" stroke="#C4B5FD" strokeWidth="2" strokeDasharray="4,3" opacity="0.75" />
          {/* Hanging tail */}
          <path d="M144,144 C150,152 148,164 142,170" fill="none" stroke="#4A7FFF" strokeWidth="10" strokeLinecap="round" />
          <path d="M142,170 C140,174 138,176 136,174" fill="none" stroke="#4A7FFF" strokeWidth="8" strokeLinecap="round" />
        </g>
      )}

      {/* ── NIGHT STARS ── */}
      {(condition === 'night' || condition === 'night_cloudy' || condition === 'night_rainy') && (
        <g opacity="0.85">
          <path d="M36,30 L38,23 L40,30 L47,32 L40,34 L38,41 L36,34 L29,32 Z" fill="#FFE566" />
          <path d="M168,44 L170,38 L172,44 L178,46 L172,48 L170,54 L168,48 L162,46 Z" fill="#FFE566" opacity="0.7" />
          <circle cx="162" cy="26" r="2.5" fill="#FFE566" opacity="0.65" />
        </g>
      )}

      {/* ── ZZZ for sleepy ── */}
      {isSleepy && (
        <g opacity="0.75">
          <text x="138" y="82" fontSize="12" fill="#A0A8C8" fontWeight="700" fontFamily="sans-serif">z</text>
          <text x="146" y="72" fontSize="10" fill="#A0A8C8" fontWeight="700" fontFamily="sans-serif">z</text>
          <text x="153" y="63" fontSize="8"  fill="#A0A8C8" fontWeight="700" fontFamily="sans-serif">z</text>
        </g>
      )}
    </svg>
  )
}
