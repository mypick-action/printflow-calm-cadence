import React, { forwardRef } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { getPlanningMeta } from '@/services/storage';
import { cn } from '@/lib/utils';

interface RecalculateButtonProps {
  onClick: () => void;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  showLastCalculated?: boolean;
}

export const RecalculateButton = forwardRef<HTMLDivElement, RecalculateButtonProps>(({
  onClick,
  className,
  variant = 'outline',
  showLastCalculated = true,
}, ref) => {
  const { language } = useLanguage();
  const meta = getPlanningMeta();

  return (
    <div ref={ref} className={cn("flex items-center gap-3", className)}>
      {showLastCalculated && meta.lastRecalculatedAt && (
        <span className="text-xs text-muted-foreground">
          {language === 'he' ? 'חושב לאחרונה:' : 'Last calculated:'}{' '}
          {format(new Date(meta.lastRecalculatedAt), 'HH:mm')}
        </span>
      )}
      <Button variant={variant} onClick={onClick} className="gap-2">
        <RefreshCw className="w-4 h-4" />
        {language === 'he' ? 'חישוב מחדש' : 'Recalculate Planning'}
      </Button>
    </div>
  );
});

RecalculateButton.displayName = 'RecalculateButton';
