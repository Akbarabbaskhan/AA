import { useEffect, useRef } from 'react'
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
  shiver: 'shiver 0.2s linear infinite',
  sway:   'sway 1.2s ease-in-out infinite',
  idle:   'idle 6s ease-in-out infinite',
}

export default function Mascot({ condition, onClick }: Props) {
  const state = MASCOT[condition]
  const groupRef = useRef<SVGGElement>(null)

  const isHappy   = state.mood === 'happy' || state.mood === 'cozy'
  const isScared  = state.mood === 'scared'
  const isSleepy  = state.mood === 'sleepy'
  const isSad     = state.mood === 'sad'
  const isAnnoyed = state.mood === 'annoyed'
  const isCalm    = state.mood === 'calm'

  const cx = 110, cy = 110

  const handleClick = () => {
    if (groupRef.current) {
      groupRef.current.style.animation = 'none'
      groupRef.current.getBoundingClientRect()
      groupRef.current.style.animation = 'bounce 0.4s ease-out, ' + ANIM_CSS[state.animation]
    }
    onClick()
  }

  return (
    <svg
      width="220" height="220"
      viewBox="0 0 220 220"
      onClick={handleClick}
      style={{ cursor: 'pointer', filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.2))' }}
    >
      <defs>
        <radialGradient id="bodyGrad" cx="50%" cy="40%" r="55%">
          <stop offset="0%"   stopColor="#FFF8C8" />
          <stop offset="55%"  stopColor="#F5E060" />
          <stop offset="100%" stopColor="#DDB830" />
        </radialGradient>
        <radialGradient id="blushGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#FFB3C6" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FF8FAB" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="wingGrad" cx="40%" cy="30%" r="65%">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#D0E8FF" stopOpacity="0.5" />
        </radialGradient>
        <linearGradient id="creamGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F0E8DC" />
        </linearGradient>
        <linearGradient id="scarfGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#5B8CFF" />
          <stop offset="50%"  stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#5B8CFF" />
        </linearGradient>
        <radialGradient id="umbrellaGrad" cx="50%" cy="30%" r="70%">
          <stop offset="0%"   stopColor="#FFCCE0" />
          <stop offset="100%" stopColor="#FF6B9D" />
        </radialGradient>
        <style>{`
          .mascot-body { animation: ${ANIM_CSS[state.animation]}; transform-origin: center; }
          .eye-group { animation: blink 4s ease-in-out infinite; transform-origin: center; }
          .blush { animation: pulse-blush 3s ease-in-out infinite; }
        `}</style>
      </defs>

      <g className="mascot-body" ref={groupRef}>
        {/* Wings */}
        <path d={`M${cx-10},${cy-8} C${cx-50},${cy-52} ${cx-75},${cy-15} ${cx-58},${cy+12} C${cx-44},${cy+36} ${cx-16},${cy+22} ${cx-10},${cy+6} Z`} fill="url(#wingGrad)" stroke="#C8D8F8" strokeWidth="1" opacity="0.88" />
        <path d={`M${cx-10},${cy+6} C${cx-30},${cy+40} ${cx-55},${cy+45} ${cx-48},${cy+22} C${cx-42},${cy+8} ${cx-20},${cy+14} ${cx-10},${cy+6} Z`} fill="url(#wingGrad)" stroke="#C8D8F8" strokeWidth="1" opacity="0.7" />
        <path d={`M${cx+10},${cy-8} C${cx+50},${cy-52} ${cx+75},${cy-15} ${cx+58},${cy+12} C${cx+44},${cy+36} ${cx+16},${cy+22} ${cx+10},${cy+6} Z`} fill="url(#wingGrad)" stroke="#C8D8F8" strokeWidth="1" opacity="0.88" />
        <path d={`M${cx+10},${cy+6} C${cx+30},${cy+40} ${cx+55},${cy+45} ${cx+48},${cy+22} C${cx+42},${cy+8} ${cx+20},${cy+14} ${cx+10},${cy+6} Z`} fill="url(#wingGrad)" stroke="#C8D8F8" strokeWidth="1" opacity="0.7" />

        {/* Base/feet */}
        <ellipse cx={cx} cy={cy+54} rx="22" ry="12" fill="#8B6347" opacity="0.9" />

        {/* Star body */}
        <path d={`M${cx},${cy-58} C${cx-10},${cy-54} ${cx-22},${cy-48} ${cx-30},${cy-36} C${cx-45},${cy-20} ${cx-60},${cy-14} ${cx-60},${cy} C${cx-60},${cy+16} ${cx-46},${cy+22} ${cx-36},${cy+30} C${cx-26},${cy+38} ${cx-22},${cy+48} ${cx-10},${cy+54} C${cx-4},${cy+57} ${cx+4},${cy+57} ${cx+10},${cy+54} C${cx+22},${cy+48} ${cx+26},${cy+38} ${cx+36},${cy+30} C${cx+46},${cy+22} ${cx+60},${cy+16} ${cx+60},${cy} C${cx+60},${cy-14} ${cx+45},${cy-20} ${cx+30},${cy-36} C${cx+22},${cy-48} ${cx+10},${cy-54} ${cx},${cy-58} Z`} fill="url(#bodyGrad)" stroke="#E0B830" strokeWidth="1.5" />

        {/* Ear tufts */}
        <path d={`M${cx-30},${cy-36} C${cx-42},${cy-54} ${cx-34},${cy-66} ${cx-20},${cy-58} C${cx-16},${cy-52} ${cx-18},${cy-44} ${cx-30},${cy-36}`} fill="#F5E070" />
        <path d={`M${cx+30},${cy-36} C${cx+42},${cy-54} ${cx+34},${cy-66} ${cx+20},${cy-58} C${cx+16},${cy-52} ${cx+18},${cy-44} ${cx+30},${cy-36}`} fill="#F5E070" />
        <path d={`M${cx-26},${cy-40} C${cx-33},${cy-52} ${cx-27},${cy-60} ${cx-18},${cy-54} C${cx-15},${cy-48} ${cx-18},${cy-44} ${cx-26},${cy-40}`} fill="#FFD0E0" opacity="0.65" />
        <path d={`M${cx+26},${cy-40} C${cx+33},${cy-52} ${cx+27},${cy-60} ${cx+18},${cy-54} C${cx+15},${cy-48} ${cx+18},${cy-44} ${cx+26},${cy-40}`} fill="#FFD0E0" opacity="0.65" />

        {/* Cream topping */}
        <path d={`M${cx-15},${cy-54} C${cx-12},${cy-66} ${cx-5},${cy-72} ${cx},${cy-76} C${cx+5},${cy-72} ${cx+12},${cy-66} ${cx+15},${cy-54} C${cx+8},${cy-50} ${cx+3},${cy-56} ${cx},${cy-58} C${cx-3},${cy-56} ${cx-8},${cy-50} ${cx-15},${cy-54} Z`} fill="url(#creamGrad)" />
        <circle cx={cx} cy={cy-78} r="4" fill="white" opacity="0.9" />
        <circle cx={cx} cy={cy-83} r="2.5" fill="#F5F0E8" opacity="0.8" />

        {/* Chocolate drizzle */}
        <path d={`M${cx-18},${cy-48} C${cx-24},${cy-32} ${cx-16},${cy-16} ${cx-22},${cy+2}`} fill="none" stroke="#8B6347" strokeWidth="2.5" strokeLinecap="round" opacity="0.65" />
        <path d={`M${cx+14},${cy-44} C${cx+20},${cy-28} ${cx+11},${cy-12} ${cx+18},${cy+6}`} fill="none" stroke="#8B6347" strokeWidth="2" strokeLinecap="round" opacity="0.55" />

        {/* Arms */}
        <ellipse cx={cx-52} cy={cy+6} rx="11" ry="8" fill="#EDCA50" transform={`rotate(-25,${cx-52},${cy+6})`} />
        <ellipse cx={cx+52} cy={cy+6} rx="11" ry="8" fill="#EDCA50" transform={`rotate(25,${cx+52},${cy+6})`} />

        {/* Blush */}
        <ellipse className="blush" cx={cx-23} cy={cy+14} rx="14" ry="9" fill="url(#blushGrad)" opacity={isHappy ? 0.85 : 0.4} />
        <ellipse className="blush" cx={cx+23} cy={cy+14} rx="14" ry="9" fill="url(#blushGrad)" opacity={isHappy ? 0.85 : 0.4} />

        {/* Eyes */}
        {isSleepy && <>
          <path d={`M${cx-17},${cy-1} C${cx-17},${cy-10} ${cx-7},${cy-10} ${cx-7},${cy-1}`} fill="#2D2D2D" />
          <path d={`M${cx+7},${cy-1} C${cx+7},${cy-10} ${cx+17},${cy-10} ${cx+17},${cy-1}`} fill="#2D2D2D" />
          <text x={cx+18} y={cy-18} fontSize="10" fill="#B0B0D0" opacity="0.8" fontFamily="sans-serif">z z</text>
        </>}
        {isScared && <>
          <circle cx={cx-13} cy={cy-5} r="9" fill="white" />
          <circle cx={cx+13} cy={cy-5} r="9" fill="white" />
          <circle cx={cx-13} cy={cy-5} r="6" fill="#1a1a2e" />
          <circle cx={cx+13} cy={cy-5} r="6" fill="#1a1a2e" />
          <circle cx={cx-10} cy={cy-8} r="2" fill="white" />
          <circle cx={cx+16} cy={cy-8} r="2" fill="white" />
        </>}
        {isAnnoyed && <>
          <path d={`M${cx-19},${cy-2} C${cx-14},${cy-9} ${cx-7},${cy-9} ${cx-5},${cy-2}`} fill="#2D2D2D" />
          <path d={`M${cx+5},${cy-2} C${cx+7},${cy-9} ${cx+14},${cy-9} ${cx+19},${cy-2}`} fill="#2D2D2D" />
          <line x1={cx-20} y1={cy-14} x2={cx-5} y2={cy-18} stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />
          <line x1={cx+20} y1={cy-14} x2={cx+5} y2={cy-18} stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />
        </>}
        {(isHappy || isSad || isCalm) && <>
          <g className="eye-group">
            <ellipse cx={cx-13} cy={cy-4} rx="7" ry="8" fill="#1a1a2e" />
          </g>
          <g className="eye-group">
            <ellipse cx={cx+13} cy={cy-4} rx="7" ry="8" fill="#1a1a2e" />
          </g>
          <circle cx={cx-10} cy={cy-7} r="2.5" fill="white" opacity="0.9" />
          <circle cx={cx+16} cy={cy-7} r="2.5" fill="white" opacity="0.9" />
        </>}

        {/* Mouth */}
        {isHappy  && <path d={`M${cx-11},${cy+20} C${cx-6},${cy+28} ${cx+6},${cy+28} ${cx+11},${cy+20}`} fill="none" stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />}
        {isSad    && <path d={`M${cx-11},${cy+27} C${cx-6},${cy+20} ${cx+6},${cy+20} ${cx+11},${cy+27}`} fill="none" stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />}
        {isScared && <ellipse cx={cx} cy={cy+24} rx="9" ry="8" fill="#3D2010" />}
        {(isAnnoyed || isCalm) && <line x1={cx-10} y1={cy+23} x2={cx+10} y2={cy+23} stroke="#5D4037" strokeWidth="2.5" strokeLinecap="round" />}
        {isSleepy && <path d={`M${cx-8},${cy+22} C${cx-4},${cy+27} ${cx+4},${cy+27} ${cx+8},${cy+22}`} fill="none" stroke="#5D4037" strokeWidth="2" strokeLinecap="round" />}

        {/* Umbrella */}
        {state.accessory === 'umbrella' && <g transform={`translate(${cx-50},${cy-78})`}>
          <path d="M2,32 C2,5 48,5 48,32 C40,20 10,20 2,32 Z" fill="url(#umbrellaGrad)" stroke="#FF6B9D" strokeWidth="1.5" />
          <line x1="25" y1="32" x2="25" y2="72" stroke="#FF6B9D" strokeWidth="3" strokeLinecap="round" />
          <path d="M25,72 C25,82 18,88 15,82" fill="none" stroke="#FF6B9D" strokeWidth="3" strokeLinecap="round" />
          <line x1="8"  y1="20" x2="25" y2="32" stroke="#FFB3C8" strokeWidth="1" opacity="0.7" />
          <line x1="25" y1="14" x2="25" y2="32" stroke="#FFB3C8" strokeWidth="1" opacity="0.7" />
          <line x1="42" y1="20" x2="25" y2="32" stroke="#FFB3C8" strokeWidth="1" opacity="0.7" />
        </g>}

        {/* Scarf */}
        {state.accessory === 'scarf' && <g>
          <path d={`M${cx-40},${cy+30} C${cx-34},${cy+22} ${cx},${cy+20} ${cx+34},${cy+22} C${cx+40},${cy+26} ${cx+40},${cy+34} ${cx+34},${cy+38} C${cx},${cy+44} ${cx-34},${cy+38} ${cx-40},${cy+30} Z`} fill="url(#scarfGrad)" opacity="0.95" />
          <path d={`M${cx+32},${cy+36} C${cx+42},${cy+44} ${cx+37},${cy+58} ${cx+28},${cy+62}`} fill="none" stroke="#5B8CFF" strokeWidth="10" strokeLinecap="round" />
          <path d={`M${cx-38},${cy+29} C${cx-30},${cy+27} ${cx},${cy+25} ${cx+30},${cy+27}`} fill="none" stroke="#C4B5FD" strokeWidth="2" strokeDasharray="4,3" opacity="0.8" />
        </g>}

        {/* Night stars */}
        {(condition === 'night' || condition === 'night_cloudy' || condition === 'night_rainy') && <g opacity="0.85">
          <path d="M36,26 L38,20 L40,26 L46,28 L40,30 L38,36 L36,30 L30,28 Z" fill="#FFE566" />
          <path d="M170,42 L172,36 L174,42 L180,44 L174,46 L172,52 L170,46 L164,44 Z" fill="#FFE566" opacity="0.7" />
          <circle cx="164" cy="24" r="2.5" fill="#FFE566" opacity="0.6" />
        </g>}
      </g>
    </svg>
  )
}
