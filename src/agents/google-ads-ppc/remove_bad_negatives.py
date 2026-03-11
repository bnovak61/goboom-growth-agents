#!/usr/bin/env python3
"""
Remove negative keywords that are actually converting
Based on Audrey's feedback: NPO help, 501 C 3 help, how to start a non-profit are qualified
"""

import json
from google.ads.googleads.client import GoogleAdsClient
from google.ads.googleads.errors import GoogleAdsException

CUSTOMER_ID = "9926142954"
LOGIN_CUSTOMER_ID = "5660386900"

# Keywords to REMOVE from negatives (these are actually converting)
KEYWORDS_TO_REMOVE = [
    "how to",  # This was blocking qualified leads
    "npo help",
    "501 c 3 help",
    "501c3 help",
]

with open('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json') as f:
    creds = json.load(f)

def get_client():
    config = {
        'developer_token': 'wyv5YWkns7LYXHjsZ5bokg',
        'client_id': creds['client_id'],
        'client_secret': creds['client_secret'],
        'refresh_token': creds['refresh_token'],
        'login_customer_id': LOGIN_CUSTOMER_ID,
        'use_proto_plus': True
    }
    return GoogleAdsClient.load_from_dict(config)

def find_and_remove_negatives(client):
    """Find and remove the problematic negative keywords"""
    ga_service = client.get_service("GoogleAdsService")
    campaign_criterion_service = client.get_service("CampaignCriterionService")

    print("🔍 Finding negative keywords to remove...")

    # Query for negative keywords
    query = """
        SELECT
            campaign_criterion.resource_name,
            campaign_criterion.keyword.text,
            campaign_criterion.keyword.match_type,
            campaign_criterion.negative,
            campaign.name
        FROM campaign_criterion
        WHERE campaign_criterion.negative = TRUE
            AND campaign_criterion.type = 'KEYWORD'
            AND campaign.status = 'ENABLED'
    """

    response = ga_service.search(customer_id=CUSTOMER_ID, query=query)

    to_remove = []
    for row in response:
        keyword_text = row.campaign_criterion.keyword.text.lower()
        for bad_kw in KEYWORDS_TO_REMOVE:
            if bad_kw.lower() in keyword_text or keyword_text in bad_kw.lower():
                to_remove.append({
                    "resource_name": row.campaign_criterion.resource_name,
                    "keyword": row.campaign_criterion.keyword.text,
                    "campaign": row.campaign.name
                })
                break

    print(f"   Found {len(to_remove)} negative keywords to remove")

    if not to_remove:
        print("   No problematic negatives found")
        return

    # Remove them
    operations = []
    for item in to_remove:
        print(f"   🗑️  Removing: \"{item['keyword']}\" from {item['campaign']}")
        operation = client.get_type("CampaignCriterionOperation")
        operation.remove = item["resource_name"]
        operations.append(operation)

    try:
        response = campaign_criterion_service.mutate_campaign_criteria(
            customer_id=CUSTOMER_ID,
            operations=operations
        )
        print(f"\n✅ Successfully removed {len(response.results)} negative keywords")
    except GoogleAdsException as ex:
        print(f"❌ Error: {ex.failure.errors[0].message}")

def main():
    print("═" * 70)
    print("  REMOVING PROBLEMATIC NEGATIVE KEYWORDS")
    print("  Based on Audrey's feedback - these are qualified leads")
    print("═" * 70)

    client = get_client()
    find_and_remove_negatives(client)

    print("\n✅ Done - 'how to', 'npo help', '501c3 help' queries will now show ads")

if __name__ == "__main__":
    main()
