import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  Settings, 
  Clock, 
  Save,
  Trash2,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { getPriorityRules, savePriorityRules, PriorityRules, resetAllPrintFlowData, isDemoMode } from '@/services/storage';
import { WorkScheduleSection } from './WorkScheduleSection';

export const SettingsPage: React.FC = () => {
  const { language } = useLanguage();
  const [rules, setRules] = useState<PriorityRules>({
    urgentDaysThreshold: 14,
    criticalDaysThreshold: 7,
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const demoMode = isDemoMode();

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

  const handleReset = () => {
    setIsResetting(true);
    // Small delay for visual feedback
    setTimeout(() => {
      resetAllPrintFlowData();
      // Reload the page to show bootstrap screen
      window.location.reload();
    }, 300);
  };

  const updateRules = (updates: Partial<PriorityRules>) => {
    setRules(prev => ({ ...prev, ...updates }));
    setHasChanges(true);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-xl">
          <Settings className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {language === 'he' ? 'הגדרות' : 'Settings'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {language === 'he' ? 'הגדרות המערכת' : 'System settings'}
          </p>
        </div>
        {demoMode && (
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
            {language === 'he' ? 'מצב הדגמה' : 'Demo Mode'}
          </Badge>
        )}
      </div>

      {/* Work Schedule Section - First */}
      <WorkScheduleSection />

      {/* Priority Rules Card - Second */}
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

      {/* Reset System Card */}
      <Card variant="elevated" className="border-error/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-error">
            <RotateCcw className="w-5 h-5" />
            {language === 'he' ? 'איפוס מערכת' : 'Reset System'}
          </CardTitle>
          <CardDescription>
            {language === 'he' 
              ? 'מחיקת כל הנתונים וחזרה למסך הפתיחה'
              : 'Delete all data and return to first-run screen'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-error/5 rounded-lg border border-error/20 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-error mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {language === 'he' ? 'פעולה זו לא ניתנת לביטול' : 'This action cannot be undone'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {language === 'he' 
                    ? 'כל הפרויקטים, המוצרים, המדפסות וההיסטוריה יימחקו לצמיתות.'
                    : 'All projects, products, printers, and history will be permanently deleted.'}
                </p>
              </div>
            </div>
          </div>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full gap-2">
                <Trash2 className="w-4 h-4" />
                {language === 'he' ? 'איפוס מערכת / התחל מחדש' : 'Reset System / Start Over'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {language === 'he' ? 'אישור איפוס מערכת' : 'Confirm System Reset'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {language === 'he' 
                    ? 'זה ימחק את כל הנתונים מהמכשיר הזה. להמשיך?'
                    : 'This will delete all data on this device. Continue?'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {language === 'he' ? 'ביטול' : 'Cancel'}
                </AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleReset}
                  className="bg-error hover:bg-error/90"
                  disabled={isResetting}
                >
                  {isResetting 
                    ? (language === 'he' ? 'מאפס...' : 'Resetting...') 
                    : (language === 'he' ? 'כן, אפס הכל' : 'Yes, Reset Everything')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
};
