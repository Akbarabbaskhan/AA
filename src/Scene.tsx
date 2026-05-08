import { WeatherCondition } from './types'

export default function Scene({ condition }: { condition: WeatherCondition }) {
  const w = 480, h = 420

  switch (condition) {
    case 'sunny':
    case 'partly_cloudy':
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <radialGradient id="sunGlow" cx="75%" cy="18%" r="35%">
              <stop offset="0%"   stopColor="#FFFDE0" stopOpacity="0.9"/>
              <stop offset="60%"  stopColor="#FFD060" stopOpacity="0.3"/>
              <stop offset="100%" stopColor="#FF9020" stopOpacity="0"/>
            </radialGradient>
            <style>{`
              @keyframes sunSpin { from{transform:rotate(0deg)}to{transform:rotate(360deg)} }
              @keyframes cloudDrift { 0%,100%{transform:translateX(0)}50%{transform:translateX(18px)} }
              @keyframes flowerBob { 0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-4px) rotate(5deg)} }
              @keyframes sparkle { 0%,100%{opacity:0.3 scale:1}50%{opacity:1;transform:scale(1.4)} }
            `}</style>
          </defs>
          {/* Sky gradient base */}
          <rect width={w} height={h} fill="transparent"/>
          {/* Sun glow */}
          <circle cx={w*0.78} cy={h*0.14} r="55" fill="#FFE566" opacity="0.95" style={{filter:'blur(2px)'}}/>
          <circle cx={w*0.78} cy={h*0.14} r="42" fill="#FFF5A0"/>
          {/* Sun rays */}
          <g style={{transformOrigin:`${w*0.78}px ${h*0.14}px`, animation:'sunSpin 18s linear infinite'}}>
            {Array.from({length:12},(_,i)=>{
              const a=(i/12)*Math.PI*2, r1=52, r2=70
              return <line key={i} x1={w*0.78+Math.cos(a)*r1} y1={h*0.14+Math.sin(a)*r1}
                x2={w*0.78+Math.cos(a)*r2} y2={h*0.14+Math.sin(a)*r2}
                stroke="#FFD040" strokeWidth="3" strokeLinecap="round" opacity="0.7"/>
            })}
          </g>
          <rect x="0" y="0" width={w} height={h} fill="url(#sunGlow)"/>
          {/* Clouds */}
          {condition==='partly_cloudy' && <>
            <g style={{animation:'cloudDrift 6s ease-in-out infinite'}}>
              <ellipse cx="130" cy="90"  rx="70" ry="30" fill="white" opacity="0.9"/>
              <ellipse cx="100" cy="95"  rx="45" ry="24" fill="white" opacity="0.9"/>
              <ellipse cx="175" cy="88"  rx="50" ry="22" fill="white" opacity="0.85"/>
            </g>
            <g style={{animation:'cloudDrift 8s ease-in-out 2s infinite'}}>
              <ellipse cx="340" cy="70" rx="55" ry="22" fill="white" opacity="0.8"/>
              <ellipse cx="310" cy="74" rx="38" ry="18" fill="white" opacity="0.8"/>
            </g>
          </>}
          {/* Hills */}
          <ellipse cx="0"   cy={h}   rx="200" ry="120" fill="#5DBB63" opacity="0.9"/>
          <ellipse cx={w}   cy={h}   rx="200" ry="110" fill="#4CAF50" opacity="0.85"/>
          <ellipse cx={w/2} cy={h+20} rx="280" ry="100" fill="#66BB6A"/>
          {/* Ground strip */}
          <rect x="0" y={h-55} width={w} height="55" fill="#4CAF50" opacity="0.9"/>
          <rect x="0" y={h-30} width={w} height="30" fill="#388E3C"/>
          {/* Flowers */}
          {[[50,h-54],[120,h-60],[200,h-58],[280,h-62],[370,h-56],[430,h-54]].map(([x,y],i)=>(
            <g key={i} style={{transformOrigin:`${x}px ${y}px`, animation:`flowerBob ${1.5+i*0.3}s ease-in-out ${i*0.4}s infinite`}}>
              <line x1={x} y1={y} x2={x} y2={(y as number)+22} stroke="#388E3C" strokeWidth="2"/>
              {['#FF6B9D','#FFD700','#FF8C42','#A78BFA','#FF6B6B','#74B9FF'][i] && <>
                {[0,60,120,180,240,300].map((a,j)=>{
                  const rad=a*Math.PI/180
                  return <ellipse key={j} cx={(x as number)+Math.cos(rad)*7} cy={(y as number)+Math.sin(rad)*7}
                    rx="5" ry="5" fill={['#FF6B9D','#FFD700','#FF8C42','#A78BFA','#FF6B6B','#74B9FF'][i]} opacity="0.9"/>
                })}
                <circle cx={x} cy={y} r="5" fill="#FFF176"/>
              </>}
            </g>
          ))}
          {/* Sparkles */}
          {[[60,50],[200,30],[380,60],[440,40]].map(([x,y],i)=>(
            <text key={i} x={x} y={y} fontSize="18" style={{animation:`sparkle ${1.5+i*0.5}s ease-in-out ${i*0.7}s infinite`}}>✨</text>
          ))}
        </svg>
      )

    case 'rainy':
    case 'night_rainy':
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <style>{`
              @keyframes rainDrop { from{transform:translateY(-30px) translateX(0)} to{transform:translateY(${h+20}px) translateX(-20px)} }
              @keyframes puddleRipple { 0%{r:8px;opacity:0.6}100%{r:28px;opacity:0} }
            `}</style>
          </defs>
          {/* Dark clouds */}
          {[[60,45,120,42],[160,30,100,38],[300,50,130,40],[380,35,110,36]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={i%2?'#3a4a6a':'#2e3f5c'} opacity="0.9"/>
          ))}
          {[[30,70,90,32],[200,62,100,34],[340,68,95,30]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#253450" opacity="0.85"/>
          ))}
          {/* Ground / puddles */}
          <rect x="0" y={h-60} width={w} height="60" fill="#1a2840"/>
          <rect x="0" y={h-30} width={w} height="30" fill="#162035"/>
          {/* Puddle reflections */}
          <ellipse cx="100" cy={h-12} rx="60" ry="10" fill="#2040A0" opacity="0.4"/>
          <ellipse cx="280" cy={h-15} rx="50" ry="8"  fill="#2040A0" opacity="0.35"/>
          <ellipse cx="420" cy={h-10} rx="40" ry="7"  fill="#2040A0" opacity="0.3"/>
          {/* Ripple animations */}
          {[[100,h-12],[280,h-15],[420,h-10]].map(([cx,cy],i)=>(
            <circle key={i} cx={cx} cy={cy} r="8" fill="none" stroke="#4060C0" strokeWidth="1.5"
              style={{animation:`puddleRipple 1.8s ease-out ${i*0.6}s infinite`}}/>
          ))}
          {/* Rain drops */}
          {Array.from({length:35},(_,i)=>(
            <line key={i} x1={20+i*14} y1={-10} x2={10+i*14} y2={20}
              stroke={condition==='night_rainy'?'#4060A0':'#5B8CFF'} strokeWidth="1.5" strokeLinecap="round" opacity="0.6"
              style={{animation:`rainDrop ${0.5+Math.random()*0.5}s linear ${Math.random()*1.5}s infinite`}}/>
          ))}
          {/* Duck */}
          <g transform="translate(380,330)">
            <ellipse cx="0" cy="0" rx="20" ry="14" fill="#FFD700"/>
            <circle cx="16" cy="-8" r="10" fill="#FFD700"/>
            <ellipse cx="22" cy="-7" rx="7" ry="4" fill="#FF8C00"/>
            <circle cx="20" cy="-11" r="2" fill="#333"/>
          </g>
        </svg>
      )

    case 'thunderstorm':
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <style>{`
              @keyframes lightningFlash { 0%,100%{opacity:0} 8%{opacity:1} 16%{opacity:0.3} 24%{opacity:0.8} 32%{opacity:0} }
              @keyframes boltAppear { 0%,60%,100%{opacity:0} 65%{opacity:1} 75%{opacity:0.6} 80%{opacity:0} }
            `}</style>
          </defs>
          {/* Storm clouds - heavy */}
          {[[0,20,160,60],[100,10,180,55],[260,18,170,58],[380,12,150,52]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={['#1a1e2e','#141824','#0f1520','#141824'][i]} opacity="0.95"/>
          ))}
          {[[60,55,140,48],[220,50,160,44],[380,52,130,40]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#0c0f1c" opacity="0.9"/>
          ))}
          {/* Flash overlay */}
          <rect x="0" y="0" width={w} height={h} fill="#8090FF" opacity="0.08"
            style={{animation:'lightningFlash 3.5s ease-in-out infinite'}}/>
          {/* Lightning bolts */}
          <g style={{animation:'boltAppear 3.5s ease-in-out infinite'}}>
            <path d="M320,65 L295,160 L315,160 L282,260" fill="none" stroke="#FFFDE0" strokeWidth="3" strokeLinecap="round"/>
            <path d="M320,65 L295,160 L315,160 L282,260" fill="none" stroke="rgba(255,220,80,0.4)" strokeWidth="8" strokeLinecap="round"/>
          </g>
          <g style={{animation:'boltAppear 3.5s ease-in-out 1.2s infinite'}}>
            <path d="M120,72 L104,148 L118,148 L96,220" fill="none" stroke="#FFFDE0" strokeWidth="2.5" strokeLinecap="round"/>
          </g>
          {/* Ground */}
          <rect x="0" y={h-50} width={w} height="50" fill="#0a0d18"/>
          {/* Puddle reflections */}
          <ellipse cx="160" cy={h-12} rx="80" ry="10" fill="#1020A0" opacity="0.5"/>
          <ellipse cx="380" cy={h-10} rx="60" ry="8"  fill="#1020A0" opacity="0.4"/>
          {/* Rain - heavy */}
          {Array.from({length:45},(_,i)=>(
            <line key={i} x1={10+i*12} y1={-10} x2={-2+i*12} y2={25}
              stroke="#3050A0" strokeWidth="1.8" strokeLinecap="round" opacity="0.7"
              style={{animation:`rainDrop ${0.35+Math.random()*0.3}s linear ${Math.random()*1}s infinite`}}/>
          ))}
        </svg>
      )

    case 'snow':
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <style>{`
              @keyframes snowFall { from{transform:translateY(-20px) translateX(0)} to{transform:translateY(${h+10}px) translateX(25px)} }
              @keyframes snowGlow { 0%,100%{opacity:0.7} 50%{opacity:1} }
            `}</style>
          </defs>
          {/* Snowy clouds */}
          {[[80,50,110,38],[220,36,130,42],[370,44,120,36]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#C8D8E8" opacity="0.85"/>
          ))}
          {[[150,68,90,30],[310,62,100,32]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#D8E8F4" opacity="0.8"/>
          ))}
          {/* Snow ground */}
          <path d={`M0,${h-80} Q${w/4},${h-100} ${w/2},${h-85} Q${w*3/4},${h-95} ${w},${h-80} L${w},${h} L0,${h}Z`} fill="white" opacity="0.95"/>
          <path d={`M0,${h-40} Q${w/3},${h-55} ${w/2},${h-45} Q${w*2/3},${h-52} ${w},${h-40} L${w},${h} L0,${h}Z`} fill="#EEF5FF"/>
          {/* Snowflakes */}
          {Array.from({length:30},(_,i)=>{
            const size=3+Math.random()*6
            return <circle key={i} cx={10+i*17} cy={-10} r={size/2} fill="white" opacity="0.85"
              style={{animation:`snowFall ${3+Math.random()*3}s linear ${Math.random()*4}s infinite`}}/>
          })}
          {/* Snowflake stars */}
          {[[80,200],[200,180],[340,190],[420,205]].map(([x,y],i)=>(
            <text key={i} x={x} y={y} fontSize="24" fill="white" opacity="0.6"
              style={{animation:`snowGlow ${2+i*0.5}s ease-in-out ${i*0.7}s infinite`}}>❄</text>
          ))}
          {/* Trees */}
          {[[40,h-80],[420,h-85]].map(([x,y],i)=>(
            <g key={i}>
              <rect x={(x as number)-5} y={(y as number)+20} width="10" height="30" fill="#5D4037"/>
              <path d={`M${x},${y} L${(x as number)-30},${(y as number)+50} L${(x as number)+30},${(y as number)+50}Z`} fill="#2E7D32"/>
              <path d={`M${x},${(y as number)+20} L${(x as number)-25},${(y as number)+60} L${(x as number)+25},${(y as number)+60}Z`} fill="#388E3C"/>
              {/* Snow on tree */}
              <path d={`M${x},${y} L${(x as number)-22},${(y as number)+42} L${(x as number)+22},${(y as number)+42}Z`} fill="white" opacity="0.7"/>
            </g>
          ))}
        </svg>
      )

    case 'windy':
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <style>{`
              @keyframes leafBlow { from{transform:translateX(-60px) rotate(0deg) translateY(0)} to{transform:translateX(${w+60}px) rotate(540deg) translateY(40px)} }
              @keyframes windLine { 0%{transform:translateX(-100px);opacity:0} 20%{opacity:0.6} 80%{opacity:0.5} 100%{transform:translateX(120px);opacity:0} }
            `}</style>
          </defs>
          {/* Wind streaks */}
          {[[50,80,200],[80,140,160],[60,200,180],[70,280,150],[55,340,170]].map(([h2,y,len],i)=>(
            <path key={i} d={`M-20,${y} Q${len/2},${(y as number)-10} ${len},${y}`}
              fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="h2/30"
              style={{animation:`windLine ${1.5+i*0.3}s ease-in-out ${i*0.4}s infinite`}}/>
          ))}
          {/* Ground */}
          <rect x="0" y={h-60} width={w} height="60" fill="#3D7A3A" opacity="0.9"/>
          <rect x="0" y={h-28} width={w} height="28" fill="#2E6B2B"/>
          {/* Grass blades blowing */}
          {Array.from({length:20},(_,i)=>(
            <path key={i} d={`M${20+i*26},${h-28} C${18+i*26},${h-58} ${30+i*26},${h-72} ${24+i*26},${h-80}`}
              fill="none" stroke="#4CAF50" strokeWidth="2.5" strokeLinecap="round"
              style={{animation:`sway ${0.8+i%3*0.3}s ease-in-out ${(i%5)*0.2}s infinite`}}/>
          ))}
          {/* Leaves */}
          {['#E8A020','#CC4820','#E8C828','#88B840','#D06828'].map((color,i)=>(
            <ellipse key={i} cx={-30+i*20} cy={80+i*25} rx="10" ry="6" fill={color} opacity="0.9"
              style={{animation:`leafBlow ${1.8+i*0.4}s linear ${i*0.6}s infinite`}}/>
          ))}
          {Array.from({length:6},(_,i)=>(
            <ellipse key={i} cx={-20+i*15} cy={150+i*18} rx={8+i} ry={5+i*0.5}
              fill={['#E8A020','#CC4820','#88B840','#D06828','#E8C828','#A04020'][i]}
              opacity="0.85" style={{animation:`leafBlow ${2+i*0.35}s linear ${i*0.5+1}s infinite`}}/>
          ))}
          {/* Bent tree */}
          <path d="M380,h-60 C375,290 365,230 370,160 C375,100 400,80 420,60" fill="none" stroke="#5D4037" strokeWidth="12" strokeLinecap="round"
            style={{transform:`translateY(${h-300}px)`, animation:'sway 1.1s ease-in-out infinite'}}/>
        </svg>
      )

    case 'fog':
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <style>{`@keyframes fogDrift { 0%,100%{transform:translateX(0);opacity:0.18} 50%{transform:translateX(35px);opacity:0.28} }`}</style>
          </defs>
          {/* City silhouette */}
          {[[20,h-120,40,120],[80,h-160,50,160],[150,h-100,35,100],[210,h-180,45,180],[280,h-130,55,130],[360,h-110,40,110],[410,h-150,50,150]].map(([x,y,w2,h2],i)=>(
            <rect key={i} x={x} y={y} width={w2} height={h2} fill="#1a2030" opacity="0.6"/>
          ))}
          {/* Windows */}
          {[[30,h-110],[85,h-140],[155,h-80],[215,h-160],[290,h-110],[365,h-90],[415,h-130]].map(([x,y],i)=>(
            <g key={i}>
              {[[0,0],[10,0],[0,14],[10,14]].map(([dx,dy],j)=>(
                <rect key={j} x={(x as number)+dx} y={(y as number)+dy} width="6" height="8" fill="#FFE566" opacity={Math.random()>0.4?0.7:0.1}/>
              ))}
            </g>
          ))}
          <rect x="0" y={h-40} width={w} height="40" fill="#1a2030" opacity="0.8"/>
          {/* Fog layers */}
          {[0.12,0.28,0.44,0.58,0.72].map((yf,i)=>(
            <rect key={i} x="-10%" y={h*yf} width="130%" height={60+i*15} rx="30"
              fill={`rgba(180,195,210,${0.18+i*0.03})`}
              style={{animation:`fogDrift ${6+i*2}s ease-in-out ${i*1.2}s infinite`}}/>
          ))}
          {/* Lamp post */}
          <g transform={`translate(60,${h-160})`}>
            <rect x="-3" y="0" width="6" height="140" fill="#3a3a4a"/>
            <path d="M-3,0 Q-20,-20 -30,-15" fill="none" stroke="#3a3a4a" strokeWidth="5"/>
            <circle cx="-30" cy="-12" r="10" fill="#FFE566" opacity="0.9" style={{filter:'blur(4px)'}}/>
            <circle cx="-30" cy="-12" r="6"  fill="#FFF8A0"/>
          </g>
        </svg>
      )

    case 'night':
    case 'night_cloudy':
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <style>{`
              @keyframes starTwinkle { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
              @keyframes moonGlow { 0%,100%{filter:blur(3px)} 50%{filter:blur(6px)} }
            `}</style>
          </defs>
          {/* Moon */}
          <circle cx={w*0.78} cy={h*0.18} r="46" fill="#FFF8C0" opacity="0.9"
            style={{filter:'blur(1px)'}}/>
          <circle cx={w*0.78} cy={h*0.18} r="40" fill="#FFF5A0"/>
          <circle cx={w*0.78+18} cy={h*0.18-14} r="36" fill="#1e2535"/>
          {/* Stars */}
          {Array.from({length:55},(_,i)=>{
            const x=Math.random()*w, y=Math.random()*h*0.65
            const size=0.8+Math.random()*2.5
            return <circle key={i} cx={x} cy={y} r={size} fill="white"
              style={{animation:`starTwinkle ${1.5+Math.random()*2.5}s ease-in-out ${Math.random()*3}s infinite`}}/>
          })}
          {/* Star cluster */}
          {[[60,80],[58,72],[68,76],[52,68]].map(([x,y],i)=>(
            <circle key={i} cx={x} cy={y} r="1.5" fill="#FFE566" opacity="0.9"
              style={{animation:`starTwinkle ${1+i*0.4}s ease-in-out ${i*0.3}s infinite`}}/>
          ))}
          {/* Night clouds */}
          {condition==='night_cloudy' && <>
            <ellipse cx="140" cy="80" rx="110" ry="38" fill="#141e2e" opacity="0.85"/>
            <ellipse cx="100" cy="88"  rx="75"  ry="28" fill="#0f1828" opacity="0.8"/>
            <ellipse cx="360" cy="65" rx="90"  ry="32" fill="#141e2e" opacity="0.8"/>
          </>}
          {/* Distant hills silhouette */}
          <path d={`M0,${h-80} Q${w*0.2},${h-150} ${w*0.35},${h-90} Q${w*0.5},${h-160} ${w*0.65},${h-100} Q${w*0.8},${h-145} ${w},${h-85} L${w},${h} L0,${h}Z`}
            fill="#0a0d18" opacity="0.95"/>
          <rect x="0" y={h-40} width={w} height="40" fill="#080b14"/>
          {/* Moon reflection on ground */}
          <ellipse cx={w*0.78} cy={h-20} rx="50" ry="6" fill="#FFE566" opacity="0.08"/>
        </svg>
      )

    case 'cloudy':
    default:
      return (
        <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice"
          style={{ position:'absolute', inset:0 }}>
          <defs>
            <style>{`@keyframes cloudDrift2 { 0%,100%{transform:translateX(0)} 50%{transform:translateX(15px)} }`}</style>
          </defs>
          {/* Multiple cloud layers */}
          {[[50,60,110,40],[200,44,140,48],[380,55,120,42]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#8090A8" opacity="0.7"
              style={{animation:`cloudDrift2 ${5+i*1.5}s ease-in-out ${i*1.2}s infinite`}}/>
          ))}
          {[[100,95,95,36],[280,88,120,40],[440,100,100,34]].map(([cx,cy,rx,ry],i)=>(
            <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#9AA0B2" opacity="0.75"
              style={{animation:`cloudDrift2 ${6+i*1.2}s ease-in-out ${i*0.8}s infinite`}}/>
          ))}
          <rect x="0" y={h-50} width={w} height="50" fill="#3a4050" opacity="0.8"/>
          <rect x="0" y={h-25} width={w} height="25" fill="#2e3445"/>
        </svg>
      )
  }
}
