# SmartMail AI - Gmail Automation with AI

A powerful Gmail automation application that uses Google's Gemini AI to automatically categorize your emails and apply labels. Built with Node.js backend and React frontend.

## Features

- **AI-Powered Categorization**: Uses Gemini AI to automatically categorize emails into Work, Personal, Shopping, Finance, Travel, Social, Promotions, or Other
- **Automatic Label Management**: Creates and applies labels to emails based on AI categorization
- **Batch Processing**: Process multiple emails at once for efficient organization
- **Modern UI**: Clean, responsive interface built with React and Tailwind CSS
- **Secure Authentication**: OAuth2 integration with Google for secure Gmail access

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Google Cloud Project with Gmail API and Gemini API enabled

## Setup Instructions

### 1. Google Cloud Configuration

1. **Create a Google Cloud Project**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable APIs**:
   - Enable Gmail API: Go to "APIs & Services" > "Library" > search "Gmail API" > Enable
   - Enable Gemini API: Go to "APIs & Services" > "Library" > search "Generative Language API" > Enable

3. **Create OAuth2 Credentials**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Select "Web application"
   - Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
   - Save the Client ID and Client Secret

4. **Get Gemini API Key**:
   - Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Create a new API key
   - Copy the API key

### 2. Backend Setup

1. **Install dependencies**:
   ```bash
   cd /path/to/smartMailOrg
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your credentials:
   ```env
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   SESSION_SECRET=your_session_secret_here
   GEMINI_API_KEY=your_gemini_api_key
   PORT=3000
   NODE_ENV=development
   ```

3. **Start the backend server**:
   ```bash
   npm run dev
   ```
   
   The backend will start on `http://localhost:3000`

### 3. Frontend Setup

1. **Install frontend dependencies**:
   ```bash
   cd frontend
   npm install
   ```

2. **Start the frontend development server**:
   ```bash
   npm run dev
   ```
   
   The frontend will start on `http://localhost:5173`

## Usage

1. **Open the application**:
   Navigate to `http://localhost:5173` in your browser

2. **Sign in with Google**:
   Click "Sign in with Google" and authorize the application to access your Gmail

3. **View your emails**:
   Your recent emails will be displayed in the dashboard

4. **Categorize emails**:
   - **Single email**: Click the "Categorize" button next to any email
   - **Multiple emails**: Select emails using checkboxes and click "Process X Emails"

5. **Create custom labels**:
   Click "Create Label" to add new labels for categorization

6. **Monitor progress**:
   Processed emails will show their category with a green badge

## API Endpoints

### Authentication
- `GET /auth/google` - Initiates Google OAuth2 flow
- `GET /auth/google/callback` - OAuth2 callback handler
- `GET /auth/logout` - Logs out user
- `GET /auth/status` - Checks authentication status

### Gmail Operations
- `GET /api/emails` - Fetches user's emails
- `GET /api/labels` - Fetches existing labels
- `POST /api/labels` - Creates a new label
- `POST /api/categorize-email` - Categorizes a single email
- `POST /api/apply-label` - Applies label to email
- `POST /api/batch-categorize` - Categorizes multiple emails

## Project Structure

```
smartMailOrg/
├── server.js              # Main backend server
├── package.json           # Backend dependencies
├── .env.example          # Environment variables template
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Login.jsx     # Login component
│   │   │   └── Dashboard.jsx # Main dashboard
│   │   ├── App.jsx           # Main React app
│   │   ├── main.jsx          # React entry point
│   │   └── index.css         # Tailwind CSS
│   ├── package.json      # Frontend dependencies
│   ├── vite.config.js    # Vite configuration
│   └── tailwind.config.js # Tailwind configuration
└── README.md             # This file
```

## Security Considerations

- Your Google credentials are stored locally in `.env` file
- Never commit `.env` file to version control
- The application uses OAuth2 for secure authentication
- Gmail access tokens are stored in server-side sessions

## Troubleshooting

### Common Issues

1. **"Redirect URI mismatch" error**:
   - Ensure `http://localhost:3000/auth/google/callback` is added to your OAuth2 client's authorized redirect URIs

2. **"Gmail API not enabled" error**:
   - Make sure Gmail API is enabled in your Google Cloud project

3. **"Gemini API error"**:
   - Verify your Gemini API key is correct and the Generative Language API is enabled

4. **CORS errors**:
   - Ensure both backend and frontend are running
   - Check that the frontend is on `http://localhost:5173`

### Debug Mode

To enable debug logging, set `NODE_ENV=development` in your `.env` file.
<<<<<<< HEAD
=======

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues and questions, please create an issue in the repository.
>>>>>>> master
