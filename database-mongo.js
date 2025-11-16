const { MongoClient } = require('mongodb');

class MongoDatabase {
    constructor() {
        this.client = null;
        this.db = null;
        this.uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
        this.dbName = 'smartmail_automation';
    }

    async connect() {
        try {
            console.log('🔌 Connecting to MongoDB...');
            
            // MongoDB v3 connection API
            this.client = new MongoClient(this.uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });
            
            await this.client.connect();
            this.db = this.client.db(this.dbName);
            
            // Create indexes for performance
            await this.createIndexes();
            
            console.log('✅ Connected to MongoDB successfully');
            return true;
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error.message);
            return false;
        }
    }

    async createIndexes() {
        try {
            // Users collection
            await this.db.collection('users').createIndex({ userId: 1 }, { unique: true });
            await this.db.collection('users').createIndex({ email: 1 });
            
            // Emails collection
            await this.db.collection('emails').createIndex({ gmailId: 1, userId: 1 }, { unique: true });
            await this.db.collection('emails').createIndex({ userId: 1, timestamp: -1 });
            await this.db.collection('emails').createIndex({ 'analysis.category': 1 });
            await this.db.collection('emails').createIndex({ processed: 1 });
            
            // Labels collection
            await this.db.collection('labels').createIndex({ userId: 1, name: 1 }, { unique: true });
            await this.db.collection('labels').createIndex({ gmailLabelId: 1 });
            
            // Batch logs collection
            await this.db.collection('batchLogs').createIndex({ batchId: 1 }, { unique: true });
            await this.db.collection('batchLogs').createIndex({ userId: 1, startTime: -1 });
            
            // Rate limiting collection with TTL
            await this.db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
            
            console.log('✅ Database indexes created');
        } catch (error) {
            console.error('❌ Error creating indexes:', error.message);
        }
    }

    // User authentication and token management
    async saveUser(userData) {
        try {
            const collection = this.db.collection('users');
            const result = await collection.replaceOne(
                { userId: userData.userId },
                {
                    ...userData,
                    updatedAt: new Date()
                },
                { upsert: true }
            );
            return result;
        } catch (error) {
            console.error('❌ Error saving user:', error.message);
            throw error;
        }
    }

    async getUser(userId) {
        try {
            const collection = this.db.collection('users');
            return await collection.findOne({ userId });
        } catch (error) {
            console.error('❌ Error fetching user:', error.message);
            throw error;
        }
    }

    async updateUserTokens(userId, tokens) {
        try {
            const collection = this.db.collection('users');
            const result = await collection.updateOne(
                { userId },
                {
                    $set: {
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        tokenExpiry: tokens.tokenExpiry,
                        updatedAt: new Date()
                    }
                }
            );
            return result;
        } catch (error) {
            console.error('❌ Error updating user tokens:', error.message);
            throw error;
        }
    }

    // Email management with enhanced analysis
    async saveEmail(emailData) {
        try {
            const collection = this.db.collection('emails');
            const result = await collection.replaceOne(
                { gmailId: emailData.gmailId, userId: emailData.userId },
                {
                    ...emailData,
                    updatedAt: new Date()
                },
                { upsert: true }
            );
            return result;
        } catch (error) {
            console.error('❌ Error saving email:', error.message);
            throw error;
        }
    }

    async getEmails(userId, options = {}) {
        try {
            const collection = this.db.collection('emails');
            const query = { userId };
            
            if (options.processed !== undefined) {
                query.processed = options.processed;
            }
            
            if (options.category) {
                query['analysis.category'] = options.category;
            }
            
            const cursor = collection.find(query)
                .sort({ timestamp: -1 })
                .limit(options.limit || 50);
            
            return await cursor.toArray();
        } catch (error) {
            console.error('❌ Error fetching emails:', error.message);
            throw error;
        }
    }

    async updateEmailAnalysis(gmailId, analysis) {
        try {
            const collection = this.db.collection('emails');
            const result = await collection.updateOne(
                { gmailId },
                {
                    $set: {
                        analysis: analysis,
                        processed: true,
                        updatedAt: new Date()
                    }
                }
            );
            return result;
        } catch (error) {
            console.error('❌ Error updating email analysis:', error.message);
            throw error;
        }
    }

    // Label management
    async saveLabel(labelData) {
        try {
            const collection = this.db.collection('labels');
            const result = await collection.replaceOne(
                { userId: labelData.userId, name: labelData.name },
                {
                    ...labelData,
                    updatedAt: new Date()
                },
                { upsert: true }
            );
            return result;
        } catch (error) {
            console.error('❌ Error saving label:', error.message);
            throw error;
        }
    }

    async getLabels(userId) {
        try {
            const collection = this.db.collection('labels');
            return await collection.find({ userId }).toArray();
        } catch (error) {
            console.error('❌ Error fetching labels:', error.message);
            throw error;
        }
    }

    async getLabelByName(userId, name) {
        try {
            const collection = this.db.collection('labels');
            return await collection.findOne({ userId, name });
        } catch (error) {
            console.error('❌ Error fetching label by name:', error.message);
            throw error;
        }
    }

    // Batch operations and logging
    async createBatchLog(batchData) {
        try {
            const collection = this.db.collection('batchLogs');
            const result = await collection.insertOne({
                ...batchData,
                startTime: new Date(),
                status: 'started'
            });
            return result.insertedId;
        } catch (error) {
            console.error('❌ Error creating batch log:', error.message);
            throw error;
        }
    }

    async updateBatchLog(batchId, updateData) {
        try {
            const collection = this.db.collection('batchLogs');
            const result = await collection.updateOne(
                { batchId },
                {
                    $set: {
                        ...updateData,
                        updatedAt: new Date()
                    }
                }
            );
            return result;
        } catch (error) {
            console.error('❌ Error updating batch log:', error.message);
            throw error;
        }
    }

    async getBatchLogs(userId, limit = 20) {
        try {
            const collection = this.db.collection('batchLogs');
            return await collection.find({ userId })
                .sort({ startTime: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            console.error('❌ Error fetching batch logs:', error.message);
            throw error;
        }
    }

    // Rate limiting for Gemini API
    async checkRateLimit(userId, operation = 'gemini') {
        try {
            const collection = this.db.collection('rateLimits');
            const key = `${userId}_${operation}`;
            const windowStart = new Date(Date.now() - 60000); // 1 minute window
            
            const count = await collection.countDocuments({
                key,
                timestamp: { $gte: windowStart }
            });
            
            // Check if within limit BEFORE adding current request
            if (count >= 10) {
                return false; // Rate limit exceeded
            }
            
            // Add current request
            await collection.insertOne({
                key,
                timestamp: new Date(),
                expiresAt: new Date(Date.now() + 60000)
            });
            
            return true; // Request allowed
        } catch (error) {
            console.error('❌ Error checking rate limit:', error.message);
            return true; // Allow request if rate limiting fails
        }
    }

    // Analytics and reporting
    async getEmailStats(userId) {
        try {
            const collection = this.db.collection('emails');
            
            const pipeline = [
                { $match: { userId } },
                {
                    $group: {
                        _id: null,
                        totalEmails: { $sum: 1 },
                        processedEmails: { $sum: { $cond: ['$processed', 1, 0] } },
                        categorizedEmails: { $sum: { $cond: [{ $ne: ['$analysis.category', null] }, 1, 0] } }
                    }
                }
            ];
            
            const stats = await collection.aggregate(pipeline).toArray();
            return stats[0] || { totalEmails: 0, processedEmails: 0, categorizedEmails: 0 };
        } catch (error) {
            console.error('❌ Error getting email stats:', error.message);
            throw error;
        }
    }

    async getCategoryBreakdown(userId) {
        try {
            const collection = this.db.collection('emails');
            
            const pipeline = [
                { $match: { userId, 'analysis.category': { $ne: null } } },
                {
                    $group: {
                        _id: '$analysis.category',
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1 } }
            ];
            
            return await collection.aggregate(pipeline).toArray();
        } catch (error) {
            console.error('❌ Error getting category breakdown:', error.message);
            throw error;
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
            console.log('🔌 MongoDB connection closed');
        }
    }
}

module.exports = new MongoDatabase();
