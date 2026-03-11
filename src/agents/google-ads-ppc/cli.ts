#!/usr/bin/env tsx
/**
 * Google Ads PPC Agent CLI
 *
 * Usage:
 *   npm run job:analyze-ppc -- --customer-id 9926142954 --target-cpl 80
 *   npm run job:analyze-ppc -- --client chisholm --full-report
 *   npm run job:analyze-ppc -- --all-clients --output json
 */

import { spawn } from 'child_process';
import { createLogger } from '../../shared/utils/logger.js';
import path from 'path';
import fs from 'fs';

const logger = createLogger('ppc-cli');

interface CLIOptions {
  customerId?: string;
  client?: string;
  targetCpl?: number;
  allClients?: boolean;
  output?: 'json' | 'text' | 'html';
  fullReport?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

// Client configurations - will be moved to database in Phase 2
const CLIENTS: Record<string, { customerId: string; targetCpl: number; name: string }> = {
  chisholm: {
    customerId: '9926142954',
    targetCpl: 80,
    name: 'Chisholm Law Firm',
  },
};

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--customer-id':
        options.customerId = nextArg;
        i++;
        break;
      case '--client':
        options.client = nextArg?.toLowerCase();
        i++;
        break;
      case '--target-cpl':
        options.targetCpl = parseFloat(nextArg);
        i++;
        break;
      case '--all-clients':
        options.allClients = true;
        break;
      case '--output':
        options.output = nextArg as 'json' | 'text' | 'html';
        i++;
        break;
      case '--full-report':
        options.fullReport = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                     Google Ads PPC Agent CLI                               ║
╚════════════════════════════════════════════════════════════════════════════╝

USAGE:
  npm run job:analyze-ppc -- [options]

OPTIONS:
  --customer-id <id>     Google Ads customer ID (e.g., 9926142954)
  --client <name>        Client name (e.g., chisholm)
  --target-cpl <amount>  Target cost per lead (default: 80)
  --all-clients          Run analysis for all configured clients
  --output <format>      Output format: json, text, html (default: text)
  --full-report          Generate comprehensive report
  --dry-run              Preview actions without executing
  --verbose, -v          Enable verbose logging
  --help, -h             Show this help message

EXAMPLES:
  # Analyze specific customer
  npm run job:analyze-ppc -- --customer-id 9926142954 --target-cpl 80

  # Analyze by client name
  npm run job:analyze-ppc -- --client chisholm --full-report

  # Analyze all clients with JSON output
  npm run job:analyze-ppc -- --all-clients --output json

CONFIGURED CLIENTS:
${Object.entries(CLIENTS)
  .map(([key, client]) => `  ${key}: ${client.name} (ID: ${client.customerId}, Target CPL: $${client.targetCpl})`)
  .join('\n')}
`);
}

async function runPythonAnalysis(
  customerId: string,
  targetCpl: number,
  options: CLIOptions
): Promise<{ success: boolean; output: string; data?: any }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(
      process.cwd(),
      'src/agents/google-ads-ppc/historical_analysis.py'
    );

    // Check if Python script exists
    if (!fs.existsSync(scriptPath)) {
      resolve({
        success: false,
        output: `Python script not found: ${scriptPath}`,
      });
      return;
    }

    const pythonProcess = spawn('python3', [scriptPath], {
      env: {
        ...process.env,
        CUSTOMER_ID: customerId,
        TARGET_CPL: targetCpl.toString(),
      },
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (options.verbose) {
        process.stdout.write(text);
      }
    });

    pythonProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (options.verbose) {
        process.stderr.write(text);
      }
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        // Try to read the output JSON file
        const outputPath = path.join(
          process.cwd(),
          'src/agents/google-ads-ppc/historical_analysis_output.json'
        );
        let data;
        try {
          if (fs.existsSync(outputPath)) {
            data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
          }
        } catch (e) {
          // Ignore JSON parse errors
        }

        resolve({
          success: true,
          output: stdout,
          data,
        });
      } else {
        resolve({
          success: false,
          output: stderr || stdout || `Process exited with code ${code}`,
        });
      }
    });

    pythonProcess.on('error', (error) => {
      resolve({
        success: false,
        output: `Failed to start Python process: ${error.message}`,
      });
    });
  });
}

function formatOutput(
  results: Array<{ client: string; success: boolean; data?: any; error?: string }>,
  format: 'json' | 'text' | 'html'
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(results, null, 2);

    case 'html':
      return `
<!DOCTYPE html>
<html>
<head>
  <title>PPC Analysis Report</title>
  <style>
    body { font-family: system-ui; background: #0A0A0B; color: #FAFAFA; padding: 2rem; }
    .client { background: #1F1F23; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .success { border-left: 4px solid #22C55E; }
    .error { border-left: 4px solid #EF4444; }
    h1 { color: #3B82F6; }
    h2 { color: #A1A1AA; font-size: 1.2rem; }
    .metric { display: inline-block; margin-right: 2rem; }
    .metric-value { font-size: 2rem; font-weight: bold; }
    .metric-label { color: #71717A; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>PPC Analysis Report</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  ${results
    .map(
      (r) => `
    <div class="client ${r.success ? 'success' : 'error'}">
      <h2>${r.client}</h2>
      ${
        r.success && r.data
          ? `
        <div class="metrics">
          <div class="metric">
            <div class="metric-value">$${r.data.monthly_performance?.['2026-03']?.cpl?.toFixed(2) || 'N/A'}</div>
            <div class="metric-label">Current CPL</div>
          </div>
          <div class="metric">
            <div class="metric-value">${r.data.monthly_performance?.['2026-03']?.conversions?.toFixed(0) || 'N/A'}</div>
            <div class="metric-label">Conversions</div>
          </div>
        </div>
      `
          : `<p style="color: #EF4444;">${r.error || 'Analysis failed'}</p>`
      }
    </div>
  `
    )
    .join('')}
</body>
</html>`;

    case 'text':
    default:
      return results
        .map((r) => {
          const lines = [
            `\n${'═'.repeat(60)}`,
            `  ${r.client}`,
            `${'═'.repeat(60)}`,
          ];

          if (r.success && r.data) {
            const monthly = r.data.monthly_performance || {};
            const monthKeys = Object.keys(monthly).sort();
            const latestMonth = monthKeys.length > 0 ? monthKeys[monthKeys.length - 1] : null;
            const latest = latestMonth ? monthly[latestMonth] : {};

            lines.push(
              `  Status: ✅ Success`,
              `  Period: ${r.data.analysis_period || 'N/A'}`,
              ``,
              `  Latest Month (${latestMonth}):`,
              `    • Spend: $${latest.spend?.toFixed(2) || 'N/A'}`,
              `    • Conversions: ${latest.conversions?.toFixed(0) || 'N/A'}`,
              `    • CPL: $${latest.cpl?.toFixed(2) || 'N/A'}`,
              `    • CTR: ${latest.ctr?.toFixed(2) || 'N/A'}%`
            );

            if (r.data.insights?.length) {
              lines.push(``, `  Key Insights:`);
              r.data.insights.slice(0, 3).forEach((insight: any) => {
                const icon = insight.implication === 'positive' ? '✅' : insight.implication === 'negative' ? '❌' : 'ℹ️';
                lines.push(`    ${icon} ${insight.insight}`);
              });
            }
          } else {
            lines.push(`  Status: ❌ Failed`, `  Error: ${r.error || 'Unknown error'}`);
          }

          return lines.join('\n');
        })
        .join('\n');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                     Google Ads PPC Agent                                   ║
║                     Analyzing Performance...                               ║
╚════════════════════════════════════════════════════════════════════════════╝
`);

  const results: Array<{ client: string; success: boolean; data?: any; error?: string }> = [];

  // Determine which clients to analyze
  let clientsToAnalyze: Array<{ name: string; customerId: string; targetCpl: number }> = [];

  if (options.allClients) {
    clientsToAnalyze = Object.values(CLIENTS);
  } else if (options.client) {
    const client = CLIENTS[options.client];
    if (!client) {
      console.error(`❌ Unknown client: ${options.client}`);
      console.error(`   Available clients: ${Object.keys(CLIENTS).join(', ')}`);
      process.exit(1);
    }
    clientsToAnalyze = [client];
  } else if (options.customerId) {
    clientsToAnalyze = [
      {
        name: `Customer ${options.customerId}`,
        customerId: options.customerId,
        targetCpl: options.targetCpl || 80,
      },
    ];
  } else {
    // Default to all clients
    clientsToAnalyze = Object.values(CLIENTS);
  }

  // Run analysis for each client
  for (const client of clientsToAnalyze) {
    logger.info({ client: client.name }, 'Starting analysis');

    if (!options.verbose) {
      console.log(`\n📊 Analyzing ${client.name}...`);
    }

    const result = await runPythonAnalysis(
      client.customerId,
      options.targetCpl || client.targetCpl,
      options
    );

    results.push({
      client: client.name,
      success: result.success,
      data: result.data,
      error: result.success ? undefined : result.output,
    });

    if (result.success) {
      logger.info({ client: client.name }, 'Analysis completed');
    } else {
      logger.error({ client: client.name, error: result.output }, 'Analysis failed');
    }
  }

  // Output results
  const output = formatOutput(results, options.output || 'text');
  console.log(output);

  // Save to file if JSON or HTML
  if (options.output === 'json' || options.output === 'html') {
    const ext = options.output === 'json' ? 'json' : 'html';
    const outputPath = path.join(process.cwd(), `ppc-analysis-report.${ext}`);
    fs.writeFileSync(outputPath, output);
    console.log(`\n✅ Report saved to: ${outputPath}`);
  }

  // Exit with error if any analysis failed
  const hasErrors = results.some((r) => !r.success);
  process.exit(hasErrors ? 1 : 0);
}

main().catch((error) => {
  logger.error({ error }, 'CLI failed');
  console.error(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
