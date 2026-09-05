import * as React from "react";
import { cn } from "../lib/utils";

export interface LogoProps extends React.SVGAttributes<SVGElement> {
  size?: number;
}

/**
 * Counter Logo — Icon Only
 *
 * "The Manifest" direction (.impeccable/surfaces/apps-landing.md, seed
 * 4c02ca8d): a customs stamp, not a gradient cube cluster. A single ruled
 * square carries the mark; the notched corner is the fold of a stamped
 * page, the seal-red tab is the disposition mark a manifest line always
 * carries. One flat color plus currentColor — no gradients, no depth.
 */
export function CounterLogo({ size = 32, className, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      {...props}
    >
      {/* Outer manifest square, corner folded like a stamped page */}
      <path
        d="M2 2H30L38 10V38H2V2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Folded corner tab */}
      <path d="M30 2V10H38" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {/* Seal-red disposition mark */}
      <rect x="8" y="24" width="10" height="8" fill="var(--brand-red)" />
      {/* Ledger rule beneath the seal */}
      <path d="M8 34H32" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
    </svg>
  );
}

/**
 * Counter Wordmark — mark + type, set in the display face
 */
export function CounterWordmark({ size = 32, className, ...props }: LogoProps) {
  const width = size * 4.2;
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 168 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d="M2 2H30L38 10V38H2V2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M30 2V10H38" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <rect x="8" y="24" width="10" height="8" fill="var(--brand-red)" />
      <path d="M8 34H32" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />

      <text
        x="50"
        y="27"
        fontFamily="var(--font-display), sans-serif"
        fontSize="20"
        fontWeight="600"
        letterSpacing="-0.02em"
        fill="currentColor"
      >
        counter
      </text>
    </svg>
  );
}
