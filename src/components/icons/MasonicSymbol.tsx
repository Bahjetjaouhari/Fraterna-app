import React from "react";

interface MasonicSymbolProps {
  className?: string;
  size?: number;
}

export const MasonicSymbol: React.FC<MasonicSymbolProps> = ({ 
  className = "", 
  size = 48 
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Square */}
      <path
        d="M20 80 L20 35 L50 35"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Compass */}
      <path
        d="M50 15 L25 80"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M50 15 L75 80"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* G Letter */}
      <circle
        cx="50"
        cy="50"
        r="12"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />
      <text
        x="50"
        y="55"
        textAnchor="middle"
        fontSize="14"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="Cinzel, serif"
      >
        G
      </text>
    </svg>
  );
};

export const AllSeeingEye: React.FC<MasonicSymbolProps> = ({ 
  className = "", 
  size = 48 
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Triangle */}
      <path
        d="M50 10 L90 85 L10 85 Z"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      {/* Eye */}
      <ellipse
        cx="50"
        cy="55"
        rx="18"
        ry="12"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />
      {/* Pupil */}
      <circle
        cx="50"
        cy="55"
        r="6"
        fill="currentColor"
      />
      {/* Rays */}
      <g stroke="currentColor" strokeWidth="2" opacity="0.6">
        <line x1="50" y1="30" x2="50" y2="20" />
        <line x1="35" y1="35" x2="28" y2="28" />
        <line x1="65" y1="35" x2="72" y2="28" />
      </g>
    </svg>
  );
};

export default MasonicSymbol;
