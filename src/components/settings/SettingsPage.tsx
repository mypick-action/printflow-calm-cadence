import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Settings, 
  Clock, 
  Save
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getPriorityRules, savePriorityRules, PriorityRules } from '@/services/storage';
import { WorkScheduleSection } from './WorkScheduleSection';

export const SettingsPage: React.FC = () => {
  const { language } = useLanguage();
  const [rules, setRules] = useState<PriorityRules>({
    urgentDaysThreshold: 14,
    criticalDaysThreshold: 7,
  });
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    const currentRules = getPriorityRules();
    setRules(currentRules);
  }, []);

  const handleSave = () => {
    // Validate rules
    if (rules.criticalDaysThreshold >= rules.urgentDaysThreshold) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' 
          ? 'סף קריטי חייב להיות קטן מסף דחוף'
          : 'Critical threshold must be less than urgent threshold',
        variant: 'destructive',
      });
      return;
    }
    
    savePriorityRules(rules);
    setHasChanges(false);
    toast({
      title: language === 'he' ? 'נשמר בהצלחה' : 'Saved successfully',
      description: language === 'he' 
        ? 'כללי העדיפות עודכנו'
        : 'Priority rules have been updated',
    });
  };

  const updateRules = (updates: Partial<PriorityRules>) => {
    setRules(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
  };

  const getPriorityPreview = (days: number) => {
    if (days < rules.criticalDaysThreshold) return 'critical';
    if (days < rules.urgentDaysThreshold) return 'urgent';
    return 'normal';
  };

  const previewDays = [3, 7, 10, 14, 21, 30];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-xl">
          <Settings className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {language === 'he' ? 'הגדרות' : 'Settings'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {language === 'he' ? 'הגדרות המערכת' : 'System settings'}
          </p>
        </div>
      </div>

      {/* Priority Rules Card */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="w-5 h-5 text-primary" />
            {language === 'he' ? 'כללי עדיפות אוטומטיים' : 'Auto Priority Rules'}
          </CardTitle>
          <CardDescription>
            {language === 'he' 
              ? 'העדיפות מחושבת אוטומטית לפי מספר הימים עד תאריך היעד'
              : 'Priority is automatically calculated based on days until due date'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Critical threshold */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-error/10 text-error border-error/20">
                {language === 'he' ? 'קריטי' : 'Critical'}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground min-w-fit">
                {language === 'he' ? 'פחות מ-' : 'Less than'}
              </span>
              <Input
                type="number"
                min={1}
                max={rules.urgentDaysThreshold - 1}
                value={rules.criticalDaysThreshold}
                onChange={(e) => updateRules({ criticalDaysThreshold: parseInt(e.target.value) || 1 })}
                className="w-20 text-center"
              />
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'ימים' : 'days'}
              </span>
            </div>
          </div>

          {/* Urgent threshold */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">
                {language === 'he' ? 'דחוף' : 'Urgent'}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground min-w-fit">
                {language === 'he' ? 'בין' : 'Between'}
              </span>
              <span className="font-medium">{rules.criticalDaysThreshold}</span>
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'ל-' : 'and'}
              </span>
              <Input
                type="number"
                min={rules.criticalDaysThreshold + 1}
                value={rules.urgentDaysThreshold}
                onChange={(e) => updateRules({ urgentDaysThreshold: parseInt(e.target.value) || 14 })}
                className="w-20 text-center"
              />
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? 'ימים' : 'days'}
              </span>
            </div>
          </div>

          {/* Normal */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                {language === 'he' ? 'רגיל' : 'Normal'}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {language === 'he' ? `יותר מ-${rules.urgentDaysThreshold} ימים` : `More than ${rules.urgentDaysThreshold} days`}
              </span>
            </div>
          </div>

          {/* Preview */}
          <div className="pt-4 border-t border-border">
            <div className="text-sm font-medium mb-3">
              {language === 'he' ? 'תצוגה מקדימה:' : 'Preview:'}
            </div>
            <div className="flex flex-wrap gap-2">
              {previewDays.map(days => {
                const priority = getPriorityPreview(days);
                const priorityConfig = {
                  normal: { 
                    label: language === 'he' ? 'רגיל' : 'Normal', 
                    className: 'bg-success/10 text-success border-success/20' 
                  },
                  urgent: { 
                    label: language === 'he' ? 'דחוף' : 'Urgent', 
                    className: 'bg-warning/10 text-warning border-warning/20' 
                  },
                  critical: { 
                    label: language === 'he' ? 'קריטי' : 'Critical', 
                    className: 'bg-error/10 text-error border-error/20' 
                  },
                };
                return (
                  <div key={days} className="flex items-center gap-1 p-2 bg-muted rounded-lg">
                    <span className="text-sm font-medium">{days}</span>
                    <span className="text-xs text-muted-foreground">
                      {language === 'he' ? 'ימים' : 'days'}
                    </span>
                    <span className="mx-1">→</span>
                    <Badge variant="outline" className={priorityConfig[priority].className}>
                      {priorityConfig[priority].label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Save Button */}
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges}
            className="w-full gap-2"
          >
            <Save className="w-4 h-4" />
            {language === 'he' ? 'שמור שינויים' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {/* Work Schedule Section */}
      <WorkScheduleSection />
    </div>
  );
};
