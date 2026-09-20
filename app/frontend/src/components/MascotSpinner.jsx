import React from 'react';

// Loading placeholder: the Saplink mascot's artwork (same paths as Mascot.jsx,
// idle bar eyes, no cursor tracking) jumping in place. The jump keyframes live
// in index.css (`mascot-jump`).
export default function MascotSpinner({ size = 84 }) {
  return (
    <svg className="mascot-spinner" viewBox="200 140 320 420" width={size} height={size * 1.3125} role="img" aria-label="Loading">
      <g stroke="#8a5a3a" strokeWidth="11" strokeLinecap="round" fill="none">
        <path d="M331 500 L333 527" /><path d="M395 498 L398 525" />
      </g>
      <ellipse cx="362" cy="388" rx="141" ry="113" fill="#b98b67" stroke="#8a5a3a" strokeWidth="10" />
      <path d="M355 294 Q349 252 353 218" stroke="#6fa07e" strokeWidth="11" strokeLinecap="round" fill="none" />
      <path d="M262 222 Q300 196 351 217 Q352 232 340 238 Q300 250 262 222Z" fill="#86bb96" />
      <path d="M279 222 L344 224" stroke="#bfe0c7" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <path d="M350 220 Q366 166 443 158 Q441 214 386 224 Q365 227 350 220Z" fill="#86bb96" />
      <path d="M362 217 L430 168" stroke="#bfe0c7" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <path d="M254 358 Q262 308 332 299" stroke="#d0ad8e" strokeWidth="12" strokeLinecap="round" fill="none" opacity=".85" />
      <g stroke="#4a2e1c" strokeWidth="10" strokeLinecap="round" fill="none">
        <path d="M323 347 L325 389" /><path d="M398 346 L400 390" />
      </g>
    </svg>
  );
}
