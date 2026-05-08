import React from 'react';
import Svg, { Circle, Path, G, Defs, RadialGradient, Stop, Line, Ellipse } from 'react-native-svg';
import { WeatherCondition } from '../../types/weather';

interface Props {
  condition: WeatherCondition;
  size?: number;
}

export default function WeatherIcon({ condition, size = 32 }: Props) {
  const s = size;
  const cx = s / 2;
  const cy = s / 2;

  switch (condition) {
    case 'sunny':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Defs>
            <RadialGradient id="sg" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#FFE580" />
              <Stop offset="100%" stopColor="#FFB830" />
            </RadialGradient>
          </Defs>
          <Circle cx="16" cy="16" r="7" fill="url(#sg)" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
            const rad = (angle * Math.PI) / 180;
            const x1 = 16 + 10 * Math.cos(rad);
            const y1 = 16 + 10 * Math.sin(rad);
            const x2 = 16 + 14 * Math.cos(rad);
            const y2 = 16 + 14 * Math.sin(rad);
            return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFB830" strokeWidth="2" strokeLinecap="round" />;
          })}
        </Svg>
      );

    case 'partly_cloudy':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Circle cx="20" cy="13" r="6" fill="#FFD060" opacity="0.9" />
          <Path d="M6,22 C6,17 10,14 14,14 C14,11 17,9 20,10 C24,10 26,13 25,16 C27,16 28,18 27,20 C27,21 26,22 25,22 Z" fill="white" />
          <Path d="M6,22 C6,17 10,14 14,14 C14,11 17,9 20,10 C24,10 26,13 25,16 C27,16 28,18 27,20 C27,21 26,22 25,22 Z" fill="#DDE8F8" opacity="0.5" />
        </Svg>
      );

    case 'cloudy':
    case 'night_cloudy':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Path d="M4,22 C4,17 8,13 13,13 C13,10 16,8 20,9 C24,9 26,12 25,15 C28,15 30,18 29,21 C29,22 28,23 27,23 L6,23 C5,23 4,22.5 4,22 Z" fill="#B0C4D8" />
          <Path d="M8,24 C8,20 11,17 15,17 C15,15 17,13 20,14 C23,14 25,16 24,19 C27,19 28,21 27,23 H9 C8.5,23 8,23 8,22 Z" fill="#DDE8F8" />
        </Svg>
      );

    case 'rainy':
    case 'night_rainy':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Path d="M5,16 C5,11 9,8 14,8 C14,6 17,4 20,5 C24,5 26,8 25,11 C28,11 29,14 28,17 L6,17 C5.5,17 5,16.5 5,16 Z" fill="#A0B8D0" />
          {[[10, 20, 8, 28], [16, 19, 14, 27], [22, 20, 20, 28]].map(([x1, y1, x2, y2], i) => (
            <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5B8CFF" strokeWidth="2" strokeLinecap="round" />
          ))}
        </Svg>
      );

    case 'thunderstorm':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Path d="M4,14 C4,9 8,6 13,6 C13,4 16,2 19,3 C23,3 25,6 24,9 C27,9 28,12 27,15 L5,15 C4.5,15 4,14.5 4,14 Z" fill="#555570" />
          <Path d="M18,16 L14,23 L17,23 L13,30 L22,21 L18,21 L21,16 Z" fill="#FFE566" />
        </Svg>
      );

    case 'snow':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Path d="M5,16 C5,11 9,8 14,8 C14,6 17,4 20,5 C24,5 26,8 25,11 C28,11 29,14 28,17 L6,17 C5.5,17 5,16.5 5,16 Z" fill="#C8DDF0" />
          {[[10, 22], [16, 21], [22, 22], [13, 27], [19, 27]].map(([x, y], i) => (
            <G key={i}>
              <Circle cx={x} cy={y} r="2" fill="white" opacity="0.9" />
            </G>
          ))}
        </Svg>
      );

    case 'windy':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          {[[4, 12, 22, 12, 24, 10], [4, 17, 26, 17, 28, 15], [4, 22, 20, 22, 22, 20]].map(([x1, y1, x2, y2, cx2, cy2], i) => (
            <Path key={i} d={`M${x1},${y1} L${x2},${y2} C${x2},${y2} ${cx2},${cy2} ${cx2 + 2},${Number(cy2) - 2}`}
              fill="none" stroke="#81ECEC" strokeWidth="2.5" strokeLinecap="round" />
          ))}
        </Svg>
      );

    case 'fog':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          {[8, 13, 18, 23].map((y, i) => (
            <Path key={i} d={`M4,${y} L${24 + (i % 2) * 4},${y}`}
              fill="none" stroke="#B2BEC3" strokeWidth="2" strokeLinecap="round" opacity={0.5 + i * 0.1} />
          ))}
        </Svg>
      );

    case 'night':
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Path d="M22,16 C18,16 15,13 15,9 C15,7 16,5 17,4 C12,4 8,8 8,14 C8,19 12,23 18,23 C22,23 25,21 27,17 C26,17 24,16 22,16 Z" fill="#C8B4F0" />
          <Circle cx="24" cy="8" r="1.5" fill="#FFE566" opacity="0.8" />
          <Circle cx="28" cy="14" r="1" fill="#FFE566" opacity="0.6" />
        </Svg>
      );

    default:
      return (
        <Svg width={s} height={s} viewBox="0 0 32 32">
          <Circle cx="16" cy="16" r="10" fill="#74B9FF" opacity="0.7" />
        </Svg>
      );
  }
}
