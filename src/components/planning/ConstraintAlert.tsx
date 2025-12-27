// ConstraintAlert Component
// Displays planning constraint violations without guessing solutions

import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock, Package, Shield, Moon } from 'lucide-react';
import { ConstraintViolation, PlanningConstraints, formatHoursToHuman } from '@/services/constraintCalculator';

interface ConstraintAlertProps {
  title: string;
  description: string;
  constraints: PlanningConstraints;
  violations?: ConstraintViolation[];
  className?: string;
}

export const ConstraintAlert: React.FC<ConstraintAlertProps> = ({
  title,
  description,
  constraints,
  violations = [],
  className,
}) => {
  const { language } = useLanguage();
  
  const getViolationIcon = (type: ConstraintViolation['type']) => {
    switch (type) {
      case 'time': return <Clock className="w-4 h-4" />;
      case 'filament': return <Package className="w-4 h-4" />;
      case 'risk': return <Shield className="w-4 h-4" />;
      case 'night': return <Moon className="w-4 h-4" />;
    }
  };
  
  return (
    <Alert variant="destructive" className={className}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="font-semibold">{title}</AlertTitle>
      <AlertDescription className="mt-2 space-y-3">
        <p>{description}</p>
        
        {violations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {violations.map((v, idx) => (
              <Badge 
                key={idx} 
                variant="outline" 
                className="gap-1.5 bg-destructive/5 border-destructive/20"
              >
                {getViolationIcon(v.type)}
                {language === 'he' ? v.details : v.detailsEn}
              </Badge>
            ))}
          </div>
        )}
        
        {/* Constraint requirements box */}
        <div className="p-3 rounded-lg bg-background/80 border border-border/50 mt-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            {language === 'he' ? 'דרישות להמשך היום:' : 'Requirements to continue today:'}
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span>
                {language === 'he' ? 'עד' : 'Max'}{' '}
                <strong>{formatHoursToHuman(constraints.maxCycleHours)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Package className="w-3.5 h-3.5 text-primary" />
              <span>
                {language === 'he' ? 'עד' : 'Max'}{' '}
                <strong>{constraints.maxFilamentGrams}g</strong>
              </span>
            </div>
            {constraints.preferLowRisk && (
              <div className="flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-success" />
                <span>
                  {language === 'he' ? 'סיכון נמוך מומלץ' : 'Low risk preferred'}
                </span>
              </div>
            )}
            {constraints.mustAllowNightCycle && (
              <div className="flex items-center gap-2">
                <Moon className="w-3.5 h-3.5 text-primary" />
                <span>
                  {language === 'he' ? 'מותר בלילה' : 'Night allowed required'}
                </span>
              </div>
            )}
          </div>
        </div>
        
        <p className="text-xs text-muted-foreground italic">
          {language === 'he' 
            ? 'כדי להציע פתרון חלופי, נדרשת פריסת פלטה קצרה יותר.'
            : 'To offer an alternative solution, a shorter plate preset is required.'
          }
        </p>
      </AlertDescription>
    </Alert>
  );
};
