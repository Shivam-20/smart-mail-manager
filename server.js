require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.use(passport.initialize());
app.use(passport.session());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// OAuth2 configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/auth/google/callback'
);

// Passport Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'http://localhost:3000/auth/google/callback',
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

// Auth routes
app.get('/auth/google', passport.authenticate('google'));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: 'http://localhost:5173/login' }),
  (req, res) => {
    res.redirect('http://localhost:5173/dashboard');
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

// Gmail API routes
app.get('/api/emails', isAuthenticated, async (req, res) => {
  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 20,
      q: 'in:inbox'
    });

    const messages = response.data.messages || [];
    const fullMessages = [];

    for (const message of messages) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date', 'To']
      });
      fullMessages.push(msg.data);
    }

    res.json(fullMessages);
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

app.get('/api/labels', isAuthenticated, async (req, res) => {
  try {
    const response = await gmail.users.labels.list({
      userId: 'me'
    });
    res.json(response.data.labels || []);
  } catch (error) {
    console.error('Error fetching labels:', error);
    res.status(500).json({ error: 'Failed to fetch labels' });
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

app.post('/api/categorize-email', isAuthenticated, async (req, res) => {
  try {
    const { emailId, subject, from, snippet } = req.body;
    
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `Categorize this email into one of these categories: Work, Personal, Shopping, Finance, Travel, Social, Promotions, or Other.

Email Details:
Subject: ${subject}
From: ${from}
Preview: ${snippet}

Respond with just the category name.`;

    const result = await model.generateContent(prompt);
    const category = result.response.text().trim();

    res.json({ category });
  } catch (error) {
    console.error('Error categorizing email:', error);
    res.status(500).json({ error: 'Failed to categorize email' });
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

app.post('/api/batch-categorize', isAuthenticated, async (req, res) => {
  try {
    const { emails } = req.body;
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const results = [];
    
    for (const email of emails) {
      const prompt = `Categorize this email into one of these categories: Work, Personal, Shopping, Finance, Travel, Social, Promotions, or Other.

Email Details:
Subject: ${email.subject}
From: ${email.from}
Preview: ${email.snippet}

Respond with just the category name.`;

      const result = await model.generateContent(prompt);
      const category = result.response.text().trim();
      
      results.push({
        emailId: email.id,
        category: category
      });
    }

    res.json(results);
  } catch (error) {
    console.error('Error batch categorizing:', error);
    res.status(500).json({ error: 'Failed to categorize emails' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
