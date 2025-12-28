import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
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
  ArrowRight,
} from 'lucide-react';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { generateLoadRecommendations, LoadRecommendationsResult, getActionSummary } from '@/services/loadRecommendations';
import { 
  getColorInventory, 
  getColorInventoryItem,
  setOpenTotalGrams,
  openNewSpool,
  LoadRecommendation, 
  MaterialShortage,
  getTotalGrams,
} from '@/services/storage';
import { subscribeToInventoryChanges } from '@/services/inventoryEvents';
import { toast } from '@/hooks/use-toast';

interface LoadRecommendationsPanelProps {
  onRefresh?: () => void;
  /** If true, shows full details. If false, shows only indicator with link to Printers page */
  showFullDetails?: boolean;
}

export const LoadRecommendationsPanel: React.FC<LoadRecommendationsPanelProps> = ({ onRefresh, showFullDetails = false }) => {
  const { language } = useLanguage();
  const [result, setResult] = useState<LoadRecommendationsResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  const refreshRecommendations = useCallback(() => {
    const recommendations = generateLoadRecommendations();
    setResult(recommendations);
  }, []);

  // Refresh on mount
  useEffect(() => {
    refreshRecommendations();
    onRefresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to inventory changes - refresh immediately when inventory updates
  useEffect(() => {
    const unsubscribe = subscribeToInventoryChanges(() => {
      const recommendations = generateLoadRecommendations();
      setResult(recommendations);
    });
    return unsubscribe;
  }, []);

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

  const hasLoadActions = recommendations.length > 0 || materialShortages.length > 0;

  // Compact indicator mode - just shows that action is needed with link to printers
  if (!showFullDetails && hasLoadActions) {
    return (
      <Alert className="border-warning/30 bg-warning/5">
        <Package className="h-4 w-4 text-warning" />
        <AlertTitle className="text-warning flex items-center gap-2">
          {language === 'he' ? 'נדרשת טעינת גלילים' : 'Spool Loading Required'}
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-xs">
            {recommendations.length + materialShortages.length}
          </Badge>
        </AlertTitle>
        <AlertDescription className="flex items-center justify-between mt-1">
          <span className="text-muted-foreground">
            {language === 'he' 
              ? 'יש לגשת לדף מדפסות ולהזין לפי הרשימה' 
              : 'Go to Printers page and load according to the list'}
          </span>
          <Link 
            to="/printers" 
            className="text-primary hover:underline text-sm font-medium flex items-center gap-1"
          >
            {language === 'he' ? 'לדף מדפסות' : 'Go to Printers'}
            <ArrowRight className="w-3 h-3" />
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  // Full details mode - shows all recommendations
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
                  onActionComplete={refreshRecommendations}
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
  onActionComplete?: () => void;
}

const RecommendationCard: React.FC<RecommendationCardProps> = ({ recommendation, language, onActionComplete }) => {
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [loadChoice, setLoadChoice] = useState<'open' | 'new' | null>(null);
  const [openGramsInput, setOpenGramsInput] = useState(0);
  
  // Get color inventory for this recommendation
  const inventoryItem = getColorInventoryItem(recommendation.color, recommendation.material || 'PLA');
  const totalAvailable = inventoryItem ? getTotalGrams(inventoryItem) : 0;
  
  const handleUseOpen = () => {
    setLoadChoice('open');
    setOpenGramsInput(inventoryItem?.openTotalGrams || 0);
    setLoadDialogOpen(true);
  };
  
  const handleOpenNew = () => {
    setLoadChoice('new');
    setLoadDialogOpen(true);
  };
  
  const confirmLoad = () => {
    const material = recommendation.material || 'PLA';
    
    if (loadChoice === 'open') {
      // Update open grams to what user reported
      setOpenTotalGrams(recommendation.color, material, openGramsInput);
      toast({
        title: language === 'he' ? 'גליל פתוח נטען' : 'Open spool loaded',
        description: `${recommendation.color} - ${openGramsInput}g`,
      });
    } else if (loadChoice === 'new') {
      // Open a new closed spool
      const result = openNewSpool(recommendation.color, material);
      if (result) {
        toast({
          title: language === 'he' ? 'גליל חדש נפתח' : 'New spool opened',
          description: `${recommendation.color} - +${inventoryItem?.closedSpoolSizeGrams || 1000}g`,
        });
      } else {
        toast({
          title: language === 'he' ? 'אין גלילים סגורים' : 'No closed spools available',
          variant: 'destructive',
        });
      }
    }
    
    setLoadDialogOpen(false);
    setLoadChoice(null);
    onActionComplete?.();
  };

  return (
    <>
      <div className={cn(
        "p-3 rounded-lg border",
        recommendation.priority === 'high' && "border-warning/50 bg-warning/5",
        recommendation.priority === 'medium' && "border-muted bg-muted/30",
        recommendation.priority === 'low' && "border-border bg-background",
      )}>
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
          <span className="text-sm font-medium">{recommendation.color}</span>
        </div>

        {/* Grams info */}
        <div className="mt-2 p-2 bg-muted/50 rounded text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {language === 'he' ? 'עבודה נוכחית:' : 'Current job:'}
            </span>
            <span className="font-medium">{Math.ceil(recommendation.gramsNeeded)}g</span>
          </div>
          {recommendation.sequentialCyclesCount && recommendation.sequentialCyclesCount > 1 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {language === 'he' 
                  ? `סה"כ ${recommendation.sequentialCyclesCount} עבודות:`
                  : `Total ${recommendation.sequentialCyclesCount} jobs:`}
              </span>
              <span className="font-medium">{Math.ceil(recommendation.totalGramsForSequence || 0)}g</span>
            </div>
          )}
        </div>

        {/* Color Inventory Status */}
        {inventoryItem && (
          <div className="mt-2 p-2 bg-background rounded border text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {language === 'he' ? 'פתוחים זמינים:' : 'Open available:'}
              </span>
              <span className="font-medium">{inventoryItem.openTotalGrams}g</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {language === 'he' ? 'גלילים סגורים:' : 'Closed spools:'}
              </span>
              <span className="font-medium">{inventoryItem.closedCount}</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-3 flex gap-2">
          {inventoryItem && inventoryItem.openTotalGrams > 0 && (
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1"
              onClick={handleUseOpen}
            >
              {language === 'he' ? 'השתמש בפתוח' : 'Use Open'}
            </Button>
          )}
          {inventoryItem && inventoryItem.closedCount > 0 && (
            <Button 
              variant="default" 
              size="sm" 
              className="flex-1"
              onClick={handleOpenNew}
            >
              {language === 'he' ? 'פתח חדש' : 'Open New'}
            </Button>
          )}
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {recommendation.affectedProjectNames.length > 0 && (
            <span>{recommendation.affectedProjectNames.slice(0, 2).join(', ')}</span>
          )}
        </div>
      </div>

      {/* Load Dialog */}
      <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {loadChoice === 'open' 
                ? (language === 'he' ? 'טעינת גליל פתוח' : 'Load Open Spool')
                : (language === 'he' ? 'פתיחת גליל חדש' : 'Open New Spool')}
            </DialogTitle>
            <DialogDescription>
              {loadChoice === 'open'
                ? (language === 'he' 
                    ? 'כמה גרם יש על הגליל שאתה טוען?'
                    : 'How many grams are on the spool you are loading?')
                : (language === 'he'
                    ? `נפתח גליל סגור חדש של ${recommendation.color}`
                    : `Opening a new closed ${recommendation.color} spool`)}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="flex items-center gap-2 mb-4">
              <SpoolIcon color={getSpoolColor(recommendation.color)} size={24} />
              <span className="font-medium">{recommendation.color}</span>
            </div>
            
            {loadChoice === 'open' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {language === 'he' ? 'גרמים על הגליל' : 'Grams on spool'}
                </label>
                <Input
                  type="number"
                  min={0}
                  value={openGramsInput}
                  onChange={(e) => setOpenGramsInput(parseInt(e.target.value) || 0)}
                  className="text-lg"
                />
                <p className="text-xs text-muted-foreground">
                  {language === 'he' 
                    ? 'זה יעדכן את סה"כ הגרמים בפתוחים'
                    : 'This will update the total open grams'}
                </p>
              </div>
            )}
            
            {loadChoice === 'new' && inventoryItem && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-sm">
                  {language === 'he' 
                    ? `יופחת גליל סגור אחד ויתווספו ${inventoryItem.closedSpoolSizeGrams}g לפתוחים`
                    : `Will decrement 1 closed spool and add ${inventoryItem.closedSpoolSizeGrams}g to open`}
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoadDialogOpen(false)}>
              {language === 'he' ? 'ביטול' : 'Cancel'}
            </Button>
            <Button onClick={confirmLoad}>
              {language === 'he' ? 'אישור' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LoadRecommendationsPanel;
