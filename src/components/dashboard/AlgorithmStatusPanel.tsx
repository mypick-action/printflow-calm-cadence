import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Cpu, CheckCircle2, XCircle } from 'lucide-react';

interface AlgorithmStatusProps {
  className?: string;
}

export const AlgorithmStatusPanel: React.FC<AlgorithmStatusProps> = ({ className }) => {
  const { language } = useLanguage();
  
  // V2-ONLY: Legacy has been removed, this is now just a status display
  const status = {
    activeAlgorithm: 'V2_PROJECT_CENTRIC',
    legacyPresent: false,
    singleSourceOfTruth: true,
  };

  return (
    <Card variant="elevated" className={className}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Cpu className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">
            {language === 'he' ? 'סטטוס אלגוריתם' : 'Algorithm Status'}
          </span>
        </div>
        
        <div className="space-y-2 text-xs">
          {/* Active Algorithm */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {language === 'he' ? 'אלגוריתם פעיל' : 'Active Algorithm'}
            </span>
            <Badge variant="default" className="font-mono text-[10px]">
              V2
            </Badge>
          </div>
          
          {/* Legacy Status */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {language === 'he' ? 'Legacy קוד' : 'Legacy Code'}
            </span>
            <div className="flex items-center gap-1">
              {status.legacyPresent ? (
                <>
                  <XCircle className="w-3 h-3 text-destructive" />
                  <span className="text-destructive">YES</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 text-success" />
                  <span className="text-success">REMOVED</span>
                </>
              )}
            </div>
          </div>
          
          {/* Single Source of Truth */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {language === 'he' ? 'מקור אמת יחיד' : 'Single Source'}
            </span>
            <div className="flex items-center gap-1">
              {status.singleSourceOfTruth ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-success" />
                  <span className="text-success">✓</span>
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3 text-destructive" />
                  <span className="text-destructive">✗</span>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
