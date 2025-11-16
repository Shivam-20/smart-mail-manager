const https = require('https');

class EnhancedGeminiAnalyzer {
    constructor(mongoDb) {
        this.mongoDb = mongoDb;
        this.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        this.USE_GEMINI = process.env.USE_GEMINI === 'true';
        this.VALID_CATEGORIES = [
            'Finance/Investments', 'Finance/Banking', 'Finance/E-commerce', 
            'Finance/Billing', 'Finance/General', 'Work', 'Shopping', 
            'Personal', 'Promotions', 'Other'
        ];
    }

    async analyzeEmail(subject, from, snippet, userId) {
        try {
            // Check rate limiting
            const canProceed = await this.mongoDb.checkRateLimit(userId, 'gemini');
            if (!canProceed) {
                console.log('🚫 Gemini rate limit reached, using fallback');
                return this.fallbackAnalysis(subject, from, snippet);
            }

            // Prepare enhanced prompt for comprehensive analysis
            const prompt = `You are an advanced email analyzer. Analyze this email and return a JSON response with the following fields:
- purpose: Brief purpose of the email (max 50 chars)
- category: One of these exact categories: ${this.VALID_CATEGORIES.join(', ')}
- summary: 1-sentence summary (max 100 chars)
- sentiment: positive, negative, or neutral
- suggestedLabel: Clean label name for Gmail (max 30 chars)

Email Details:
Subject: ${subject}
From: ${from}
Snippet: ${snippet}

Return ONLY valid JSON, no other text:

{
  "purpose": "...",
  "category": "...",
  "summary": "...",
  "sentiment": "...",
  "suggestedLabel": "..."
}`;

            const analysis = await this.callGeminiAPI(prompt);
            
            // Validate and clean the response
            const validatedAnalysis = this.validateAnalysis(analysis);
            
            console.log(`✅ Gemini enhanced analysis completed for: "${subject}"`);
            return validatedAnalysis;

        } catch (error) {
            console.error('❌ Error in enhanced Gemini analysis:', error.message);
            return this.fallbackAnalysis(subject, from, snippet);
        }
    }

    async callGeminiAPI(prompt) {
        return new Promise((resolve, reject) => {
            const requestData = JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            });

            const options = {
                hostname: 'generativelanguage.googleapis.com',
                path: `/v1beta/models/gemini-pro:generateContent?key=${this.GEMINI_API_KEY}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestData)
                },
                timeout: 10000 // 10 second timeout
            };

            console.log('🧠 Calling enhanced Gemini API...');

            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        
                        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                            const text = response.candidates[0].content.parts[0].text.trim();
                            
                            // Extract JSON from response
                            const jsonMatch = text.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                const analysis = JSON.parse(jsonMatch[0]);
                                resolve(analysis);
                            } else {
                                throw new Error('No valid JSON found in response');
                            }
                        } else {
                            throw new Error('Invalid Gemini response structure');
                        }
                    } catch (error) {
                        console.error('❌ Error parsing Gemini response:', error.message);
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('❌ Gemini API request failed:', error.message);
                reject(error);
            });

            req.on('timeout', () => {
                console.error('❌ Gemini API request timed out');
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(requestData);
            req.end();
        });
    }

    validateAnalysis(analysis) {
        const validated = {
            purpose: analysis.purpose || 'Unknown purpose',
            category: this.VALID_CATEGORIES.includes(analysis.category) ? analysis.category : 'Other',
            summary: analysis.summary || 'No summary available',
            sentiment: ['positive', 'negative', 'neutral'].includes(analysis.sentiment) ? analysis.sentiment : 'neutral',
            suggestedLabel: analysis.suggestedLabel || 'General'
        };

        // Clean up suggested label
        validated.suggestedLabel = validated.suggestedLabel
            .replace(/[^a-zA-Z0-9\s\/]/g, '') // Remove special characters except /
            .trim()
            .substring(0, 30);

        if (!validated.suggestedLabel) {
            validated.suggestedLabel = 'General';
        }

        return validated;
    }

    fallbackAnalysis(subject, from, snippet) {
        console.log('📋 Using fallback analysis...');
        
        const subjectLower = subject.toLowerCase();
        const fromLower = from.toLowerCase();
        const snippetLower = snippet.toLowerCase();

        // Simple rule-based analysis
        let category = 'Other';
        let purpose = 'General communication';
        let sentiment = 'neutral';
        let suggestedLabel = 'General';

        // Financial detection
        const financialKeywords = ['invoice', 'payment', 'bill', 'transaction', 'amount', 'due', 'statement', 'credit card', 'bank', 'account'];
        const investmentKeywords = ['sip', 'mutual fund', 'stock', 'portfolio', 'investment', 'trading', 'demat'];
        const workKeywords = ['meeting', 'project', 'deadline', 'report', 'presentation', 'office', 'work'];
        const personalKeywords = ['family', 'friend', 'personal', 'weekend', 'trip', 'vacation'];
        const shoppingKeywords = ['order', 'delivery', 'purchase', 'buy', 'shop', 'cart', 'shipment'];

        if (financialKeywords.some(keyword => subjectLower.includes(keyword) || snippetLower.includes(keyword))) {
            if (investmentKeywords.some(keyword => subjectLower.includes(keyword))) {
                category = 'Finance/Investments';
                purpose = 'Investment notification';
                suggestedLabel = 'Investments';
            } else {
                category = 'Finance/Banking';
                purpose = 'Financial transaction';
                suggestedLabel = 'Banking';
            }
        } else if (workKeywords.some(keyword => subjectLower.includes(keyword))) {
            category = 'Work';
            purpose = 'Work related';
            suggestedLabel = 'Work';
        } else if (personalKeywords.some(keyword => subjectLower.includes(keyword))) {
            category = 'Personal';
            purpose = 'Personal communication';
            suggestedLabel = 'Personal';
        } else if (shoppingKeywords.some(keyword => subjectLower.includes(keyword))) {
            category = 'Shopping';
            purpose = 'Shopping related';
            suggestedLabel = 'Shopping';
        }

        // Sentiment analysis
        const positiveWords = ['congratulations', 'thank you', 'great', 'excellent', 'success', 'approved'];
        const negativeWords = ['urgent', 'overdue', 'failed', 'error', 'problem', 'issue', 'cancelled'];

        if (positiveWords.some(word => subjectLower.includes(word))) {
            sentiment = 'positive';
        } else if (negativeWords.some(word => subjectLower.includes(word))) {
            sentiment = 'negative';
        }

        return {
            purpose,
            category,
            summary: subject.length > 100 ? subject.substring(0, 97) + '...' : subject,
            sentiment,
            suggestedLabel
        };
    }

    async batchAnalyzeEmails(emails, userId) {
        console.log(`🔄 Starting batch analysis of ${emails.length} emails...`);
        
        const results = [];
        const batchSize = 5; // Process in batches to respect rate limits
        
        for (let i = 0; i < emails.length; i += batchSize) {
            const batch = emails.slice(i, i + batchSize);
            console.log(`🔄 Processing analysis batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(emails.length/batchSize)}...`);
            
            for (const email of batch) {
                try {
                    const analysis = await this.analyzeEmail(
                        email.subject,
                        email.from,
                        email.snippet,
                        userId
                    );
                    
                    results.push({
                        gmailId: email.gmailId,
                        success: true,
                        analysis: analysis
                    });
                    
                    // Update email in database
                    await this.mongoDb.updateEmailAnalysis(email.gmailId, analysis);
                    
                } catch (error) {
                    console.error(`❌ Error analyzing email ${email.gmailId}:`, error.message);
                    results.push({
                        gmailId: email.gmailId,
                        success: false,
                        error: error.message
                    });
                }
            }
            
            // Add delay between batches
            if (i + batchSize < emails.length) {
                console.log('⏱️ Waiting between analysis batches...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        console.log(`✅ Batch analysis completed: ${successCount} successful, ${failCount} failed`);
        
        return {
            total: emails.length,
            successful: successCount,
            failed: failCount,
            results: results
        };
    }

    async suggestLabelOrganization(userId) {
        try {
            console.log('🧠 Analyzing label organization...');
            
            const labels = await this.mongoDb.getLabels(userId);
            const categoryBreakdown = await this.mongoDb.getCategoryBreakdown(userId);
            
            const prompt = `You are a Gmail organization expert. Analyze these labels and suggest better organization:

Current Labels: ${labels.map(l => l.name).join(', ')}
Category Breakdown: ${categoryBreakdown.map(c => `${c._id}: ${c.count} emails`).join(', ')}

Suggest improvements in this JSON format:
{
  "mergeSuggestions": [{"oldLabel": "Label1", "newLabel": "NewLabel", "reason": "..."}],
  "hierarchySuggestions": [{"parent": "Finance", "children": ["Banking", "Investments"]}],
  "renameSuggestions": [{"oldName": "Old", "newName": "New", "reason": "..."}],
  "newLabels": [{"name": "NewLabel", "purpose": "...", "estimatedEmails": 10}]
}

Return ONLY valid JSON, no other text:`;

            const suggestions = await this.callGeminiAPI(prompt);
            const validatedSuggestions = this.validateSuggestions(suggestions);
            
            console.log('✅ Label organization suggestions generated');
            return validatedSuggestions;
            
        } catch (error) {
            console.error('❌ Error generating label suggestions:', error.message);
            return {
                mergeSuggestions: [],
                hierarchySuggestions: [],
                renameSuggestions: [],
                newLabels: []
            };
        }
    }

    validateSuggestions(suggestions) {
        return {
            mergeSuggestions: suggestions.mergeSuggestions || [],
            hierarchySuggestions: suggestions.hierarchySuggestions || [],
            renameSuggestions: suggestions.renameSuggestions || [],
            newLabels: suggestions.newLabels || []
        };
    }
}

module.exports = EnhancedGeminiAnalyzer;
