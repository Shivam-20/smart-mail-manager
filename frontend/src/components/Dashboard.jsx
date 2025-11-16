import { useState, useEffect } from 'react'
import { Mail, Tag, Bot, LogOut, RefreshCw, Plus, CheckCircle, AlertCircle } from 'lucide-react'
import axios from 'axios'

const Dashboard = () => {
  const [emails, setEmails] = useState([])
  const [labels, setLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [showNewLabel, setShowNewLabel] = useState(false)
  const [selectedEmails, setSelectedEmails] = useState(new Set())

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [emailsResponse, labelsResponse] = await Promise.all([
        axios.get('/api/emails', { withCredentials: true }),
        axios.get('/api/labels', { withCredentials: true })
      ])
      setEmails(emailsResponse.data)
      setLabels(labelsResponse.data)
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    window.location.href = '/auth/logout'
  }

  const createLabel = async () => {
    if (!newLabelName.trim()) return
    
    try {
      const response = await axios.post('/api/labels', 
        { name: newLabelName }, 
        { withCredentials: true }
      )
      setLabels([...labels, response.data])
      setNewLabelName('')
      setShowNewLabel(false)
    } catch (error) {
      console.error('Error creating label:', error)
    }
  }

  const categorizeEmail = async (email) => {
    try {
      const headers = email.payload.headers
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject'
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender'
      const snippet = email.snippet || ''

      const response = await axios.post('/api/categorize-email', 
        { emailId: email.id, subject, from, snippet },
        { withCredentials: true }
      )

      return response.data.category
    } catch (error) {
      console.error('Error categorizing email:', error)
      return 'Other'
    }
  }

  const applyLabelToEmail = async (emailId, labelName) => {
    try {
      const label = labels.find(l => l.name === labelName)
      if (!label) return

      await axios.post('/api/apply-label',
        { emailId, labelId: label.id },
        { withCredentials: true }
      )
      return true
    } catch (error) {
      console.error('Error applying label:', error)
      return false
    }
  }

  const processSingleEmail = async (email) => {
    const category = await categorizeEmail(email)
    const success = await applyLabelToEmail(email.id, category)
    
    if (success) {
      setEmails(emails.map(e => 
        e.id === email.id ? { ...e, category, processed: true } : e
      ))
    }
  }

  const batchProcessEmails = async () => {
    setProcessing(true)
    try {
      const emailsToProcess = Array.from(selectedEmails).map(id => 
        emails.find(e => e.id === id)
      ).filter(Boolean)

      const emailData = emailsToProcess.map(email => {
        const headers = email.payload.headers
        return {
          id: email.id,
          subject: headers.find(h => h.name === 'Subject')?.value || 'No Subject',
          from: headers.find(h => h.name === 'From')?.value || 'Unknown Sender',
          snippet: email.snippet || ''
        }
      })

      const response = await axios.post('/api/batch-categorize',
        { emails: emailData },
        { withCredentials: true }
      )

      for (const result of response.data) {
        await applyLabelToEmail(result.emailId, result.category)
      }

      await fetchData()
      setSelectedEmails(new Set())
    } catch (error) {
      console.error('Error in batch processing:', error)
    } finally {
      setProcessing(false)
    }
  }

  const toggleEmailSelection = (emailId) => {
    const newSelected = new Set(selectedEmails)
    if (newSelected.has(emailId)) {
      newSelected.delete(emailId)
    } else {
      newSelected.add(emailId)
    }
    setSelectedEmails(newSelected)
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString()
  }

  const getSenderName = (fromString) => {
    const match = fromString.match(/(.+?)</)
    return match ? match[1].trim() : fromString
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <Bot className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-2xl font-bold text-gray-900">SmartMail AI</h1>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats and Actions */}
        <div className="mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <Mail className="h-8 w-8 text-blue-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Emails</p>
                  <p className="text-2xl font-bold text-gray-900">{emails.length}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <Tag className="h-8 w-8 text-green-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Labels</p>
                  <p className="text-2xl font-bold text-gray-900">{labels.length}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <CheckCircle className="h-8 w-8 text-purple-600 mr-3" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Selected</p>
                  <p className="text-2xl font-bold text-gray-900">{selectedEmails.size}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-4">
            <button
              onClick={fetchData}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </button>
            
            <button
              onClick={() => setShowNewLabel(true)}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Label
            </button>

            {selectedEmails.size > 0 && (
              <button
                onClick={batchProcessEmails}
                disabled={processing}
                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                <Bot className="h-4 w-4 mr-2" />
                {processing ? 'Processing...' : `Process ${selectedEmails.size} Emails`}
              </button>
            )}
          </div>
        </div>

        {/* New Label Modal */}
        {showNewLabel && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4">Create New Label</h3>
              <input
                type="text"
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder="Label name"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => {
                    setShowNewLabel(false)
                    setNewLabelName('')
                  }}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={createLabel}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Email List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">Recent Emails</h2>
          </div>
          <div className="divide-y">
            {emails.map((email) => {
              const headers = email.payload.headers
              const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject'
              const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender'
              const date = headers.find(h => h.name === 'Date')?.value || ''

              return (
                <div key={email.id} className="p-6 hover:bg-gray-50">
                  <div className="flex items-start">
                    <input
                      type="checkbox"
                      checked={selectedEmails.has(email.id)}
                      onChange={() => toggleEmailSelection(email.id)}
                      className="mt-1 mr-4"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-gray-900 truncate">
                          {subject}
                        </h3>
                        <span className="text-sm text-gray-500">
                          {formatDate(date)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        From: {getSenderName(from)}
                      </p>
                      <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                        {email.snippet}
                      </p>
                      <div className="flex items-center gap-2">
                        {email.processed && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {email.category}
                          </span>
                        )}
                        <button
                          onClick={() => processSingleEmail(email)}
                          disabled={email.processed}
                          className="inline-flex items-center px-3 py-1 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Bot className="h-3 w-3 mr-1" />
                          {email.processed ? 'Processed' : 'Categorize'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}

export default Dashboard
