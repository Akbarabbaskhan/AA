import { useMemo } from 'react'
import { WeatherCondition } from './types'

// All random values pre-computed once per condition change — never recalculated on re-render
function seeded(n: number, min: number, max: number, salt = 0) {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453
  return min + (x - Math.floor(x)) * (max - min)
}

export default function Particles({ condition }: { condition: WeatherCondition }) {
  // Stable per-particle data, only recomputed when condition changes
  const rain = useMemo(() => Array.from({ length: 32 }, (_, i) => ({
    left:   seeded(i, 0, 100),
    height: seeded(i, 12, 22, 1),
    dur:    seeded(i, 0.55, 1.0, 2),
    delay:  seeded(i, 0, 1.6, 3),
  })), [condition])

  const snow = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    left:  seeded(i, 0, 100, 10),
    size:  seeded(i, 4, 10, 11),
    dur:   seeded(i, 2.5, 5, 12),
    delay: seeded(i, 0, 4, 13),
  })), [condition])

  const leaves = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    top:   seeded(i, 10, 85, 20),
    size:  seeded(i, 10, 18, 21),
    dur:   seeded(i, 1.5, 2.8, 22),
    delay: seeded(i, 0, 3, 23),
    color: ['#A8D5A2','#F4A261','#E76F51','#E9C46A','#84C36E'][i % 5],
  })), [condition])

  const stars = useMemo(() => Array.from({ length: 50 }, (_, i) => ({
    left:  seeded(i, 0, 100, 30),
    top:   seeded(i, 0, 65, 31),
    size:  seeded(i, 1, 3.5, 32),
    dur:   seeded(i, 1, 3, 33),
    delay: seeded(i, 0, 3, 34),
  })), [condition])

  if (condition === 'rainy' || condition === 'night_rainy') {
    return (
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {rain.map((p, i) => (
          <div key={i} style={{
            position:'absolute', left:`${p.left}%`, top:-20,
            width:2, height:p.height, borderRadius:2,
            background:'rgba(168,200,255,0.55)',
            animation:`rain-fall ${p.dur}s linear ${p.delay}s infinite`,
          }}/>
        ))}
      </div>
    )
  }

  if (condition === 'thunderstorm') {
    return (
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {rain.map((p, i) => (
          <div key={i} style={{
            position:'absolute', left:`${p.left}%`, top:-20,
            width:2, height:p.height + 4, borderRadius:2,
            background:'rgba(140,170,220,0.5)',
            animation:`rain-fall ${p.dur * 0.8}s linear ${p.delay}s infinite`,
          }}/>
        ))}
        <div style={{
          position:'absolute', inset:0,
          background:'rgba(220,235,255,0.45)',
          animation:'lightning-flash 3s ease-in-out infinite',
          pointerEvents:'none',
        }}/>
      </div>
    )
  }

  if (condition === 'snow') {
    return (
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {snow.map((p, i) => (
          <div key={i} style={{
            position:'absolute', left:`${p.left}%`, top:-20,
            width:p.size, height:p.size, borderRadius:'50%',
            background:'rgba(255,255,255,0.9)',
            animation:`snow-fall ${p.dur}s linear ${p.delay}s infinite`,
          }}/>
        ))}
      </div>
    )
  }

  if (condition === 'windy') {
    return (
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {leaves.map((p, i) => (
          <div key={i} style={{
            position:'absolute', left:-40, top:`${p.top}%`,
            width:p.size, height:p.size * 0.6, borderRadius:p.size / 3,
            background:p.color, opacity:0.85,
            animation:`leaf-blow ${p.dur}s linear ${p.delay}s infinite`,
          }}/>
        ))}
      </div>
    )
  }

  if (condition === 'fog') {
    return (
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {Array.from({ length:5 }, (_,i) => (
          <div key={i} style={{
            position:'absolute', left:'-10%', top:`${15 + i * 14}%`,
            width:'130%', height:70 + i * 15, borderRadius:50,
            background:'rgba(200,216,230,0.22)',
            animation:`fog-drift ${7 + i * 2}s ease-in-out ${i * 0.8}s infinite`,
          }}/>
        ))}
      </div>
    )
  }

  if (condition === 'sunny' || condition === 'partly_cloudy') {
    return (
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        <div style={{
          position:'absolute', top:'-40%', left:'-30%',
          width:'160%', height:'160%',
          background:'radial-gradient(ellipse at 50% 50%, rgba(255,229,128,0.35) 0%, rgba(255,184,48,0.12) 40%, transparent 70%)',
          animation:'sun-rotate 22s linear infinite',
        }}/>
      </div>
    )
  }

  if (condition === 'night' || condition === 'night_cloudy') {
    return (
      <div style={{ position:'absolute', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        {stars.map((p, i) => (
          <div key={i} style={{
            position:'absolute', left:`${p.left}%`, top:`${p.top}%`,
            width:p.size, height:p.size, borderRadius:'50%', background:'white',
            animation:`star-twinkle ${p.dur}s ease-in-out ${p.delay}s infinite`,
          }}/>
        ))}
      </div>
    )
  }

  return null
}
