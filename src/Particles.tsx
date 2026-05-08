import { useMemo } from 'react'
import { WeatherCondition } from './types'

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min
}

export default function Particles({ condition }: { condition: WeatherCondition }) {
  const particles = useMemo(() => Array.from({ length: 30 }, (_, i) => i), [condition])

  if (condition === 'rainy' || condition === 'night_rainy') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {particles.map(i => (
          <div key={i} style={{
            position: 'absolute',
            left: `${rand(0, 100)}%`,
            top: -20,
            width: 2,
            height: rand(12, 22),
            borderRadius: 2,
            background: 'rgba(168,200,255,0.55)',
            animation: `rain-fall ${rand(0.6, 1.0)}s linear ${rand(0, 1.5)}s infinite`,
          }} />
        ))}
      </div>
    )
  }

  if (condition === 'thunderstorm') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {/* Rain */}
        {particles.map(i => (
          <div key={i} style={{
            position: 'absolute',
            left: `${rand(0, 100)}%`,
            top: -20,
            width: 2,
            height: rand(15, 25),
            borderRadius: 2,
            background: 'rgba(140,170,220,0.5)',
            animation: `rain-fall ${rand(0.5, 0.8)}s linear ${rand(0, 1.5)}s infinite`,
          }} />
        ))}
        {/* Lightning flash */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(220,235,255,0.5)',
          animation: 'lightning-flash 3s ease-in-out infinite',
        }} />
        {/* Bolt */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          <path d="M62% 2% L54% 38% L60% 38% L48% 68%" fill="none" stroke="rgba(255,255,220,0.7)" strokeWidth="3" />
        </svg>
      </div>
    )
  }

  if (condition === 'snow') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {particles.map(i => {
          const size = rand(4, 10)
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${rand(0, 100)}%`,
              top: -20,
              width: size,
              height: size,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)',
              animation: `snow-fall ${rand(2.5, 5)}s linear ${rand(0, 4)}s infinite`,
            }} />
          )
        })}
      </div>
    )
  }

  if (condition === 'windy') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {Array.from({ length: 14 }).map((_, i) => {
          const colors = ['#A8D5A2','#F4A261','#E76F51','#E9C46A','#84C36E']
          const size = rand(10, 18)
          return (
            <div key={i} style={{
              position: 'absolute',
              left: -40,
              top: `${rand(10, 85)}%`,
              width: size,
              height: size * 0.6,
              borderRadius: size / 3,
              background: colors[i % colors.length],
              opacity: 0.85,
              animation: `leaf-blow ${rand(1.5, 2.8)}s linear ${rand(0, 3)}s infinite`,
            }} />
          )
        })}
      </div>
    )
  }

  if (condition === 'fog') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: '-10%',
            top: `${15 + i * 14}%`,
            width: '130%',
            height: 70 + i * 15,
            borderRadius: 50,
            background: 'rgba(200,216,230,0.22)',
            animation: `fog-drift ${7 + i * 2}s ease-in-out ${i * 0.8}s infinite`,
          }} />
        ))}
      </div>
    )
  }

  if (condition === 'sunny') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute',
          top: '-40%', left: '-30%',
          width: '160%', height: '160%',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(255,229,128,0.4) 0%, rgba(255,184,48,0.15) 40%, transparent 70%)',
          animation: 'sun-rotate 20s linear infinite',
        }} />
      </div>
    )
  }

  if (condition === 'night' || condition === 'night_cloudy') {
    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {Array.from({ length: 50 }).map((_, i) => {
          const size = rand(1, 3.5)
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${rand(0, 100)}%`,
              top: `${rand(0, 65)}%`,
              width: size,
              height: size,
              borderRadius: '50%',
              background: 'white',
              animation: `star-twinkle ${rand(1, 3)}s ease-in-out ${rand(0, 3)}s infinite`,
            }} />
          )
        })}
      </div>
    )
  }

  return null
}
