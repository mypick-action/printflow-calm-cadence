import React, { useMemo } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  Printer, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight,
  HelpCircle,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getPrinters,
  getPlannedCycles,
  getProjects,
  getSpools,
  isMountedStateUnknown,
  isLoadedSpoolsInitialized,
  Printer as PrinterType,
  PlannedCycle,
  FilamentEstimate,
} from '@/services/storage';
import { isSameDay } from 'date-fns';

interface SetupRecommendation {
  printerId: string;
  printerName: string;
  status: 'ready' | 'needs_change' | 'warning' | 'unknown';
  currentColor?: string;
  currentEstimate?: FilamentEstimate;
  requiredColor: string;
  hasInventory: boolean;
  message: string;
  messageEn: string;
}

interface SetupRecommendationPanelProps {
  date?: Date;
  className?: string;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

export const SetupRecommendationPanel: React.FC<SetupRecommendationPanelProps> = ({
  date = new Date(),
  className,
}) => {
  const { language } = useLanguage();

  const { recommendations, confidence } = useMemo(() => {
    const printers = getPrinters().filter(p => p.status === 'active');
    const cycles = getPlannedCycles();
    const projects = getProjects();
    const spools = getSpools();
    const mountedStateUnknown = isMountedStateUnknown();
    const loadedSpoolsInit = isLoadedSpoolsInitialized();

    // Get cycles for the target date
    const dayCycles = cycles.filter(c => {
      const cycleDate = new Date(c.startTime);
      return isSameDay(cycleDate, date) && c.status !== 'completed' && c.status !== 'failed';
    });

    if (dayCycles.length === 0) {
      return { recommendations: [], confidence: 'high' as ConfidenceLevel };
    }

    // Determine required colors per printer
    const printerRequirements = new Map<string, { color: string; cycles: PlannedCycle[] }>();
    
    dayCycles.forEach(cycle => {
      const project = projects.find(p => p.id === cycle.projectId);
      if (!project) return;

      const existing = printerRequirements.get(cycle.printerId);
      if (existing) {
        existing.cycles.push(cycle);
        // If different color is needed, this is a multi-color scenario
      } else {
        printerRequirements.set(cycle.printerId, {
          color: project.color,
          cycles: [cycle],
        });
      }
    });

    const recs: SetupRecommendation[] = [];
    let hasUnknown = mountedStateUnknown || !loadedSpoolsInit;
    let hasLowEstimate = false;

    printerRequirements.forEach((req, printerId) => {
      const printer = printers.find(p => p.id === printerId);
      if (!printer) return;

      // Determine current mounted color and estimate
      let currentColor: string | undefined;
      let currentEstimate: FilamentEstimate | undefined;

      if (printer.hasAMS && printer.amsSlotStates && printer.amsSlotStates.length > 0) {
        // For AMS, check if any slot has the required color
        const matchingSlot = printer.amsSlotStates.find(
          s => s.color?.toLowerCase() === req.color.toLowerCase()
        );
        if (matchingSlot) {
          currentColor = matchingSlot.color;
          currentEstimate = matchingSlot.estimate;
        } else {
          currentColor = printer.amsSlotStates[0]?.color;
          currentEstimate = printer.amsSlotStates[0]?.estimate;
        }
      } else {
        currentColor = printer.mountedColor || printer.currentColor;
        currentEstimate = printer.mountedEstimate;
      }

      // Check inventory for required color
      const availableSpools = spools.filter(
        s => s.color.toLowerCase() === req.color.toLowerCase() && 
             s.state !== 'empty' && 
             s.gramsRemainingEst > 0
      );
      const hasInventory = availableSpools.length > 0;

      // Determine status
      let status: SetupRecommendation['status'];
      let message: string;
      let messageEn: string;

      const colorsMatch = currentColor?.toLowerCase() === req.color.toLowerCase();

      if (!currentColor || currentColor === '') {
        if (!loadedSpoolsInit || mountedStateUnknown) {
          status = 'unknown';
          message = `מצב לא ידוע - שים גליל ${req.color}`;
          messageEn = `Unknown state - load ${req.color} spool`;
          hasUnknown = true;
        } else {
          status = 'needs_change';
          message = `שים גליל ${req.color}`;
          messageEn = `Load ${req.color} spool`;
        }
      } else if (colorsMatch) {
        if (currentEstimate === 'low') {
          status = 'warning';
          message = `${req.color} - כמות נמוכה, הכן גליל נוסף`;
          messageEn = `${req.color} - low amount, prepare backup`;
          hasLowEstimate = true;
        } else if (currentEstimate === 'unknown') {
          status = 'ready';
          message = `${req.color} - מתאים (כמות לא ידועה)`;
          messageEn = `${req.color} - matches (unknown amount)`;
          hasUnknown = true;
        } else {
          status = 'ready';
          message = `${req.color} - כבר מתאים`;
          messageEn = `${req.color} - already loaded`;
        }
      } else {
        status = 'needs_change';
        message = `החלף מ-${currentColor} ל-${req.color}`;
        messageEn = `Change from ${currentColor} to ${req.color}`;
      }

      // Add inventory warning
      if (!hasInventory && status !== 'ready') {
        status = 'warning';
        message += ` (אין במלאי!)`;
        messageEn += ` (not in inventory!)`;
      }

      recs.push({
        printerId,
        printerName: printer.name,
        status,
        currentColor,
        currentEstimate,
        requiredColor: req.color,
        hasInventory,
        message,
        messageEn,
      });
    });

    // Determine overall confidence
    let confidence: ConfidenceLevel = 'high';
    if (hasUnknown) {
      confidence = 'low';
    } else if (hasLowEstimate) {
      confidence = 'medium';
    }

    return { recommendations: recs, confidence };
  }, [date]);

  if (recommendations.length === 0) {
    return null;
  }

  const getStatusIcon = (status: SetupRecommendation['status']) => {
    switch (status) {
      case 'ready':
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'needs_change':
        return <ArrowRight className="w-4 h-4 text-primary" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-warning" />;
      case 'unknown':
        return <HelpCircle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBgClass = (status: SetupRecommendation['status']) => {
    switch (status) {
      case 'ready':
        return 'bg-success/10 border-success/30';
      case 'needs_change':
        return 'bg-primary/10 border-primary/30';
      case 'warning':
        return 'bg-warning/10 border-warning/30';
      case 'unknown':
        return 'bg-muted/50 border-border';
    }
  };

  const confidenceBadge = () => {
    const config = {
      high: { 
        label: language === 'he' ? 'ביטחון גבוה' : 'High confidence',
        class: 'bg-success/10 text-success border-success/20'
      },
      medium: {
        label: language === 'he' ? 'ביטחון בינוני' : 'Medium confidence', 
        class: 'bg-warning/10 text-warning border-warning/20'
      },
      low: {
        label: language === 'he' ? 'ביטחון נמוך' : 'Low confidence',
        class: 'bg-muted text-muted-foreground border-border'
      },
    };
    const c = config[confidence];
    return (
      <Badge variant="outline" className={c.class}>
        {c.label}
      </Badge>
    );
  };

  const allReady = recommendations.every(r => r.status === 'ready');

  return (
    <Card variant="glass" className={cn("border-primary/20", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            {language === 'he' ? 'המלצת סט-אפ לגלילים' : 'Spool Setup Recommendation'}
          </div>
          {confidenceBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {allReady ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-success/10 border border-success/30">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <span className="font-medium text-success">
              {language === 'he' ? 'כל המדפסות מוכנות!' : 'All printers ready!'}
            </span>
          </div>
        ) : (
          recommendations.map(rec => (
            <div 
              key={rec.printerId}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                getStatusBgClass(rec.status)
              )}
            >
              <Printer className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{rec.printerName}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                  {getStatusIcon(rec.status)}
                  <span>{language === 'he' ? rec.message : rec.messageEn}</span>
                </div>
              </div>
              <SpoolIcon color={getSpoolColor(rec.requiredColor)} size={28} />
            </div>
          ))
        )}

        {confidence === 'low' && (
          <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded-lg">
            {language === 'he' 
              ? 'אין לנו מידע מלא על מצב הגלילים. עדכן דרך הגדרות > מדפסות'
              : 'We don\'t have complete spool state info. Update via Settings > Printers'}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
