#!/usr/bin/env python3
"""
Add negative keywords to campaigns
"""

import json
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

CUSTOMER_ID = "9926142954"

# Campaign IDs for non-brand campaigns (excluding trial and brand)
NON_BRAND_CAMPAIGNS = [
    {"id": 16153774044, "name": "Nationwide - Non Brand 1"},
    {"id": 22259830963, "name": "Nationwide - Non Brand 2"},
    {"id": 23494031007, "name": "Nationwide - Non Brand 1 (Weekend)"},
    {"id": 23499063017, "name": "Nationwide - Non Brand 2 (Weekend)"},
    {"id": 23548373222, "name": "Nationwide - Non Brand 1 - Q1 '26 LP Test"},
]

# Negative keywords to add
PHRASE_NEGATIVES = [
    "what is", "how to", "how do", "can i", "should i",
    "is it", "why do", "when do", "definition", "meaning",
    "example", "tutorial", "guide", "free", "diy",
    "reddit", "jobs", "salary", "career", "school",
    "degree", "requirements", "steps to", "process"
]

EXACT_NEGATIVES = [
    "how to start a nonprofit",
    "how to start a non profit",
    "how to start a nonprofit organization",
    "501c3 requirements",
    "nonprofit requirements",
    "how to form a nonprofit",
    "501 c 3 organization",
    "nonprofit lawyers",
    "nonprofit law firm",
    "bureau of corporations and charitable organizations",
    "how to start a foundation"
]

def main():
    print("═" * 70)
    print("  ADDING NEGATIVE KEYWORDS TO CAMPAIGNS")
    print("═" * 70)

    with open('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json') as f:
        creds = json.load(f)

    config = {
        'developer_token': 'wyv5YWkns7LYXHjsZ5bokg',
        'client_id': creds['client_id'],
        'client_secret': creds['client_secret'],
        'refresh_token': creds['refresh_token'],
        'login_customer_id': '5660386900',
        'use_proto_plus': True
    }

    client = GoogleAdsClient.load_from_dict(config)
    campaign_criterion_service = client.get_service("CampaignCriterionService")

    total_added = 0
    total_failed = 0

    for campaign in NON_BRAND_CAMPAIGNS:
        print(f"\n📌 Processing: {campaign['name']}")

        operations = []

        # Add phrase match negatives
        for kw in PHRASE_NEGATIVES:
            operation = client.get_type("CampaignCriterionOperation")
            criterion = operation.create
            criterion.campaign = campaign_criterion_service.campaign_path(CUSTOMER_ID, campaign["id"])
            criterion.negative = True
            criterion.keyword.text = kw
            criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
            operations.append(operation)

        # Add exact match negatives
        for kw in EXACT_NEGATIVES:
            operation = client.get_type("CampaignCriterionOperation")
            criterion = operation.create
            criterion.campaign = campaign_criterion_service.campaign_path(CUSTOMER_ID, campaign["id"])
            criterion.negative = True
            criterion.keyword.text = kw
            criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum.EXACT
            operations.append(operation)

        try:
            response = campaign_criterion_service.mutate_campaign_criteria(
                customer_id=CUSTOMER_ID,
                operations=operations
            )
            added = len(response.results)
            total_added += added
            print(f"   ✅ Added {added} negative keywords")
        except GoogleAdsException as ex:
            for error in ex.failure.errors:
                # Duplicate is OK - just means it already exists
                if "DUPLICATE" in str(error.error_code):
                    print(f"   ⚠️  Some keywords already exist (skipped duplicates)")
                else:
                    print(f"   ❌ Error: {error.message}")
                    total_failed += 1

    print("\n" + "═" * 70)
    print(f"  SUMMARY: Added {total_added} negative keywords, {total_failed} failed")
    print("═" * 70)

if __name__ == "__main__":
    main()
