/**
 * Test Data Seeder - Developer-only test scenarios for End Cycle Decision Engine
 */

import { 
  Product, 
  Project, 
  Printer, 
  PlannedCycle, 
  Spool,
  KEYS 
} from './storage';

// Test scenario identifiers
export type TestScenario = 'complete_now' | 'defer' | 'merge';

interface ScenarioResult {
  scenario: TestScenario;
  printerId: string;
  cycleId: string;
  projectId: string;
  description: string;
}

// Helper to generate test IDs
const testId = (prefix: string) => `test-${prefix}-${Date.now()}`;

// Get current date helpers
const now = () => new Date();
const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const formatTime = (date: Date) => date.toISOString();

/**
 * Scenario 1: Complete Now
 * - Printer P1 with 3 planned cycles
 * - C1 09:00-12:00 (Project A, due tomorrow 13:00) 
 * - C2 12:00-15:00 (Project B, due in a week)
 * - C3 15:00-18:00 (Project C, due in a week)
 * - Opens DecisionModal with completed_with_scrap + estimatedHours=3 + needsSpoolChange=true
 */
export function seedCompleteNowScenario(): ScenarioResult {
  const today = now();
  // Set base time to today 09:00
  const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0);
  
  // Create test product
  const product: Product = {
    id: testId('product'),
    name: 'Test Widget',
    gramsPerUnit: 25,
    platePresets: [{
      id: testId('preset'),
      name: 'Standard',
      unitsPerPlate: 8,
      cycleHours: 3,
      riskLevel: 'low',
      allowedForNightCycle: true,
      isRecommended: true,
    }]
  };

  // Create 3 projects
  const projectA: Project = {
    id: testId('proj-a'),
    name: 'Test Project A - Urgent',
    productId: product.id,
    productName: product.name,
    quantityTarget: 50,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: addDays(baseDate, 1).toISOString().split('T')[0] + 'T13:00:00', // Tomorrow 13:00
    urgency: 'urgent',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Red',
    createdAt: formatTime(addDays(today, -7)),
  };

  const projectB: Project = {
    id: testId('proj-b'),
    name: 'Test Project B - Normal',
    productId: product.id,
    productName: product.name,
    quantityTarget: 100,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: addDays(today, 7).toISOString().split('T')[0], // In a week
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Blue',
    createdAt: formatTime(addDays(today, -5)),
  };

  const projectC: Project = {
    id: testId('proj-c'),
    name: 'Test Project C - Normal',
    productId: product.id,
    productName: product.name,
    quantityTarget: 80,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: addDays(today, 7).toISOString().split('T')[0], // In a week
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Green',
    createdAt: formatTime(addDays(today, -3)),
  };

  // Create test printer
  const printer: Printer = {
    id: testId('printer-p1'),
    printerNumber: 99,
    name: 'Test Printer P1',
    active: true,
    status: 'active',
    hasAMS: false,
    currentColor: 'Red',
    currentMaterial: 'PLA',
  };

  // Create spool
  const spool: Spool = {
    id: testId('spool'),
    color: 'Red',
    material: 'PLA',
    packageSize: 1000,
    gramsRemainingEst: 150, // Low - will need spool change
    state: 'open',
    location: 'printer',
    assignedPrinterId: printer.id,
    needsAudit: false,
  };

  // Create 3 planned cycles on P1
  const cycle1: PlannedCycle = {
    id: testId('cycle-1'),
    projectId: projectA.id,
    printerId: printer.id,
    unitsPlanned: 8,
    gramsPlanned: 200,
    plateType: 'full',
    startTime: formatTime(baseDate), // 09:00
    endTime: formatTime(addHours(baseDate, 3)), // 12:00
    shift: 'day',
    status: 'in_progress', // Current cycle
    readinessState: 'ready',
    requiredColor: 'Red',
    requiredMaterial: 'PLA',
    requiredGrams: 200,
  };

  const cycle2: PlannedCycle = {
    id: testId('cycle-2'),
    projectId: projectB.id,
    printerId: printer.id,
    unitsPlanned: 8,
    gramsPlanned: 200,
    plateType: 'full',
    startTime: formatTime(addHours(baseDate, 3)), // 12:00
    endTime: formatTime(addHours(baseDate, 6)), // 15:00
    shift: 'day',
    status: 'planned',
    readinessState: 'waiting_for_spool',
    requiredColor: 'Blue',
    requiredMaterial: 'PLA',
    requiredGrams: 200,
  };

  const cycle3: PlannedCycle = {
    id: testId('cycle-3'),
    projectId: projectC.id,
    printerId: printer.id,
    unitsPlanned: 8,
    gramsPlanned: 200,
    plateType: 'full',
    startTime: formatTime(addHours(baseDate, 6)), // 15:00
    endTime: formatTime(addHours(baseDate, 9)), // 18:00
    shift: 'day',
    status: 'planned',
    readinessState: 'waiting_for_spool',
    requiredColor: 'Green',
    requiredMaterial: 'PLA',
    requiredGrams: 200,
  };

  // Save to localStorage
  saveTestData([product], [projectA, projectB, projectC], [printer], [spool], [cycle1, cycle2, cycle3]);

  return {
    scenario: 'complete_now',
    printerId: printer.id,
    cycleId: cycle1.id,
    projectId: projectA.id,
    description: `Created P1 with 3 cycles: C1 (09:00-12:00, due tomorrow), C2 (12:00-15:00), C3 (15:00-18:00). Open DecisionModal with completed_with_scrap.`,
  };
}

/**
 * Scenario 2: Defer
 * - Project with dueDate in 24 hours, estimatedHours=8
 * - Planned cycles that position estimatedStart late so riskLevel is high/critical
 */
export function seedDeferScenario(): ScenarioResult {
  const today = now();
  const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0);

  const product: Product = {
    id: testId('product'),
    name: 'Test Defer Widget',
    gramsPerUnit: 50,
    platePresets: [{
      id: testId('preset'),
      name: 'Standard',
      unitsPerPlate: 4,
      cycleHours: 4, // 4 hours per cycle = need 2 cycles for 8 hours recovery
      riskLevel: 'medium',
      allowedForNightCycle: false,
      isRecommended: true,
    }]
  };

  // Project due in 24 hours
  const project: Project = {
    id: testId('proj-defer'),
    name: 'Test Defer Project - Critical Deadline',
    productId: product.id,
    productName: product.name,
    quantityTarget: 40,
    quantityGood: 20,
    quantityScrap: 8, // 8 units to recover
    dueDate: addHours(today, 24).toISOString(), // Due in 24 hours
    urgency: 'critical',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Orange',
    createdAt: formatTime(addDays(today, -10)),
  };

  // Another project blocking the schedule
  const blockingProject: Project = {
    id: testId('proj-blocking'),
    name: 'Blocking Project',
    productId: product.id,
    productName: product.name,
    quantityTarget: 100,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: addDays(today, 3).toISOString().split('T')[0],
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Gray',
    createdAt: formatTime(addDays(today, -5)),
  };

  const printer: Printer = {
    id: testId('printer-defer'),
    printerNumber: 98,
    name: 'Test Printer Defer',
    active: true,
    status: 'active',
    hasAMS: false,
    currentColor: 'Orange',
    currentMaterial: 'PLA',
  };

  const spool: Spool = {
    id: testId('spool-defer'),
    color: 'Orange',
    material: 'PLA',
    packageSize: 1000,
    gramsRemainingEst: 800,
    state: 'open',
    location: 'printer',
    assignedPrinterId: printer.id,
    needsAudit: false,
  };

  // Current cycle ending
  const currentCycle: PlannedCycle = {
    id: testId('cycle-defer-current'),
    projectId: project.id,
    printerId: printer.id,
    unitsPlanned: 4,
    gramsPlanned: 200,
    plateType: 'full',
    startTime: formatTime(addHours(baseDate, -4)),
    endTime: formatTime(baseDate), // Ending now
    shift: 'day',
    status: 'in_progress',
    readinessState: 'ready',
    requiredColor: 'Orange',
    requiredMaterial: 'PLA',
    requiredGrams: 200,
  };

  // Blocking cycles - fill up the next 20 hours so recovery can't fit
  const blockingCycles: PlannedCycle[] = [];
  for (let i = 0; i < 5; i++) {
    blockingCycles.push({
      id: testId(`cycle-blocking-${i}`),
      projectId: blockingProject.id,
      printerId: printer.id,
      unitsPlanned: 4,
      gramsPlanned: 200,
      plateType: 'full',
      startTime: formatTime(addHours(baseDate, i * 4)), // Every 4 hours
      endTime: formatTime(addHours(baseDate, (i + 1) * 4)),
      shift: 'day',
      status: 'planned',
      readinessState: 'waiting_for_spool',
      requiredColor: 'Gray',
      requiredMaterial: 'PLA',
      requiredGrams: 200,
    });
  }

  saveTestData([product], [project, blockingProject], [printer], [spool], [currentCycle, ...blockingCycles]);

  return {
    scenario: 'defer',
    printerId: printer.id,
    cycleId: currentCycle.id,
    projectId: project.id,
    description: `Created critical project due in 24h with 8 units to recover (needs ~8h). Schedule is blocked for 20h. riskLevel should be high/critical.`,
  };
}

/**
 * Scenario 3: Merge
 * - Future cycle of same project on P1 + 2 more cycles after
 * - unitsToRecover so additionalTimeNeeded ~1-2h
 * - extensionImpact.affectedCycles returns array with delayHours
 */
export function seedMergeScenario(): ScenarioResult {
  const today = now();
  const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0);

  const product: Product = {
    id: testId('product-merge'),
    name: 'Test Merge Widget',
    gramsPerUnit: 30,
    platePresets: [{
      id: testId('preset-merge'),
      name: 'Standard',
      unitsPerPlate: 10, // Max 10, so cycles with 6 have room for 4 more
      cycleHours: 3,
      riskLevel: 'low',
      allowedForNightCycle: true,
      isRecommended: true,
    }]
  };

  const project: Project = {
    id: testId('proj-merge'),
    name: 'Test Merge Project',
    productId: product.id,
    productName: product.name,
    quantityTarget: 50,
    quantityGood: 20,
    quantityScrap: 4, // 4 units to recover = ~1.5-2h additional
    dueDate: addDays(today, 5).toISOString().split('T')[0],
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Purple',
    createdAt: formatTime(addDays(today, -7)),
  };

  const projectOther1: Project = {
    id: testId('proj-other-1'),
    name: 'Other Project 1',
    productId: product.id,
    productName: product.name,
    quantityTarget: 30,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: addDays(today, 6).toISOString().split('T')[0],
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Cyan',
    createdAt: formatTime(addDays(today, -3)),
  };

  const projectOther2: Project = {
    id: testId('proj-other-2'),
    name: 'Other Project 2',
    productId: product.id,
    productName: product.name,
    quantityTarget: 25,
    quantityGood: 0,
    quantityScrap: 0,
    dueDate: addDays(today, 7).toISOString().split('T')[0],
    urgency: 'normal',
    urgencyManualOverride: false,
    status: 'in_progress',
    color: 'Magenta',
    createdAt: formatTime(addDays(today, -2)),
  };

  const printer: Printer = {
    id: testId('printer-merge'),
    printerNumber: 97,
    name: 'Test Printer Merge',
    active: true,
    status: 'active',
    hasAMS: false,
    currentColor: 'Purple',
    currentMaterial: 'PLA',
  };

  const spool: Spool = {
    id: testId('spool-merge'),
    color: 'Purple',
    material: 'PLA',
    packageSize: 1000,
    gramsRemainingEst: 600,
    state: 'open',
    location: 'printer',
    assignedPrinterId: printer.id,
    needsAudit: false,
  };

  // Current cycle that just finished with scrap
  const currentCycle: PlannedCycle = {
    id: testId('cycle-merge-current'),
    projectId: project.id,
    printerId: printer.id,
    unitsPlanned: 6,
    gramsPlanned: 180,
    plateType: 'full',
    startTime: formatTime(addHours(baseDate, -3)),
    endTime: formatTime(baseDate),
    shift: 'day',
    status: 'in_progress',
    readinessState: 'ready',
    requiredColor: 'Purple',
    requiredMaterial: 'PLA',
    requiredGrams: 180,
  };

  // Future cycle of SAME project - merge candidate
  const futureSameProjectCycle: PlannedCycle = {
    id: testId('cycle-merge-future'),
    projectId: project.id,
    printerId: printer.id,
    unitsPlanned: 6,
    gramsPlanned: 180,
    plateType: 'full',
    startTime: formatTime(addHours(baseDate, 3)), // 3 hours from now
    endTime: formatTime(addHours(baseDate, 6)),
    shift: 'day',
    status: 'planned',
    readinessState: 'waiting_for_spool',
    requiredColor: 'Purple',
    requiredMaterial: 'PLA',
    requiredGrams: 180,
  };

  // 2 more cycles after the merge candidate
  const cycle2: PlannedCycle = {
    id: testId('cycle-after-1'),
    projectId: projectOther1.id,
    printerId: printer.id,
    unitsPlanned: 6,
    gramsPlanned: 180,
    plateType: 'full',
    startTime: formatTime(addHours(baseDate, 6)), // Right after future cycle
    endTime: formatTime(addHours(baseDate, 9)),
    shift: 'day',
    status: 'planned',
    readinessState: 'waiting_for_spool',
    requiredColor: 'Cyan',
    requiredMaterial: 'PLA',
    requiredGrams: 180,
  };

  const cycle3: PlannedCycle = {
    id: testId('cycle-after-2'),
    projectId: projectOther2.id,
    printerId: printer.id,
    unitsPlanned: 6,
    gramsPlanned: 180,
    plateType: 'full',
    startTime: formatTime(addHours(baseDate, 9)), // After cycle2
    endTime: formatTime(addHours(baseDate, 12)),
    shift: 'day',
    status: 'planned',
    readinessState: 'waiting_for_spool',
    requiredColor: 'Magenta',
    requiredMaterial: 'PLA',
    requiredGrams: 180,
  };

  saveTestData(
    [product], 
    [project, projectOther1, projectOther2], 
    [printer], 
    [spool], 
    [currentCycle, futureSameProjectCycle, cycle2, cycle3]
  );

  return {
    scenario: 'merge',
    printerId: printer.id,
    cycleId: currentCycle.id,
    projectId: project.id,
    description: `Created merge scenario: current cycle + future cycle of same project + 2 more cycles after. 4 units to recover (~1.5h). Check extensionImpact.affectedCycles.`,
  };
}

/**
 * Helper to save test data, appending to existing data
 */
function saveTestData(
  products: Product[],
  projects: Project[],
  printers: Printer[],
  spools: Spool[],
  cycles: PlannedCycle[]
) {
  // Get existing data
  const existingProducts = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
  const existingProjects = JSON.parse(localStorage.getItem(KEYS.PROJECTS) || '[]');
  const existingPrinters = JSON.parse(localStorage.getItem(KEYS.PRINTERS) || '[]');
  const existingSpools = JSON.parse(localStorage.getItem(KEYS.SPOOLS) || '[]');
  const existingCycles = JSON.parse(localStorage.getItem(KEYS.PLANNED_CYCLES) || '[]');

  // Append new data
  localStorage.setItem(KEYS.PRODUCTS, JSON.stringify([...existingProducts, ...products]));
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify([...existingProjects, ...projects]));
  localStorage.setItem(KEYS.PRINTERS, JSON.stringify([...existingPrinters, ...printers]));
  localStorage.setItem(KEYS.SPOOLS, JSON.stringify([...existingSpools, ...spools]));
  localStorage.setItem(KEYS.PLANNED_CYCLES, JSON.stringify([...existingCycles, ...cycles]));
}

/**
 * Clear all test data (entities with IDs starting with 'test-')
 */
export function clearTestData() {
  const filterNonTest = <T extends { id: string }>(items: T[]) => 
    items.filter(item => !item.id.startsWith('test-'));

  const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]');
  const projects = JSON.parse(localStorage.getItem(KEYS.PROJECTS) || '[]');
  const printers = JSON.parse(localStorage.getItem(KEYS.PRINTERS) || '[]');
  const spools = JSON.parse(localStorage.getItem(KEYS.SPOOLS) || '[]');
  const cycles = JSON.parse(localStorage.getItem(KEYS.PLANNED_CYCLES) || '[]');

  localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(filterNonTest(products)));
  localStorage.setItem(KEYS.PROJECTS, JSON.stringify(filterNonTest(projects)));
  localStorage.setItem(KEYS.PRINTERS, JSON.stringify(filterNonTest(printers)));
  localStorage.setItem(KEYS.SPOOLS, JSON.stringify(filterNonTest(spools)));
  localStorage.setItem(KEYS.PLANNED_CYCLES, JSON.stringify(filterNonTest(cycles)));
}

// ============= SCENARIO FREEZE/REPLAY =============

const FROZEN_SCENARIO_KEY = 'frozen_test_scenario';

export interface FrozenScenario {
  id: string;
  name: string;
  frozenAt: string;
  scenario: TestScenario;
  data: {
    products: Product[];
    projects: Project[];
    printers: Printer[];
    spools: Spool[];
    cycles: PlannedCycle[];
  };
}

/**
 * Freeze current test scenario state for replay
 */
export function freezeCurrentScenario(name: string, scenario: TestScenario): FrozenScenario {
  const products = JSON.parse(localStorage.getItem(KEYS.PRODUCTS) || '[]').filter(
    (p: Product) => p.id.startsWith('test-')
  );
  const projects = JSON.parse(localStorage.getItem(KEYS.PROJECTS) || '[]').filter(
    (p: Project) => p.id.startsWith('test-')
  );
  const printers = JSON.parse(localStorage.getItem(KEYS.PRINTERS) || '[]').filter(
    (p: Printer) => p.id.startsWith('test-')
  );
  const spools = JSON.parse(localStorage.getItem(KEYS.SPOOLS) || '[]').filter(
    (s: Spool) => s.id.startsWith('test-')
  );
  const cycles = JSON.parse(localStorage.getItem(KEYS.PLANNED_CYCLES) || '[]').filter(
    (c: PlannedCycle) => c.id.startsWith('test-')
  );

  const frozen: FrozenScenario = {
    id: `frozen-${Date.now()}`,
    name,
    frozenAt: new Date().toISOString(),
    scenario,
    data: { products, projects, printers, spools, cycles },
  };

  // Save to localStorage
  const existing = getFrozenScenarios();
  existing.push(frozen);
  localStorage.setItem(FROZEN_SCENARIO_KEY, JSON.stringify(existing));

  return frozen;
}

/**
 * Get all frozen scenarios
 */
export function getFrozenScenarios(): FrozenScenario[] {
  try {
    const data = localStorage.getItem(FROZEN_SCENARIO_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Restore a frozen scenario
 */
export function restoreFrozenScenario(scenarioId: string): boolean {
  const scenarios = getFrozenScenarios();
  const scenario = scenarios.find(s => s.id === scenarioId);
  if (!scenario) return false;

  // Clear existing test data
  clearTestData();

  // Restore frozen data
  saveTestData(
    scenario.data.products,
    scenario.data.projects,
    scenario.data.printers,
    scenario.data.spools,
    scenario.data.cycles
  );

  return true;
}

/**
 * Delete a frozen scenario
 */
export function deleteFrozenScenario(scenarioId: string): void {
  const scenarios = getFrozenScenarios().filter(s => s.id !== scenarioId);
  localStorage.setItem(FROZEN_SCENARIO_KEY, JSON.stringify(scenarios));
}

/**
 * Clear all frozen scenarios
 */
export function clearAllFrozenScenarios(): void {
  localStorage.setItem(FROZEN_SCENARIO_KEY, JSON.stringify([]));
}

/**
 * Get test scenario info for display
 */
export function getScenarioInfo(scenario: TestScenario): { 
  titleHe: string; 
  titleEn: string; 
  descriptionHe: string;
  descriptionEn: string;
} {
  switch (scenario) {
    case 'complete_now':
      return {
        titleHe: 'תרחיש 1: Complete Now',
        titleEn: 'Scenario 1: Complete Now',
        descriptionHe: 'מדפסת P1 עם 3 מחזורים (C1 דחוף, C2/C3 רגילים). בודק domino effect.',
        descriptionEn: 'Printer P1 with 3 cycles (C1 urgent, C2/C3 normal). Tests domino effect.',
      };
    case 'defer':
      return {
        titleHe: 'תרחיש 2: Defer',
        titleEn: 'Scenario 2: Defer',
        descriptionHe: 'פרויקט קריטי ב-24 שעות, לו"ז חסום. בודק riskLevel גבוה.',
        descriptionEn: 'Critical project in 24h, blocked schedule. Tests high riskLevel.',
      };
    case 'merge':
      return {
        titleHe: 'תרחיש 3: Merge',
        titleEn: 'Scenario 3: Merge',
        descriptionHe: 'מחזור עתידי של אותו פרויקט + 2 מחזורים אחריו. בודק extensionImpact.',
        descriptionEn: 'Future cycle of same project + 2 cycles after. Tests extensionImpact.',
      };
  }
}
