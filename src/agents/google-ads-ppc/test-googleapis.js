#!/usr/bin/env node
/**
 * Test using googleapis with OAuth2
 */

import { google } from 'googleapis';
import fs from 'fs';

const credentials = JSON.parse(fs.readFileSync('/Users/bnovak/GoBoom/goboom/.google-ads-credentials.json', 'utf-8'));

console.log('Setting up OAuth2 client...');

const oauth2Client = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret
);

oauth2Client.setCredentials({
  refresh_token: credentials.refresh_token
});

console.log('Getting access token...');
const { token } = await oauth2Client.getAccessToken();
console.log('Access token obtained:', token ? 'Yes' : 'No');

// The googleapis package doesn't have Google Ads API built-in
// Let's try a direct HTTP call with the obtained token

console.log('Making direct API call...');

const response = await fetch('https://googleads.googleapis.com/v17/customers/9926142954:listAccessibleCustomers', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'developer-token': 'wyv5YWkns7LYXHjsZ5bokg'
  }
});

console.log('Response status:', response.status);
const data = await response.text();
console.log('Response:', data);
