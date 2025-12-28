/**
 * Developer Test Mode Panel
 * Hidden panel for seeding test scenarios to validate End Cycle Decision Engine
 * Includes: Debug Panel, Raw Computation Toggle, Event Log, Scenario Freeze/Replay
 */

import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Save,
  RotateCcw,
  FileJson,
  History,
  Code,
  Bug,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  seedCompleteNowScenario,
  seedDeferScenario,
  seedMergeScenario,
  clearTestData,
  getScenarioInfo,
  TestScenario,
  freezeCurrentScenario,
  getFrozenScenarios,
  restoreFrozenScenario,
  deleteFrozenScenario,
  clearAllFrozenScenarios,
  FrozenScenario,
} from '@/services/testDataSeeder';
import {
  getEventLog,
  clearEventLog,
  EndCycleEventLogEntry,
} from '@/services/endCycleEventLog';

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
  const [activeTab, setActiveTab] = useState<string>('scenarios');
  const [freezeName, setFreezeName] = useState<string>('');
  const [frozenScenarios, setFrozenScenarios] = useState<FrozenScenario[]>([]);
  const [eventLog, setEventLog] = useState<EndCycleEventLogEntry[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EndCycleEventLogEntry | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);

  const scenarios: TestScenario[] = ['complete_now', 'defer', 'merge'];

  useEffect(() => {
    setFrozenScenarios(getFrozenScenarios());
    setEventLog(getEventLog());
  }, [activeTab]);

  const refreshEventLog = () => {
    setEventLog(getEventLog());
  };

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

  const handleFreezeScenario = () => {
    if (!freezeName.trim() || seededScenarios.length === 0) {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'נא להזין שם ולוודא שיש תרחיש פעיל' : 'Please enter a name and ensure there is an active scenario',
        variant: 'destructive',
      });
      return;
    }

    const lastScenario = seededScenarios[seededScenarios.length - 1];
    const frozen = freezeCurrentScenario(freezeName, lastScenario.scenario);
    setFrozenScenarios(getFrozenScenarios());
    setFreezeName('');

    toast({
      title: language === 'he' ? 'תרחיש הוקפא' : 'Scenario Frozen',
      description: `ID: ${frozen.id}`,
    });
  };

  const handleRestoreScenario = (scenarioId: string) => {
    const success = restoreFrozenScenario(scenarioId);
    if (success) {
      toast({
        title: language === 'he' ? 'תרחיש שוחזר' : 'Scenario Restored',
        description: language === 'he' ? 'נתוני הבדיקה שוחזרו' : 'Test data restored',
      });
    } else {
      toast({
        title: language === 'he' ? 'שגיאה' : 'Error',
        description: language === 'he' ? 'לא נמצא תרחיש' : 'Scenario not found',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteFrozen = (scenarioId: string) => {
    deleteFrozenScenario(scenarioId);
    setFrozenScenarios(getFrozenScenarios());
  };

  const handleClearEventLog = () => {
    clearEventLog();
    setEventLog([]);
    setSelectedEvent(null);
    toast({
      title: language === 'he' ? 'לוג נמחק' : 'Log Cleared',
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

  const renderScenariosTab = () => (
    <div className="space-y-4">
      <Alert className="border-warning/30 bg-warning/10">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <AlertDescription className="text-sm">
          {language === 'he'
            ? 'נתונים אלה מוספים ל-localStorage ויופיעו ברשימות המדפסות והפרויקטים.'
            : 'This data will be added to localStorage and appear in printers/projects lists.'
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

      {/* Freeze Scenario */}
      {seededScenarios.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">
            {language === 'he' ? 'הקפא תרחיש נוכחי:' : 'Freeze Current Scenario:'}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder={language === 'he' ? 'שם התרחיש...' : 'Scenario name...'}
              value={freezeName}
              onChange={(e) => setFreezeName(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleFreezeScenario} size="sm">
              <Save className="h-4 w-4 mr-1" />
              {language === 'he' ? 'הקפא' : 'Freeze'}
            </Button>
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
    </div>
  );

  const renderFrozenTab = () => (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {language === 'he' 
          ? 'תרחישים מוקפאים ניתנים לשחזור חוזר לבדיקות אמינות.'
          : 'Frozen scenarios can be replayed for reliable testing.'
        }
      </div>

      {frozenScenarios.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {language === 'he' ? 'אין תרחישים מוקפאים' : 'No frozen scenarios'}
        </div>
      ) : (
        <ScrollArea className="h-[300px]">
          <div className="space-y-2">
            {frozenScenarios.map(frozen => (
              <div 
                key={frozen.id} 
                className="p-3 border rounded-lg bg-muted/30 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{frozen.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {frozen.scenario} • {new Date(frozen.frozenAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleRestoreScenario(frozen.id)}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      {language === 'he' ? 'שחזר' : 'Restore'}
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => handleDeleteFrozen(frozen.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground font-mono bg-muted/50 p-2 rounded">
                  {frozen.data.cycles.length} cycles, {frozen.data.projects.length} projects
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {frozenScenarios.length > 0 && (
        <Button 
          variant="destructive" 
          size="sm"
          className="w-full"
          onClick={() => {
            clearAllFrozenScenarios();
            setFrozenScenarios([]);
          }}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          {language === 'he' ? 'מחק הכל' : 'Clear All'}
        </Button>
      )}
    </div>
  );

  const renderEventLogTab = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {language === 'he' 
            ? `${eventLog.length} אירועים מתועדים`
            : `${eventLog.length} events logged`
          }
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refreshEventLog}>
            <RotateCcw className="h-3 w-3 mr-1" />
            {language === 'he' ? 'רענן' : 'Refresh'}
          </Button>
          <Button size="sm" variant="destructive" onClick={handleClearEventLog}>
            <Trash2 className="h-3 w-3 mr-1" />
            {language === 'he' ? 'נקה' : 'Clear'}
          </Button>
        </div>
      </div>

      {eventLog.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          {language === 'he' ? 'אין אירועים' : 'No events logged'}
        </div>
      ) : (
        <ScrollArea className="h-[250px]">
          <div className="space-y-2">
            {eventLog.slice().reverse().map((entry, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedEvent(entry)}
                className={`w-full p-2 border rounded text-start text-xs ${
                  selectedEvent === entry ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {entry.decision}
                  </Badge>
                  <span className="text-muted-foreground">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground truncate">
                  {entry.cycleId.slice(0, 30)}...
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}

      {selectedEvent && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              {language === 'he' ? 'פרטי אירוע:' : 'Event Details:'}
            </div>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={() => setShowRawJson(!showRawJson)}
            >
              <Code className="h-3 w-3 mr-1" />
              {showRawJson ? 'Hide' : 'Show'} JSON
            </Button>
          </div>
          
          {showRawJson ? (
            <ScrollArea className="h-[200px]">
              <pre className="text-xs bg-muted p-3 rounded font-mono overflow-x-auto">
                {JSON.stringify(selectedEvent, null, 2)}
              </pre>
            </ScrollArea>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Decision</div>
                <div className="font-medium">{selectedEvent.decision}</div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Replan</div>
                <div className="font-medium">{selectedEvent.replanTriggered ? 'Yes' : 'No'}</div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Cycles Before</div>
                <div className="font-medium">{selectedEvent.inputs.plannedCyclesBefore}</div>
              </div>
              <div className="p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Cycles After (Immediate)</div>
                <div className="font-medium">{selectedEvent.outputs.plannedCyclesAfterImmediate}</div>
              </div>
              {selectedEvent.postReplan && (
                <div className="p-2 bg-green-500/20 rounded border border-green-500/30">
                  <div className="text-muted-foreground">Cycles After Replan</div>
                  <div className="font-medium">
                    {selectedEvent.postReplan.plannedCyclesAfterReplan}
                    <span className={`ml-2 text-sm ${selectedEvent.postReplan.cyclesChanged >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ({selectedEvent.postReplan.cyclesChanged >= 0 ? '+' : ''}{selectedEvent.postReplan.cyclesChanged})
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {selectedEvent.postReplan.replanDurationMs}ms • {selectedEvent.postReplan.replanSuccess ? '✓' : '✗'}
                  </div>
                </div>
              )}
              <div className="col-span-2 p-2 bg-muted/50 rounded">
                <div className="text-muted-foreground">Progress Before → After</div>
                <div className="font-medium">
                  {selectedEvent.inputs.projectProgressBefore.quantityGood}/
                  {selectedEvent.inputs.projectProgressBefore.quantityTarget}
                  {' → '}
                  {selectedEvent.outputs.projectProgressAfter.quantityGood}/
                  {selectedEvent.outputs.projectProgressAfter.quantityTarget}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

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
            ? 'צור נתוני בדיקה, הקפא תרחישים, וצפה בלוג אירועים'
            : 'Seed test data, freeze scenarios, and view event log'
          }
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="scenarios" className="text-xs">
              <Bug className="h-3 w-3 mr-1" />
              {language === 'he' ? 'תרחישים' : 'Scenarios'}
            </TabsTrigger>
            <TabsTrigger value="frozen" className="text-xs">
              <Save className="h-3 w-3 mr-1" />
              {language === 'he' ? 'מוקפאים' : 'Frozen'}
            </TabsTrigger>
            <TabsTrigger value="log" className="text-xs">
              <History className="h-3 w-3 mr-1" />
              {language === 'he' ? 'לוג' : 'Log'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scenarios" className="mt-0">
            {renderScenariosTab()}
          </TabsContent>

          <TabsContent value="frozen" className="mt-0">
            {renderFrozenTab()}
          </TabsContent>

          <TabsContent value="log" className="mt-0">
            {renderEventLogTab()}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
