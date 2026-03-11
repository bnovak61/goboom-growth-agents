#!/usr/bin/env node
/**
 * Google Ads PPC Agent - Direct REST API Implementation
 *
 * Analyzes Google Ads campaigns like a veteran PPC engineer
 * and executes fixes autonomously.
 */

import fs from 'fs';

// Configuration
const CONFIG = {
  credentials: JSON.parse(fs.readFileSync('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json', 'utf-8')),
  developerToken: 'wyv5YWkns7LYXHjsZ5bokg',
  loginCustomerId: '5660386900',
  customerId: '9926142954', // Chisholm Law Firm
  targetCPL: 80, // Target CPL
  apiVersion: 'v17'
};

// Get OAuth access token
async function getAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CONFIG.credentials.client_id,
      client_secret: CONFIG.credentials.client_secret,
      refresh_token: CONFIG.credentials.refresh_token,
      grant_type: 'refresh_token'
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// Execute GAQL query
async function executeQuery(accessToken, query) {
  const url = `https://googleads.googleapis.com/${CONFIG.apiVersion}/customers/${CONFIG.customerId}/googleAds:search`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': CONFIG.developerToken,
      'login-customer-id': CONFIG.loginCustomerId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`API Error (${response.status}):`, errorText.substring(0, 500));
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

// Get active search campaigns
async function getCampaigns(accessToken) {
  console.log('\n📊 Fetching active search campaigns...');

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_per_conversion,
      metrics.search_impression_share
    FROM campaign
    WHERE campaign.status = 'ENABLED'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC
  `;

  const result = await executeQuery(accessToken, query);
  const campaigns = (result.results || []).map(r => ({
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    type: r.campaign?.advertisingChannelType,
    budget: (parseInt(r.campaignBudget?.amountMicros) || 0) / 1000000,
    spend: (parseInt(r.metrics?.costMicros) || 0) / 1000000,
    impressions: parseInt(r.metrics?.impressions) || 0,
    clicks: parseInt(r.metrics?.clicks) || 0,
    conversions: parseFloat(r.metrics?.conversions) || 0,
    ctr: parseFloat(r.metrics?.ctr) || 0,
    cpc: (parseInt(r.metrics?.averageCpc) || 0) / 1000000,
    cpl: parseFloat(r.metrics?.costPerConversion) / 1000000 || Infinity,
    impressionShare: parseFloat(r.metrics?.searchImpressionShare) || 0
  }));

  console.log(`   Found ${campaigns.length} active search campaigns`);
  return campaigns;
}

// Get keywords with performance data
async function getKeywords(accessToken) {
  console.log('\n🔑 Fetching keyword performance...');

  const query = `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr,
      metrics.average_cpc,
      ad_group_criterion.quality_info.quality_score
    FROM keyword_view
    WHERE campaign.status = 'ENABLED'
      AND ad_group_criterion.status = 'ENABLED'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC
    LIMIT 200
  `;

  const result = await executeQuery(accessToken, query);
  const keywords = (result.results || []).map(r => ({
    id: r.adGroupCriterion?.criterionId,
    text: r.adGroupCriterion?.keyword?.text,
    matchType: r.adGroupCriterion?.keyword?.matchType,
    status: r.adGroupCriterion?.status,
    adGroupId: r.adGroup?.id,
    adGroupName: r.adGroup?.name,
    campaignId: r.campaign?.id,
    campaignName: r.campaign?.name,
    impressions: parseInt(r.metrics?.impressions) || 0,
    clicks: parseInt(r.metrics?.clicks) || 0,
    cost: (parseInt(r.metrics?.costMicros) || 0) / 1000000,
    conversions: parseFloat(r.metrics?.conversions) || 0,
    ctr: parseFloat(r.metrics?.ctr) || 0,
    cpc: (parseInt(r.metrics?.averageCpc) || 0) / 1000000,
    qualityScore: r.adGroupCriterion?.qualityInfo?.qualityScore
  }));

  console.log(`   Found ${keywords.length} active keywords`);
  return keywords;
}

// Get search terms report
async function getSearchTerms(accessToken) {
  console.log('\n🔍 Analyzing search terms...');

  const query = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.ctr
    FROM search_term_view
    WHERE campaign.status = 'ENABLED'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND segments.date DURING LAST_14_DAYS
    ORDER BY metrics.cost_micros DESC
    LIMIT 500
  `;

  const result = await executeQuery(accessToken, query);
  const terms = (result.results || []).map(r => ({
    term: r.searchTermView?.searchTerm,
    status: r.searchTermView?.status,
    campaignId: r.campaign?.id,
    campaignName: r.campaign?.name,
    adGroupId: r.adGroup?.id,
    adGroupName: r.adGroup?.name,
    impressions: parseInt(r.metrics?.impressions) || 0,
    clicks: parseInt(r.metrics?.clicks) || 0,
    cost: (parseInt(r.metrics?.costMicros) || 0) / 1000000,
    conversions: parseFloat(r.metrics?.conversions) || 0,
    ctr: parseFloat(r.metrics?.ctr) || 0
  }));

  console.log(`   Found ${terms.length} search terms`);
  return terms;
}

// Get daily performance for trend analysis
async function getDailyPerformance(accessToken) {
  console.log('\n📈 Fetching daily performance trends...');

  const query = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.ctr,
      metrics.cost_per_conversion
    FROM campaign
    WHERE campaign.status = 'ENABLED'
      AND campaign.advertising_channel_type = 'SEARCH'
      AND segments.date DURING LAST_30_DAYS
    ORDER BY segments.date DESC
  `;

  const result = await executeQuery(accessToken, query);

  // Aggregate by date
  const byDate = {};
  (result.results || []).forEach(r => {
    const date = r.segments?.date;
    if (!byDate[date]) {
      byDate[date] = { date, spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    }
    byDate[date].spend += (parseInt(r.metrics?.costMicros) || 0) / 1000000;
    byDate[date].impressions += parseInt(r.metrics?.impressions) || 0;
    byDate[date].clicks += parseInt(r.metrics?.clicks) || 0;
    byDate[date].conversions += parseFloat(r.metrics?.conversions) || 0;
  });

  const dailyData = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
  console.log(`   Got ${dailyData.length} days of data`);
  return dailyData;
}

// Analyze performance and identify issues
function analyzePerformance(campaigns, keywords, searchTerms, dailyData) {
  console.log('\n🧠 Analyzing performance...');

  const issues = [];
  const recommendations = [];

  // Calculate totals
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);
  const avgCPL = totalConversions > 0 ? totalSpend / totalConversions : Infinity;
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  // Analyze week-over-week performance
  if (dailyData.length >= 14) {
    const lastWeek = dailyData.slice(0, 7);
    const prevWeek = dailyData.slice(7, 14);

    const lastWeekConv = lastWeek.reduce((s, d) => s + d.conversions, 0);
    const prevWeekConv = prevWeek.reduce((s, d) => s + d.conversions, 0);
    const lastWeekSpend = lastWeek.reduce((s, d) => s + d.spend, 0);
    const prevWeekSpend = prevWeek.reduce((s, d) => s + d.spend, 0);

    const lastWeekCPL = lastWeekConv > 0 ? lastWeekSpend / lastWeekConv : Infinity;
    const prevWeekCPL = prevWeekConv > 0 ? prevWeekSpend / prevWeekConv : Infinity;

    const convChange = prevWeekConv > 0 ? ((lastWeekConv - prevWeekConv) / prevWeekConv * 100) : 0;
    const cplChange = prevWeekCPL > 0 && prevWeekCPL !== Infinity ? ((lastWeekCPL - prevWeekCPL) / prevWeekCPL * 100) : 0;

    if (convChange < -20) {
      issues.push({
        severity: 'CRITICAL',
        type: 'CONVERSION_DROP',
        description: `Conversions dropped ${Math.abs(convChange).toFixed(0)}% week-over-week`,
        detail: `Last week: ${lastWeekConv.toFixed(0)} conversions ($${lastWeekCPL.toFixed(2)} CPL) vs Previous: ${prevWeekConv.toFixed(0)} conversions ($${prevWeekCPL.toFixed(2)} CPL)`
      });
    }

    if (cplChange > 30) {
      issues.push({
        severity: 'CRITICAL',
        type: 'CPL_SPIKE',
        description: `CPL increased ${cplChange.toFixed(0)}% week-over-week`,
        detail: `$${lastWeekCPL.toFixed(2)} vs $${prevWeekCPL.toFixed(2)} previous week`
      });
    }
  }

  // Campaign-level analysis
  campaigns.forEach(c => {
    if (c.cpl > CONFIG.targetCPL * 1.5 && c.conversions >= 3) {
      issues.push({
        severity: 'HIGH',
        type: 'HIGH_CPL_CAMPAIGN',
        description: `"${c.name}" - CPL $${c.cpl.toFixed(2)} is ${Math.round((c.cpl / CONFIG.targetCPL - 1) * 100)}% above target`,
        detail: `Spent $${c.spend.toFixed(2)}, ${c.conversions.toFixed(0)} conversions`
      });
    }

    if (c.ctr < 2 && c.impressions > 1000) {
      issues.push({
        severity: 'MEDIUM',
        type: 'LOW_CTR',
        description: `"${c.name}" - CTR ${(c.ctr * 100).toFixed(2)}% is below 2%`,
        detail: `${c.impressions.toLocaleString()} impressions, ${c.clicks} clicks`
      });
    }

    if (c.conversions === 0 && c.spend > 100) {
      issues.push({
        severity: 'CRITICAL',
        type: 'ZERO_CONVERSIONS',
        description: `"${c.name}" - Zero conversions with $${c.spend.toFixed(2)} spend`,
        detail: 'Check conversion tracking or pause campaign'
      });
    }

    // Good performer - recommend budget increase
    if (c.cpl < CONFIG.targetCPL * 0.7 && c.conversions >= 5 && c.impressionShare < 0.8) {
      recommendations.push({
        priority: 1,
        type: 'INCREASE_BUDGET',
        action: `Increase budget for "${c.name}"`,
        reason: `CPL $${c.cpl.toFixed(2)} is ${Math.round((1 - c.cpl / CONFIG.targetCPL) * 100)}% below target with only ${(c.impressionShare * 100).toFixed(0)}% impression share`,
        impact: `Could capture more conversions at efficient CPL`
      });
    }
  });

  // Keyword analysis - find low quality scores
  const lowQSKeywords = keywords.filter(k => k.qualityScore && k.qualityScore < 5 && k.cost > 20);
  if (lowQSKeywords.length > 0) {
    issues.push({
      severity: 'HIGH',
      type: 'LOW_QUALITY_SCORES',
      description: `${lowQSKeywords.length} keywords with Quality Score below 5`,
      detail: lowQSKeywords.slice(0, 5).map(k => `"${k.text}" (QS: ${k.qualityScore})`).join(', ')
    });
  }

  // Search term analysis - find informational queries
  const informationalPatterns = /\b(what is|how to|how do|can i|should i|is it|why|when|definition|meaning|example|tutorial|guide|free|diy|reddit|jobs|salary|career|school|degree)\b/i;
  const informationalTerms = searchTerms.filter(t => informationalPatterns.test(t.term) && t.cost > 5);
  const wastedSpend = informationalTerms.reduce((s, t) => s + t.cost, 0);

  if (informationalTerms.length > 0) {
    issues.push({
      severity: 'CRITICAL',
      type: 'INFORMATIONAL_QUERIES',
      description: `${informationalTerms.length} informational search terms wasting $${wastedSpend.toFixed(2)}`,
      detail: informationalTerms.slice(0, 5).map(t => `"${t.term}" ($${t.cost.toFixed(2)})`).join(', ')
    });

    recommendations.push({
      priority: 1,
      type: 'ADD_NEGATIVES',
      action: 'Add negative keywords for informational queries',
      reason: `${informationalTerms.length} search terms show informational intent, not buying intent`,
      impact: `Save ~$${wastedSpend.toFixed(2)}/period and improve lead quality`,
      negatives: ['what is', 'how to', 'free', 'diy', 'jobs', 'salary', 'reddit', 'school', 'degree', 'definition', 'example', 'tutorial']
    });
  }

  // High spend, no conversion search terms
  const wastedTerms = searchTerms.filter(t => t.cost > 20 && t.conversions === 0 && !informationalPatterns.test(t.term));
  if (wastedTerms.length > 0) {
    const totalWasted = wastedTerms.reduce((s, t) => s + t.cost, 0);
    issues.push({
      severity: 'HIGH',
      type: 'WASTED_SPEND_TERMS',
      description: `${wastedTerms.length} search terms with $${totalWasted.toFixed(2)} spend and zero conversions`,
      detail: wastedTerms.slice(0, 5).map(t => `"${t.term}" ($${t.cost.toFixed(2)})`).join(', ')
    });
  }

  return {
    summary: {
      totalSpend,
      totalConversions,
      avgCPL,
      totalClicks,
      totalImpressions,
      avgCTR,
      activeCampaigns: campaigns.length
    },
    issues: issues.sort((a, b) => {
      const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return order[a.severity] - order[b.severity];
    }),
    recommendations: recommendations.sort((a, b) => a.priority - b.priority)
  };
}

// Generate report
function generateReport(campaigns, keywords, searchTerms, dailyData, analysis) {
  const lines = [];

  lines.push('═'.repeat(70));
  lines.push('  CHISHOLM LAW FIRM - GOOGLE ADS PPC ANALYSIS');
  lines.push('  Target CPL: $' + CONFIG.targetCPL);
  lines.push('  Analysis Date: ' + new Date().toISOString().split('T')[0]);
  lines.push('═'.repeat(70));
  lines.push('');

  // Summary
  lines.push('📊 PERFORMANCE SUMMARY (Last 30 Days)');
  lines.push('─'.repeat(70));
  lines.push(`  Total Spend:        $${analysis.summary.totalSpend.toFixed(2)}`);
  lines.push(`  Total Conversions:  ${analysis.summary.totalConversions.toFixed(0)}`);
  lines.push(`  Average CPL:        $${analysis.summary.avgCPL.toFixed(2)} ${analysis.summary.avgCPL <= CONFIG.targetCPL ? '✓' : '⚠ ABOVE TARGET'}`);
  lines.push(`  Total Clicks:       ${analysis.summary.totalClicks.toLocaleString()}`);
  lines.push(`  Average CTR:        ${analysis.summary.avgCTR.toFixed(2)}%`);
  lines.push(`  Active Campaigns:   ${analysis.summary.activeCampaigns}`);
  lines.push('');

  // Week over week trend
  if (dailyData.length >= 14) {
    const lastWeek = dailyData.slice(0, 7);
    const prevWeek = dailyData.slice(7, 14);
    const lastWeekConv = lastWeek.reduce((s, d) => s + d.conversions, 0);
    const prevWeekConv = prevWeek.reduce((s, d) => s + d.conversions, 0);
    const lastWeekSpend = lastWeek.reduce((s, d) => s + d.spend, 0);
    const prevWeekSpend = prevWeek.reduce((s, d) => s + d.spend, 0);

    lines.push('📈 WEEK-OVER-WEEK COMPARISON');
    lines.push('─'.repeat(70));
    lines.push(`  This Week:     ${lastWeekConv.toFixed(0)} conversions | $${lastWeekSpend.toFixed(2)} spend | $${lastWeekConv > 0 ? (lastWeekSpend/lastWeekConv).toFixed(2) : '∞'} CPL`);
    lines.push(`  Previous Week: ${prevWeekConv.toFixed(0)} conversions | $${prevWeekSpend.toFixed(2)} spend | $${prevWeekConv > 0 ? (prevWeekSpend/prevWeekConv).toFixed(2) : '∞'} CPL`);
    const change = prevWeekConv > 0 ? ((lastWeekConv - prevWeekConv) / prevWeekConv * 100) : 0;
    lines.push(`  Change:        ${change >= 0 ? '+' : ''}${change.toFixed(0)}% conversions`);
    lines.push('');
  }

  // Issues
  if (analysis.issues.length > 0) {
    lines.push('🚨 ISSUES IDENTIFIED (' + analysis.issues.length + ')');
    lines.push('─'.repeat(70));
    analysis.issues.forEach(issue => {
      const icon = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'HIGH' ? '🟠' : '🟡';
      lines.push(`  ${icon} [${issue.severity}] ${issue.description}`);
      lines.push(`     ${issue.detail}`);
      lines.push('');
    });
  }

  // Campaign breakdown
  lines.push('📋 CAMPAIGN PERFORMANCE');
  lines.push('─'.repeat(70));
  campaigns.slice(0, 10).forEach(c => {
    const status = c.cpl <= CONFIG.targetCPL ? '✓' : c.cpl <= CONFIG.targetCPL * 1.5 ? '⚠' : '✗';
    lines.push(`  ${status} ${c.name}`);
    lines.push(`     Spend: $${c.spend.toFixed(2)} | Conv: ${c.conversions.toFixed(0)} | CPL: $${c.cpl === Infinity ? '∞' : c.cpl.toFixed(2)} | CTR: ${(c.ctr * 100).toFixed(2)}% | IS: ${(c.impressionShare * 100).toFixed(0)}%`);
  });
  lines.push('');

  // Top keywords
  const topKeywords = keywords.filter(k => k.conversions > 0).sort((a, b) => b.conversions - a.conversions).slice(0, 10);
  if (topKeywords.length > 0) {
    lines.push('🔑 TOP CONVERTING KEYWORDS');
    lines.push('─'.repeat(70));
    topKeywords.forEach(k => {
      const cpl = k.conversions > 0 ? k.cost / k.conversions : Infinity;
      lines.push(`  "${k.text}" [${k.matchType}]`);
      lines.push(`     Conv: ${k.conversions.toFixed(0)} | Cost: $${k.cost.toFixed(2)} | CPL: $${cpl.toFixed(2)} | QS: ${k.qualityScore || 'N/A'}`);
    });
    lines.push('');
  }

  // Problematic search terms
  const problemTerms = searchTerms
    .filter(t => t.cost > 10 && t.conversions === 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 15);
  if (problemTerms.length > 0) {
    lines.push('💸 WASTED SPEND - SEARCH TERMS (No Conversions)');
    lines.push('─'.repeat(70));
    problemTerms.forEach(t => {
      lines.push(`  $${t.cost.toFixed(2)} - "${t.term}"`);
    });
    lines.push('');
  }

  // Recommendations
  if (analysis.recommendations.length > 0) {
    lines.push('💡 RECOMMENDATIONS');
    lines.push('─'.repeat(70));
    analysis.recommendations.forEach((rec, i) => {
      lines.push(`  ${i + 1}. ${rec.action}`);
      lines.push(`     Reason: ${rec.reason}`);
      lines.push(`     Impact: ${rec.impact}`);
      if (rec.negatives) {
        lines.push(`     Negatives to add: ${rec.negatives.join(', ')}`);
      }
      lines.push('');
    });
  }

  lines.push('═'.repeat(70));
  lines.push('  END OF ANALYSIS');
  lines.push('═'.repeat(70));

  return lines.join('\n');
}

// Main execution
async function main() {
  console.log('═'.repeat(70));
  console.log('  GOOGLE ADS PPC AGENT - CHISHOLM LAW FIRM');
  console.log('  Customer ID: ' + CONFIG.customerId);
  console.log('  Target CPL: $' + CONFIG.targetCPL);
  console.log('═'.repeat(70));

  try {
    // Get access token
    console.log('\n🔐 Authenticating...');
    const accessToken = await getAccessToken();
    console.log('   Authentication successful');

    // Fetch all data
    const campaigns = await getCampaigns(accessToken);
    const keywords = await getKeywords(accessToken);
    const searchTerms = await getSearchTerms(accessToken);
    const dailyData = await getDailyPerformance(accessToken);

    // Analyze
    const analysis = analyzePerformance(campaigns, keywords, searchTerms, dailyData);

    // Generate and print report
    const report = generateReport(campaigns, keywords, searchTerms, dailyData, analysis);
    console.log('\n');
    console.log(report);

    // Return data for further processing
    return { campaigns, keywords, searchTerms, dailyData, analysis };

  } catch (error) {
    console.error('\n❌ Analysis failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

main();
