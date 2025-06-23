// netlify/functions/salon-ai.js
const https = require('https');

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { message } = JSON.parse(event.body);
    const apiKey = process.env.CLAUDE_API_KEY;

    // Return debug info if no message
    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing message',
          debug: {
            hasApiKey: !!apiKey,
            apiKeyLength: apiKey ? apiKey.length : 0,
            environment: process.env.NODE_ENV || 'unknown'
          }
        })
      };
    }

    // Return debug info if no API key
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Missing API key in environment',
          debug: {
            hasApiKey: false,
            envVars: Object.keys(process.env).filter(key => key.includes('CLAUDE')),
            environment: process.env.NODE_ENV || 'unknown'
          }
        })
      };
    }

    const claudeData = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: message
        }
      ]
    };

    const response = await callClaudeAPI(claudeData, apiKey);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        details: error.message,
        debug: {
          hasApiKey: !!process.env.CLAUDE_API_KEY,
          apiKeyLength: process.env.CLAUDE_API_KEY ? process.env.CLAUDE_API_KEY.length : 0,
          errorStack: error.stack
        }
      })
    };
  }
};

function callClaudeAPI(data, apiKey) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (res.statusCode !== 200) {
            reject(new Error(`Claude API error ${res.statusCode}: ${JSON.stringify(response)}`));
          } else {
            resolve(response);
          }
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${body}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Request error: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}