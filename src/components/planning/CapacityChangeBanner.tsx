import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { RefreshCw, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CapacityChangeBannerProps {
  reason?: string;
  onRecalculate: () => void;
  onDismiss: () => void;
  className?: string;
}

export const CapacityChangeBanner: React.FC<CapacityChangeBannerProps> = ({
  reason,
  onRecalculate,
  onDismiss,
  className,
}) => {
  const { language } = useLanguage();

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 p-4 bg-warning/10 border border-warning/30 rounded-xl",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-warning/20 rounded-lg">
          <RefreshCw className="w-4 h-4 text-warning" />
        </div>
        <div>
          <p className="font-medium text-foreground">
            {language === 'he' ? 'הקיבולת השתנתה' : 'Capacity changed'}
          </p>
          {reason && (
            <p className="text-sm text-muted-foreground">
              {reason}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onDismiss} className="gap-1">
          <Clock className="w-3 h-3" />
          {language === 'he' ? 'מאוחר יותר' : 'Later'}
        </Button>
        <Button size="sm" onClick={onRecalculate} className="gap-1">
          <RefreshCw className="w-3 h-3" />
          {language === 'he' ? 'חשב מחדש' : 'Recalculate'}
        </Button>
      </div>
    </div>
  );
};
