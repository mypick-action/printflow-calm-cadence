import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigation } from '@/contexts/NavigationContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { 
  Package, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  XCircle,
  ChevronDown,
  ChevronUp,
  Printer as PrinterIcon,
} from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { generateLoadRecommendations, LoadRecommendationsResult, getActionSummary } from '@/services/loadRecommendations';
import { getSpools, getPrinters, LoadRecommendation, MaterialShortage } from '@/services/storage';
import { subscribeToInventoryChanges } from '@/services/inventoryEvents';

interface LoadRecommendationsPanelProps {
  onRefresh?: () => void;
}

export const LoadRecommendationsPanel: React.FC<LoadRecommendationsPanelProps> = ({ onRefresh }) => {
  const { language } = useLanguage();
  const { navigateTo } = useNavigation();
  const [result, setResult] = useState<LoadRecommendationsResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  const refreshRecommendations = useCallback(() => {
    const recommendations = generateLoadRecommendations();
    setResult(recommendations);
    onRefresh?.();
  }, [onRefresh]);

  // Refresh on mount
  useEffect(() => {
    refreshRecommendations();
  }, [refreshRecommendations]);

  // Subscribe to inventory changes - refresh immediately when inventory updates
  useEffect(() => {
    const unsubscribe = subscribeToInventoryChanges(() => {
      refreshRecommendations();
    });
    return unsubscribe;
  }, [refreshRecommendations]);

  if (!result) return null;

  const { recommendations, materialShortages, summary } = result;
  const actionSummary = getActionSummary(result);

  // If all cycles are ready, show a minimal success state
  if (!actionSummary.hasActions && summary.totalCycles > 0) {
    return (
      <Alert className="border-success/30 bg-success/5">
        <CheckCircle className="h-4 w-4 text-success" />
        <AlertTitle className="text-success">
          {language === 'he' ? 'מוכן לביצוע' : 'Ready to Execute'}
        </AlertTitle>
        <AlertDescription>
          {language === 'he' ? actionSummary.message : actionSummary.messageEn}
        </AlertDescription>
      </Alert>
    );
  }

  if (summary.totalCycles === 0) {
    return null; // No cycles, no panel
  }

  return (
    <Card variant="elevated" className="border-warning/30">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-warning" />
            <CardTitle className="text-base">
              {language === 'he' ? 'פעולות נדרשות' : 'Required Actions'}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {/* Summary badges */}
            <div className="flex items-center gap-1">
              {summary.cyclesReady > 0 && (
                <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-xs">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  {summary.cyclesReady}
                </Badge>
              )}
              {summary.cyclesWaitingForSpool > 0 && (
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
                  <Clock className="w-3 h-3 mr-1" />
                  {summary.cyclesWaitingForSpool}
                </Badge>
              )}
              {summary.cyclesBlockedInventory > 0 && (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-xs">
                  <XCircle className="w-3 h-3 mr-1" />
                  {summary.cyclesBlockedInventory}
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 pt-2 space-y-4">
          {/* Material Shortages - Critical alerts first */}
          {materialShortages.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-destructive flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" />
                {language === 'he' ? 'חסר חומר גלם' : 'Material Shortage'}
              </h4>
              {materialShortages.map((shortage, idx) => (
                <ShortageAlert key={idx} shortage={shortage} language={language} />
              ))}
            </div>
          )}

          {/* Load Recommendations */}
          {recommendations.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-warning flex items-center gap-1">
                <Package className="w-4 h-4" />
                {language === 'he' ? 'הנחיות טעינה' : 'Load Instructions'}
              </h4>
              {recommendations.map((rec) => (
                <RecommendationCard 
                  key={rec.id} 
                  recommendation={rec} 
                  language={language}
                  onClick={() => {
                    console.log('[LoadRecommendationsPanel] onClick called for:', rec.printerId, rec.printerName);
                    console.log('[LoadRecommendationsPanel] Calling navigateTo("printers", ...)', { openPrinterId: rec.printerId, focusField: 'mountColor' });
                    navigateTo('printers', { openPrinterId: rec.printerId, focusField: 'mountColor' });
                    console.log('[LoadRecommendationsPanel] navigateTo completed');
                  }}
                />
              ))}
            </div>
          )}

          {/* Summary Stats */}
          <div className="flex items-center justify-between pt-2 border-t text-sm text-muted-foreground">
            <span>
              {language === 'he' 
                ? `${summary.totalCycles} מחזורים מתוכננים`
                : `${summary.totalCycles} cycles planned`}
            </span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-success" />
                {summary.cyclesReady} {language === 'he' ? 'מוכנים' : 'ready'}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-warning" />
                {summary.cyclesWaitingForSpool} {language === 'he' ? 'ממתינים' : 'waiting'}
              </span>
              {summary.cyclesBlockedInventory > 0 && (
                <span className="flex items-center gap-1">
                  <XCircle className="w-3 h-3 text-destructive" />
                  {summary.cyclesBlockedInventory} {language === 'he' ? 'חסומים' : 'blocked'}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

// Sub-components

const ShortageAlert: React.FC<{ shortage: MaterialShortage; language: string }> = ({ shortage, language }) => {
  return (
    <Alert variant="destructive" className="py-2">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">
        {language === 'he' 
          ? `חסר ${shortage.color}` 
          : `${shortage.color} shortage`}
      </AlertTitle>
      <AlertDescription className="text-xs space-y-1">
        <div>
          {language === 'he'
            ? `נדרש: ${Math.ceil(shortage.requiredGrams)}g | זמין: ${Math.ceil(shortage.availableGrams)}g | חסר: ${Math.ceil(shortage.shortfallGrams)}g`
            : `Required: ${Math.ceil(shortage.requiredGrams)}g | Available: ${Math.ceil(shortage.availableGrams)}g | Short: ${Math.ceil(shortage.shortfallGrams)}g`}
        </div>
        <div className="text-muted-foreground">
          {language === 'he' ? 'פרויקטים מושפעים: ' : 'Affected projects: '}
          {shortage.affectedProjectNames.join(', ')}
        </div>
      </AlertDescription>
    </Alert>
  );
};

interface RecommendationCardProps {
  recommendation: LoadRecommendation;
  language: string;
  onClick?: () => void;
}

const RecommendationCard: React.FC<RecommendationCardProps> = ({ recommendation, language, onClick }) => {
  const spools = getSpools();
  const suggestedSpools = spools.filter(s => recommendation.suggestedSpoolIds.includes(s.id));

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[RecommendationCard] Navigating to printers for:', recommendation.printerId);
    onClick?.();
  };

  return (
    <button 
      type="button"
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        recommendation.priority === 'high' && "border-warning/50 bg-warning/5",
        recommendation.priority === 'medium' && "border-muted bg-muted/30",
        recommendation.priority === 'low' && "border-border bg-background",
        "cursor-pointer hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-primary"
      )}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <PrinterIcon className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{recommendation.printerName}</span>
        </div>
        <Badge 
          variant="outline" 
          className={cn(
            "text-xs",
            recommendation.priority === 'high' && "bg-warning/10 text-warning border-warning/30",
            recommendation.priority === 'medium' && "bg-muted text-muted-foreground",
            recommendation.priority === 'low' && "bg-background text-muted-foreground",
          )}
        >
          {recommendation.priority === 'high' && (language === 'he' ? 'דחוף' : 'Urgent')}
          {recommendation.priority === 'medium' && (language === 'he' ? 'רגיל' : 'Normal')}
          {recommendation.priority === 'low' && (language === 'he' ? 'נמוך' : 'Low')}
        </Badge>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <SpoolIcon color={getSpoolColor(recommendation.color)} size={16} />
        <span className="text-sm">
          {language === 'he' 
            ? recommendation.message 
            : recommendation.messageEn}
        </span>
      </div>

      {/* Suggested spools from inventory */}
      {suggestedSpools.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed">
          <span className="text-xs text-muted-foreground">
            {language === 'he' ? 'גלילים מומלצים מהמלאי:' : 'Suggested spools from inventory:'}
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {suggestedSpools.map(spool => (
              <Badge key={spool.id} variant="secondary" className="text-xs">
            {spool.color} ({Math.ceil(spool.gramsRemainingEst)}g)
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 text-xs text-muted-foreground">
        {language === 'he' 
          ? `משפיע על ${recommendation.affectedCycleIds.length} מחזורים`
          : `Affects ${recommendation.affectedCycleIds.length} cycles`}
        {recommendation.affectedProjectNames.length > 0 && (
          <span> • {recommendation.affectedProjectNames.slice(0, 2).join(', ')}</span>
        )}
      </div>
    </button>
  );
};

export default LoadRecommendationsPanel;
