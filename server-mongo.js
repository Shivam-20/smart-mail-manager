require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const MongoDatabase = require('./database-mongo');
const BatchProcessor = require('./batch-processor');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize MongoDB
const mongoDb = MongoDatabase;

// OAuth2 setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://127.0.0.1:3000/auth/google/callback'
);

// Batch processor
const batchProcessor = new BatchProcessor(mongoDb, oauth2Client);

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'smartmail-session-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://127.0.0.1:3000/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Save user to MongoDB
    const userData = {
      userId: profile.id,
      email: profile.emails[0].value,
      displayName: profile.displayName,
      accessToken: accessToken,
      refreshToken: refreshToken,
      tokenExpiry: new Date(Date.now() + 3600 * 1000), // 1 hour
      createdAt: new Date()
    };
    
    await mongoDb.saveUser(userData);
    done(null, { profile, accessToken, refreshToken });
  } catch (error) {
    console.error('❌ Error saving user:', error.message);
    done(error, null);
  }
}));

// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

// Token refresh helper
async function withTokenRefresh(req, res, operation) {
  try {
    // Set OAuth credentials
    oauth2Client.setCredentials({
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken
    });
    
    // Try the operation
    return await operation();
    
  } catch (error) {
    // Check if it's a token error
    if (error.code === 401 || error.message.includes('invalid_token')) {
      try {
        console.log('🔄 Refreshing access token...');
        
        // Refresh the token
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Update in MongoDB
        await mongoDb.updateUserTokens(req.user.profile.id, {
          accessToken: credentials.access_token,
          refreshToken: credentials.refresh_token || req.user.refreshToken,
          tokenExpiry: new Date(credentials.expiry_date)
        });
        
        // Update session
        req.user.accessToken = credentials.access_token;
        
        // Retry the operation
        oauth2Client.setCredentials({
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token || req.user.refreshToken
        });
        
        return await operation();
        
      } catch (refreshError) {
        console.error('❌ Token refresh failed:', refreshError.message);
        return res.status(401).json({ 
          error: 'Token refresh failed. Please re-login.',
          requiresReauth: true 
        });
      }
    } else {
      throw error;
    }
  }
}

// Routes

// Auth routes
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.modify']
}));

app.get('/auth/google/callback', passport.authenticate('google', {
  successRedirect: '/dashboard',
  failureRedirect: '/login'
}));

app.get('/auth/check', isAuthenticated, async (req, res) => {
  try {
    const user = await mongoDb.getUser(req.user.profile.id);
    if (user) {
      res.json({ 
        authenticated: true, 
        user: req.user.profile,
        tokenExpiry: user.tokenExpiry
      });
    } else {
      res.json({ authenticated: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Auth check failed' });
  }
});

app.get('/auth/logout', (req, res) => {
  req.logout();
  res.redirect('/login');
});

// Enhanced email routes with MongoDB
app.get('/api/emails', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.profile.id;
    const limit = parseInt(req.query.limit) || 50;
    const processed = req.query.processed === 'true' ? true : req.query.processed === 'false' ? false : undefined;
    
    const emails = await mongoDb.getEmails(userId, { limit, processed });
    res.json(emails);
    
  } catch (error) {
    console.error('❌ Error fetching emails:', error.message);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Enhanced batch operation routes
app.post('/api/batch/create', isAuthenticated, async (req, res) => {
  try {
    const { operation, options } = req.body;
    const userId = req.user.profile.id;
    
    // Validate batch size
    const maxBatchSizes = {
      fetchEmails: 500,
      analyzeEmails: 200,
      assignLabels: 200,
      fullProcess: 200
    };
    
    if (options.batchSize && maxBatchSizes[operation]) {
      if (options.batchSize > maxBatchSizes[operation]) {
        return res.status(400).json({ 
          error: `Batch size too large. Maximum for ${operation} is ${maxBatchSizes[operation]}` 
        });
      }
      
      if (options.batchSize < 1) {
        return res.status(400).json({ 
          error: 'Batch size must be at least 1' 
        });
      }
    }
    
    const batchId = await batchProcessor.createBatch(userId, operation, { ...options, userId });
    
    res.json({ 
      success: true, 
      batchId: batchId,
      message: `Batch ${batchId} created for ${operation}`
    });
    
  } catch (error) {
    console.error('❌ Error creating batch:', error.message);
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

app.post('/api/batch/execute', isAuthenticated, async (req, res) => {
  try {
    const { batchId } = req.body;
    
    // Get user tokens
    const user = await mongoDb.getUser(req.user.profile.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Execute batch with token refresh
    const result = await withTokenRefresh(req, res, async () => {
      return await batchProcessor.executeBatch(batchId, {
        accessToken: user.accessToken,
        refreshToken: user.refreshToken
      });
    });
    
    res.json({
      success: true,
      batchId: batchId,
      result: result
    });
    
  } catch (error) {
    console.error('❌ Error executing batch:', error.message);
    res.status(500).json({ error: 'Failed to execute batch' });
  }
});

app.get('/api/batch/status/:batchId', isAuthenticated, async (req, res) => {
  try {
    const { batchId } = req.params;
    const status = await batchProcessor.getBatchStatus(batchId);
    
    if (!status) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    
    res.json(status);
    
  } catch (error) {
    console.error('❌ Error getting batch status:', error.message);
    res.status(500).json({ error: 'Failed to get batch status' });
  }
});

app.get('/api/batch/history', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.profile.id;
    const limit = parseInt(req.query.limit) || 20;
    
    const history = await batchProcessor.getUserBatchHistory(userId, limit);
    res.json(history);
    
  } catch (error) {
    console.error('❌ Error getting batch history:', error.message);
    res.status(500).json({ error: 'Failed to get batch history' });
  }
});

// Enhanced label routes
app.get('/api/labels', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.profile.id;
    
    const result = await withTokenRefresh(req, res, async () => {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const response = await gmail.users.labels.list({ userId: 'me' });
      
      const gmailLabels = response.data.labels || [];
      
      // Save to MongoDB
      for (const label of gmailLabels) {
        if (label.type === 'user') {
          await mongoDb.saveLabel({
            userId: userId,
            name: label.name,
            gmailLabelId: label.id,
            emailCount: 0,
            isAuto: false
          });
        }
      }
      
      return gmailLabels;
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error fetching labels:', error.message);
    res.status(500).json({ error: 'Failed to fetch labels' });
  }
});

app.get('/api/labels/emails/:labelName', isAuthenticated, async (req, res) => {
  try {
    const { labelName } = req.params;
    const userId = req.user.profile.id;
    
    const result = await withTokenRefresh(req, res, async () => {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: `label:${labelName}`
      });
      
      const messages = response.data.messages || [];
      const emails = [];
      
      for (const message of messages.slice(0, 50)) { // Limit to 50
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date']
        });
        
        const headers = msg.data.payload.headers;
        emails.push({
          gmailId: msg.data.id,
          subject: (headers.find(h => h.name === 'Subject') || {}).value || 'No Subject',
          from: (headers.find(h => h.name === 'From') || {}).value || 'Unknown',
          date: (headers.find(h => h.name === 'Date') || {}).value || ''
        });
      }
      
      return emails;
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error fetching label emails:', error.message);
    res.status(500).json({ error: 'Failed to fetch label emails' });
  }
});

// Analytics and reporting routes
app.get('/api/analytics/overview', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.profile.id;
    
    const [emailStats, categoryBreakdown, labels] = await Promise.all([
      mongoDb.getEmailStats(userId),
      mongoDb.getCategoryBreakdown(userId),
      mongoDb.getLabels(userId)
    ]);
    
    res.json({
      emailStats,
      categoryBreakdown,
      totalLabels: labels.length
    });
    
  } catch (error) {
    console.error('❌ Error getting analytics:', error.message);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

app.get('/api/analytics/suggestions', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user.profile.id;
    const suggestions = await batchProcessor.geminiAnalyzer.suggestLabelOrganization(userId);
    res.json(suggestions);
    
  } catch (error) {
    console.error('❌ Error getting suggestions:', error.message);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// Serve static files
// Dashboard route (removed authentication - moved below)

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/login.html');
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const mongoConnected = await mongoDb.connect();
    res.json({ 
      status: 'healthy', 
      mongodb: mongoConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy', 
      error: error.message 
    });
  }
});

// Serve static files and dashboard
app.use(express.static(__dirname));
app.get('/dashboard', (req, res) => {
  res.sendFile('dashboard-mongo.html', { root: __dirname });
});

// Start server
async function startServer() {
  try {
    // Connect to MongoDB
    const mongoConnected = await mongoDb.connect();
    if (!mongoConnected) {
      throw new Error('Failed to connect to MongoDB');
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Enhanced Gmail Automation Server running on http://localhost:${PORT}`);
      console.log(`📊 MongoDB Integration: Enabled`);
      console.log(`🧠 Enhanced Gemini Analysis: Enabled`);
      console.log(`🔄 Batch Processing: Enabled`);
      console.log(`🌐 Dashboard: http://localhost:${PORT}/dashboard`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await mongoDb.close();
  process.exit(0);
});

startServer();

module.exports = app;
