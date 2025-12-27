import React from 'react';

interface SpoolIconProps {
  color?: string;
  size?: number;
  className?: string;
}

export const SpoolIcon: React.FC<SpoolIconProps> = ({ 
  color = '#333', 
  size = 48,
  className = ''
}) => {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 64 64" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer flange - left */}
      <ellipse cx="16" cy="32" rx="6" ry="16" fill="#9CA3AF" />
      <ellipse cx="16" cy="32" rx="4" ry="12" fill="#D1D5DB" />
      
      {/* Spool body with filament */}
      <rect x="16" y="20" width="32" height="24" rx="2" fill={color} />
      
      {/* Filament wrap lines */}
      <path d="M20 24 L44 24" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <path d="M20 28 L44 28" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <path d="M20 32 L44 32" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <path d="M20 36 L44 36" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <path d="M20 40 L44 40" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      
      {/* Outer flange - right */}
      <ellipse cx="48" cy="32" rx="6" ry="16" fill="#9CA3AF" />
      <ellipse cx="48" cy="32" rx="4" ry="12" fill="#D1D5DB" />
      
      {/* Center hole - left */}
      <ellipse cx="16" cy="32" rx="2" ry="6" fill="#6B7280" />
      
      {/* Center hole - right */}
      <ellipse cx="48" cy="32" rx="2" ry="6" fill="#6B7280" />
      
      {/* Highlight on filament */}
      <rect x="18" y="22" width="28" height="2" rx="1" fill="rgba(255,255,255,0.3)" />
    </svg>
  );
};

// Color mapping for common filament colors
export const SPOOL_COLORS: Record<string, string> = {
  'black': '#1F2937',
  'white': '#F9FAFB',
  'gray': '#6B7280',
  'red': '#DC2626',
  'blue': '#2563EB',
  'green': '#16A34A',
  'yellow': '#EAB308',
  'orange': '#EA580C',
  'purple': '#9333EA',
  'pink': '#EC4899',
  'brown': '#92400E',
  'transparent': '#E5E7EB',
  'שחור': '#1F2937',
  'לבן': '#F9FAFB',
  'אפור': '#6B7280',
  'אדום': '#DC2626',
  'כחול': '#2563EB',
  'ירוק': '#16A34A',
  'צהוב': '#EAB308',
  'כתום': '#EA580C',
  'סגול': '#9333EA',
  'ורוד': '#EC4899',
  'חום': '#92400E',
  'שקוף': '#E5E7EB',
};

export const getSpoolColor = (colorName: string): string => {
  const lowerName = colorName.toLowerCase();
  return SPOOL_COLORS[lowerName] || SPOOL_COLORS[colorName] || '#6B7280';
};

// Get text color style for displaying spool color name
export const getSpoolTextStyle = (colorName: string): React.CSSProperties => {
  const color = getSpoolColor(colorName);
  // For light colors (white, yellow, transparent), use a darker shade for readability
  const lowerName = colorName.toLowerCase();
  const lightColors = ['white', 'לבן', 'yellow', 'צהוב', 'transparent', 'שקוף'];
  
  if (lightColors.includes(lowerName)) {
    // Use a darker version or add text shadow for visibility
    return { 
      color: lowerName.includes('white') || lowerName === 'לבן' ? '#374151' : color,
      textShadow: '0 0 1px rgba(0,0,0,0.3)'
    };
  }
  
  return { color };
};
