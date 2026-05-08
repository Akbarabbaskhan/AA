import { WeatherCondition } from './types'
import { MASCOT } from './constants'

interface Props { condition: WeatherCondition; onClick: () => void }

const ANIM: Record<string, string> = {
  bounce: 'bounce 0.9s ease-in-out infinite',
  float:  'float 3.5s ease-in-out infinite',
  shake:  'shake 0.9s ease-in-out infinite',
  shiver: 'shiver 0.15s linear infinite',
  sway:   'sway 1.1s ease-in-out infinite',
  idle:   'idle 5s ease-in-out infinite',
}

export default function Mascot({ condition, onClick }: Props) {
  const state = MASCOT[condition]
  const { mood, animation, accessory } = state

  const isHappy   = mood === 'happy' || mood === 'cozy'
  const isScared  = mood === 'scared'
  const isSleepy  = mood === 'sleepy'
  const isSad     = mood === 'sad'
  const isAnnoyed = mood === 'annoyed'
  const isCalm    = mood === 'calm'

  return (
    <svg width="200" height="210" viewBox="0 0 200 210" onClick={onClick}
      style={{ cursor:'pointer', animation: ANIM[animation], transformOrigin:'center 85%',
        filter:'drop-shadow(0 18px 32px rgba(0,0,0,0.35)) drop-shadow(0 4px 8px rgba(0,0,0,0.2))' }}>
      <defs>
        <radialGradient id="bodyG" cx="40%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#4a4a5a"/>
          <stop offset="45%"  stopColor="#2a2a38"/>
          <stop offset="100%" stopColor="#111118"/>
        </radialGradient>
        <radialGradient id="bellyG" cx="50%" cy="40%" r="55%">
          <stop offset="0%"   stopColor="#6a6278"/>
          <stop offset="100%" stopColor="#4a4458"/>
        </radialGradient>
        <radialGradient id="eyeL" cx="35%" cy="30%" r="60%">
          <stop offset="0%"   stopColor="#7EFFCC"/>
          <stop offset="50%"  stopColor="#00E5A0"/>
          <stop offset="100%" stopColor="#00A878"/>
        </radialGradient>
        <radialGradient id="eyeR" cx="35%" cy="30%" r="60%">
          <stop offset="0%"   stopColor="#7EFFCC"/>
          <stop offset="50%"  stopColor="#00E5A0"/>
          <stop offset="100%" stopColor="#00A878"/>
        </radialGradient>
        <radialGradient id="blushG" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#FF6B9D" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="#FF6B9D" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="umbG" cx="50%" cy="20%" r="75%">
          <stop offset="0%"   stopColor="#B8A0FF"/>
          <stop offset="100%" stopColor="#7C5CE4"/>
        </radialGradient>
        <linearGradient id="scarfG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#FF6B9D"/>
          <stop offset="50%"  stopColor="#FFB347"/>
          <stop offset="100%" stopColor="#FF6B9D"/>
        </linearGradient>
        <radialGradient id="moonG" cx="40%" cy="35%" r="60%">
          <stop offset="0%"   stopColor="#FFFDE0"/>
          <stop offset="100%" stopColor="#FFE566"/>
        </radialGradient>
        <style>{`
          @keyframes blink {
            0%,82%,100%{ transform:scaleY(1) }
            88%{ transform:scaleY(0.05) }
            91%{ transform:scaleY(1) }
            94%{ transform:scaleY(0.05) }
          }
          .lEye{ animation:blink 3.5s ease-in-out infinite; transform-origin:75px 88px; }
          .rEye{ animation:blink 3.5s ease-in-out 0.1s infinite; transform-origin:125px 88px; }

          @keyframes tailSwish {
            0%  { transform:rotate(-10deg) }
            30% { transform:rotate(14deg) }
            55% { transform:rotate(-6deg) }
            75% { transform:rotate(18deg) }
            100%{ transform:rotate(-10deg) }
          }
          .tail{ animation:tailSwish 2s ease-in-out infinite; transform-origin:85px 155px; }

          @keyframes earTwitchL {
            0%,70%,100%{ transform:rotate(0deg) }
            75%{ transform:rotate(-12deg) }
            80%{ transform:rotate(0deg) }
            85%{ transform:rotate(-8deg) }
            90%{ transform:rotate(0deg) }
          }
          @keyframes earTwitchR {
            0%,60%,100%{ transform:rotate(0deg) }
            65%{ transform:rotate(10deg) }
            70%{ transform:rotate(0deg) }
            75%{ transform:rotate(7deg) }
            80%{ transform:rotate(0deg) }
          }
          .earL{ animation:earTwitchL 4s ease-in-out 0.8s infinite; transform-origin:65px 72px; }
          .earR{ animation:earTwitchR 4s ease-in-out 2s infinite; transform-origin:135px 72px; }

          @keyframes breathe {
            0%,100%{ transform:scaleY(1) scaleX(1) }
            50%{ transform:scaleY(1.025) scaleX(1.015) }
          }
          .body{ animation:breathe 3s ease-in-out infinite; transform-origin:100px 148px; }

          @keyframes pawTapL {
            0%,80%,100%{ transform:translateY(0) }
            85%{ transform:translateY(-8px) }
            90%{ transform:translateY(2px) }
            95%{ transform:translateY(0) }
          }
          @keyframes pawTapR {
            0%,60%,100%{ transform:translateY(0) }
            65%{ transform:translateY(-8px) }
            70%{ transform:translateY(2px) }
            75%{ transform:translateY(0) }
          }
          .pawL{ animation:pawTapL 5s ease-in-out 1s infinite; }
          .pawR{ animation:pawTapR 5s ease-in-out 2.5s infinite; }

          @keyframes headBob {
            0%,100%{ transform:translateY(0) rotate(0deg) }
            25%{ transform:translateY(-2px) rotate(-1.5deg) }
            75%{ transform:translateY(-1px) rotate(1deg) }
          }
          .head{ animation:headBob 4s ease-in-out infinite; transform-origin:100px 95px; }

          @keyframes whiskerWave {
            0%,100%{ transform:rotate(0deg) }
            50%{ transform:rotate(3deg) }
          }
          .wL{ animation:whiskerWave 2.8s ease-in-out infinite; transform-origin:90px 113px; }
          .wR{ animation:whiskerWave 2.8s ease-in-out 1.4s infinite; transform-origin:110px 113px; transform:scaleX(-1); }

          @keyframes sparkleFloat {
            0%  { opacity:0; transform:translateY(0) scale(0.5) }
            20% { opacity:1; transform:translateY(-8px) scale(1) }
            80% { opacity:0.8; transform:translateY(-22px) scale(0.9) }
            100%{ opacity:0; transform:translateY(-32px) scale(0.4) }
          }
          .sp1{ animation:sparkleFloat 2.4s ease-in-out 0s infinite; }
          .sp2{ animation:sparkleFloat 2.4s ease-in-out 0.8s infinite; }
          .sp3{ animation:sparkleFloat 2.4s ease-in-out 1.6s infinite; }
        `}</style>
      </defs>

      {/* ── SPARKLES (float up around the cat) ── */}
      <text className="sp1" x="22"  y="115" fontSize="13" style={{pointerEvents:'none'}}>✨</text>
      <text className="sp2" x="168" y="105" fontSize="11" style={{pointerEvents:'none'}}>⭐</text>
      <text className="sp3" x="42"  y="148" fontSize="10" style={{pointerEvents:'none'}}>💫</text>

      {/* ── TAIL ── */}
      <g className="tail">
        <path d="M85,155 C60,152 42,160 40,175 C38,188 55,196 70,190 C82,185 88,172 85,155 Z"
          fill="url(#bodyG)" stroke="#111118" strokeWidth="1"/>
        <path d="M68,186 C60,188 50,186 48,180 C46,174 52,168 62,170"
          fill="#4a4a5a" opacity="0.5"/>
      </g>

      {/* ── BODY ── */}
      <g className="body">
      <ellipse cx="100" cy="148" rx="52" ry="45" fill="url(#bodyG)"/>
      {/* Belly patch */}
      <ellipse cx="100" cy="152" rx="28" ry="28" fill="url(#bellyG)" opacity="0.7"/>

      {/* ── EARS ── */}
      <g className="earL">
        <path d="M60,72 L48,42 L82,60 Z" fill="url(#bodyG)"/>
        <path d="M62,70 L54,50 L78,64 Z" fill="#E8728A" opacity="0.85"/>
      </g>
      <g className="earR">
        <path d="M140,72 L152,42 L118,60 Z" fill="url(#bodyG)"/>
        <path d="M138,70 L146,50 L122,64 Z" fill="#E8728A" opacity="0.85"/>
      </g>

      </g>{/* end body breathing group */}

      {/* ── HEAD (with bob) ── */}
      <g className="head">
      <ellipse cx="100" cy="95" rx="50" ry="46" fill="url(#bodyG)"/>
      {/* Head sheen */}
      <ellipse cx="82" cy="76" rx="22" ry="16" fill="white" opacity="0.06"/>

      {/* ── EYES ── */}
      {isSleepy ? (
        <>
          {/* Half-moon closed eyes */}
          <path d="M62,88 C66,80 84,80 88,88 Z" fill="#00C896"/>
          <path d="M112,88 C116,80 134,80 138,88 Z" fill="#00C896"/>
          <path d="M62,88 C66,84 84,84 88,88" fill="none" stroke="#008860" strokeWidth="1.5"/>
          <path d="M112,88 C116,84 134,84 138,88" fill="none" stroke="#008860" strokeWidth="1.5"/>
        </>
      ) : isScared ? (
        <>
          {/* Wide scared eyes */}
          <ellipse cx="75" cy="88" rx="14" ry="14" fill="white"/>
          <ellipse cx="125" cy="88" rx="14" ry="14" fill="white"/>
          <g className="lEye"><ellipse cx="75" cy="88" rx="10" ry="13" fill="url(#eyeL)"/>
            <ellipse cx="75" cy="88" rx="5" ry="8" fill="#111"/>
            <circle cx="78" cy="83" r="3" fill="white"/></g>
          <g className="rEye"><ellipse cx="125" cy="88" rx="10" ry="13" fill="url(#eyeR)"/>
            <ellipse cx="125" cy="88" rx="5" ry="8" fill="#111"/>
            <circle cx="128" cy="83" r="3" fill="white"/></g>
        </>
      ) : isAnnoyed ? (
        <>
          {/* Squint eyes with inner brow lines */}
          <ellipse cx="75" cy="88" rx="13" ry="9" fill="url(#eyeL)"/>
          <ellipse cx="125" cy="88" rx="13" ry="9" fill="url(#eyeR)"/>
          <ellipse cx="75" cy="90" rx="13" ry="5" fill="#111"/>
          <ellipse cx="125" cy="90" rx="13" ry="5" fill="#111"/>
          {/* Angled brows */}
          <path d="M63,77 C68,73 84,74 88,77" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M137,77 C133,73 117,74 113,77" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round"/>
        </>
      ) : (
        <>
          {/* Normal teal eyes */}
          <ellipse cx="75" cy="88" rx="15" ry="16" fill="white" opacity="0.15"/>
          <g className="lEye">
            <ellipse cx="75" cy="88" rx="13" ry="14" fill="url(#eyeL)"/>
            <ellipse cx="75" cy="88" rx="7" ry="10" fill="#0a0a14"/>
            <circle cx="79" cy="82" r="3.5" fill="white" opacity="0.9"/>
            <circle cx="71" cy="92" r="1.5" fill="white" opacity="0.4"/>
          </g>
          <ellipse cx="125" cy="88" rx="15" ry="16" fill="white" opacity="0.15"/>
          <g className="rEye">
            <ellipse cx="125" cy="88" rx="13" ry="14" fill="url(#eyeR)"/>
            <ellipse cx="125" cy="88" rx="7" ry="10" fill="#0a0a14"/>
            <circle cx="129" cy="82" r="3.5" fill="white" opacity="0.9"/>
            <circle cx="121" cy="92" r="1.5" fill="white" opacity="0.4"/>
          </g>
        </>
      )}

      {/* ── NOSE ── */}
      <path d="M97,106 L103,106 L100,110 Z" fill="#E8728A"/>
      {/* Philtrum */}
      <line x1="100" y1="110" x2="100" y2="114" stroke="#333" strokeWidth="1.2"/>

      {/* ── MOUTH ── */}
      {isHappy  && <><path d="M100,114 C94,114 88,120 86,126" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round"/>
                     <path d="M100,114 C106,114 112,120 114,126" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round"/></>}
      {isSad    && <><path d="M100,114 C94,118 88,116 86,112" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round"/>
                     <path d="M100,114 C106,118 112,116 114,112" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round"/></>}
      {isScared && <ellipse cx="100" cy="122" rx="9" ry="7" fill="#333"/>}
      {(isAnnoyed||isCalm) && <path d="M88,120 L112,120" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round"/>}
      {isSleepy && <><path d="M100,114 C94,116 90,118 88,117" fill="none" stroke="#555" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M100,114 C106,116 110,118 112,117" fill="none" stroke="#555" strokeWidth="1.8" strokeLinecap="round"/></>}

      {/* ── WHISKERS ── */}
      <g className="wL">
        <line x1="60" y1="108" x2="90" y2="112" stroke="rgba(255,255,255,0.38)" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="58" y1="114" x2="89" y2="115" stroke="rgba(255,255,255,0.33)" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="60" y1="120" x2="90" y2="118" stroke="rgba(255,255,255,0.28)" strokeWidth="1.3" strokeLinecap="round"/>
      </g>
      <g className="wR">
        <line x1="140" y1="108" x2="110" y2="112" stroke="rgba(255,255,255,0.38)" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="142" y1="114" x2="111" y2="115" stroke="rgba(255,255,255,0.33)" strokeWidth="1.3" strokeLinecap="round"/>
        <line x1="140" y1="120" x2="110" y2="118" stroke="rgba(255,255,255,0.28)" strokeWidth="1.3" strokeLinecap="round"/>
      </g>

      </g>{/* end head bob group */}

      {/* ── BLUSH ── */}
      <ellipse cx="62" cy="110" rx="16" ry="11" fill="url(#blushG)" opacity={isHappy?0.9:0.4}/>
      <ellipse cx="138" cy="110" rx="16" ry="11" fill="url(#blushG)" opacity={isHappy?0.9:0.4}/>

      {/* ── PAWS ── */}
      <g className="pawL">
        <ellipse cx="72" cy="188" rx="20" ry="13" fill="url(#bodyG)"/>
        {[64,72,80].map((x,i)=><ellipse key={i} cx={x} cy="191" rx="4" ry="3" fill="#E8728A" opacity="0.6"/>)}
      </g>
      <g className="pawR">
        <ellipse cx="128" cy="188" rx="20" ry="13" fill="url(#bodyG)"/>
        {[120,128,136].map((x,i)=><ellipse key={i} cx={x} cy="191" rx="4" ry="3" fill="#E8728A" opacity="0.6"/>)}
      </g>

      {/* ── UMBRELLA ── */}
      {accessory==='umbrella' && <g>
        {/* Handle on right side — stays outside head boundary */}
        <line x1="157" y1="46" x2="163" y2="118" stroke="#6040C0" strokeWidth="3" strokeLinecap="round"/>
        <path d="M163,118 C164,132 151,139 144,128" fill="none" stroke="#6040C0" strokeWidth="3" strokeLinecap="round"/>
        {/* Canopy dome above head/ears (ears tip at y≈42) */}
        <path d="M43,46 C43,6 157,6 157,46 C143,32 57,32 43,46Z" fill="url(#umbG)" stroke="#6040C0" strokeWidth="1.5"/>
        <circle cx="43"  cy="46" r="3" fill="#9B78FF"/>
        <circle cx="100" cy="12" r="3" fill="#9B78FF"/>
        <circle cx="157" cy="46" r="3" fill="#9B78FF"/>
        <line x1="73"  y1="26" x2="100" y2="44" stroke="#B8A0FF" strokeWidth="0.8" opacity="0.6"/>
        <line x1="100" y1="8"  x2="100" y2="44" stroke="#B8A0FF" strokeWidth="0.8" opacity="0.6"/>
        <line x1="127" y1="26" x2="100" y2="44" stroke="#B8A0FF" strokeWidth="0.8" opacity="0.6"/>
        {[58,76,100,124,142].map((x,i)=><ellipse key={i} cx={x} cy={i%2===0?22:33} rx="2" ry="3" fill="white" opacity="0.25"/>)}
      </g>}

      {/* ── SCARF ── */}
      {accessory==='scarf' && <g>
        <path d="M52,148 C56,136 76,130 100,130 C124,130 144,136 148,148 C148,158 134,164 100,164 C66,164 52,158 52,148Z" fill="url(#scarfG)" opacity="0.95"/>
        <path d="M54,148 C64,142 80,140 100,140 C120,140 136,142 146,148" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeDasharray="4,3"/>
        <path d="M144,156 C152,168 148,184 140,190" fill="none" stroke="#FF6B9D" strokeWidth="9" strokeLinecap="round"/>
        <path d="M140,190 L136,196" fill="none" stroke="#FF6B9D" strokeWidth="7" strokeLinecap="round"/>
      </g>}

      {/* ── NIGHT MOON HALO (night conditions) ── */}
      {(condition==='night'||condition==='night_cloudy'||condition==='night_rainy') && <>
        <circle cx="100" cy="95" r="62" fill="none" stroke="#FFE566" strokeWidth="1" opacity="0.2"/>
        <circle cx="100" cy="95" r="70" fill="none" stroke="#FFE566" strokeWidth="0.5" opacity="0.1"/>
        <path d="M30,34 L32,26 L34,34 L42,36 L34,38 L32,46 L30,38 L22,36 Z" fill="#FFE566" opacity="0.9"/>
        <circle cx="168" cy="44" r="3" fill="#FFE566" opacity="0.75"/>
        <circle cx="22"  cy="60" r="2" fill="#FFE566" opacity="0.55"/>
      </>}

      {/* ── ZZZ ── */}
      {isSleepy && <>
        <text x="148" y="72" fontSize="14" fill="#A0A8D8" fontWeight="800" fontFamily="sans-serif" opacity="0.85">z</text>
        <text x="158" y="60" fontSize="11" fill="#A0A8D8" fontWeight="700" fontFamily="sans-serif" opacity="0.7">z</text>
        <text x="166" y="50" fontSize="9"  fill="#A0A8D8" fontWeight="600" fontFamily="sans-serif" opacity="0.55">z</text>
      </>}

      {/* ── SCARED SWEAT DROP ── */}
      {isScared && <g>
        <path d="M152,68 C154,60 160,52 158,46 C156,40 150,42 150,50 C150,60 152,64 152,68Z" fill="#A0C8FF" opacity="0.8"/>
      </g>}
    </svg>
  )
}
