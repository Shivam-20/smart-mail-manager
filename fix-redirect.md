# Fix Redirect URI Mismatch Error

## The Problem
Your Google OAuth2 client is configured with a different redirect URI than what our application is using.

## Current Application Configuration
Our app is using: `http://localhost:3000/auth/google/callback`

## What You Need to Do

### Step 1: Go to Google Cloud Console
1. Visit: https://console.cloud.google.com/
2. Select your project: `axiomatic-folio-456711-g5`
3. Go to "APIs & Services" > "Credentials"

### Step 2: Edit OAuth2 Client
1. Find your OAuth2 client ID: `410336536738-2r9kmd68cf284ptonsdbkdc727kr6a17.apps.googleusercontent.com`
2. Click on it to edit
3. Scroll down to "Authorized redirect URIs"
4. Add this URI: `http://localhost:3000/auth/google/callback`
5. Click "Save"

### Step 3: Wait a Few Minutes
Sometimes it takes 2-5 minutes for changes to propagate

### Step 4: Try Again
Go back to the test page and click "Sign in with Google"

## Alternative: Check Current Configuration
You can see what redirect URIs are currently configured by:
1. Going to Google Cloud Console
2. APIs & Services > Credentials
3. Click on your OAuth2 client
4. Look at "Authorized redirect URIs" section

## Common Redirect URI Formats
- `http://localhost:3000/auth/google/callback` (what we use)
- `http://127.0.0.1:3000/auth/google/callback` (alternative)
- `https://yourdomain.com/auth/google/callback` (for production)

Make sure the exact URI matches what's in our server configuration.
