import React from 'react';

const R = 9, C = 13;
const nodes = [0, 60, 120, 180, 240, 300].map((deg) => {
  const r = (deg * Math.PI) / 180;
  return [C + Math.cos(r) * R, C + Math.sin(r) * R];
});

export default function Logo() {
  return (
    <svg viewBox="0 0 26 26" style={{ width: 26, height: 26, flex: 'none' }} aria-hidden="true">
      {nodes.map(([x, y], i) => (
        <line key={'l' + i} x1={C} y1={C} x2={x} y2={y} stroke="var(--color-accent-2-600)" strokeWidth="1.4" opacity="0.65" />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={'c' + i} cx={x} cy={y} r="2.6" fill="var(--color-accent-2-500)" />
      ))}
      <circle cx={C} cy={C} r="4.2" fill="var(--color-accent-2-700)" />
    </svg>
  );
}
