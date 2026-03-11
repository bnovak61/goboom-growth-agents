export interface PracticeAreaBenchmark {
  practiceArea: string;
  targetCpl: number;
  warningCpl: number;
  criticalCpl: number;
  expectedCtr: number; // minimum healthy CTR
  expectedCpm: number; // typical CPM
}

export const PRACTICE_AREA_BENCHMARKS: Record<string, PracticeAreaBenchmark> = {
  personal_injury: {
    practiceArea: 'Personal Injury',
    targetCpl: 62.5,   // midpoint of $50-$75
    warningCpl: 100,
    criticalCpl: 150,
    expectedCtr: 1.5,
    expectedCpm: 25,
  },
  immigration: {
    practiceArea: 'Immigration',
    targetCpl: 45,      // midpoint of $35-$55
    warningCpl: 75,
    criticalCpl: 110,
    expectedCtr: 1.2,
    expectedCpm: 20,
  },
  criminal_defense: {
    practiceArea: 'Criminal Defense',
    targetCpl: 50,      // midpoint of $40-$60
    warningCpl: 85,
    criticalCpl: 125,
    expectedCtr: 1.3,
    expectedCpm: 22,
  },
  family_law: {
    practiceArea: 'Family Law',
    targetCpl: 67.5,    // midpoint of $55-$80
    warningCpl: 110,
    criticalCpl: 160,
    expectedCtr: 1.4,
    expectedCpm: 28,
  },
  workers_comp: {
    practiceArea: 'Workers Compensation',
    targetCpl: 77.5,    // midpoint of $65-$90
    warningCpl: 120,
    criticalCpl: 180,
    expectedCtr: 1.1,
    expectedCpm: 30,
  },
  estate_planning: {
    practiceArea: 'Estate Planning',
    targetCpl: 55,
    warningCpl: 90,
    criticalCpl: 140,
    expectedCtr: 1.3,
    expectedCpm: 22,
  },
  employment_law: {
    practiceArea: 'Employment Law',
    targetCpl: 60,
    warningCpl: 95,
    criticalCpl: 145,
    expectedCtr: 1.2,
    expectedCpm: 24,
  },
  bankruptcy: {
    practiceArea: 'Bankruptcy',
    targetCpl: 40,
    warningCpl: 70,
    criticalCpl: 100,
    expectedCtr: 1.5,
    expectedCpm: 18,
  },
};

export function getBenchmark(practiceArea?: string): PracticeAreaBenchmark {
  if (!practiceArea) {
    // Default general benchmark
    return {
      practiceArea: 'General',
      targetCpl: 60,
      warningCpl: 100,
      criticalCpl: 150,
      expectedCtr: 1.3,
      expectedCpm: 25,
    };
  }

  const key = practiceArea.toLowerCase().replace(/\s+/g, '_');
  return PRACTICE_AREA_BENCHMARKS[key] ?? getBenchmark();
}

export function getCplStatus(
  cpl: number,
  benchmark: PracticeAreaBenchmark
): 'healthy' | 'warning' | 'critical' {
  if (cpl <= benchmark.targetCpl) return 'healthy';
  if (cpl <= benchmark.warningCpl) return 'warning';
  return 'critical';
}
