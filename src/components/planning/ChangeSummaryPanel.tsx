import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  ChevronDown,
  Plus,
  Minus,
  Printer,
  Package,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { PlanningChange } from '@/services/planningSnapshot';

interface ChangeSummaryPanelProps {
  changes: PlanningChange[];
  hasChanges: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const getChangeIcon = (type: PlanningChange['type']) => {
  switch (type) {
    case 'projects_added':
      return <Plus className="w-4 h-4 text-success" />;
    case 'projects_removed':
      return <Minus className="w-4 h-4 text-muted-foreground" />;
    case 'printers_added':
      return <Printer className="w-4 h-4 text-success" />;
    case 'printers_disabled':
      return <Printer className="w-4 h-4 text-error" />;
    case 'inventory_changed':
      return <SpoolIcon color="#888888" size={16} />;
    case 'schedule_changed':
      return <Clock className="w-4 h-4 text-primary" />;
    case 'warnings_changed':
      return <AlertTriangle className="w-4 h-4 text-warning" />;
    case 'units_changed':
      return <Package className="w-4 h-4 text-primary" />;
    default:
      return <CheckCircle2 className="w-4 h-4 text-muted-foreground" />;
  }
};

export const ChangeSummaryPanel: React.FC<ChangeSummaryPanelProps> = ({
  changes,
  hasChanges,
  isOpen,
  onOpenChange,
}) => {
  const { language } = useLanguage();

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <Card variant="glass" className="border-primary/20">
        <CollapsibleTrigger className="w-full">
          <CardContent className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-success" />
              <span className="font-medium">
                {language === 'he' ? 'מה השתנה מאז החישוב האחרון?' : 'What changed since the last plan?'}
              </span>
              {hasChanges && (
                <Badge variant="secondary" className="text-xs">
                  {changes.length}
                </Badge>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </CardContent>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-2">
            {!hasChanges ? (
              <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                {language === 'he' 
                  ? 'לא זוהו שינויים משמעותיים. החישוב בוצע מחדש כדי לוודא שהתכנון עדכני.'
                  : 'No major changes detected. Plan rebuilt to stay current.'}
              </div>
            ) : (
              changes.map((change, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-2 rounded-lg bg-background border border-border/50"
                >
                  {getChangeIcon(change.type)}
                  <span className="text-sm">
                    {language === 'he' ? change.messageHe : change.messageEn}
                  </span>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};
