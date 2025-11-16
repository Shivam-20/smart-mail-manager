const { google } = require('googleapis');
const EnhancedGeminiAnalyzer = require('./gemini-enhanced');

class BatchProcessor {
    constructor(mongoDb, oauth2Client) {
        this.mongoDb = mongoDb;
        this.oauth2Client = oauth2Client;
        this.geminiAnalyzer = new EnhancedGeminiAnalyzer(mongoDb);
        this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    }

    async createBatch(userId, operation, options = {}) {
        try {
            const batchId = this.generateBatchId();
            
            const batchData = {
                batchId,
                userId,
                operation,
                options,
                status: 'created',
                emailsProcessed: 0,
                emailsTotal: 0,
                labelsCreated: 0,
                labelsUsed: 0,
                errors: []
            };
            
            await this.mongoDb.createBatchLog(batchData);
            console.log(`📝 Created batch ${batchId} for ${operation}`);
            
            return batchId;
        } catch (error) {
            console.error('❌ Error creating batch:', error.message);
            throw error;
        }
    }

    async executeBatch(batchId, userTokens) {
        try {
            console.log(`🚀 Starting batch execution: ${batchId}`);
            
            // Set OAuth credentials
            this.oauth2Client.setCredentials({
                access_token: userTokens.accessToken,
                refresh_token: userTokens.refreshToken
            });
            
            // Get batch details
            const batchLog = await this.mongoDb.db.collection('batchLogs').findOne({ batchId });
            
            if (!batchLog) {
                throw new Error('Batch not found');
            }
            
            // Update status to running
            await this.mongoDb.updateBatchLog(batchId, {
                status: 'running',
                startTime: new Date()
            });
            
            let result;
            
            switch (batchLog.operation) {
                case 'fetchEmails':
                    result = await this.batchFetchEmails(batchId, batchLog.options);
                    break;
                case 'analyzeEmails':
                    result = await this.batchAnalyzeEmails(batchId, batchLog.options);
                    break;
                case 'createLabels':
                    result = await this.batchCreateLabels(batchId, batchLog.options);
                    break;
                case 'assignLabels':
                    result = await this.batchAssignLabels(batchId, batchLog.options);
                    break;
                case 'organizeLabels':
                    result = await this.batchOrganizeLabels(batchId, batchLog.options);
                    break;
                case 'fullProcess':
                    result = await this.fullBatchProcess(batchId, batchLog.options);
                    break;
                default:
                    throw new Error(`Unknown operation: ${batchLog.operation}`);
            }
            
            // Update batch completion
            await this.mongoDb.updateBatchLog(batchId, {
                status: 'completed',
                endTime: new Date(),
                ...result
            });
            
            console.log(`✅ Batch ${batchId} completed successfully`);
            return result;
            
        } catch (error) {
            console.error(`❌ Batch ${batchId} failed:`, error.message);
            
            await this.mongoDb.updateBatchLog(batchId, {
                status: 'failed',
                endTime: new Date(),
                errors: [error.message]
            });
            
            throw error;
        }
    }

    async batchFetchEmails(batchId, options) {
        console.log('📬 Starting batch email fetch...');
        
        const batchSize = options.batchSize || 100;
        const userId = options.userId;
        
        try {
            let pageToken = null;
            let totalEmails = 0;
            let fetchedEmails = [];
            
            do {
                const response = await this.gmail.users.messages.list({
                    userId: 'me',
                    maxResults: Math.min(batchSize, 50), // Gmail API limit
                    pageToken: pageToken,
                    q: options.query || 'in:inbox'
                });
                
                const messages = response.data.messages || [];
                console.log(`📧 Fetching ${messages.length} emails...`);
                
                // Fetch full email details
                for (const message of messages) {
                    try {
                        const msg = await this.gmail.users.messages.get({
                            userId: 'me',
                            id: message.id,
                            format: 'metadata',
                            metadataHeaders: ['Subject', 'From', 'Date', 'To', 'Snippet']
                        });
                        
                        const headers = msg.data.payload.headers;
                        const emailData = {
                            gmailId: msg.data.id,
                            userId: userId,
                            threadId: msg.data.threadId,
                            subject: (headers.find(h => h.name === 'Subject') || {}).value || 'No Subject',
                            from: (headers.find(h => h.name === 'From') || {}).value || 'Unknown',
                            to: (headers.find(h => h.name === 'To') || {}).value || '',
                            snippet: msg.data.snippet || '',
                            timestamp: new Date((headers.find(h => h.name === 'Date') || {}).value || Date.now()),
                            processed: false,
                            synced: false
                        };
                        
                        await this.mongoDb.saveEmail(emailData);
                        fetchedEmails.push(emailData);
                        totalEmails++;
                        
                    } catch (msgError) {
                        console.error(`❌ Error fetching message ${message.id}:`, msgError.message);
                    }
                }
                
                pageToken = response.data.nextPageToken;
                
                // Update progress
                await this.mongoDb.updateBatchLog(batchId, {
                    emailsProcessed: totalEmails
                });
                
            } while (pageToken && totalEmails < batchSize);
            
            console.log(`✅ Batch fetch completed: ${totalEmails} emails fetched`);
            
            return {
                emailsProcessed: totalEmails,
                emailsTotal: totalEmails,
                operation: 'fetchEmails'
            };
            
        } catch (error) {
            console.error('❌ Error in batch fetch:', error.message);
            throw error;
        }
    }

    async batchAnalyzeEmails(batchId, options) {
        console.log('🧠 Starting batch email analysis...');
        
        const userId = options.userId;
        const limit = options.limit || 100;
        
        try {
            // Get unprocessed emails
            const emails = await this.mongoDb.getEmails(userId, {
                processed: false,
                limit: limit
            });
            
            if (emails.length === 0) {
                console.log('ℹ️ No unprocessed emails found');
                return {
                    emailsProcessed: 0,
                    emailsTotal: 0,
                    operation: 'analyzeEmails'
                };
            }
            
            console.log(`🧠 Analyzing ${emails.length} emails...`);
            
            // Use enhanced Gemini analyzer for batch processing
            const result = await this.geminiAnalyzer.batchAnalyzeEmails(emails, userId);
            
            console.log(`✅ Batch analysis completed: ${result.successful} successful, ${result.failed} failed`);
            
            return {
                emailsProcessed: result.successful,
                emailsTotal: emails.length,
                operation: 'analyzeEmails',
                errors: result.failed > 0 ? [`${result.failed} emails failed analysis`] : []
            };
            
        } catch (error) {
            console.error('❌ Error in batch analysis:', error.message);
            throw error;
        }
    }

    async batchCreateLabels(batchId, options) {
        console.log('🏷️ Starting batch label creation...');
        
        const userId = options.userId;
        
        try {
            // Get all analyzed emails to determine needed labels
            const emails = await this.mongoDb.getEmails(userId, {
                processed: true
            });
            
            const uniqueLabels = new Set();
            emails.forEach(email => {
                if (email.analysis && email.analysis.suggestedLabel) {
                    uniqueLabels.add(email.analysis.suggestedLabel);
                }
            });
            
            console.log(`🏷️ Creating ${uniqueLabels.size} unique labels...`);
            
            let labelsCreated = 0;
            let existingLabels = 0;
            
            for (const labelName of uniqueLabels) {
                try {
                    // Check if label already exists in Gmail
                    const existingLabel = await this.mongoDb.getLabelByName(userId, labelName);
                    
                    if (!existingLabel) {
                        // Create label in Gmail
                        const createResponse = await this.gmail.users.labels.create({
                            userId: 'me',
                            requestBody: {
                                name: labelName,
                                labelListVisibility: 'labelShow',
                                messageListVisibility: 'show'
                            }
                        });
                        
                        // Save to database
                        await this.mongoDb.saveLabel({
                            userId: userId,
                            name: labelName,
                            gmailLabelId: createResponse.data.id,
                            emailCount: 0,
                            isAuto: true
                        });
                        
                        labelsCreated++;
                        console.log(`✅ Created label: ${labelName}`);
                    } else {
                        existingLabels++;
                    }
                    
                } catch (labelError) {
                    console.error(`❌ Error creating label ${labelName}:`, labelError.message);
                }
            }
            
            console.log(`✅ Batch label creation completed: ${labelsCreated} created, ${existingLabels} already existed`);
            
            return {
                labelsCreated: labelsCreated,
                labelsUsed: existingLabels + labelsCreated,
                operation: 'createLabels'
            };
            
        } catch (error) {
            console.error('❌ Error in batch label creation:', error.message);
            throw error;
        }
    }

    async batchAssignLabels(batchId, options) {
        console.log('📮 Starting batch label assignment...');
        
        const userId = options.userId;
        const batchSize = options.batchSize || 50;
        
        try {
            // Get processed but unsynced emails
            const emails = await this.mongoDb.getEmails(userId, {
                processed: true,
                limit: batchSize
            });
            
            const unsyncedEmails = emails.filter(email => !email.synced);
            
            if (unsyncedEmails.length === 0) {
                console.log('ℹ️ No emails to label');
                return {
                    emailsProcessed: 0,
                    emailsTotal: 0,
                    operation: 'assignLabels'
                };
            }
            
            console.log(`📮 Assigning labels to ${unsyncedEmails.length} emails...`);
            
            let successCount = 0;
            let failCount = 0;
            
            for (const email of unsyncedEmails) {
                try {
                    if (email.analysis && email.analysis.suggestedLabel) {
                        // Get Gmail label ID
                        const label = await this.mongoDb.getLabelByName(userId, email.analysis.suggestedLabel);
                        
                        if (label) {
                            // Apply label to email
                            await this.gmail.users.messages.modify({
                                userId: 'me',
                                id: email.gmailId,
                                requestBody: {
                                    addLabelIds: [label.gmailLabelId]
                                }
                            });
                            
                            // Mark as synced
                            await this.mongoDb.db.collection('emails').updateOne(
                                { gmailId: email.gmailId },
                                { $set: { synced: true, updatedAt: new Date() } }
                            );
                            
                            successCount++;
                        } else {
                            console.warn(`⚠️ Label not found: ${email.analysis.suggestedLabel}`);
                            failCount++;
                        }
                    }
                    
                } catch (assignError) {
                    console.error(`❌ Error assigning label to ${email.gmailId}:`, assignError.message);
                    failCount++;
                }
            }
            
            console.log(`✅ Batch label assignment completed: ${successCount} successful, ${failCount} failed`);
            
            return {
                emailsProcessed: successCount,
                emailsTotal: unsyncedEmails.length,
                operation: 'assignLabels',
                errors: failCount > 0 ? [`${failCount} emails failed labeling`] : []
            };
            
        } catch (error) {
            console.error('❌ Error in batch label assignment:', error.message);
            throw error;
        }
    }

    async batchOrganizeLabels(batchId, options) {
        console.log('🗂️ Starting batch label organization...');
        
        const userId = options.userId;
        
        try {
            // Get AI suggestions for label organization
            const suggestions = await this.geminiAnalyzer.suggestLabelOrganization(userId);
            
            console.log('🧠 Generated label organization suggestions');
            
            // This would typically require user approval
            // For now, we'll just return the suggestions
            
            return {
                suggestions: suggestions,
                operation: 'organizeLabels'
            };
            
        } catch (error) {
            console.error('❌ Error in batch label organization:', error.message);
            throw error;
        }
    }

    async fullBatchProcess(batchId, options) {
        console.log('🔄 Starting full batch process...');
        
        const userId = options.userId;
        const batchSize = options.batchSize || 100;
        
        try {
            // Step 1: Fetch emails
            console.log('📬 Step 1: Fetching emails...');
            const fetchResult = await this.batchFetchEmails(batchId, { userId, batchSize });
            
            // Step 2: Analyze emails
            console.log('🧠 Step 2: Analyzing emails...');
            const analyzeResult = await this.batchAnalyzeEmails(batchId, { userId, limit: batchSize });
            
            // Step 3: Create labels
            console.log('🏷️ Step 3: Creating labels...');
            const createLabelsResult = await this.batchCreateLabels(batchId, { userId });
            
            // Step 4: Assign labels
            console.log('📮 Step 4: Assigning labels...');
            const assignLabelsResult = await this.batchAssignLabels(batchId, { userId, batchSize });
            
            const finalResult = {
                ...fetchResult,
                ...analyzeResult,
                ...createLabelsResult,
                ...assignLabelsResult,
                operation: 'fullProcess'
            };
            
            console.log('✅ Full batch process completed successfully');
            return finalResult;
            
        } catch (error) {
            console.error('❌ Error in full batch process:', error.message);
            throw error;
        }
    }

    async getBatchStatus(batchId) {
        try {
            const batchLog = await this.mongoDb.db.collection('batchLogs').findOne({ batchId });
            return batchLog;
        } catch (error) {
            console.error('❌ Error getting batch status:', error.message);
            throw error;
        }
    }

    async getUserBatchHistory(userId, limit = 20) {
        try {
            return await this.mongoDb.getBatchLogs(userId, limit);
        } catch (error) {
            console.error('❌ Error getting batch history:', error.message);
            throw error;
        }
    }

    generateBatchId() {
        return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

module.exports = BatchProcessor;
