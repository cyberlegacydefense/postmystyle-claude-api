const axios = require('axios');

// Environment variables
const IG_BUSINESS_ID = process.env.POSTMYSTYLE_IG_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('🔍 PostMyStyle UGC Monitor v4.3 - Clean Version');
  console.log(`🕐 Start time: ${new Date().toISOString()}`);

  // Validate environment variables
  if (!IG_BUSINESS_ID || !ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_API_KEY) {
    const error = 'Missing required environment variables';
    console.error('❌', error);
    return createErrorResponse(error, 500);
  }

  const results = {
    success: true,
    timestamp: new Date().toISOString(),
    executionTimeMs: 0,
    pendingSessionsFound: 0,
    sessionHashtagsSearched: 0,
    postsFound: 0,
    postsProcessed: 0,
    newDiscoveries: 0,
    sessionsCorrelated: 0,
    errors: [],
    discoveredPosts: [],
    stats: {
      duplicatesSkipped: 0,
      lowConfidenceSkipped: 0,
      processingErrors: 0,
      sessionIdsFound: 0,
      sessionsUpdated: 0
    }
  };

  try {
    // Check Instagram API health first
    await validateInstagramAPI();

    // Main workflow: Search for pending session hashtags
    await searchPendingSessionHashtags(results);

    // Test known working hashtag from local test
    await testKnownWorkingHashtag(results);

    // Calculate execution time
    results.executionTimeMs = Date.now() - startTime;

    console.log(`✅ UGC Monitor Complete: ${results.newDiscoveries} new discoveries, ${results.sessionsCorrelated} sessions correlated`);
    console.log(`🕐 Total execution time: ${results.executionTimeMs}ms`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(results)
    };

  } catch (error) {
    console.error('❌ UGC Monitor Critical Failure:', error);
    results.success = false;
    results.executionTimeMs = Date.now() - startTime;
    results.errors.push({
      type: 'CRITICAL_FAILURE',
      message: error.message,
      timestamp: new Date().toISOString()
    });

    return createErrorResponse(error.message, 500, results);
  }
};

async function validateInstagramAPI() {
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

    if (!IG_BUSINESS_ID || IG_BUSINESS_ID.length < 10) {
      throw new Error(`Invalid IG_BUSINESS_ID: ${IG_BUSINESS_ID ? 'too short' : 'missing'}`);
    }
    if (!ACCESS_TOKEN || ACCESS_TOKEN.length < 50) {
      throw new Error(`Invalid ACCESS_TOKEN: ${ACCESS_TOKEN ? 'too short' : 'missing'}`);
    }

    const url = `https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`;
    const params = {
      access_token: ACCESS_TOKEN,
      fields: 'id,username,media_count,followers_count'
    };

    console.log('🔍 MAKING INSTAGRAM API REQUEST:');
    console.log(`   URL: ${url}`);
    console.log(`   Business ID: ${IG_BUSINESS_ID}`);

    const response = await axios.get(url, {
      params: params,
      timeout: 10000
    });

    console.log(`✅ Instagram API validation SUCCESS:`, {
      status: response.status,
      username: response.data.username,
      mediaCount: response.data.media_count,
      followersCount: response.data.followers_count,
      businessId: response.data.id
    });

    return true;

  } catch (error) {
    console.error('❌ Instagram API validation ERROR:', error.message);
    if (error.response?.data) {
      console.error(`   Response data:`, JSON.stringify(error.response.data, null, 2));
    }
    throw new Error(`Instagram API validation failed: ${error.message}`);
  }
}

async function searchPendingSessionHashtags(results) {
  try {
    console.log('🔍 Querying pending sessions from media_send table...');

    const pendingSessions = await getPendingSessions();

    if (!pendingSessions || pendingSessions.length === 0) {
      console.log('📭 No pending sessions found');
      return;
    }

    results.pendingSessionsFound = pendingSessions.length;
    console.log(`📋 Found ${pendingSessions.length} pending sessions to check`);

    // Process first 3 sessions for debugging
    const sessionsToProcess = pendingSessions.slice(0, 3);

    for (const session of sessionsToProcess) {
      try {
        await searchSessionHashtag(session, results);
      } catch (error) {
        console.error(`❌ Error processing session ${session.public_tracking_code}:`, error.message);
        results.errors.push({
          type: 'SESSION_PROCESSING_ERROR',
          sessionId: session.public_tracking_code,
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }

      // Small delay between sessions
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error('❌ Failed to search pending session hashtags:', error.message);
    results.errors.push({
      type: 'PENDING_SESSIONS_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function getPendingSessions() {
  try {
    const dateThreshold = getDateDaysAgo(30);
    console.log(`🔍 DEBUG: Querying pending sessions since: ${dateThreshold}`);

    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?ugc_tracking_enabled=eq.true&ugc_discovery_status=eq.pending&public_tracking_code=not.is.null&send_timestamp=gte.${dateThreshold}&select=id,public_tracking_code,stylist_id,client_id,client_name,send_timestamp&order=send_timestamp.desc&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    console.log(`📊 DEBUG: Found ${response.data?.length || 0} pending sessions`);
    return response.data;
  } catch (error) {
    console.error('❌ Failed to get pending sessions:', error.message);
    throw error;
  }
}

async function searchSessionHashtag(session, results) {
  const sessionHashtag = `postmystyle${session.public_tracking_code.toLowerCase()}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 PROCESSING SESSION: ${session.public_tracking_code}`);
  console.log(`   Client: ${session.client_name}`);
  console.log(`   Hashtag: #${sessionHashtag}`);

  try {
    results.sessionHashtagsSearched++;

    // Step 1: Get hashtag ID
    console.log(`🔍 Step 1: Getting hashtag ID for #${sessionHashtag}`);
    const hashtagData = await getHashtagId(sessionHashtag);
    if (!hashtagData) {
      console.log(`⚠️ Hashtag #${sessionHashtag} not found on Instagram`);
      return;
    }

    console.log(`✅ Step 1 SUCCESS: Hashtag found - ID: ${hashtagData.id}`);

    // Step 2: Get posts for this hashtag
    console.log(`🔍 Step 2: Getting posts for hashtag ID ${hashtagData.id}`);
    const posts = await getHashtagPosts(hashtagData.id, sessionHashtag);

    results.postsFound += posts.length;
    console.log(`📸 Step 2 SUCCESS: Found ${posts.length} posts for session ${session.public_tracking_code}`);

  } catch (error) {
    console.error(`❌ Error searching session hashtag ${sessionHashtag}:`, error.message);
    results.errors.push({
      type: 'SESSION_HASHTAG_ERROR',
      sessionId: session.public_tracking_code,
      hashtag: sessionHashtag,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function getHashtagId(hashtag) {
  try {
    console.log(`🔍 DEBUG: Searching Instagram for hashtag: ${hashtag}`);

    const response = await axios.get(`https://graph.facebook.com/v19.0/ig_hashtag_search`, {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        q: hashtag
      },
      timeout: 10000
    });

    console.log(`📊 DEBUG: Hashtag search response:`, {
      status: response.status,
      resultCount: response.data?.data?.length || 0
    });

    if (response.data?.data?.length > 0) {
      console.log(`✅ Hashtag "${hashtag}" found with ID: ${response.data.data[0].id}`);
      return { id: response.data.data[0].id, name: hashtag };
    }

    console.log(`❌ Hashtag "${hashtag}" not found`);
    return null;
  } catch (error) {
    console.error(`❌ Hashtag search failed for #${hashtag}:`, error.message);
    throw error;
  }
}

async function getHashtagPosts(hashtagId, hashtagName) {
  try {
    console.log(`📸 DEBUG: Getting posts for hashtag ID ${hashtagId}`);

    const response = await axios.get(`https://graph.facebook.com/v19.0/${hashtagId}/recent_media`, {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        fields: 'id,media_type,caption,timestamp,username',
        limit: 10
      },
      timeout: 15000
    });

    const posts = response.data?.data || [];
    console.log(`📊 DEBUG: Found ${posts.length} posts for ${hashtagName}`);

    if (posts.length > 0) {
      const firstPost = posts[0];
      console.log(`📋 First post sample:`, {
        id: firstPost.id,
        username: firstPost.username,
        timestamp: firstPost.timestamp,
        captionPreview: firstPost.caption ? firstPost.caption.substring(0, 100) + '...' : 'No caption'
      });
    }

    return posts;
  } catch (error) {
    console.error(`❌ Failed to get posts for hashtag ${hashtagName}:`, error.message);
    if (error.response?.data) {
      console.error(`❌ Posts error details:`, error.response.data);
    }
    return [];
  }
}

async function testKnownWorkingHashtag(results) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🧪 TESTING KNOWN WORKING HASHTAG');

  try {
    // Test multiple variations of the known hashtag
    const hashtagVariations = [
      'PostMyStylesalon1O1HOY',     // Exact case you mentioned
      'postmystylesalon1O1HOY',     // From logs
      'postmystylesalon1o1hoy'      // All lowercase
    ];

    for (const hashtag of hashtagVariations) {
      console.log(`\n🔍 TESTING: #${hashtag}`);

      try {
        // Search for hashtag
        const hashtagResponse = await axios.get(`https://graph.facebook.com/v19.0/ig_hashtag_search`, {
          params: {
            access_token: ACCESS_TOKEN,
            user_id: IG_BUSINESS_ID,
            q: hashtag
          },
          timeout: 10000
        });

        const found = hashtagResponse.data?.data?.length > 0;
        console.log(`   Search result: ${found ? '✅ FOUND' : '❌ NOT FOUND'}`);

        if (found) {
          const hashtagId = hashtagResponse.data.data[0].id;
          console.log(`   Hashtag ID: ${hashtagId}`);

          // Try to get posts
          const postsResponse = await axios.get(`https://graph.facebook.com/v19.0/${hashtagId}/recent_media`, {
            params: {
              access_token: ACCESS_TOKEN,
              user_id: IG_BUSINESS_ID,
              fields: 'id,caption,timestamp,username',
              limit: 5
            },
            timeout: 15000
          });

          const posts = postsResponse.data?.data || [];
          console.log(`   Posts found: ${posts.length}`);

          if (posts.length > 0) {
            const firstPost = posts[0];
            console.log(`   📋 First post: ${firstPost.id} by @${firstPost.username || 'unknown'}`);
            console.log(`   Timestamp: ${firstPost.timestamp}`);
            if (firstPost.caption) {
              console.log(`   Caption preview: ${firstPost.caption.substring(0, 150)}...`);

              // Check for session ID in caption
              const hasPostMyStyle = firstPost.caption.toLowerCase().includes('postmystyle');
              const hasSalon = firstPost.caption.toLowerCase().includes('salon');
              const hasCode = firstPost.caption.toLowerCase().includes('1o1hoy');

              console.log(`   Caption analysis:`);
              console.log(`      Contains 'postmystyle': ${hasPostMyStyle ? '✅' : '❌'}`);
              console.log(`      Contains 'salon': ${hasSalon ? '✅' : '❌'}`);
              console.log(`      Contains '1o1hoy': ${hasCode ? '✅' : '❌'}`);
            }
          }
        }

      } catch (searchError) {
        console.log(`   ❌ Search failed: ${searchError.message}`);
      }

      // Small delay between variations
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.log(`❌ Known hashtag test failed: ${error.message}`);
  }
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function createErrorResponse(message, statusCode, partialResults = null) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
      ...(partialResults && { partialResults })
    })
  };
}