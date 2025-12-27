import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SpoolIcon, getSpoolColor } from '@/components/icons/SpoolIcon';
import { 
  Sun, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Moon
} from 'lucide-react';

interface DashboardProps {
  printerNames: string[];
  onReportIssue?: () => void;
}

// Mock data for demonstration
const mockPlanData = [
  {
    printer: 'מדפסת 1',
    cycles: [
      { time: '08:30 - 12:00', project: 'חלק לבן', color: 'לבן', units: 12 },
      { time: '12:15 - 16:00', project: 'מכסה אדום', color: 'אדום', units: 8 },
      { time: '16:15 - 17:30', project: 'תיחורים שחורים', color: 'שחור', units: 4, endOfDay: true },
    ],
    leaveSpool: 'שחור',
  },
  {
    printer: 'מדפסת 2',
    cycles: [
      { time: '08:30 - 13:00', project: 'בזיס רוון', color: 'ירוק', units: 15 },
      { time: '13:15 - 17:00', project: 'מעמת אפהה', color: 'אפור', units: 10 },
    ],
    leaveSpool: 'אפור',
  },
];

export const Dashboard: React.FC<DashboardProps> = ({ printerNames, onReportIssue }) => {
  const { t } = useLanguage();
  
  return (
    <div className="space-y-6">
      {/* Header with greeting */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-warning-light flex items-center justify-center">
            <Sun className="w-7 h-7 text-warning" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {t('dashboard.goodMorning')} {t('dashboard.todayPlan')}
            </h1>
          </div>
        </div>
        <Button variant="outline" className="gap-2" onClick={onReportIssue}>
          <AlertTriangle className="w-4 h-4" />
          {t('dashboard.reportIssue')}
        </Button>
      </div>
      
      {/* Status badges */}
      <div className="flex flex-wrap gap-3">
        <div className="status-badge status-warning">
          <AlertTriangle className="w-4 h-4" />
          כפריקום רשים
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-sm">
          <SpoolIcon color={getSpoolColor('שחור')} size={16} />
          בדוק מלאי, שחר, אדום
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-muted-foreground text-sm">
          <CheckCircle2 className="w-4 h-4 text-success" />
          מכבי, אוטומטי
        </div>
      </div>
      
      {/* Printer cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {mockPlanData.map((printer, idx) => (
          <Card key={idx} variant="elevated" className="overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                {printer.printer}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {printer.cycles.map((cycle, cycleIdx) => (
                <div 
                  key={cycleIdx}
                  className={`
                    flex items-center gap-4 p-3 rounded-xl border transition-all
                    ${cycle.endOfDay 
                      ? 'bg-primary-light border-primary/30' 
                      : 'bg-muted/50 border-border'
                    }
                  `}
                >
                  <SpoolIcon color={getSpoolColor(cycle.color)} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{cycle.time}</span>
                      {cycle.endOfDay && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-medium">
                          <Moon className="w-3 h-3" />
                          {t('dashboard.endOfDayCycle')}
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-foreground mt-1">
                      {cycle.project}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-foreground">{cycle.units}</div>
                    <div className="text-xs text-muted-foreground">יחידות</div>
                  </div>
                </div>
              ))}
              
              {/* Leave spool instruction */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-success-light border border-success/30">
                <SpoolIcon color={getSpoolColor(printer.leaveSpool)} size={28} />
                <span className="text-sm font-medium text-success">
                  {t('dashboard.leaveSpool')} גליל {printer.leaveSpool}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      
      {/* All ready status */}
      <Card variant="glass" className="border-success/30">
        <CardContent className="flex items-center justify-center gap-3 py-6">
          <CheckCircle2 className="w-6 h-6 text-success" />
          <span className="text-lg font-medium text-success">{t('dashboard.allReady')}</span>
        </CardContent>
      </Card>
    </div>
  );
};
