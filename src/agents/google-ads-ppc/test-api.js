#!/usr/bin/env node
/**
 * Test Google Ads API connection with timeout
 */

import { GoogleAdsApi } from 'google-ads-api';
import fs from 'fs';

const credentials = JSON.parse(fs.readFileSync('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json', 'utf-8'));

const TIMEOUT = 15000; // 15 seconds

const timeout = setTimeout(() => {
  console.error('TIMEOUT: API call took longer than 15 seconds');
  process.exit(1);
}, TIMEOUT);

console.log('Creating GoogleAdsApi client...');

try {
  const client = new GoogleAdsApi({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    developer_token: 'wyv5YWkns7LYXHjsZ5bokg'
  });

  console.log('Getting customer client for 9926142954...');

  const customer = client.Customer({
    customer_id: '9926142954',
    login_customer_id: '5660386900',
    refresh_token: credentials.refresh_token
  });

  console.log('Executing GAQL query...');

  const results = await customer.query(`
    SELECT customer.id, customer.descriptive_name
    FROM customer
    LIMIT 1
  `);

  clearTimeout(timeout);
  console.log('SUCCESS:', JSON.stringify(results, null, 2));
  process.exit(0);

} catch (error) {
  clearTimeout(timeout);
  console.error('ERROR:', error.message);
  if (error.errors) {
    console.error('API Errors:', JSON.stringify(error.errors, null, 2));
  }
  process.exit(1);
}
