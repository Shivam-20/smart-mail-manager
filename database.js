const Database = require('better-sqlite3');
const path = require('path');

// Create database file
const dbPath = path.join(__dirname, 'smartmail.db');
const db = new Database(dbPath);

// Initialize database tables
function initDatabase() {
  // Create emails table
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      threadId TEXT,
      subject TEXT,
      from_email TEXT,
      to_email TEXT,
      date TEXT,
      snippet TEXT,
      category TEXT DEFAULT 'Other',
      processed BOOLEAN DEFAULT FALSE,
      synced BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create labels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create email_labels junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_labels (
      email_id TEXT,
      label_id TEXT,
      PRIMARY KEY (email_id, label_id),
      FOREIGN KEY (email_id) REFERENCES emails(id),
      FOREIGN KEY (label_id) REFERENCES labels(id)
    )
  `);

  console.log('✅ Database initialized successfully');
}

// Email operations
function saveEmail(emailData) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO emails (
      id, threadId, subject, from_email, to_email, date, snippet, category, processed, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    emailData.id,
    emailData.threadId || '',
    emailData.subject || '',
    emailData.from || '',
    emailData.to || '',
    emailData.date || '',
    emailData.snippet || '',
    emailData.category || 'Other',
    emailData.processed ? 1 : 0,  // Convert boolean to integer
    emailData.synced ? 1 : 0      // Convert boolean to integer
  );
  
  return result;
}

function getEmails(filters = {}) {
  let query = 'SELECT * FROM emails WHERE 1=1';
  const params = [];
  
  if (filters.category) {
    query += ' AND category = ?';
    params.push(filters.category);
  }
  
  if (filters.processed !== undefined) {
    query += ' AND processed = ?';
    params.push(filters.processed);
  }
  
  if (filters.synced !== undefined) {
    query += ' AND synced = ?';
    params.push(filters.synced);
  }
  
  query += ' ORDER BY date DESC LIMIT ?';
  params.push(filters.limit || 50);
  
  return db.prepare(query).all(...params);
}

function updateEmailCategory(emailId, category) {
  const stmt = db.prepare(`
    UPDATE emails 
    SET category = ?, processed = TRUE, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `);
  
  return stmt.run(category, emailId);
}

function markEmailAsSynced(emailId) {
  const stmt = db.prepare(`
    UPDATE emails 
    SET synced = TRUE, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `);
  
  return stmt.run(emailId);
}

// Label operations
function saveLabel(labelData) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO labels (id, name, type)
    VALUES (?, ?, ?)
  `);
  
  return stmt.run(labelData.id, labelData.name, labelData.type || 'user');
}

function getLabels() {
  return db.prepare('SELECT * FROM labels ORDER BY name').all();
}

function getUnsyncedEmails() {
  return db.prepare(`
    SELECT * FROM emails 
    WHERE processed = TRUE AND synced = FALSE 
    ORDER BY date DESC
  `).all();
}

// Utility functions
function getDatabaseStats() {
  const stats = {
    totalEmails: db.prepare('SELECT COUNT(*) as count FROM emails').get().count,
    processedEmails: db.prepare('SELECT COUNT(*) as count FROM emails WHERE processed = TRUE').get().count,
    syncedEmails: db.prepare('SELECT COUNT(*) as count FROM emails WHERE synced = TRUE').get().count,
    totalLabels: db.prepare('SELECT COUNT(*) as count FROM labels').get().count
  };
  
  return stats;
}

function clearDatabase() {
  db.exec('DELETE FROM emails');
  db.exec('DELETE FROM labels');
  db.exec('DELETE FROM email_labels');
  console.log('✅ Database cleared');
}

// Close database connection
function closeDatabase() {
  db.close();
}

module.exports = {
  initDatabase,
  saveEmail,
  getEmails,
  updateEmailCategory,
  markEmailAsSynced,
  saveLabel,
  getLabels,
  getUnsyncedEmails,
  getDatabaseStats,
  clearDatabase,
  closeDatabase
};
