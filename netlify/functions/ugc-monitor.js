async function validateInstagramAPI() {
  try {
    // More detailed environment variable checking
    console.log('🔍 ENVIRONMENT VARIABLE CHECK:');
    console.log(`   IG_BUSINESS_ID: ${IG_BUSINESS_ID ? 'SET' : 'MISSING'} (length: ${IG_BUSINESS_ID?.length || 0})`);
    console.log(`   ACCESS_TOKEN: ${ACCESS_TOKEN ? 'SET' : 'MISSING'} (length: ${ACCESS_TOKEN?.length || 0})`);
    console.log(`   SUPABASE_URL: ${SUPABASE_URL ? 'SET' : 'MISSING'}`);
    console.log(`   SUPABASE_API_KEY: ${SUPABASE_API_KEY ? 'SET' : 'MISSING'}`);

    // Show first/last few characters for debugging (without exposing full tokens)
    if (IG_BUSINESS_ID) {
      console.log(`   IG_BUSINESS_ID format: ${IG_BUSINESS_ID.substring(0, 3)}...${IG_BUSINESS_ID.substring(IG_BUSINESS_ID.length - 3)}`);
    }
    if (ACCESS_TOKEN) {
      console.log(`   ACCESS_TOKEN format: ${ACCESS_TOKEN.substring(0, 10)}...${ACCESS_TOKEN.substring(ACCESS_TOKEN.length - 10)}`);
    }

    // Check for obvious issues
    if (!IG_BUSINESS_ID || IG_BUSINESS_ID.length < 10) {
      throw new Error(`Invalid IG_BUSINESS_ID: ${IG_BUSINESS_ID ? 'too short' : 'missing'}`);
    }
    if (!ACCESS_TOKEN || ACCESS_TOKEN.length < 50) {
      throw new Error(`Invalid ACCESS_TOKEN: ${ACCESS_TOKEN ? 'too short' : 'missing'}`);
    }

    const url = `https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`;
    const params = {
      access_token: ACCESS_TOKEN,
      fields: 'id,username,account_type,media_count'
    };

    console.log('🔍 MAKING INSTAGRAM API REQUEST:');
    console.log(`   URL: ${url}`);
    console.log(`   Fields: ${params.fields}`);
    console.log(`   Token length: ${ACCESS_TOKEN.length}`);
    console.log(`   Business ID: ${IG_BUSINESS_ID}`);

    const response = await axios.get(url, {
      params: params,
      timeout: 10000,
      headers: {
        'User-Agent': 'PostMyStyle-UGC-Monitor/1.0'
      }
    });

    console.log(`✅ Instagram API validation SUCCESS:`, {
      status: response.status,
      username: response.data.username,
      accountType: response.data.account_type,
      mediaCount: response.data.media_count,
      businessId: response.data.id
    });

    return true;

  } catch (error) {
    console.error('❌ Instagram API validation DETAILED ERROR:');
    console.error(`   Error type: ${error.constructor.name}`);
    console.error(`   Error message: ${error.message}`);
    console.error(`   HTTP status: ${error.response?.status || 'No HTTP response'}`);
    console.error(`   HTTP status text: ${error.response?.statusText || 'N/A'}`);

    if (error.response?.data) {
      console.error(`   Response data:`, JSON.stringify(error.response.data, null, 2));
    }

    if (error.config) {
      console.error(`   Request URL: ${error.config.url}`);
      console.error(`   Request method: ${error.config.method}`);
      console.error(`   Request params:`, error.config.params);
    }

    // Specific error handling for common issues
    if (error.response?.status === 400) {
      console.error('🔍 400 ERROR ANALYSIS:');
      console.error('   This usually means:');
      console.error('   1. Invalid access token format');
      console.error('   2. Invalid business account ID');
      console.error('   3. Token doesn\'t have required permissions');
      console.error('   4. Business ID doesn\'t match the token');
    }

    if (error.response?.status === 401) {
      console.error('🔍 401 ERROR ANALYSIS:');
      console.error('   This usually means:');
      console.error('   1. Expired access token');
      console.error('   2. Invalid access token');
      console.error('   3. Token revoked or deactivated');
    }

    throw new Error(`Instagram API validation failed: ${error.message}`);
  }
}