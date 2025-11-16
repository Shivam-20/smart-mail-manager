require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const https = require('https');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
db.initDatabase();

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const USE_GEMINI = process.env.USE_GEMINI === 'true';
const VALID_CATEGORIES = [
  'Finance/Investments', 'Finance/Banking', 'Finance/E-commerce', 
  'Finance/Billing', 'Finance/General', 'Work', 'Shopping', 
  'Personal', 'Promotions', 'Other'
];

// Rate limiting for Gemini API
let geminiCallsThisMinute = 0;
let lastMinuteReset = Date.now();
const MAX_GEMINI_CALLS_PER_MINUTE = 10;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} - User: ${req.user ? req.user.profile.displayName : 'Anonymous'}`);
  next();
});

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.use(passport.initialize());
app.use(passport.session());

// OAuth2 configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://127.0.0.1:3000/auth/google/callback'
);

// Passport Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://127.0.0.1:3000/auth/google/callback',
  scope: ['https://www.googleapis.com/auth/gmail.modify', 'email', 'profile']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    return done(null, { profile, accessToken, refreshToken });
  } catch (error) {
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Gmail API setup
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
};

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'SmartMail AI Server is running!' });
});

// Serve static HTML files
app.get('/dashboard', (req, res) => {
  res.sendFile(__dirname + '/dashboard.html');
});

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/login.html');
});

// Auth routes
app.get('/auth/google', passport.authenticate('google'));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: 'http://127.0.0.1:3000/login' }),
  (req, res) => {
    console.log('✅ OAuth callback successful, user:', req.user.profile.displayName);
    console.log('✅ Redirecting to dashboard...');
    res.redirect('http://127.0.0.1:3000/dashboard');
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('http://localhost:5173');
  });
});

app.get('/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ 
      authenticated: true, 
      user: req.user.profile 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Gmail API routes with pagination support
app.get('/api/emails', isAuthenticated, async (req, res) => {
  try {
    console.log('📧 Fetching emails from Gmail...');
    console.log('🔐 User authenticated:', req.user.profile.displayName);
    
    // Set OAuth credentials from session
    oauth2Client.setCredentials({ 
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken 
    });
    
    // Get pagination parameters
    const pageToken = req.query.pageToken || null;
    const maxResults = parseInt(req.query.maxResults) || 20;
    
    console.log(`📄 Fetching page with token: ${pageToken || 'first'}, maxResults: ${maxResults}`);
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: maxResults,
      pageToken: pageToken,
      q: 'in:inbox'
    });

    // Check if response has messages array
    const messages = response.data.messages || [];
    console.log(`📧 Found ${messages.length} messages in Gmail`);
    
    if (!Array.isArray(messages)) {
      console.error('❌ Gmail API returned non-array response:', response.data);
      return res.json({
        emails: [],
        nextPageToken: null,
        prevPageToken: null,
        totalResults: 0
      });
    }

    const fullMessages = [];
    const savedEmails = [];

    for (const message of messages) {
      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date', 'To']
        });
        
        // Extract email data
        const headers = msg.data.payload.headers;
        const subjectHeader = headers.find(h => h.name === 'Subject');
        const fromHeader = headers.find(h => h.name === 'From');
        const toHeader = headers.find(h => h.name === 'To');
        const dateHeader = headers.find(h => h.name === 'Date');
        
        const emailData = {
          id: msg.data.id,
          threadId: msg.data.threadId,
          subject: subjectHeader ? subjectHeader.value : 'No Subject',
          from: fromHeader ? fromHeader.value : 'Unknown Sender',
          to: toHeader ? toHeader.value : '',
          date: dateHeader ? dateHeader.value : '',
          snippet: msg.data.snippet || ''
        };
        
        fullMessages.push(msg.data);
        
        // Save to database
        db.saveEmail(emailData);
        savedEmails.push(emailData);
        
      } catch (msgError) {
        console.error(`❌ Error fetching message ${message.id}:`, msgError.message);
        // Continue with other messages even if one fails
      }
    }

    console.log(`✅ Successfully fetched and saved ${savedEmails.length} emails`);
    
    // Return paginated response
    res.json({
      emails: fullMessages,
      nextPageToken: response.data.nextPageToken || null,
      prevPageToken: null, // Gmail doesn't provide prevPageToken
      totalResults: response.data.resultSizeEstimate || 0,
      currentPageSize: messages.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching emails:', error.message);
    
    // Check if it's the Gmail API not enabled error
    if (error.message.includes('accessNotConfigured') || error.message.includes('Gmail API has not been used')) {
      console.error('🚨 Gmail API not enabled in project!');
      return res.status(403).json({ 
        error: 'Gmail API not enabled. Please enable Gmail API in your Google Cloud Console.',
        details: 'See enable-gmail-api.md for instructions',
        emails: [],
        nextPageToken: null,
        prevPageToken: null,
        totalResults: 0
      });
    }
    
    // Return empty array to prevent forEach errors in frontend
    res.status(500).json({ 
      error: 'Failed to fetch emails', 
      details: error.message,
      emails: [],
      nextPageToken: null,
      prevPageToken: null,
      totalResults: 0
    });
  }
});

app.get('/api/labels', isAuthenticated, async (req, res) => {
  try {
    console.log('🏷️ Fetching labels from Gmail...');
    console.log('🔐 User authenticated:', req.user.profile.displayName);
    
    // Set OAuth credentials from session
    oauth2Client.setCredentials({ 
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken 
    });
    
    const response = await gmail.users.labels.list({
      userId: 'me'
    });
    
    const labels = response.data.labels || [];
    console.log(`✅ Successfully fetched ${labels.length} labels from Gmail`);
    
    // Save labels to database
    labels.forEach(label => {
      db.saveLabel(label);
    });
    
    res.json(labels);
    
  } catch (error) {
    console.error('❌ Error fetching labels:', error.message);
    
    // Check if it's the Gmail API not enabled error
    if (error.message.includes('accessNotConfigured') || error.message.includes('Gmail API has not been used')) {
      console.error('🚨 Gmail API not enabled in project!');
      return res.status(403).json({ 
        error: 'Gmail API not enabled. Please enable Gmail API in your Google Cloud Console.',
        details: 'See enable-gmail-api.md for instructions',
        labels: [] // Return empty array to prevent frontend errors
      });
    }
    
    // Return empty array to prevent frontend forEach errors
    res.status(500).json({ 
      error: 'Failed to fetch labels', 
      details: error.message,
      labels: []
    });
  }
});

app.post('/api/labels', isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    const response = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error creating label:', error);
    res.status(500).json({ error: 'Failed to create label' });
  }
});

// Gemini LLM categorization function
async function categorizeEmailWithGemini(subject, from) {
  return new Promise((resolve, reject) => {
    // Check rate limiting
    const now = Date.now();
    if (now - lastMinuteReset > 60000) {
      geminiCallsThisMinute = 0;
      lastMinuteReset = now;
    }
    
    if (geminiCallsThisMinute >= MAX_GEMINI_CALLS_PER_MINUTE) {
      console.log('🚫 Gemini rate limit reached, using fallback');
      resolve(categorizeEmail(subject, from));
      return;
    }
    
    geminiCallsThisMinute++;
    
    // Prepare the prompt
    const prompt = `You are an email categorizer. Return ONLY ONE category from this exact list:
Finance/Investments, Finance/Banking, Finance/E-commerce, Finance/Billing, Finance/General, Work, Shopping, Personal, Promotions, Other

Email Subject: ${subject}
Email From: ${from}

Category:`;

    // Prepare the request data
    const requestData = JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestData)
      },
      timeout: 5000 // 5 second timeout
    };

    console.log('🤖 Calling Gemini API for categorization...');
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.candidates && response.candidates[0] && response.candidates[0].content) {
            let category = response.candidates[0].content.parts[0].text.trim();
            
            // Clean up the response
            category = category.split('\n')[0].trim(); // Take first line
            category = category.replace(/^Category:\s*/i, ''); // Remove "Category:" prefix
            category = category.replace(/^["']|["']$/g, ''); // Remove quotes
            
            // Validate category
            if (VALID_CATEGORIES.includes(category)) {
              console.log(`✅ Gemini categorized as: ${category}`);
              resolve(category);
            } else {
              console.log(`⚠️ Gemini returned invalid category "${category}", using fallback`);
              resolve(categorizeEmail(subject, from));
            }
          } else {
            console.log('⚠️ Gemini returned invalid response, using fallback');
            resolve(categorizeEmail(subject, from));
          }
        } catch (error) {
          console.log('❌ Error parsing Gemini response, using fallback:', error.message);
          resolve(categorizeEmail(subject, from));
        }
      });
    });

    req.on('error', (error) => {
      console.log('❌ Gemini API request failed, using fallback:', error.message);
      resolve(categorizeEmail(subject, from));
    });

    req.on('timeout', () => {
      console.log('❌ Gemini API request timed out, using fallback');
      req.destroy();
      resolve(categorizeEmail(subject, from));
    });

    req.write(requestData);
    req.end();
  });
}

// Enhanced categorization rules with domain-based matching and hierarchical labels
function categorizeEmail(subject, from) {
  const subjectLower = subject.toLowerCase();
  const fromLower = from.toLowerCase();
  
  // Financial domains for high-confidence matching
  const financialDomains = [
    'groww.in', 'angelbroking.in', 'axisbank.com', 'hdfcbank.com', 'icicibank.com',
    'sbi.co.in', 'kotak.com', 'nsdl.co.in', 'cdslindia.com', 'bseindia.com',
    'nseindia.com', 'camsonline.com', 'karvy.com', 'zerodha.com', 'upstox.com',
    'paytm.com', 'phonepe.com', 'googlepay.com', 'amazon.in', 'flipkart.com'
  ];
  
  // Check if sender is from financial domain
  const isFinancialSender = financialDomains.some(domain => fromLower.includes(domain));
  
  // Investment-specific keywords
  const investmentKeywords = ['sip', 'mutual fund', 'demat', 'trading', 'portfolio', 'stock', 'equity', 'nav', 'redemption', 'purchase'];
  
  // Banking-specific keywords  
  const bankingKeywords = ['statement', 'credit card', 'debit card', 'account', 'balance', 'transaction', 'emi', 'instalment'];
  
  // E-commerce keywords
  const ecommerceKeywords = ['order', 'delivery', 'shipment', 'return', 'refund', 'invoice', 'purchase'];
  
  // Calculate category score
  let category = 'Other';
  let score = 0;
  
  // Domain-based matching (highest confidence)
  if (isFinancialSender) {
    score += 3;
    
    if (investmentKeywords.some(keyword => subjectLower.includes(keyword))) {
      category = 'Finance/Investments';
      score += 2;
    } else if (bankingKeywords.some(keyword => subjectLower.includes(keyword))) {
      category = 'Finance/Banking'; 
      score += 2;
    } else if (ecommerceKeywords.some(keyword => subjectLower.includes(keyword))) {
      category = 'Finance/E-commerce';
      score += 2;
    } else {
      category = 'Finance/General';
    }
  }
  
  // Subject-based matching (medium confidence)
  else if (subjectLower.includes('invoice') || subjectLower.includes('payment') || subjectLower.includes('bill')) {
    category = 'Finance/Billing';
    score += 2;
  } else if (subjectLower.includes('meeting') || subjectLower.includes('project') || fromLower.includes('company')) {
    category = 'Work';
    score += 2;
  } else if (subjectLower.includes('buy') || subjectLower.includes('order') || subjectLower.includes('shop')) {
    category = 'Shopping';
    score += 2;
  } else if (subjectLower.includes('family') || subjectLower.includes('friend')) {
    category = 'Personal';
    score += 2;
  } else if (subjectLower.includes('newsletter') || subjectLower.includes('promotion')) {
    category = 'Promotions';
    score += 2;
  }
  
  // Special cases for your examples
  if (subjectLower.includes('sip') || subjectLower.includes('instalment')) {
    category = 'Finance/Investments';
    score += 3;
  } else if (subjectLower.includes('credit card statement')) {
    category = 'Finance/Banking';
    score += 3;
  } else if (subjectLower.includes('e-voting') || subjectLower.includes('itc limited')) {
    category = 'Finance/Investments';
    score += 3;
  }
  
  // Log categorization for debugging
  console.log(`🏷️ Rule-based categorization: "${subject}" → ${category} (score: ${score})`);
  
  return category;
}

// AI-powered categorization endpoint
app.post('/api/categorize-email', isAuthenticated, async (req, res) => {
  try {
    const { subject, from } = req.body;
    
    console.log('🤖 Categorizing email:', { subject, from });
    
    let category;
    
    // Use Gemini AI if enabled and available
    if (USE_GEMINI && GEMINI_API_KEY) {
      console.log('🧠 Using Gemini AI for categorization...');
      category = await categorizeEmailWithGemini(subject, from);
    } else {
      console.log('📋 Using rule-based categorization...');
      category = categorizeEmail(subject, from);
    }

    console.log(`✅ Final categorization: ${category}`);
    res.json({ category, source: USE_GEMINI && GEMINI_API_KEY ? 'gemini' : 'rules' });
  } catch (error) {
    console.error('❌ Error categorizing email:', error);
    res.status(500).json({ error: 'Failed to categorize email' });
  }
});

// Apply Gmail label to email
app.post('/api/apply-label', isAuthenticated, async (req, res) => {
  try {
    const { emailId, category } = req.body;
    
    console.log(`🏷️ Applying label "${category}" to email ${emailId}`);
    
    // Set OAuth credentials from session
    oauth2Client.setCredentials({ 
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken 
    });
    
    // Check if label exists, create if not
    let labelId;
    try {
      const labelsResponse = await gmail.users.labels.list({
        userId: 'me'
      });
      
      const existingLabel = labelsResponse.data.labels.find(label => label.name === category);
      
      if (existingLabel) {
        labelId = existingLabel.id;
        console.log(`✅ Found existing label: ${category} (${labelId})`);
      } else {
        // Create new label
        const createResponse = await gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name: category,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show'
          }
        });
        
        labelId = createResponse.data.id;
        console.log(`✅ Created new label: ${category} (${labelId})`);
        
        // Save to database
        db.saveLabel(createResponse.data);
      }
    } catch (labelError) {
      console.error('❌ Error finding/creating label:', labelError.message);
      return res.status(500).json({ error: 'Failed to create/find label' });
    }
    
    // Apply label to email
    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id: emailId,
        requestBody: {
          addLabelIds: [labelId]
        }
      });
      
      console.log(`✅ Applied label "${category}" to email ${emailId}`);
      
      // Update database
      db.updateEmailCategory(emailId, category);
      db.markEmailAsSynced(emailId);
      
      res.json({ 
        success: true, 
        message: `Applied label "${category}" to email`,
        labelId: labelId,
        category: category
      });
      
    } catch (applyError) {
      console.error('❌ Error applying label to email:', applyError.message);
      res.status(500).json({ error: 'Failed to apply label to email' });
    }
    
  } catch (error) {
    console.error('❌ Error in apply-label endpoint:', error);
    res.status(500).json({ error: 'Failed to apply label' });
  }
});

// Bulk email categorization and organization
app.post('/api/bulk-organize', isAuthenticated, async (req, res) => {
  try {
    console.log('🔄 Starting bulk email organization...');
    
    // Set OAuth credentials from session
    oauth2Client.setCredentials({ 
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken 
    });
    
    // Fetch more emails for bulk processing (up to 100)
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 100,
      q: 'in:inbox -label:Finance/Investments -label:Finance/Banking -label:Work -label:Shopping -label:Personal -label:Promotions'
    });

    const messages = response.data.messages || [];
    console.log(`📧 Found ${messages.length} uncategorized emails for bulk processing`);
    
    if (messages.length === 0) {
      return res.json({ 
        message: 'No uncategorized emails found',
        results: []
      });
    }

    const results = [];
    const batchSize = 5; // Process in batches to respect rate limits
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(messages.length/batchSize)}...`);
      
      for (const message of batch) {
        try {
          // Get email details
          const msg = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
          });
          
          const headers = msg.data.payload.headers;
          const subjectHeader = headers.find(h => h.name === 'Subject');
          const fromHeader = headers.find(h => h.name === 'From');
          
          const subject = subjectHeader ? subjectHeader.value : 'No Subject';
          const from = fromHeader ? fromHeader.value : 'Unknown';
          
          // Categorize using AI or rules
          let category;
          if (USE_GEMINI && GEMINI_API_KEY && geminiCallsThisMinute < MAX_GEMINI_CALLS_PER_MINUTE) {
            category = await categorizeEmailWithGemini(subject, from);
          } else {
            category = categorizeEmail(subject, from);
          }
          
          // Save to database
          const emailData = {
            id: msg.data.id,
            threadId: msg.data.threadId,
            subject: subject,
            from: from,
            date: headers.find(h => h.name === 'Date') ? headers.find(h => h.name === 'Date').value : '',
            snippet: msg.data.snippet || '',
            category: category,
            processed: true,
            synced: false
          };
          
          db.saveEmail(emailData);
          
          results.push({
            emailId: msg.data.id,
            subject: subject,
            from: from,
            category: category,
            source: USE_GEMINI && GEMINI_API_KEY ? 'gemini' : 'rules'
          });
          
        } catch (error) {
          console.error(`❌ Error processing message ${message.id}:`, error.message);
          results.push({
            emailId: message.id,
            error: error.message
          });
        }
      }
      
      // Add delay between batches to respect rate limits
      if (i + batchSize < messages.length) {
        console.log('⏱️ Waiting between batches...');
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      }
    }
    
    // Group results by category
    const grouped = {};
    results.forEach(result => {
      if (!result.error) {
        grouped[result.category] = (grouped[result.category] || 0) + 1;
      }
    });
    
    console.log('✅ Bulk organization completed');
    console.log('📊 Results:', grouped);
    
    res.json({
      message: `Processed ${results.length} emails`,
      total: results.length,
      successful: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length,
      grouped: grouped,
      results: results
    });
    
  } catch (error) {
    console.error('❌ Error in bulk organization:', error);
    res.status(500).json({ error: 'Failed to organize emails' });
  }
});

// Label analysis and cleanup
app.get('/api/labels/analysis', isAuthenticated, async (req, res) => {
  try {
    console.log('🔍 Analyzing existing Gmail labels...');
    
    // Set OAuth credentials from session
    oauth2Client.setCredentials({ 
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken 
    });
    
    const response = await gmail.users.labels.list({
      userId: 'me'
    });
    
    const labels = response.data.labels || [];
    
    // Analyze labels for potential issues
    const analysis = {
      total: labels.length,
      userLabels: labels.filter(l => l.type === 'user').length,
      systemLabels: labels.filter(l => l.type === 'system').length,
      potentialDuplicates: [],
      nonHierarchical: [],
      suggestions: []
    };
    
    // Find potential duplicates (case-insensitive)
    const labelNames = labels.map(l => l.name.toLowerCase());
    const seen = new Set();
    
    labels.forEach(label => {
      const lowerName = label.name.toLowerCase();
      if (seen.has(lowerName)) {
        analysis.potentialDuplicates.push(label.name);
      } else {
        seen.add(lowerName);
      }
      
      // Check for non-hierarchical labels that could be hierarchical
      if (label.name.includes('_') || label.name.includes('-')) {
        analysis.nonHierarchical.push(label.name);
      }
    });
    
    // Generate suggestions
    if (analysis.potentialDuplicates.length > 0) {
      analysis.suggestions.push(`Found ${analysis.potentialDuplicates.length} potential duplicate labels that could be merged`);
    }
    
    if (analysis.nonHierarchical.length > 0) {
      analysis.suggestions.push(`Found ${analysis.nonHierarchical.length} labels that could be converted to hierarchical format`);
    }
    
    console.log('✅ Label analysis completed');
    res.json({
      labels: labels,
      analysis: analysis
    });
    
  } catch (error) {
    console.error('❌ Error analyzing labels:', error);
    res.status(500).json({ error: 'Failed to analyze labels' });
  }
});

// Bulk operations on selected emails
app.post('/api/bulk-operations', isAuthenticated, async (req, res) => {
  try {
    const { emailIds, operation, category } = req.body;
    
    console.log(`🔄 Bulk operation: ${operation} on ${emailIds.length} emails`);
    
    if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({ error: 'No email IDs provided' });
    }
    
    // Set OAuth credentials from session
    oauth2Client.setCredentials({ 
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken 
    });
    
    const results = [];
    const batchSize = 5; // Process in batches to respect rate limits
    
    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, i + batchSize);
      console.log(`🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(emailIds.length/batchSize)}...`);
      
      for (const emailId of batch) {
        try {
          let result;
          
          if (operation === 'applyLabel') {
            result = await applyLabelToEmail(emailId, category);
          } else if (operation === 'categorize') {
            result = await categorizeEmailById(emailId);
          } else {
            throw new Error('Unknown operation');
          }
          
          results.push({
            emailId: emailId,
            success: true,
            result: result
          });
          
        } catch (error) {
          console.error(`❌ Error processing ${emailId}:`, error.message);
          results.push({
            emailId: emailId,
            success: false,
            error: error.message
          });
        }
      }
      
      // Add delay between batches
      if (i + batchSize < emailIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    console.log(`✅ Bulk operation completed: ${successCount} successful, ${failCount} failed`);
    
    res.json({
      operation: operation,
      total: emailIds.length,
      successful: successCount,
      failed: failCount,
      results: results
    });
    
  } catch (error) {
    console.error('❌ Error in bulk operations:', error);
    res.status(500).json({ error: 'Failed to perform bulk operation' });
  }
});

// Helper function to apply label to email
async function applyLabelToEmail(emailId, category) {
  // Check if label exists, create if not
  let labelId;
  try {
    const labelsResponse = await gmail.users.labels.list({
      userId: 'me'
    });
    
    const existingLabel = labelsResponse.data.labels.find(label => label.name === category);
    
    if (existingLabel) {
      labelId = existingLabel.id;
    } else {
      // Create new label
      const createResponse = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: category,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });
      
      labelId = createResponse.data.id;
      db.saveLabel(createResponse.data);
    }
  } catch (labelError) {
    throw new Error('Failed to create/find label');
  }
  
  // Apply label to email
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        addLabelIds: [labelId]
      }
    });
    
    // Update database
    db.updateEmailCategory(emailId, category);
    db.markEmailAsSynced(emailId);
    
    return { category: category, labelId: labelId };
  } catch (applyError) {
    throw new Error('Failed to apply label to email');
  }
}

// Helper function to categorize email by ID
async function categorizeEmailById(emailId) {
  try {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date']
    });
    
    const headers = msg.data.payload.headers;
    const subject = headers.find(h => h.name === 'Subject') ? headers.find(h => h.name === 'Subject').value : 'No Subject';
    const from = headers.find(h => h.name === 'From') ? headers.find(h => h.name === 'From').value : 'Unknown';
    
    // Categorize using AI or rules
    let category;
    if (USE_GEMINI && GEMINI_API_KEY && geminiCallsThisMinute < MAX_GEMINI_CALLS_PER_MINUTE) {
      category = await categorizeEmailWithGemini(subject, from);
    } else {
      category = categorizeEmail(subject, from);
    }
    
    // Update database
    db.updateEmailCategory(emailId, category);
    
    return { category: category };
  } catch (error) {
    throw new Error('Failed to categorize email');
  }
}

// Database API routes
app.get('/api/db/emails', isAuthenticated, (req, res) => {
  try {
    const emails = db.getEmails({ limit: 50 });
    res.json(emails);
  } catch (error) {
    console.error('❌ Error fetching emails from database:', error);
    res.status(500).json({ error: 'Failed to fetch emails from database' });
  }
});

app.get('/api/db/stats', isAuthenticated, (req, res) => {
  try {
    const stats = db.getDatabaseStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error fetching database stats:', error);
    res.status(500).json({ error: 'Failed to fetch database stats' });
  }
});

app.post('/api/db/categorize-email', isAuthenticated, (req, res) => {
  try {
    const { emailId, category } = req.body;
    const result = db.updateEmailCategory(emailId, category);
    console.log(`✅ Categorized email ${emailId} as ${category}`);
    res.json({ success: true, changes: result.changes });
  } catch (error) {
    console.error('❌ Error categorizing email in database:', error);
    res.status(500).json({ error: 'Failed to categorize email' });
  }
});

app.post('/api/db/sync-to-gmail', isAuthenticated, async (req, res) => {
  try {
    const unsyncedEmails = db.getUnsyncedEmails();
    console.log(`🔄 Syncing ${unsyncedEmails.length} emails to Gmail...`);
    
    let syncedCount = 0;
    let errorCount = 0;
    
    for (const email of unsyncedEmails) {
      try {
        // Find or create label for category
        const labelResponse = await gmail.users.labels.list({
          userId: 'me'
        });
        
        let label = labelResponse.data.labels.find(l => l.name === email.category);
        
        if (!label) {
          // Create new label
          const createResponse = await gmail.users.labels.create({
            userId: 'me',
            requestBody: {
              name: email.category,
              labelListVisibility: 'labelShow',
              messageListVisibility: 'show'
            }
          });
          label = createResponse.data;
          db.saveLabel(label);
        }
        
        // Apply label to email
        await gmail.users.messages.modify({
          userId: 'me',
          id: email.id,
          requestBody: {
            addLabelIds: [label.id]
          }
        });
        
        // Mark as synced in database
        db.markEmailAsSynced(email.id);
        syncedCount++;
        
      } catch (syncError) {
        console.error(`❌ Error syncing email ${email.id}:`, syncError.message);
        errorCount++;
      }
    }
    
    console.log(`✅ Sync completed: ${syncedCount} synced, ${errorCount} errors`);
    res.json({ 
      success: true, 
      synced: syncedCount, 
      errors: errorCount,
      total: unsyncedEmails.length
    });
    
  } catch (error) {
    console.error('❌ Error syncing to Gmail:', error);
    res.status(500).json({ error: 'Failed to sync to Gmail' });
  }
});

app.post('/api/apply-label', isAuthenticated, async (req, res) => {
  try {
    const { emailId, labelId } = req.body;
    
    await gmail.users.messages.modify({
      userId: 'me',
      id: emailId,
      requestBody: {
        addLabelIds: [labelId]
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error applying label:', error);
    res.status(500).json({ error: 'Failed to apply label' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Using simplified version for Node.js v10 compatibility');
});
