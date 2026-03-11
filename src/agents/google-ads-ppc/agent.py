#!/usr/bin/env python3
"""
Google Ads PPC Agent - Python Implementation

Analyzes Google Ads campaigns like a veteran PPC engineer
and executes fixes autonomously.
"""

import json
import sys
from datetime import datetime, timedelta
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

# Configuration
CUSTOMER_ID = "9926142954"
LOGIN_CUSTOMER_ID = "5660386900"
DEVELOPER_TOKEN = "wyv5YWkns7LYXHjsZ5bokg"
TARGET_CPL = 80

# Load credentials
with open('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json') as f:
    creds = json.load(f)

def get_client():
    """Create Google Ads API client"""
    config = {
        "developer_token": DEVELOPER_TOKEN,
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": creds["refresh_token"],
        "login_customer_id": LOGIN_CUSTOMER_ID,
        "use_proto_plus": True
    }
    return GoogleAdsClient.load_from_dict(config)

def get_campaigns(client):
    """Get active search campaigns"""
    print("\n📊 Fetching active search campaigns...")

    ga_service = client.get_service("GoogleAdsService")

    query = """
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
    """

    campaigns = []
    response = ga_service.search(customer_id=CUSTOMER_ID, query=query)

    for row in response:
        campaigns.append({
            "id": row.campaign.id,
            "name": row.campaign.name,
            "status": str(row.campaign.status.name),
            "type": str(row.campaign.advertising_channel_type.name),
            "budget": row.campaign_budget.amount_micros / 1_000_000 if row.campaign_budget.amount_micros else 0,
            "spend": row.metrics.cost_micros / 1_000_000 if row.metrics.cost_micros else 0,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "conversions": row.metrics.conversions,
            "ctr": row.metrics.ctr,
            "cpc": row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0,
            "cpl": row.metrics.cost_per_conversion / 1_000_000 if row.metrics.cost_per_conversion else float('inf'),
            "impression_share": row.metrics.search_impression_share if row.metrics.search_impression_share else 0
        })

    print(f"   Found {len(campaigns)} active search campaigns")
    return campaigns

def get_keywords(client):
    """Get keywords with performance data"""
    print("\n🔑 Fetching keyword performance...")

    ga_service = client.get_service("GoogleAdsService")

    query = """
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
    """

    keywords = []
    response = ga_service.search(customer_id=CUSTOMER_ID, query=query)

    for row in response:
        keywords.append({
            "id": row.ad_group_criterion.criterion_id,
            "text": row.ad_group_criterion.keyword.text,
            "match_type": str(row.ad_group_criterion.keyword.match_type.name),
            "ad_group_id": row.ad_group.id,
            "ad_group_name": row.ad_group.name,
            "campaign_id": row.campaign.id,
            "campaign_name": row.campaign.name,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "cost": row.metrics.cost_micros / 1_000_000 if row.metrics.cost_micros else 0,
            "conversions": row.metrics.conversions,
            "ctr": row.metrics.ctr,
            "cpc": row.metrics.average_cpc / 1_000_000 if row.metrics.average_cpc else 0,
            "quality_score": row.ad_group_criterion.quality_info.quality_score if hasattr(row.ad_group_criterion.quality_info, 'quality_score') else None
        })

    print(f"   Found {len(keywords)} active keywords")
    return keywords

def get_search_terms(client):
    """Get search terms report"""
    print("\n🔍 Analyzing search terms...")

    ga_service = client.get_service("GoogleAdsService")

    query = """
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
    """

    terms = []
    response = ga_service.search(customer_id=CUSTOMER_ID, query=query)

    for row in response:
        terms.append({
            "term": row.search_term_view.search_term,
            "status": str(row.search_term_view.status.name) if hasattr(row.search_term_view, 'status') else "UNKNOWN",
            "campaign_id": row.campaign.id,
            "campaign_name": row.campaign.name,
            "ad_group_id": row.ad_group.id,
            "ad_group_name": row.ad_group.name,
            "impressions": row.metrics.impressions,
            "clicks": row.metrics.clicks,
            "cost": row.metrics.cost_micros / 1_000_000 if row.metrics.cost_micros else 0,
            "conversions": row.metrics.conversions,
            "ctr": row.metrics.ctr
        })

    print(f"   Found {len(terms)} search terms")
    return terms

def get_daily_performance(client):
    """Get daily performance for trend analysis"""
    print("\n📈 Fetching daily performance trends...")

    ga_service = client.get_service("GoogleAdsService")

    query = """
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
    """

    by_date = {}
    response = ga_service.search(customer_id=CUSTOMER_ID, query=query)

    for row in response:
        date = row.segments.date
        if date not in by_date:
            by_date[date] = {"date": date, "spend": 0, "impressions": 0, "clicks": 0, "conversions": 0}
        by_date[date]["spend"] += row.metrics.cost_micros / 1_000_000 if row.metrics.cost_micros else 0
        by_date[date]["impressions"] += row.metrics.impressions
        by_date[date]["clicks"] += row.metrics.clicks
        by_date[date]["conversions"] += row.metrics.conversions

    daily_data = sorted(by_date.values(), key=lambda x: x["date"], reverse=True)
    print(f"   Got {len(daily_data)} days of data")
    return daily_data

def analyze_performance(campaigns, keywords, search_terms, daily_data):
    """Analyze performance and identify issues"""
    print("\n🧠 Analyzing performance...")

    issues = []
    recommendations = []

    # Calculate totals
    total_spend = sum(c["spend"] for c in campaigns)
    total_conversions = sum(c["conversions"] for c in campaigns)
    avg_cpl = total_spend / total_conversions if total_conversions > 0 else float('inf')
    total_clicks = sum(c["clicks"] for c in campaigns)
    total_impressions = sum(c["impressions"] for c in campaigns)
    avg_ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0

    # Week-over-week analysis
    if len(daily_data) >= 14:
        last_week = daily_data[:7]
        prev_week = daily_data[7:14]

        last_week_conv = sum(d["conversions"] for d in last_week)
        prev_week_conv = sum(d["conversions"] for d in prev_week)
        last_week_spend = sum(d["spend"] for d in last_week)
        prev_week_spend = sum(d["spend"] for d in prev_week)

        last_week_cpl = last_week_spend / last_week_conv if last_week_conv > 0 else float('inf')
        prev_week_cpl = prev_week_spend / prev_week_conv if prev_week_conv > 0 else float('inf')

        conv_change = ((last_week_conv - prev_week_conv) / prev_week_conv * 100) if prev_week_conv > 0 else 0
        cpl_change = ((last_week_cpl - prev_week_cpl) / prev_week_cpl * 100) if prev_week_cpl > 0 and prev_week_cpl != float('inf') else 0

        if conv_change < -20:
            issues.append({
                "severity": "CRITICAL",
                "type": "CONVERSION_DROP",
                "description": f"Conversions dropped {abs(conv_change):.0f}% week-over-week",
                "detail": f"Last week: {last_week_conv:.0f} conversions (${last_week_cpl:.2f} CPL) vs Previous: {prev_week_conv:.0f} conversions (${prev_week_cpl:.2f} CPL)"
            })

        if cpl_change > 30:
            issues.append({
                "severity": "CRITICAL",
                "type": "CPL_SPIKE",
                "description": f"CPL increased {cpl_change:.0f}% week-over-week",
                "detail": f"${last_week_cpl:.2f} vs ${prev_week_cpl:.2f} previous week"
            })

    # Campaign-level analysis
    for c in campaigns:
        if c["cpl"] > TARGET_CPL * 1.5 and c["conversions"] >= 3:
            issues.append({
                "severity": "HIGH",
                "type": "HIGH_CPL_CAMPAIGN",
                "description": f"\"{c['name']}\" - CPL ${c['cpl']:.2f} is {int((c['cpl'] / TARGET_CPL - 1) * 100)}% above target",
                "detail": f"Spent ${c['spend']:.2f}, {c['conversions']:.0f} conversions"
            })

        if c["ctr"] < 0.02 and c["impressions"] > 1000:
            issues.append({
                "severity": "MEDIUM",
                "type": "LOW_CTR",
                "description": f"\"{c['name']}\" - CTR {c['ctr'] * 100:.2f}% is below 2%",
                "detail": f"{c['impressions']:,} impressions, {c['clicks']} clicks"
            })

        if c["conversions"] == 0 and c["spend"] > 100:
            issues.append({
                "severity": "CRITICAL",
                "type": "ZERO_CONVERSIONS",
                "description": f"\"{c['name']}\" - Zero conversions with ${c['spend']:.2f} spend",
                "detail": "Check conversion tracking or pause campaign"
            })

        # Good performer - recommend budget increase
        if c["cpl"] < TARGET_CPL * 0.7 and c["conversions"] >= 5 and c["impression_share"] < 0.8:
            recommendations.append({
                "priority": 1,
                "type": "INCREASE_BUDGET",
                "action": f"Increase budget for \"{c['name']}\"",
                "reason": f"CPL ${c['cpl']:.2f} is {int((1 - c['cpl'] / TARGET_CPL) * 100)}% below target with only {c['impression_share'] * 100:.0f}% impression share",
                "impact": "Could capture more conversions at efficient CPL"
            })

    # Low quality score keywords
    low_qs = [k for k in keywords if k.get("quality_score") and k["quality_score"] < 5 and k["cost"] > 20]
    if low_qs:
        issues.append({
            "severity": "HIGH",
            "type": "LOW_QUALITY_SCORES",
            "description": f"{len(low_qs)} keywords with Quality Score below 5",
            "detail": ", ".join(f"\"{k['text']}\" (QS: {k['quality_score']})" for k in low_qs[:5])
        })

    # Informational queries
    import re
    info_pattern = re.compile(r"\b(what is|how to|how do|can i|should i|is it|why|when|definition|meaning|example|tutorial|guide|free|diy|reddit|jobs|salary|career|school|degree)\b", re.I)

    info_terms = [t for t in search_terms if info_pattern.search(t["term"]) and t["cost"] > 5]
    wasted_spend = sum(t["cost"] for t in info_terms)

    if info_terms:
        issues.append({
            "severity": "CRITICAL",
            "type": "INFORMATIONAL_QUERIES",
            "description": f"{len(info_terms)} informational search terms wasting ${wasted_spend:.2f}",
            "detail": ", ".join(f"\"{t['term']}\" (${t['cost']:.2f})" for t in info_terms[:5])
        })

        recommendations.append({
            "priority": 1,
            "type": "ADD_NEGATIVES",
            "action": "Add negative keywords for informational queries",
            "reason": f"{len(info_terms)} search terms show informational intent, not buying intent",
            "impact": f"Save ~${wasted_spend:.2f}/period and improve lead quality",
            "negatives": ["what is", "how to", "free", "diy", "jobs", "salary", "reddit", "school", "degree", "definition", "example", "tutorial"]
        })

    # High spend, no conversion terms
    wasted = [t for t in search_terms if t["cost"] > 20 and t["conversions"] == 0 and not info_pattern.search(t["term"])]
    if wasted:
        total_wasted = sum(t["cost"] for t in wasted)
        issues.append({
            "severity": "HIGH",
            "type": "WASTED_SPEND_TERMS",
            "description": f"{len(wasted)} search terms with ${total_wasted:.2f} spend and zero conversions",
            "detail": ", ".join(f"\"{t['term']}\" (${t['cost']:.2f})" for t in wasted[:5])
        })

    # Sort issues by severity
    severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    issues.sort(key=lambda x: severity_order.get(x["severity"], 99))
    recommendations.sort(key=lambda x: x["priority"])

    return {
        "summary": {
            "total_spend": total_spend,
            "total_conversions": total_conversions,
            "avg_cpl": avg_cpl,
            "total_clicks": total_clicks,
            "total_impressions": total_impressions,
            "avg_ctr": avg_ctr,
            "active_campaigns": len(campaigns)
        },
        "issues": issues,
        "recommendations": recommendations
    }

def generate_report(campaigns, keywords, search_terms, daily_data, analysis):
    """Generate formatted report"""
    lines = []

    lines.append("═" * 70)
    lines.append("  CHISHOLM LAW FIRM - GOOGLE ADS PPC ANALYSIS")
    lines.append(f"  Target CPL: ${TARGET_CPL}")
    lines.append(f"  Analysis Date: {datetime.now().strftime('%Y-%m-%d')}")
    lines.append("═" * 70)
    lines.append("")

    # Summary
    s = analysis["summary"]
    lines.append("📊 PERFORMANCE SUMMARY (Last 30 Days)")
    lines.append("─" * 70)
    lines.append(f"  Total Spend:        ${s['total_spend']:.2f}")
    lines.append(f"  Total Conversions:  {s['total_conversions']:.0f}")
    cpl_status = "✓" if s['avg_cpl'] <= TARGET_CPL else "⚠ ABOVE TARGET"
    lines.append(f"  Average CPL:        ${s['avg_cpl']:.2f} {cpl_status}")
    lines.append(f"  Total Clicks:       {s['total_clicks']:,}")
    lines.append(f"  Average CTR:        {s['avg_ctr']:.2f}%")
    lines.append(f"  Active Campaigns:   {s['active_campaigns']}")
    lines.append("")

    # Week over week
    if len(daily_data) >= 14:
        last_week = daily_data[:7]
        prev_week = daily_data[7:14]
        last_conv = sum(d["conversions"] for d in last_week)
        prev_conv = sum(d["conversions"] for d in prev_week)
        last_spend = sum(d["spend"] for d in last_week)
        prev_spend = sum(d["spend"] for d in prev_week)

        lines.append("📈 WEEK-OVER-WEEK COMPARISON")
        lines.append("─" * 70)
        this_cpl = f"${last_spend/last_conv:.2f}" if last_conv > 0 else "∞"
        prev_cpl = f"${prev_spend/prev_conv:.2f}" if prev_conv > 0 else "∞"
        lines.append(f"  This Week:     {last_conv:.0f} conversions | ${last_spend:.2f} spend | {this_cpl} CPL")
        lines.append(f"  Previous Week: {prev_conv:.0f} conversions | ${prev_spend:.2f} spend | {prev_cpl} CPL")
        change = ((last_conv - prev_conv) / prev_conv * 100) if prev_conv > 0 else 0
        lines.append(f"  Change:        {'+' if change >= 0 else ''}{change:.0f}% conversions")
        lines.append("")

    # Issues
    if analysis["issues"]:
        lines.append(f"🚨 ISSUES IDENTIFIED ({len(analysis['issues'])})")
        lines.append("─" * 70)
        for issue in analysis["issues"]:
            icon = "🔴" if issue["severity"] == "CRITICAL" else "🟠" if issue["severity"] == "HIGH" else "🟡"
            lines.append(f"  {icon} [{issue['severity']}] {issue['description']}")
            lines.append(f"     {issue['detail']}")
            lines.append("")

    # Campaign breakdown
    lines.append("📋 CAMPAIGN PERFORMANCE")
    lines.append("─" * 70)
    for c in campaigns[:10]:
        status = "✓" if c["cpl"] <= TARGET_CPL else "⚠" if c["cpl"] <= TARGET_CPL * 1.5 else "✗"
        lines.append(f"  {status} {c['name']}")
        cpl_str = f"${c['cpl']:.2f}" if c['cpl'] != float('inf') else "∞"
        lines.append(f"     Spend: ${c['spend']:.2f} | Conv: {c['conversions']:.0f} | CPL: {cpl_str} | CTR: {c['ctr'] * 100:.2f}% | IS: {c['impression_share'] * 100:.0f}%")
    lines.append("")

    # Top keywords
    top_kw = sorted([k for k in keywords if k["conversions"] > 0], key=lambda x: x["conversions"], reverse=True)[:10]
    if top_kw:
        lines.append("🔑 TOP CONVERTING KEYWORDS")
        lines.append("─" * 70)
        for k in top_kw:
            cpl = k["cost"] / k["conversions"] if k["conversions"] > 0 else float('inf')
            lines.append(f"  \"{k['text']}\" [{k['match_type']}]")
            qs = k.get('quality_score', 'N/A')
            lines.append(f"     Conv: {k['conversions']:.0f} | Cost: ${k['cost']:.2f} | CPL: ${cpl:.2f} | QS: {qs}")
        lines.append("")

    # Wasted spend terms
    problem = sorted([t for t in search_terms if t["cost"] > 10 and t["conversions"] == 0], key=lambda x: x["cost"], reverse=True)[:15]
    if problem:
        lines.append("💸 WASTED SPEND - SEARCH TERMS (No Conversions)")
        lines.append("─" * 70)
        for t in problem:
            lines.append(f"  ${t['cost']:.2f} - \"{t['term']}\"")
        lines.append("")

    # Recommendations
    if analysis["recommendations"]:
        lines.append("💡 RECOMMENDATIONS")
        lines.append("─" * 70)
        for i, rec in enumerate(analysis["recommendations"], 1):
            lines.append(f"  {i}. {rec['action']}")
            lines.append(f"     Reason: {rec['reason']}")
            lines.append(f"     Impact: {rec['impact']}")
            if "negatives" in rec:
                lines.append(f"     Negatives to add: {', '.join(rec['negatives'])}")
            lines.append("")

    lines.append("═" * 70)
    lines.append("  END OF ANALYSIS")
    lines.append("═" * 70)

    return "\n".join(lines)

def main():
    print("═" * 70)
    print("  GOOGLE ADS PPC AGENT - CHISHOLM LAW FIRM")
    print(f"  Customer ID: {CUSTOMER_ID}")
    print(f"  Target CPL: ${TARGET_CPL}")
    print("═" * 70)

    try:
        print("\n🔐 Authenticating...")
        client = get_client()
        print("   Authentication successful")

        # Fetch all data
        campaigns = get_campaigns(client)
        keywords = get_keywords(client)
        search_terms = get_search_terms(client)
        daily_data = get_daily_performance(client)

        # Analyze
        analysis = analyze_performance(campaigns, keywords, search_terms, daily_data)

        # Generate report
        report = generate_report(campaigns, keywords, search_terms, daily_data, analysis)
        print("\n")
        print(report)

        # Save to JSON for UI
        output = {
            "campaigns": campaigns,
            "keywords": keywords,
            "search_terms": search_terms,
            "daily_data": daily_data,
            "analysis": analysis,
            "generated_at": datetime.now().isoformat()
        }

        with open('/Users/bnovak/Documents/goboom-growth-agents/src/agents/google-ads-ppc/analysis_output.json', 'w') as f:
            json.dump(output, f, indent=2, default=str)
        print("\n✅ Analysis saved to analysis_output.json")

        return output

    except GoogleAdsException as ex:
        print(f"\n❌ Google Ads API Error:")
        for error in ex.failure.errors:
            print(f"   {error.error_code}: {error.message}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
