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

    // Test Instagram API with basic fields first
    console.log('🔍 Testing Instagram API...');
    const response = await axios.get(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`, {
      params: {
        access_token: ACCESS_TOKEN,
        fields: 'id,username'  // Removed account_type - not available for IGUser
      },
      timeout: 10000
    });

    console.log('✅ Basic API SUCCESS:', response.data);

    // Now test business-specific fields to see what's available
    console.log('🔍 Testing business-specific fields...');
    try {
      const businessResponse = await axios.get(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`, {
        params: {
          access_token: ACCESS_TOKEN,
          fields: 'id,username,media_count,followers_count'
        },
        timeout: 10000
      });
      console.log('✅ Business fields SUCCESS:', businessResponse.data);
    } catch (fieldError) {
      console.log('⚠️ Business fields not available:', fieldError.response?.data || fieldError.message);
    }

    // Test hashtag search capability (the main function we need)
    console.log('🔍 Testing hashtag search capability...');
    try {
      const hashtagTest = await axios.get('https://graph.facebook.com/v19.0/ig_hashtag_search', {
        params: {
          access_token: ACCESS_TOKEN,
          user_id: IG_BUSINESS_ID,
          q: 'postmystyle'  // Test hashtag
        },
        timeout: 10000
      });
      console.log('✅ Hashtag search SUCCESS:', hashtagTest.data);
    } catch (hashtagError) {
      console.log('❌ Hashtag search FAILED:', hashtagError.response?.data || hashtagError.message);
    }

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
        basicApiData: response.data,
        environment: {
          businessIdLength: IG_BUSINESS_ID.length,
          accessTokenLength: ACCESS_TOKEN.length,
          businessIdFormat: `${IG_BUSINESS_ID.substring(0, 3)}...${IG_BUSINESS_ID.substring(IG_BUSINESS_ID.length - 3)}`
        },
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