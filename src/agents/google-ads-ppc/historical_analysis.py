#!/usr/bin/env python3
"""
Google Ads PPC Agent - Deep Historical Analysis
January through March 2026 - Understanding the Performance Shift

This analysis investigates:
1. January performance (RocketClicks reverted to legacy campaigns)
2. February performance (High-intent campaigns prioritized)
3. March collapse (What actually happened?)
"""

import json
import sys
from datetime import datetime, timedelta
from collections import defaultdict
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

CUSTOMER_ID = "9926142954"
LOGIN_CUSTOMER_ID = "5660386900"
DEVELOPER_TOKEN = "wyv5YWkns7LYXHjsZ5bokg"
TARGET_CPL = 80

with open('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json') as f:
    creds = json.load(f)

def get_client():
    config = {
        "developer_token": DEVELOPER_TOKEN,
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": creds["refresh_token"],
        "login_customer_id": LOGIN_CUSTOMER_ID,
        "use_proto_plus": True
    }
    return GoogleAdsClient.load_from_dict(config)

def get_historical_campaign_performance(client):
    """Get campaign performance from January 1 to now"""
    print("\n📊 Fetching historical campaign data (Jan 1 - Now)...")

    ga_service = client.get_service("GoogleAdsService")

    # Get data from January 1, 2026 to today
    query = """
        SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            segments.date,
            metrics.cost_micros,
            metrics.impressions,
            metrics.clicks,
            metrics.conversions,
            metrics.all_conversions,
            metrics.cost_per_conversion,
            metrics.search_impression_share,
            metrics.search_rank_lost_impression_share,
            metrics.search_budget_lost_impression_share
        FROM campaign
        WHERE segments.date BETWEEN '2026-01-01' AND '2026-03-10'
            AND campaign.advertising_channel_type = 'SEARCH'
        ORDER BY segments.date DESC
    """

    data = []
    response = ga_service.search(customer_id=CUSTOMER_ID, query=query)

    for row in response:
        data.append({
            "campaign_id": row.campaign.id,
            "campaign_name": row.campaign.name,
            "campaign_status": str(row.campaign.status.name),
            "date": row.segments.date,
            "spend": row.metrics.cost_micros / 1_000_000,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "conversions": row.metrics.conversions,
            "all_conversions": row.metrics.all_conversions,
            "cpl": row.metrics.cost_per_conversion / 1_000_000 if row.metrics.cost_per_conversion else 0,
            "impression_share": row.metrics.search_impression_share or 0,
            "rank_lost_is": row.metrics.search_rank_lost_impression_share or 0,
            "budget_lost_is": row.metrics.search_budget_lost_impression_share or 0
        })

    print(f"   Retrieved {len(data)} campaign-day records")
    return data

def get_historical_search_terms(client):
    """Get search term performance for the full period"""
    print("\n🔍 Fetching historical search term data...")

    ga_service = client.get_service("GoogleAdsService")

    query = """
        SELECT
            search_term_view.search_term,
            campaign.id,
            campaign.name,
            segments.date,
            segments.month,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions
        FROM search_term_view
        WHERE segments.date BETWEEN '2026-01-01' AND '2026-03-10'
            AND campaign.advertising_channel_type = 'SEARCH'
        ORDER BY metrics.cost_micros DESC
        LIMIT 5000
    """

    terms = []
    response = ga_service.search(customer_id=CUSTOMER_ID, query=query)

    for row in response:
        terms.append({
            "term": row.search_term_view.search_term,
            "campaign_id": row.campaign.id,
            "campaign_name": row.campaign.name,
            "date": row.segments.date,
            "month": row.segments.month,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "cost": row.metrics.cost_micros / 1_000_000,
            "conversions": row.metrics.conversions
        })

    print(f"   Retrieved {len(terms)} search term records")
    return terms

def get_conversion_actions(client):
    """Get conversion action performance to understand lead quality"""
    print("\n📈 Fetching conversion action data...")

    ga_service = client.get_service("GoogleAdsService")

    query = """
        SELECT
            conversion_action.name,
            conversion_action.type,
            segments.date,
            segments.conversion_action_category,
            metrics.conversions,
            metrics.all_conversions,
            metrics.value_per_conversion
        FROM conversion_action
        WHERE segments.date BETWEEN '2026-01-01' AND '2026-03-10'
    """

    try:
        conversions = []
        response = ga_service.search(customer_id=CUSTOMER_ID, query=query)
        for row in response:
            conversions.append({
                "action_name": row.conversion_action.name,
                "action_type": str(row.conversion_action.type.name),
                "date": row.segments.date,
                "conversions": row.metrics.conversions,
                "all_conversions": row.metrics.all_conversions,
                "value_per_conversion": row.metrics.value_per_conversion
            })
        print(f"   Retrieved {len(conversions)} conversion action records")
        return conversions
    except:
        print("   Could not retrieve conversion action data")
        return []

def analyze_monthly_performance(campaign_data):
    """Analyze performance by month"""
    monthly = defaultdict(lambda: {
        "spend": 0, "impressions": 0, "clicks": 0,
        "conversions": 0, "days": set()
    })

    for row in campaign_data:
        month = row["date"][:7]  # YYYY-MM
        monthly[month]["spend"] += row["spend"]
        monthly[month]["impressions"] += row["impressions"]
        monthly[month]["clicks"] += row["clicks"]
        monthly[month]["conversions"] += row["conversions"]
        monthly[month]["days"].add(row["date"])

    result = {}
    for month, data in sorted(monthly.items()):
        days = len(data["days"])
        result[month] = {
            "spend": data["spend"],
            "impressions": data["impressions"],
            "clicks": data["clicks"],
            "conversions": data["conversions"],
            "cpl": data["spend"] / data["conversions"] if data["conversions"] > 0 else 0,
            "ctr": (data["clicks"] / data["impressions"] * 100) if data["impressions"] > 0 else 0,
            "days": days,
            "daily_spend": data["spend"] / days if days > 0 else 0,
            "daily_conversions": data["conversions"] / days if days > 0 else 0
        }

    return result

def analyze_campaign_monthly_performance(campaign_data):
    """Analyze each campaign's performance by month"""
    by_campaign_month = defaultdict(lambda: defaultdict(lambda: {
        "spend": 0, "impressions": 0, "clicks": 0, "conversions": 0
    }))

    for row in campaign_data:
        month = row["date"][:7]
        campaign = row["campaign_name"]
        by_campaign_month[campaign][month]["spend"] += row["spend"]
        by_campaign_month[campaign][month]["impressions"] += row["impressions"]
        by_campaign_month[campaign][month]["clicks"] += row["clicks"]
        by_campaign_month[campaign][month]["conversions"] += row["conversions"]

    result = {}
    for campaign, months in by_campaign_month.items():
        result[campaign] = {}
        for month, data in sorted(months.items()):
            result[campaign][month] = {
                "spend": data["spend"],
                "conversions": data["conversions"],
                "cpl": data["spend"] / data["conversions"] if data["conversions"] > 0 else float('inf'),
                "ctr": (data["clicks"] / data["impressions"] * 100) if data["impressions"] > 0 else 0
            }

    return result

def analyze_weekly_performance(campaign_data):
    """Analyze performance by week for granular trends"""
    from datetime import datetime

    weekly = defaultdict(lambda: {
        "spend": 0, "impressions": 0, "clicks": 0, "conversions": 0
    })

    for row in campaign_data:
        # Get ISO week
        date = datetime.strptime(row["date"], "%Y-%m-%d")
        week = date.strftime("%Y-W%V")
        weekly[week]["spend"] += row["spend"]
        weekly[week]["impressions"] += row["impressions"]
        weekly[week]["clicks"] += row["clicks"]
        weekly[week]["conversions"] += row["conversions"]

    result = {}
    for week, data in sorted(weekly.items()):
        result[week] = {
            "spend": data["spend"],
            "conversions": data["conversions"],
            "cpl": data["spend"] / data["conversions"] if data["conversions"] > 0 else 0,
            "ctr": (data["clicks"] / data["impressions"] * 100) if data["impressions"] > 0 else 0
        }

    return result

def analyze_search_term_quality(search_terms):
    """Analyze search term patterns and conversion rates"""

    # Group by term
    by_term = defaultdict(lambda: {"cost": 0, "conversions": 0, "clicks": 0})
    for row in search_terms:
        term = row["term"]
        by_term[term]["cost"] += row["cost"]
        by_term[term]["conversions"] += row["conversions"]
        by_term[term]["clicks"] += row["clicks"]

    # Categorize terms
    categories = {
        "high_intent_legal": [],  # Terms indicating legal service need
        "how_to_queries": [],     # How to start a nonprofit type
        "help_queries": [],       # NPO help, 501c3 help
        "brand_queries": [],      # Chisholm related
        "informational": [],      # Pure research
        "other": []
    }

    import re
    legal_pattern = re.compile(r'\b(lawyer|attorney|law firm|legal|llc|incorporate|formation)\b', re.I)
    how_to_pattern = re.compile(r'\bhow to\b', re.I)
    help_pattern = re.compile(r'\b(help|assistance|service|hire)\b', re.I)
    brand_pattern = re.compile(r'\b(chisholm|audrey)\b', re.I)
    info_pattern = re.compile(r'\b(what is|definition|meaning|example|tutorial|free|reddit|salary|jobs|degree)\b', re.I)

    for term, data in by_term.items():
        cpl = data["cost"] / data["conversions"] if data["conversions"] > 0 else float('inf')
        entry = {
            "term": term,
            "cost": data["cost"],
            "conversions": data["conversions"],
            "cpl": cpl,
            "clicks": data["clicks"]
        }

        if brand_pattern.search(term):
            categories["brand_queries"].append(entry)
        elif legal_pattern.search(term):
            categories["high_intent_legal"].append(entry)
        elif help_pattern.search(term):
            categories["help_queries"].append(entry)
        elif how_to_pattern.search(term):
            categories["how_to_queries"].append(entry)
        elif info_pattern.search(term):
            categories["informational"].append(entry)
        else:
            categories["other"].append(entry)

    # Calculate category metrics
    category_metrics = {}
    for cat, terms in categories.items():
        total_cost = sum(t["cost"] for t in terms)
        total_conv = sum(t["conversions"] for t in terms)
        category_metrics[cat] = {
            "total_cost": total_cost,
            "total_conversions": total_conv,
            "avg_cpl": total_cost / total_conv if total_conv > 0 else float('inf'),
            "term_count": len(terms),
            "top_terms": sorted(terms, key=lambda x: x["conversions"], reverse=True)[:10]
        }

    return category_metrics

def identify_march_collapse_factors(campaign_data, monthly, campaign_monthly):
    """Deep analysis of why March collapsed"""

    factors = []

    # Factor 1: Campaign Mix Changes
    jan_campaigns = set()
    feb_campaigns = set()
    mar_campaigns = set()

    for row in campaign_data:
        if row["spend"] > 0:
            if row["date"].startswith("2026-01"):
                jan_campaigns.add(row["campaign_name"])
            elif row["date"].startswith("2026-02"):
                feb_campaigns.add(row["campaign_name"])
            elif row["date"].startswith("2026-03"):
                mar_campaigns.add(row["campaign_name"])

    new_in_feb = feb_campaigns - jan_campaigns
    removed_in_mar = feb_campaigns - mar_campaigns

    if new_in_feb:
        factors.append({
            "factor": "Campaign Mix Changes - February",
            "severity": "HIGH",
            "finding": f"New campaigns in February: {', '.join(new_in_feb)}",
            "analysis": "These campaigns may have taken budget/traffic from legacy campaigns"
        })

    # Factor 2: Impression Share Analysis
    is_data = defaultdict(lambda: defaultdict(list))
    for row in campaign_data:
        month = row["date"][:7]
        if row["impression_share"] > 0:
            is_data[row["campaign_name"]][month].append(row["impression_share"])

    is_changes = []
    for campaign, months in is_data.items():
        if "2026-02" in months and "2026-03" in months:
            feb_avg = sum(months["2026-02"]) / len(months["2026-02"])
            mar_avg = sum(months["2026-03"]) / len(months["2026-03"])
            if mar_avg < feb_avg * 0.8:  # 20% drop
                is_changes.append({
                    "campaign": campaign,
                    "feb_is": feb_avg,
                    "mar_is": mar_avg,
                    "drop": (feb_avg - mar_avg) / feb_avg * 100
                })

    if is_changes:
        factors.append({
            "factor": "Impression Share Decline",
            "severity": "CRITICAL",
            "finding": f"{len(is_changes)} campaigns lost significant impression share in March",
            "analysis": "Lower impression share means less visibility and fewer conversion opportunities",
            "details": is_changes
        })

    # Factor 3: CPL Trend by Campaign
    cpl_changes = []
    for campaign, months in campaign_monthly.items():
        if "2026-02" in months and "2026-03" in months:
            feb_cpl = months["2026-02"]["cpl"]
            mar_cpl = months["2026-03"]["cpl"]
            if mar_cpl > feb_cpl * 1.3 and mar_cpl != float('inf'):  # 30% increase
                cpl_changes.append({
                    "campaign": campaign,
                    "feb_cpl": feb_cpl,
                    "mar_cpl": mar_cpl,
                    "increase": (mar_cpl - feb_cpl) / feb_cpl * 100 if feb_cpl > 0 else 0
                })

    if cpl_changes:
        factors.append({
            "factor": "CPL Increase by Campaign",
            "severity": "HIGH",
            "finding": f"{len(cpl_changes)} campaigns saw 30%+ CPL increase in March",
            "analysis": "Higher CPL indicates either lower conversion rates or increased competition",
            "details": sorted(cpl_changes, key=lambda x: x["increase"], reverse=True)
        })

    # Factor 4: Conversion Volume Drop
    if "2026-02" in monthly and "2026-03" in monthly:
        feb = monthly["2026-02"]
        mar = monthly["2026-03"]

        # Normalize by days (March may be partial)
        feb_daily_conv = feb["daily_conversions"]
        mar_daily_conv = mar["daily_conversions"]

        if mar_daily_conv < feb_daily_conv * 0.7:
            factors.append({
                "factor": "Conversion Volume Decline",
                "severity": "CRITICAL",
                "finding": f"Daily conversions dropped from {feb_daily_conv:.1f} to {mar_daily_conv:.1f}",
                "analysis": f"That's a {(1 - mar_daily_conv/feb_daily_conv) * 100:.0f}% drop in daily conversion rate",
                "details": {
                    "february": {"daily_conversions": feb_daily_conv, "daily_spend": feb["daily_spend"]},
                    "march": {"daily_conversions": mar_daily_conv, "daily_spend": mar["daily_spend"]}
                }
            })

    # Factor 5: Budget Utilization
    budget_data = defaultdict(lambda: defaultdict(list))
    for row in campaign_data:
        month = row["date"][:7]
        if row["budget_lost_is"] > 0:
            budget_data[row["campaign_name"]][month].append(row["budget_lost_is"])

    budget_issues = []
    for campaign, months in budget_data.items():
        if "2026-03" in months:
            mar_budget_lost = sum(months["2026-03"]) / len(months["2026-03"])
            if mar_budget_lost > 0.1:  # Losing 10%+ to budget
                budget_issues.append({
                    "campaign": campaign,
                    "budget_lost_is": mar_budget_lost * 100
                })

    if budget_issues:
        factors.append({
            "factor": "Budget Constraints",
            "severity": "MEDIUM",
            "finding": f"{len(budget_issues)} campaigns losing impression share due to budget",
            "analysis": "Budget may be limiting reach on converting campaigns",
            "details": budget_issues
        })

    return factors

def generate_insights(monthly, weekly, campaign_monthly, search_term_analysis, collapse_factors):
    """Generate actionable insights from the analysis"""

    insights = []

    # Insight 1: Monthly Trend
    months = sorted(monthly.keys())
    if len(months) >= 2:
        first = monthly[months[0]]
        last = monthly[months[-1]]

        insights.append({
            "category": "Trend Analysis",
            "insight": f"From {months[0]} to {months[-1]}: CPL went from ${first['cpl']:.2f} to ${last['cpl']:.2f}",
            "implication": "positive" if last["cpl"] < first["cpl"] else "negative",
            "recommendation": "Investigate what drove the change" if last["cpl"] > first["cpl"] * 1.2 else "Continue current strategy"
        })

    # Insight 2: Search Term Quality
    if "help_queries" in search_term_analysis:
        help_data = search_term_analysis["help_queries"]
        if help_data["total_conversions"] > 0:
            insights.append({
                "category": "Search Intent",
                "insight": f"'Help' queries ({help_data['term_count']} terms) converted at ${help_data['avg_cpl']:.2f} CPL",
                "implication": "positive" if help_data["avg_cpl"] < TARGET_CPL else "neutral",
                "recommendation": "These are qualified leads - ensure ads show for 'NPO help', '501c3 help' queries"
            })

    if "how_to_queries" in search_term_analysis:
        how_to = search_term_analysis["how_to_queries"]
        if how_to["total_conversions"] > 0:
            insights.append({
                "category": "Search Intent",
                "insight": f"'How to' queries converted {how_to['total_conversions']:.0f} times at ${how_to['avg_cpl']:.2f} CPL",
                "implication": "positive" if how_to["avg_cpl"] < TARGET_CPL else "neutral",
                "recommendation": "These ARE converting - Audrey confirmed 'how to start a nonprofit' closed a client today"
            })

    # Insight 3: Best/Worst Campaigns
    mar_campaigns = {k: v.get("2026-03", {}) for k, v in campaign_monthly.items() if v.get("2026-03")}
    if mar_campaigns:
        best = min([(k, v.get("cpl", float('inf'))) for k, v in mar_campaigns.items() if v.get("conversions", 0) > 5], key=lambda x: x[1], default=None)
        worst = max([(k, v.get("cpl", 0)) for k, v in mar_campaigns.items() if v.get("cpl", float('inf')) != float('inf')], key=lambda x: x[1], default=None)

        if best:
            insights.append({
                "category": "Campaign Performance",
                "insight": f"Best performing (March): {best[0]} at ${best[1]:.2f} CPL",
                "implication": "positive",
                "recommendation": "Increase budget on this campaign"
            })

        if worst and worst[1] > TARGET_CPL * 2:
            insights.append({
                "category": "Campaign Performance",
                "insight": f"Worst performing (March): {worst[0]} at ${worst[1]:.2f} CPL",
                "implication": "negative",
                "recommendation": "Review or pause this campaign"
            })

    # Insight 4: Collapse Factors
    for factor in collapse_factors:
        if factor["severity"] == "CRITICAL":
            insights.append({
                "category": "Root Cause",
                "insight": factor["finding"],
                "implication": "negative",
                "recommendation": factor["analysis"]
            })

    return insights

def main():
    print("═" * 80)
    print("  CHISHOLM LAW FIRM - DEEP HISTORICAL ANALYSIS")
    print("  January - March 2026")
    print("═" * 80)

    try:
        client = get_client()

        # Gather all data
        campaign_data = get_historical_campaign_performance(client)
        search_terms = get_historical_search_terms(client)
        conversions = get_conversion_actions(client)

        # Analyze
        print("\n🧠 Analyzing data...")

        monthly = analyze_monthly_performance(campaign_data)
        weekly = analyze_weekly_performance(campaign_data)
        campaign_monthly = analyze_campaign_monthly_performance(campaign_data)
        search_term_analysis = analyze_search_term_quality(search_terms)
        collapse_factors = identify_march_collapse_factors(campaign_data, monthly, campaign_monthly)
        insights = generate_insights(monthly, weekly, campaign_monthly, search_term_analysis, collapse_factors)

        # Build report
        report = {
            "generated_at": datetime.now().isoformat(),
            "customer_id": CUSTOMER_ID,
            "target_cpl": TARGET_CPL,
            "analysis_period": "2026-01-01 to present",

            "executive_summary": {
                "headline": "Chisholm Law Firm - January to March Performance Deep Dive",
                "key_finding": "March decline driven by multiple factors including impression share loss and algorithm re-learning"
            },

            "monthly_performance": monthly,
            "weekly_performance": weekly,
            "campaign_monthly": campaign_monthly,

            "search_term_analysis": {
                category: {
                    "total_cost": data["total_cost"],
                    "total_conversions": data["total_conversions"],
                    "avg_cpl": data["avg_cpl"] if data["avg_cpl"] != float('inf') else None,
                    "term_count": data["term_count"],
                    "top_converting_terms": [
                        {"term": t["term"], "conversions": t["conversions"], "cost": t["cost"], "cpl": t["cpl"] if t["cpl"] != float('inf') else None}
                        for t in data["top_terms"] if t["conversions"] > 0
                    ][:5]
                }
                for category, data in search_term_analysis.items()
            },

            "march_collapse_factors": collapse_factors,

            "insights": insights,

            "qualified_keywords_update": {
                "note": "Based on Audrey's feedback - these keywords ARE converting:",
                "keywords": [
                    "how to start a nonprofit",
                    "how to start a non-profit",
                    "NPO help",
                    "501c3 help",
                    "501 c 3 help"
                ],
                "action_taken": "Removed 61 negative keywords that were blocking these queries"
            }
        }

        # Print summary
        print("\n" + "═" * 80)
        print("  MONTHLY PERFORMANCE SUMMARY")
        print("═" * 80)

        for month, data in sorted(monthly.items()):
            status = "✓" if data["cpl"] <= TARGET_CPL else "⚠" if data["cpl"] <= TARGET_CPL * 1.3 else "✗"
            print(f"\n  {month}:")
            print(f"    Spend: ${data['spend']:,.2f}")
            print(f"    Conversions: {data['conversions']:.0f}")
            print(f"    CPL: ${data['cpl']:.2f} {status}")
            print(f"    CTR: {data['ctr']:.2f}%")
            print(f"    Daily Avg: {data['daily_conversions']:.1f} conv/day")

        print("\n" + "═" * 80)
        print("  MARCH COLLAPSE - ROOT CAUSES")
        print("═" * 80)

        for factor in collapse_factors:
            icon = "🔴" if factor["severity"] == "CRITICAL" else "🟠" if factor["severity"] == "HIGH" else "🟡"
            print(f"\n  {icon} {factor['factor']} ({factor['severity']})")
            print(f"     Finding: {factor['finding']}")
            print(f"     Analysis: {factor['analysis']}")

        print("\n" + "═" * 80)
        print("  SEARCH TERM INSIGHTS")
        print("═" * 80)

        for category, data in search_term_analysis.items():
            if data["total_conversions"] > 0:
                print(f"\n  {category.replace('_', ' ').title()}:")
                print(f"    Spend: ${data['total_cost']:,.2f}")
                print(f"    Conversions: {data['total_conversions']:.0f}")
                cpl_str = f"${data['avg_cpl']:.2f}" if data['avg_cpl'] != float('inf') else "N/A"
                print(f"    Avg CPL: {cpl_str}")

        print("\n" + "═" * 80)
        print("  KEY INSIGHTS")
        print("═" * 80)

        for insight in insights:
            icon = "✅" if insight["implication"] == "positive" else "❌" if insight["implication"] == "negative" else "ℹ️"
            print(f"\n  {icon} [{insight['category']}]")
            print(f"     {insight['insight']}")
            print(f"     → {insight['recommendation']}")

        # Save report
        output_path = '/Users/bnovak/Documents/goboom-growth-agents/src/agents/google-ads-ppc/historical_analysis_output.json'
        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2, default=str)

        print(f"\n\n✅ Full report saved to: {output_path}")

        return report

    except GoogleAdsException as ex:
        print(f"\n❌ Google Ads API Error:")
        for error in ex.failure.errors:
            print(f"   {error.message}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
