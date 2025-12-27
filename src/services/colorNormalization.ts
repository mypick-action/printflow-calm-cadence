// ============= COLOR NORMALIZATION =============
// Single source of truth for color matching across the system
// Handles: case differences, whitespace, Hebrew variants

/**
 * Hebrew to English color mapping
 * Add new colors as needed
 */
const hebrewToEnglish: Record<string, string> = {
  'ירוק': 'green',
  'לבן': 'white',
  'שחור': 'black',
  'כחול': 'blue',
  'אדום': 'red',
  'צהוב': 'yellow',
  'כתום': 'orange',
  'סגול': 'purple',
  'ורוד': 'pink',
  'אפור': 'gray',
  'גריי': 'gray',
  'חום': 'brown',
  'זהב': 'gold',
  'כסף': 'silver',
  'בז\'': 'beige',
  'בז': 'beige',
  'טורקיז': 'turquoise',
  'ציאן': 'cyan',
  'מג\'נטה': 'magenta',
  'מגנטה': 'magenta',
};

/**
 * Normalize color string for consistent matching
 * This is the ONLY function that should be used for color comparison
 * 
 * @param color - The color string to normalize
 * @returns Normalized lowercase English color key
 * 
 * Examples:
 * - "Green" -> "green"
 * - "ירוק" -> "green"
 * - " White " -> "white"
 * - "PLA Green" -> "pla green" (strips nothing, just lowercases)
 */
export const normalizeColor = (color: string | undefined | null): string => {
  if (!color) return '';
  
  const trimmed = color.trim().toLowerCase();
  
  // Check if it's a Hebrew color word
  if (hebrewToEnglish[trimmed]) {
    return hebrewToEnglish[trimmed];
  }
  
  // Check if the string contains a Hebrew color as part of it
  for (const [hebrew, english] of Object.entries(hebrewToEnglish)) {
    if (trimmed.includes(hebrew)) {
      return trimmed.replace(hebrew, english);
    }
  }
  
  return trimmed;
};

/**
 * Check if two colors match using normalization
 * Use this instead of direct string comparison
 */
export const colorsMatch = (color1: string | undefined | null, color2: string | undefined | null): boolean => {
  return normalizeColor(color1) === normalizeColor(color2);
};

/**
 * Get the display name for a color (for UI purposes)
 * Keeps original casing but trims whitespace
 */
export const getColorDisplayName = (color: string | undefined | null): string => {
  if (!color) return '';
  return color.trim();
};
