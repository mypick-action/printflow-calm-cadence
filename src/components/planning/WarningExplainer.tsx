import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { 
  AlertTriangle,
  Info,
  ArrowRight,
  Package,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { SpoolIcon } from '@/components/icons/SpoolIcon';
import { PlanningWarning } from '@/services/planningEngine';

interface WarningExplainerProps {
  warnings: PlanningWarning[];
  onNavigateToProjects?: () => void;
  onNavigateToInventory?: () => void;
  onRecalculate?: () => void;
}

interface WarningWithAction {
  warning: PlanningWarning;
  explanationHe: string;
  explanationEn: string;
  actionHe: string;
  actionEn: string;
  actionType: 'projects' | 'inventory' | 'recalculate' | 'none';
}

const getWarningDetails = (warning: PlanningWarning): Omit<WarningWithAction, 'warning'> => {
  switch (warning.type) {
    case 'material_low':
      return {
        explanationHe: 'כמות הפילמנט עשויה לא להספיק להשלמת כל המחזורים המתוכננים.',
        explanationEn: 'Filament quantity may not be enough to complete all planned cycles.',
        actionHe: 'בדוק מלאי ושקול להזמין',
        actionEn: 'Check inventory and consider ordering',
        actionType: 'inventory',
      };
    case 'deadline_risk':
      return {
        explanationHe: 'הזמן הזמין עלול לא להספיק להשלמת הפרויקט עד תאריך היעד.',
        explanationEn: 'Available time may not be enough to complete the project by due date.',
        actionHe: 'עדכן עדיפות או הארך תאריך',
        actionEn: 'Update priority or extend deadline',
        actionType: 'projects',
      };
    case 'capacity_unused':
      return {
        explanationHe: 'יש קיבולת מדפסות שלא מנוצלת. ניתן לקבל פרויקטים נוספים.',
        explanationEn: 'Printer capacity is underutilized. Can accept more projects.',
        actionHe: 'הוסף פרויקטים או חשב מחדש',
        actionEn: 'Add projects or recalculate',
        actionType: 'recalculate',
      };
    case 'printer_overload':
      return {
        explanationHe: 'מדפסת אחת או יותר עמוסות מעבר לקיבולת הרגילה.',
        explanationEn: 'One or more printers are loaded beyond normal capacity.',
        actionHe: 'פזר עומס או הוסף מדפסת',
        actionEn: 'Distribute load or add printer',
        actionType: 'recalculate',
      };
    default:
      return {
        explanationHe: 'נמצאה בעיה שדורשת תשומת לב.',
        explanationEn: 'An issue was found that needs attention.',
        actionHe: 'בדוק פרטים',
        actionEn: 'Check details',
        actionType: 'none',
      };
  }
};

const getWarningIcon = (type: PlanningWarning['type']) => {
  switch (type) {
    case 'material_low':
      return <SpoolIcon color="#f59e0b" size={18} />;
    case 'deadline_risk':
      return <AlertTriangle className="w-[18px] h-[18px] text-warning" />;
    case 'capacity_unused':
      return <Printer className="w-[18px] h-[18px] text-primary" />;
    case 'printer_overload':
      return <Printer className="w-[18px] h-[18px] text-error" />;
    default:
      return <AlertTriangle className="w-[18px] h-[18px] text-warning" />;
  }
};

export const WarningExplainer: React.FC<WarningExplainerProps> = ({
  warnings,
  onNavigateToProjects,
  onNavigateToInventory,
  onRecalculate,
}) => {
  const { language } = useLanguage();

  if (warnings.length === 0) return null;

  const warningsWithActions: WarningWithAction[] = warnings.map(w => ({
    warning: w,
    ...getWarningDetails(w),
  }));

  const handleAction = (actionType: WarningWithAction['actionType']) => {
    switch (actionType) {
      case 'projects':
        onNavigateToProjects?.();
        break;
      case 'inventory':
        onNavigateToInventory?.();
        break;
      case 'recalculate':
        onRecalculate?.();
        break;
    }
  };

  // Tooltip for the warnings header
  const warningTooltipText = language === 'he' 
    ? 'אזהרה = משהו שעלול לעכב. לא חסם מלא, אבל צריך תשומת לב.'
    : 'Warning = might cause delay. Not a full block, but needs attention.';

  return (
    <div className="space-y-3">
      {/* Header with info tooltip */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-warning" />
        <span className="font-medium text-warning">
          {language === 'he' ? `${warnings.length} אזהרות` : `${warnings.length} Warning(s)`}
        </span>
        
        {/* Desktop tooltip */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="hidden sm:flex h-6 w-6">
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {warningTooltipText}
          </TooltipContent>
        </Tooltip>
        
        {/* Mobile popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="sm:hidden h-6 w-6">
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-sm">
            {warningTooltipText}
          </PopoverContent>
        </Popover>
      </div>

      {/* Warning cards */}
      <div className="space-y-2">
        {warningsWithActions.map((item, index) => (
          <div
            key={index}
            className="p-3 rounded-lg border border-warning/30 bg-warning/5 space-y-2"
          >
            {/* Warning header */}
            <div className="flex items-start gap-2">
              {getWarningIcon(item.warning.type)}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {language === 'he' ? item.warning.message : item.warning.messageEn}
                </p>
              </div>
              <Badge 
                variant="outline" 
                className={`text-xs shrink-0 ${
                  item.warning.severity === 'error' 
                    ? 'bg-error/10 text-error border-error/20' 
                    : item.warning.severity === 'warn'
                    ? 'bg-warning/10 text-warning border-warning/20'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {item.warning.severity === 'error' 
                  ? (language === 'he' ? 'חמור' : 'Severe')
                  : item.warning.severity === 'warn'
                  ? (language === 'he' ? 'אזהרה' : 'Warning')
                  : (language === 'he' ? 'מידע' : 'Info')}
              </Badge>
            </div>
            
            {/* Explanation */}
            <p className="text-xs text-muted-foreground ps-6">
              {language === 'he' ? item.explanationHe : item.explanationEn}
            </p>
            
            {/* Action button */}
            {item.actionType !== 'none' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 ms-4"
                onClick={() => handleAction(item.actionType)}
              >
                {language === 'he' ? item.actionHe : item.actionEn}
                <ArrowRight className="w-3 h-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
