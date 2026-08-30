import * as React from "react";
import { cn } from "../lib/utils";

export interface LogoProps extends React.SVGAttributes<SVGElement> {
  size?: number;
}

/**
 * Counter Logo - Icon Only
 * A bold geometric 'C' mark formed by stacked orange gradient cubes/blocks
 * arranged in a distinctive pattern suggesting both a counter (tally) and connectivity.
 * The cubes cascade in a 'C' formation with depth and perspective.
 */
export function CounterLogo({ size = 32, className, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id="counter-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FB923C" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
        <linearGradient id="counter-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#C2410C" />
        </linearGradient>
        <linearGradient id="counter-grad-3" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#EA580C" />
          <stop offset="100%" stopColor="#FB923C" />
        </linearGradient>
      </defs>

      {/* Top row - 3 cubes forming top of C */}
      <rect x="16" y="6" width="10" height="10" rx="2.5" fill="url(#counter-grad-1)" />
      <rect x="28" y="6" width="10" height="10" rx="2.5" fill="url(#counter-grad-2)" />
      <rect
        x="40"
        y="6"
        width="10"
        height="10"
        rx="2.5"
        fill="url(#counter-grad-1)"
        opacity="0.7"
      />

      {/* Upper-left cube */}
      <rect x="6" y="18" width="10" height="10" rx="2.5" fill="url(#counter-grad-2)" />

      {/* Center-left cube with small accent */}
      <rect x="6" y="30" width="10" height="10" rx="2.5" fill="url(#counter-grad-3)" />
      <rect
        x="18"
        y="33"
        width="5"
        height="5"
        rx="1.5"
        fill="url(#counter-grad-1)"
        opacity="0.35"
      />

      {/* Lower-left cube */}
      <rect x="6" y="42" width="10" height="10" rx="2.5" fill="url(#counter-grad-2)" />

      {/* Bottom row - 3 cubes forming bottom of C */}
      <rect
        x="16"
        y="54"
        width="10"
        height="10"
        rx="2.5"
        fill="url(#counter-grad-1)"
        opacity="0.7"
      />
      <rect x="28" y="54" width="10" height="10" rx="2.5" fill="url(#counter-grad-2)" />
      <rect x="40" y="54" width="10" height="10" rx="2.5" fill="url(#counter-grad-1)" />

      {/* Accent dots - connectivity nodes */}
      <circle cx="54" cy="14" r="2.5" fill="url(#counter-grad-1)" opacity="0.5" />
      <circle cx="54" cy="56" r="2.5" fill="url(#counter-grad-1)" opacity="0.5" />
    </svg>
  );
}

/**
 * Counter Wordmark - Full logo with text
 */
export function CounterWordmark({ size = 32, className, ...props }: LogoProps) {
  const width = size * 4.5;
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 288 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id="wm-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FB923C" />
          <stop offset="100%" stopColor="#EA580C" />
        </linearGradient>
        <linearGradient id="wm-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#C2410C" />
        </linearGradient>
        <linearGradient id="wm-grad-3" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#EA580C" />
          <stop offset="100%" stopColor="#FB923C" />
        </linearGradient>
      </defs>

      {/* Icon - compact C shape */}
      <rect x="12" y="8" width="8" height="8" rx="2" fill="url(#wm-grad-1)" />
      <rect x="22" y="8" width="8" height="8" rx="2" fill="url(#wm-grad-2)" />
      <rect x="32" y="8" width="8" height="8" rx="2" fill="url(#wm-grad-1)" opacity="0.7" />

      <rect x="6" y="18" width="8" height="8" rx="2" fill="url(#wm-grad-2)" />
      <rect x="6" y="28" width="8" height="8" rx="2" fill="url(#wm-grad-3)" />
      <rect x="6" y="38" width="8" height="8" rx="2" fill="url(#wm-grad-2)" />

      <rect x="12" y="48" width="8" height="8" rx="2" fill="url(#wm-grad-1)" opacity="0.7" />
      <rect x="22" y="48" width="8" height="8" rx="2" fill="url(#wm-grad-2)" />
      <rect x="32" y="48" width="8" height="8" rx="2" fill="url(#wm-grad-1)" />

      <circle cx="43" cy="14" r="2" fill="url(#wm-grad-1)" opacity="0.5" />
      <circle cx="43" cy="52" r="2" fill="url(#wm-grad-1)" opacity="0.5" />

      {/* Wordmark text */}
      <text
        x="64"
        y="42"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="28"
        fontWeight="700"
        letterSpacing="-0.5"
        fill="currentColor"
      >
        counter
      </text>
    </svg>
  );
}
