import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlaskConical, RotateCcw, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  getAllFeatureFlags,
  enableFeature,
  disableFeature,
  resetAllFeatureFlags,
  FeatureFlagName,
} from '@/services/featureFlags';
import { getBlockSummary, clearBlockLog, formatBlockSummary } from '@/services/cycleBlockLogger';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const FeatureFlagsPanel: React.FC = () => {
  const { language } = useLanguage();
  const [flags, setFlags] = useState<Record<FeatureFlagName, { enabled: boolean; description: string }>>(
    getAllFeatureFlags()
  );
  const [blockSummary, setBlockSummary] = useState(getBlockSummary());

  useEffect(() => {
    setFlags(getAllFeatureFlags());
    setBlockSummary(getBlockSummary());
  }, []);

  const handleToggle = (flag: FeatureFlagName, enabled: boolean) => {
    if (enabled) {
      enableFeature(flag);
    } else {
      disableFeature(flag);
    }
    setFlags(getAllFeatureFlags());
    
    toast({
      title: enabled 
        ? (language === 'he' ? 'פיצ\'ר הופעל' : 'Feature Enabled')
        : (language === 'he' ? 'פיצ\'ר כובה' : 'Feature Disabled'),
      description: flag,
    });
  };

  const handleResetAll = () => {
    resetAllFeatureFlags();
    setFlags(getAllFeatureFlags());
    toast({
      title: language === 'he' ? 'הדגלים אופסו' : 'Flags Reset',
      description: language === 'he' ? 'כל הדגלים כבויים' : 'All flags are now OFF',
    });
  };

  const handleClearBlockLog = () => {
    clearBlockLog();
    setBlockSummary(getBlockSummary());
    toast({
      title: language === 'he' ? 'לוג נוקה' : 'Log Cleared',
    });
  };

  const flagLabels: Record<FeatureFlagName, { he: string; en: string }> = {
    PHYSICAL_PLATES_LIMIT: { he: 'הגבלת פלטות פיזיות', en: 'Physical Plates Limit' },
    WEEKEND_AUTONOMY_BUDGET: { he: 'תקציב אוטונומיה לסופ"ש', en: 'Weekend Autonomy Budget' },
    OVERNIGHT_SPOOL_PREP_MODAL: { he: 'מודל הכנת גלילים ללילה', en: 'Overnight Spool Prep Modal' },
    OVERNIGHT_OPEN_SPOOL_ALLOWED: { he: 'גליל פתוח למחזור לילה', en: 'Open Spool for Night Cycle' },
    PLANNER_V2_PROJECT_CENTRIC: { he: 'תכנון V2 - מינימום מדפסות', en: 'Planner V2 - Minimum Printers' },
    PLANNING_HYBRID_OBJECTIVE: { he: 'HYBRID - ניצול קיבולת', en: 'HYBRID Objective' },
    MAX_THROUGHPUT_V0: { he: 'Max Throughput V0 - מילוי מדפסות', en: 'Max Throughput V0 - Fill Printers' },
  };

  return (
    <Card variant="elevated" className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FlaskConical className="w-5 h-5 text-primary" />
          {language === 'he' ? 'פיצ\'רים בפיתוח (Feature Flags)' : 'Development Features (Flags)'}
          <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
            DEV
          </Badge>
        </CardTitle>
        <CardDescription>
          {language === 'he' 
            ? 'הפעל פיצ\'רים חדשים לבדיקה - כל הדגלים כבויים כברירת מחדל'
            : 'Enable new features for testing - all flags are OFF by default'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Feature Flags List */}
        <div className="space-y-3">
          {Object.entries(flags).map(([flag, { enabled, description }]) => (
            <div 
              key={flag}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-background"
            >
              <div className="flex items-center gap-2">
                <Label htmlFor={flag} className="font-medium cursor-pointer">
                  {flagLabels[flag as FeatureFlagName]?.[language] || flag}
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{description}</p>
                    <p className="text-xs text-muted-foreground mt-1">Key: {flag}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={enabled ? 'default' : 'secondary'} className="text-xs">
                  {enabled ? 'ON' : 'OFF'}
                </Badge>
                <Switch
                  id={flag}
                  checked={enabled}
                  onCheckedChange={(checked) => handleToggle(flag as FeatureFlagName, checked)}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Reset Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleResetAll}
          className="w-full gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          {language === 'he' ? 'כבה את כל הדגלים' : 'Reset All Flags to OFF'}
        </Button>

        {/* Block Summary */}
        {blockSummary.total > 0 && (
          <div className="mt-4 p-3 rounded-lg border border-border bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {language === 'he' ? 'סיכום חסימות (Cycle Blocks)' : 'Cycle Block Summary'}
              </span>
              <Button variant="ghost" size="sm" onClick={handleClearBlockLog}>
                {language === 'he' ? 'נקה' : 'Clear'}
              </Button>
            </div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
              {formatBlockSummary(blockSummary)}
            </pre>
          </div>
        )}

        {/* Console hint */}
        <p className="text-xs text-muted-foreground text-center">
          {language === 'he' 
            ? 'בקונסול: window.FF.log() | window.BlockLog.summary()'
            : 'Console: window.FF.log() | window.BlockLog.summary()'}
        </p>
      </CardContent>
    </Card>
  );
};
