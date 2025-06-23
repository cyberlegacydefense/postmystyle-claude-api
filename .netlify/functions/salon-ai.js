// netlify/functions/salon-ai.js
// Server-side AI Business Advisor for Salon Owners

const fetch = require('node-fetch');

// Salon business stage detection
const getSalonStage = (salonData) => {
  const {
    totalStylists = 0,
    totalClients = 0,
    totalShares = 0,
    totalViews = 0,
    engagementRate = 0
  } = salonData;

  // Startup salon
  if (totalStylists <= 2 && totalClients < 50 && totalShares < 100) return 'startup';

  // Growing salon
  if (totalStylists <= 5 && totalClients < 200 && totalShares < 500) return 'growing';

  // Established salon
  if (totalStylists <= 10 && totalClients < 500 && totalShares < 1500) return 'established';

  // Enterprise salon
  return 'enterprise';
};

// Dynamic prompts for salon management
const getSalonPrompt = (stage, salonName, ownerName, salonData, actionType = 'overview') => {
  const basePrompt = `You are an AI business strategist for ${ownerName}, owner of ${salonName}. Always start your response with "${ownerName}," to personalize the message. Provide strategic business insights, not individual stylist advice. Keep responses actionable and under 200 words.`;

  if (actionType !== 'overview') {
    // Handle specific action requests
    switch(actionType) {
      case 'team-performance':
        return `${basePrompt} They have ${salonData.totalStylists} stylists. Give 3 specific strategies to improve team performance, motivation, and productivity. Focus on training, incentives, and performance management.`;

      case 'increase-revenue':
        return `${basePrompt} Current metrics: ${salonData.totalClients} clients, ${salonData.totalShares} posts, ${salonData.totalViews} views. Suggest 3 concrete ways to increase revenue: pricing strategies, upselling, and new revenue streams.`;

      case 'expand-business':
        return `${basePrompt} With ${salonData.totalStylists} stylists and ${salonData.totalClients} clients, advise on expansion: new locations, services, or scaling strategies.`;

      case 'marketing-strategy':
        return `${basePrompt} Social metrics: ${salonData.totalShares} posts, ${salonData.engagementRate}% engagement. Recommend 3 marketing strategies to attract new clients and increase brand awareness.`;

      default:
        return `${basePrompt} Answer their specific question: "${actionType}" with relevant advice based on their salon data.`;
    }
  }

  // Default overview prompts by stage
  switch(stage) {
    case 'startup':
      return `${basePrompt}

      Their salon is in startup phase with ${salonData.totalStylists} stylists, ${salonData.totalClients} total clients, and ${salonData.totalShares} social posts. Focus on: foundation building, initial marketing strategies, cash flow management, hiring first employees, and establishing salon culture. Provide 2-3 specific actionable steps for early-stage salon growth.`;

    case 'growing':
      return `${basePrompt}

      Their salon is growing with ${salonData.totalStylists} stylists, ${salonData.totalClients} clients, ${salonData.totalShares} posts, and ${salonData.engagementRate}% engagement. Analyze: stylist performance gaps, client acquisition costs, operational efficiency, and scaling challenges. Provide specific insights on managing team growth, optimizing pricing, and improving systems.`;

    case 'established':
      return `${basePrompt}

      They run an established salon with ${salonData.totalStylists} stylists, ${salonData.totalClients} clients, ${salonData.totalShares} posts. Focus on: competitive differentiation, premium service offerings, stylist retention strategies, client lifetime value optimization, and potential expansion opportunities.`;

    case 'enterprise':
      return `${basePrompt}

      They operate a large salon with ${salonData.totalStylists} stylists, ${salonData.totalClients} clients. Provide advanced insights on: market expansion, franchise opportunities, technology investments, brand positioning, strategic partnerships, and industry leadership positioning.`;

    default:
      return `${basePrompt} Provide strategic business insights for growing their salon operation based on their current metrics.`;
  }
};

// Fallback messages when Claude API fails
const getFallbackMessage = (stage, salonName, ownerName, salonData) => {
  switch(stage) {
    case 'startup':
      return `${ownerName}, ${salonName} is in an exciting startup phase! With ${salonData.totalStylists} stylists and ${salonData.totalClients} clients, focus on building strong foundations: establish consistent service quality, develop your brand identity, and create systems for growth. Consider investing in staff training and customer retention strategies.`;

    case 'growing':
      return `${ownerName}, ${salonName} is growing well! With ${salonData.totalStylists} stylists and ${salonData.totalClients} clients, you're ready to optimize operations. Focus on stylist performance management, implement booking systems, and consider expanding service offerings. Your ${salonData.totalShares} social posts show good engagement - leverage this for marketing.`;

    case 'established':
      return `${ownerName}, ${salonName} is well-established! With your team of ${salonData.totalStylists} stylists serving ${salonData.totalClients} clients, focus on differentiation and premium positioning. Consider advanced training programs, loyalty rewards, and strategic partnerships to maintain your competitive edge.`;

    default:
      return `${ownerName}, ${salonName} shows great potential! Focus on data-driven decisions, team development, and customer experience to drive sustainable growth.`;
  }
};

// Main function handler
exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { prompt, salonData, ownerName, salonName, actionType } = JSON.parse(event.body);

    // Validate required data
    if (!salonData || !ownerName || !salonName) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'Missing required data' })
      };
    }

    console.log('AI request for salon:', salonName, 'Action:', actionType || 'overview');

    // Determine salon stage
    const stage = getSalonStage(salonData);

    // Generate prompt
    const aiPrompt = getSalonPrompt(stage, salonName, ownerName, salonData, actionType);

    // Call Claude API
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.CLAUDE_API_KEY, // Set this in Netlify environment variables
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: aiPrompt
          }]
        })
      });

      const data = await response.json();

      if (data.error) {
        console.error('Claude API error:', data.error);
        throw new Error('Claude API error');
      }

      if (data.content && data.content[0]) {
        return {
          statusCode: 200,
          headers: {
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            success: true,
            message: data.content[0].text.trim(),
            stage: stage,
            source: 'claude'
          })
        };
      } else {
        throw new Error('No content returned from Claude');
      }

    } catch (aiError) {
      console.error('AI API error:', aiError);

      // Return fallback message
      const fallbackMessage = getFallbackMessage(stage, salonName, ownerName, salonData);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: true,
          message: fallbackMessage,
          stage: stage,
          source: 'fallback'
        })
      };
    }

  } catch (error) {
    console.error('Function error:', error);

    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};