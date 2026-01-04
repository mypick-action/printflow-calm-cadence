// ============= PLANNING DECISION LOG =============
// Module for logging planning decisions with detailed reasoning
// Helps debug why certain printers were chosen for projects

export interface PrinterScoreDetails {
  printerId: string;
  printerName: string;
  currentTime: Date;
  effectiveAvailabilityTime: Date;
  waitHours: number;
  isNextDay: boolean;
  scores: {
    availability: number;
    colorMatch: number;
    switchCost: number;
    projectContinuity: number;
    total: number;
  };
  reasons: string[];
}

export interface PlanningDecision {
  timestamp: Date;
  projectId: string;
  projectName: string;
  projectColor: string;
  deadline: string;
  remainingUnits: number;
  
  // Estimation results
  estimationResults: {
    printersNeeded: number;
    estimatedFinishTime: Date | null;
    meetsDeadline: boolean;
    marginHours: number;
  };
  
  // Selected printers with scoring details
  selectedPrinters: PrinterScoreDetails[];
  
  // All evaluated printers (for debugging)
  allPrinterScores?: PrinterScoreDetails[];
  
  // Decision reasons
  reasons: string[];
}

// In-memory log for current planning run
let decisionLog: PlanningDecision[] = [];

// Debug mode flag
let debugMode = true;

export function setDecisionLogDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

export function logPlanningDecision(decision: PlanningDecision): void {
  decisionLog.push(decision);
  
  if (debugMode) {
    console.log('[Planning Decision] 📋', decision.projectName, ':', {
      printers: decision.selectedPrinters.map(p => p.printerName).join(', ') || 'none',
      estimatedFinish: decision.estimationResults.estimatedFinishTime?.toISOString() ?? 'N/A',
      meetsDeadline: decision.estimationResults.meetsDeadline,
      marginHours: decision.estimationResults.marginHours.toFixed(1),
      reasons: decision.reasons,
    });
    
    // Log detailed scorer info for each selected printer
    for (const printer of decision.selectedPrinters) {
      console.log(`[Scoring] ${printer.printerName}:`, {
        currentTime: printer.currentTime.toISOString(),
        effectiveTime: printer.effectiveAvailabilityTime.toISOString(),
        waitHours: printer.waitHours.toFixed(2),
        isNextDay: printer.isNextDay,
        scores: printer.scores,
        reasons: printer.reasons,
      });
    }
  }
}

export function getDecisionLog(): PlanningDecision[] {
  return [...decisionLog];
}

export function clearDecisionLog(): void {
  decisionLog = [];
}

// Helper to format decision for display
export function formatDecisionSummary(decision: PlanningDecision): string {
  const lines: string[] = [];
  
  lines.push(`📋 ${decision.projectName} (${decision.projectColor})`);
  lines.push(`   Deadline: ${decision.deadline}, Remaining: ${decision.remainingUnits} units`);
  
  if (decision.selectedPrinters.length > 0) {
    lines.push(`   Selected: ${decision.selectedPrinters.map(p => p.printerName).join(', ')}`);
    lines.push(`   Finish: ${decision.estimationResults.estimatedFinishTime?.toISOString() ?? 'N/A'}`);
    lines.push(`   Margin: ${decision.estimationResults.marginHours.toFixed(1)}h`);
  } else {
    lines.push('   ⚠️ No printers selected');
  }
  
  for (const reason of decision.reasons) {
    lines.push(`   → ${reason}`);
  }
  
  return lines.join('\n');
}
