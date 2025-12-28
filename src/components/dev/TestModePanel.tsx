/**
 * Developer Test Mode Panel
 * Hidden panel for seeding test scenarios to validate End Cycle Decision Engine
 */

import React, { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  FlaskConical,
  Play,
  Trash2,
  Zap,
  CalendarClock,
  Merge,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  seedCompleteNowScenario,
  seedDeferScenario,
  seedMergeScenario,
  clearTestData,
  getScenarioInfo,
  TestScenario,
} from '@/services/testDataSeeder';

interface TestModePanelProps {
  onClose: () => void;
  onScenarioSeeded?: (scenario: TestScenario, printerId: string, cycleId: string) => void;
}

interface SeededScenario {
  scenario: TestScenario;
  printerId: string;
  cycleId: string;
  projectId: string;
  description: string;
}

export const TestModePanel: React.FC<TestModePanelProps> = ({ onClose, onScenarioSeeded }) => {
  const { language } = useLanguage();
  const [seededScenarios, setSeededScenarios] = useState<SeededScenario[]>([]);
  const [isSeeding, setIsSeeding] = useState<TestScenario | null>(null);

  const scenarios: TestScenario[] = ['complete_now', 'defer', 'merge'];

  const handleSeedScenario = async (scenario: TestScenario) => {
    setIsSeeding(scenario);
    
    try {
      let result: SeededScenario;
      
      switch (scenario) {
        case 'complete_now':
          result = seedCompleteNowScenario();
          break;
        case 'defer':
          result = seedDeferScenario();
          break;
        case 'merge':
          result = seedMergeScenario();
          break;
      }
      
      setSeededScenarios(prev => [...prev, result]);
      
      toast({
        title: language === 'he' ? 'תרחיש נוצר בהצלחה' : 'Scenario created successfully',
        description: result.description,
      });

      if (onScenarioSeeded) {
        onScenarioSeeded(result.scenario, result.printerId, result.cycleId);
      }
    } catch (error) {
      toast({
        title: language === 'he' ? 'שגיאה ביצירת תרחיש' : 'Error creating scenario',
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setIsSeeding(null);
    }
  };

  const handleClearTestData = () => {
    clearTestData();
    setSeededScenarios([]);
    toast({
      title: language === 'he' ? 'נתוני בדיקה נמחקו' : 'Test data cleared',
      description: language === 'he' 
        ? 'כל הנתונים עם prefix "test-" נמחקו' 
        : 'All data with "test-" prefix has been removed',
    });
  };

  const getScenarioIcon = (scenario: TestScenario) => {
    switch (scenario) {
      case 'complete_now': return Zap;
      case 'defer': return CalendarClock;
      case 'merge': return Merge;
    }
  };

  const getScenarioColor = (scenario: TestScenario) => {
    switch (scenario) {
      case 'complete_now': return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
      case 'defer': return 'bg-orange-500/10 text-orange-600 border-orange-500/30';
      case 'merge': return 'bg-purple-500/10 text-purple-600 border-purple-500/30';
    }
  };

  return (
    <Card className="border-warning/50 bg-warning/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-warning" />
            <CardTitle className="text-lg">
              {language === 'he' ? 'מצב בדיקה (למפתחים)' : 'Test Mode (Developers Only)'}
            </CardTitle>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>
          {language === 'he' 
            ? 'צור נתוני בדיקה לאימות End Cycle Decision Engine'
            : 'Seed test data to validate End Cycle Decision Engine'
          }
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <Alert className="border-warning/30 bg-warning/10">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertDescription className="text-sm">
            {language === 'he'
              ? 'נתונים אלה מוספים ל-localStorage ויופיעו ברשימות המדפסות והפרויקטים. השתמש ב"נקה נתוני בדיקה" לסיום.'
              : 'This data will be added to localStorage and appear in printers/projects lists. Use "Clear Test Data" when done.'
            }
          </AlertDescription>
        </Alert>

        {/* Scenario Buttons */}
        <div className="grid gap-3">
          {scenarios.map(scenario => {
            const info = getScenarioInfo(scenario);
            const Icon = getScenarioIcon(scenario);
            const isSeeded = seededScenarios.some(s => s.scenario === scenario);
            
            return (
              <div 
                key={scenario}
                className={`p-4 rounded-lg border ${getScenarioColor(scenario)}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Icon className="h-5 w-5 mt-0.5" />
                    <div>
                      <div className="font-medium">
                        {language === 'he' ? info.titleHe : info.titleEn}
                      </div>
                      <div className="text-sm opacity-80 mt-1">
                        {language === 'he' ? info.descriptionHe : info.descriptionEn}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {isSeeded && (
                      <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {language === 'he' ? 'נוצר' : 'Seeded'}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleSeedScenario(scenario)}
                      disabled={isSeeding !== null}
                      className="shrink-0"
                    >
                      <Play className="h-4 w-4 mr-1" />
                      {isSeeding === scenario 
                        ? (language === 'he' ? 'יוצר...' : 'Seeding...')
                        : (language === 'he' ? 'צור' : 'Seed')
                      }
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <Separator />

        {/* Seeded Scenarios Summary */}
        {seededScenarios.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              {language === 'he' ? 'תרחישים שנוצרו:' : 'Seeded Scenarios:'}
            </div>
            <div className="text-xs space-y-1 bg-muted/50 p-3 rounded-lg font-mono">
              {seededScenarios.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span>{s.scenario}</span>
                  <span className="text-muted-foreground">→</span>
                  <span>printer: {s.printerId.slice(0, 20)}...</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clear Button */}
        <Button 
          variant="destructive" 
          className="w-full"
          onClick={handleClearTestData}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {language === 'he' ? 'נקה נתוני בדיקה' : 'Clear Test Data'}
        </Button>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground space-y-1">
          <div className="font-medium">
            {language === 'he' ? 'הוראות שימוש:' : 'Usage Instructions:'}
          </div>
          <ol className="list-decimal list-inside space-y-1 mr-4">
            <li>{language === 'he' ? 'לחץ "צור" על תרחיש' : 'Click "Seed" on a scenario'}</li>
            <li>{language === 'he' ? 'עבור לדף "דיווח סיום מחזור"' : 'Go to "End Cycle Log" page'}</li>
            <li>{language === 'he' ? 'בחר את מדפסת הבדיקה (מספר 97-99)' : 'Select test printer (number 97-99)'}</li>
            <li>{language === 'he' ? 'דווח על תוצאה ובדוק את DecisionModal' : 'Report result and check DecisionModal'}</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
};
