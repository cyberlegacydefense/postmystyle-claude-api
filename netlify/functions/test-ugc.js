const axios = require('axios');

// Environment variables
const IG_BUSINESS_ID = process.env.POSTMYSTYLE_IG_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

exports.handler = async (event, context) => {
  console.log('🔍 TEST UGC Monitor - Basic Environment Check');

  try {
    console.log('🔍 ENVIRONMENT VARIABLE CHECK:');
    console.log(`   IG_BUSINESS_ID: ${IG_BUSINESS_ID ? 'SET' : 'MISSING'} (length: ${IG_BUSINESS_ID?.length || 0})`);
    console.log(`   ACCESS_TOKEN: ${ACCESS_TOKEN ? 'SET' : 'MISSING'} (length: ${ACCESS_TOKEN?.length || 0})`);

    if (IG_BUSINESS_ID) {
      console.log(`   IG_BUSINESS_ID format: ${IG_BUSINESS_ID.substring(0, 3)}...${IG_BUSINESS_ID.substring(IG_BUSINESS_ID.length - 3)}`);
    }
    if (ACCESS_TOKEN) {
      console.log(`   ACCESS_TOKEN format: ${ACCESS_TOKEN.substring(0, 10)}...${ACCESS_TOKEN.substring(ACCESS_TOKEN.length - 10)}`);
    }

    if (!IG_BUSINESS_ID || !ACCESS_TOKEN) {
      throw new Error('Missing environment variables');
    }

    // Test Instagram API
    console.log('🔍 Testing Instagram API...');
    const response = await axios.get(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`, {
      params: {
        access_token: ACCESS_TOKEN,
        fields: 'id,username,account_type'
      },
      timeout: 10000
    });

    console.log('✅ Instagram API SUCCESS:', response.data);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: 'Environment and API check passed',
        data: response.data,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('❌ Full error:', error.response?.data || error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        details: error.response?.data || null,
        timestamp: new Date().toISOString()
      })
    };
  }
};