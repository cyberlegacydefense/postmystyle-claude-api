const axios = require('axios');

// Environment variables
const IG_BUSINESS_ID = process.env.POSTMYSTYLE_IG_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;
const MONITORING_WEBHOOK = process.env.MONITORING_ALERT_WEBHOOK;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('🔍 PostMyStyle UGC Monitor v4.1 - Session-Based Tracking System');
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

    // Monitoring webhook is optional - remove if not needed
    // if (results.newDiscoveries > 0 && MONITORING_WEBHOOK) {
    //   await sendMonitoringAlert(results);
    // }

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
    console.log(`🔍 DEBUG: Validating Instagram API with Business ID: ${IG_BUSINESS_ID}`);
    console.log(`🔍 DEBUG: Access token length: ${ACCESS_TOKEN ? ACCESS_TOKEN.length : 'MISSING'}`);

    const response = await axios.get(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`, {
      params: {
        access_token: ACCESS_TOKEN,
        fields: 'id,username,account_type,media_count'
      },
      timeout: 10000
    });

    console.log(`✅ Instagram API validated:`, {
      username: response.data.username,
      accountType: response.data.account_type,
      mediaCount: response.data.media_count,
      businessId: response.data.id
    });

    return true;
  } catch (error) {
    console.error('❌ Instagram API validation failed:', error.message);
    console.error(`🔍 DEBUG: Full validation error:`, error.response?.data || error);
    throw new Error(`Instagram API validation failed: ${error.message}`);
  }
}

async function searchPendingSessionHashtags(results) {
  try {
    console.log('🔍 Querying pending sessions from media_send table...');

    // Get sessions that are pending UGC discovery
    const pendingSessions = await getPendingSessions();

    if (!pendingSessions || pendingSessions.length === 0) {
      console.log('📭 No pending sessions found');
      return;
    }

    results.pendingSessionsFound = pendingSessions.length;
    console.log(`📋 Found ${pendingSessions.length} pending sessions to check`);

    // DEBUG: Log all sessions being processed
    console.log(`📋 DEBUG: All pending sessions found:`);
    pendingSessions.forEach((session, index) => {
      console.log(`  ${index + 1}. ${session.public_tracking_code} (${session.client_name}) - ${session.send_timestamp}`);
    });

    // Process sessions in batches to avoid rate limits
    const batchSize = 2; // Reduced for better debugging
    for (let i = 0; i < pendingSessions.length; i += batchSize) {
      const batch = pendingSessions.slice(i, i + batchSize);

      for (const session of batch) {
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
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Small delay between batches to respect rate limits
      if (i + batchSize < pendingSessions.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
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
      `${SUPABASE_URL}/rest/v1/media_send?ugc_tracking_enabled=eq.true&ugc_discovery_status=eq.pending&public_tracking_code=not.is.null&send_timestamp=gte.${dateThreshold}&select=id,public_tracking_code,stylist_id,client_id,client_name,send_timestamp,ugc_tracking_enabled,ugc_discovery_status&order=send_timestamp.desc&limit=50`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    console.log(`📊 DEBUG: Pending sessions query results:`, {
      totalPendingSessions: response.data?.length || 0,
      hasData: !!response.data
    });

    return response.data;
  } catch (error) {
    console.error('❌ Failed to get pending sessions:', error.message);
    console.error(`🔍 DEBUG: Database query error:`, error.response?.data || error);
    throw error;
  }
}

async function searchSessionHashtag(session, results) {
  const sessionHashtag = `postmystyle${session.public_tracking_code.toLowerCase()}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 PROCESSING SESSION: ${session.public_tracking_code}`);
  console.log(`   Client: ${session.client_name}`);
  console.log(`   Hashtag: #${sessionHashtag}`);
  console.log(`   Date: ${session.send_timestamp}`);
  console.log(`   Original Case: ${session.public_tracking_code}`);
  console.log(`   Lowercase: ${session.public_tracking_code.toLowerCase()}`);

  try {
    results.sessionHashtagsSearched++;

    // Step 1: Get hashtag ID
    console.log(`🔍 Step 1: Getting hashtag ID for #${sessionHashtag}`);
    const hashtagData = await getHashtagId(sessionHashtag);
    if (!hashtagData) {
      console.log(`⚠️ Hashtag #${sessionHashtag} not found on Instagram`);
      console.log(`🔍 DEBUG: This means no posts have been made with this hashtag yet`);
      return;
    }

    console.log(`✅ Step 1 SUCCESS: Hashtag found - ID: ${hashtagData.id}, Name: ${hashtagData.name}`);

    // Step 2: Get posts for this specific session hashtag
    console.log(`🔍 Step 2: Getting posts for hashtag ID ${hashtagData.id}`);
    const posts = await getHashtagPosts(hashtagData.id, sessionHashtag);
    if (!posts || posts.length === 0) {
      console.log(`📭 No posts found for #${sessionHashtag}`);
      return;
    }

    results.postsFound += posts.length;
    console.log(`📸 Step 2 SUCCESS: Found ${posts.length} posts for session ${session.public_tracking_code}`);

    // Step 3: Process each post
    console.log(`🔍 Step 3: Processing ${posts.length} posts`);
    for (const post of posts) {
      try {
        const processed = await processSessionUGCPost(post, session, sessionHashtag, results);
        if (processed) {
          results.postsProcessed++;
          results.discoveredPosts.push(processed);

          // Record the discovery and correlate with session
          const isNew = await recordSessionUGCDiscovery(processed, session);
          if (isNew) {
            results.newDiscoveries++;
            results.sessionsCorrelated++;

            // Update session status to 'found'
            await updateSessionDiscoveryStatus(session.id, 'found');
            results.stats.sessionsUpdated++;

            console.log(`✅ Session ${session.public_tracking_code} marked as found`);
          } else {
            results.stats.duplicatesSkipped++;
          }
        }
      } catch (error) {
        console.error(`❌ Error processing post ${post.id} for session ${session.public_tracking_code}:`, error.message);
        results.stats.processingErrors++;
      }
    }

  } catch (error) {
    console.error(`❌ Error searching session hashtag ${sessionHashtag}:`, error.message);
    console.error(`🔍 DEBUG: Full error details:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    results.errors.push({
      type: 'SESSION_HASHTAG_ERROR',
      sessionId: session.public_tracking_code,
      hashtag: sessionHashtag,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function processSessionUGCPost(post, session, sourceHashtag, results) {
  if (!post.caption) {
    return null; // Skip posts without captions
  }

  console.log(`📝 Processing session post ${post.id}: "${post.caption.substring(0, 100)}..."`);

  // Extract session IDs from caption using flexible patterns
  const sessionIds = extractSessionIds(post.caption);

  if (sessionIds.length === 0) {
    console.log(`⚠️ No session IDs found in post ${post.id}`);
    return null;
  }

  console.log(`🔍 DEBUG: Found session IDs in post: ${sessionIds.join(', ')}`);
  console.log(`🔍 DEBUG: Expected session ID: ${session.public_tracking_code}`);

  // More flexible session ID matching - check multiple variations
  const expectedVariations = [
    session.public_tracking_code.toUpperCase(),
    session.public_tracking_code.toLowerCase(),
    session.public_tracking_code,
    `salon${session.public_tracking_code}`,  // In case it includes "salon" prefix
    session.public_tracking_code.replace(/^salon/i, '') // Remove salon prefix if exists
  ];

  const matchedSessionId = sessionIds.find(id =>
    expectedVariations.some(variation =>
      id.toLowerCase() === variation.toLowerCase() ||
      id.toLowerCase().includes(variation.toLowerCase()) ||
      variation.toLowerCase().includes(id.toLowerCase())
    )
  );

  if (!matchedSessionId) {
    console.log(`⚠️ Post ${post.id} session IDs (${sessionIds.join(', ')}) don't match expected variations (${expectedVariations.join(', ')})`);

    // TEMPORARY: For debugging, process anyway if we found ANY session-like ID
    console.log(`🧪 DEBUG: Processing anyway for debugging purposes...`);

    // Use the first found session ID for debugging
    const debugSessionId = sessionIds[0];
    results.stats.sessionIdsFound++;
    console.log(`🎯 DEBUG: Using session ID: ${debugSessionId} (not exact match)`);

    // Continue with processing using the found ID
    const salonMentions = extractSalonMentions(post.caption);
    const confidenceScore = calculateSessionConfidenceScore(post, debugSessionId, salonMentions);

    const ugcData = {
      postId: post.id,
      sessionId: debugSessionId,
      expectedSessionId: session.public_tracking_code,
      isExactMatch: false, // Flag for debugging
      caption: post.caption,
      mediaType: post.media_type,
      timestamp: post.timestamp,
      permalink: post.permalink,
      username: post.username || 'unknown',
      likeCount: post.like_count || 0,
      commentsCount: post.comments_count || 0,
      salonHandles: salonMentions,
      sourceHashtag: sourceHashtag,
      confidenceScore: confidenceScore,
      discoveredAt: new Date().toISOString(),
      clientName: session.client_name,
      processed: true
    };

    console.log(`🧪 DEBUG UGC processed: Found ${debugSessionId}, Expected ${session.public_tracking_code}, User @${ugcData.username}, Confidence: ${confidenceScore}%`);
    return ugcData;
  }

  results.stats.sessionIdsFound++;
  console.log(`🎯 Session ID confirmed: ${matchedSessionId} (matches ${session.public_tracking_code})`);

  // Extract additional metadata
  const salonMentions = extractSalonMentions(post.caption);
  const confidenceScore = calculateSessionConfidenceScore(post, matchedSessionId, salonMentions);

  // Skip low confidence posts
  if (confidenceScore < 40) {
    console.log(`⚠️ Low confidence score (${confidenceScore}%) for post ${post.id}, skipping`);
    results.stats.lowConfidenceSkipped++;
    return null;
  }

  const ugcData = {
    postId: post.id,
    sessionId: matchedSessionId,
    expectedSessionId: session.public_tracking_code,
    isExactMatch: true,
    caption: post.caption,
    mediaType: post.media_type,
    timestamp: post.timestamp,
    permalink: post.permalink,
    username: post.username || 'unknown',
    likeCount: post.like_count || 0,
    commentsCount: post.comments_count || 0,
    salonHandles: salonMentions,
    sourceHashtag: sourceHashtag,
    confidenceScore: confidenceScore,
    discoveredAt: new Date().toISOString(),
    clientName: session.client_name,
    processed: true
  };

  console.log(`✅ Session UGC processed: ${matchedSessionId}, User @${ugcData.username}, Confidence: ${confidenceScore}%`);
  return ugcData;
}

// More flexible session ID extraction like the local test
function extractSessionIds(text) {
  // Use multiple patterns like the successful local test
  const sessionPatterns = [
    /#PostMyStyle([A-Z0-9]{3,12})/gi,        // Original strict pattern
    /#postmystyle([A-Z0-9]{3,12})/gi,        // Case insensitive
    /#postmystyle(\w{3,})/gi,                // More flexible characters
    /#postmystyle[_-](\w{3,})/gi,            // With separators
    /#PostMyStylesalon(\w{6})/gi             // Salon format
  ];

  let allMatches = [];

  for (const pattern of sessionPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      const ids = matches.map(match => {
        const result = match.match(pattern);
        return result ? result[1] : null;
      }).filter(Boolean);

      allMatches = allMatches.concat(ids);
      console.log(`🔍 DEBUG: Pattern ${pattern} found IDs: ${ids.join(', ')}`);
    }
  }

  // Remove duplicates and return
  const uniqueIds = [...new Set(allMatches)];
  console.log(`🎯 DEBUG: All unique session IDs found: ${uniqueIds.join(', ')}`);

  return uniqueIds;
}

function extractSalonMentions(caption) {
  const mentions = caption.match(/@(\w+)/g) || [];
  return mentions
    .filter(mention => !mention.toLowerCase().includes('postmystyle'))
    .map(mention => mention.substring(1))
    .filter(handle => handle.length > 2);
}

function calculateSessionConfidenceScore(post, sessionId, salonHandles) {
  let confidence = 60; // Higher base score for session-based tracking

  // Session ID quality checks
  if (sessionId.length >= 6) confidence += 15; // Expected length
  if (sessionId.match(/^[A-Z0-9]+$/)) confidence += 10; // Alphanumeric format

  // Salon mention indicators
  if (salonHandles.length > 0) confidence += 10;
  if (salonHandles.length > 1) confidence += 5;

  // Content quality indicators
  if (post.caption.length > 50) confidence += 5;
  if (post.caption.length > 150) confidence += 5;
  if (post.like_count > 0) confidence += 5;
  if (post.like_count > 5) confidence += 5;
  if (post.comments_count > 0) confidence += 5;

  // PostMyStyle brand mentions
  if (post.caption.toLowerCase().includes('postmystyle')) confidence += 10;

  // Hair/beauty related keywords
  const beautyKeywords = ['hair', 'style', 'salon', 'cut', 'color', 'highlight', 'transformation', 'beautiful', 'gorgeous', 'stylist'];
  const keywordMatches = beautyKeywords.filter(keyword =>
    post.caption.toLowerCase().includes(keyword)
  ).length;
  confidence += Math.min(keywordMatches * 2, 10);

  return Math.min(confidence, 100);
}

async function recordSessionUGCDiscovery(ugcData, session) {
  try {
    // Check if this post was already discovered
    const existingCheck = await axios.get(
      `${SUPABASE_URL}/rest/v1/ugc_discoveries?post_url=eq.${encodeURIComponent(ugcData.permalink)}&select=id`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    if (existingCheck.data?.length > 0) {
      console.log(`⚠️ Post ${ugcData.postId} already discovered, skipping`);
      return false; // Not new
    }

    // Record new UGC discovery with direct session correlation
    const insertResponse = await axios.post(
      `${SUPABASE_URL}/rest/v1/ugc_discoveries`,
      {
        media_send_id: session.id, // Direct correlation with session
        stylist_id: session.stylist_id,
        platform: 'instagram',
        post_url: ugcData.permalink,
        post_content: ugcData.caption,
        post_timestamp: ugcData.timestamp,
        engagement_score: ugcData.likeCount + ugcData.commentsCount,
        likes: ugcData.likeCount,
        comments: ugcData.commentsCount,
        shares: 0,
        confidence_score: ugcData.confidenceScore / 100,
        discovery_method: 'automated_session_hashtag',
        created_at: ugcData.discoveredAt,
        updated_at: ugcData.discoveredAt
      },
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'Content-Type': 'application/json',
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    console.log(`✅ Session UGC discovery recorded: ${ugcData.postId} correlated with session ${session.public_tracking_code}`);
    return true; // New discovery

  } catch (error) {
    console.error(`❌ Failed to record session UGC discovery for ${ugcData.postId}:`, error.message);
    throw error;
  }
}

async function updateSessionDiscoveryStatus(sessionId, status) {
  try {
    await axios.patch(
      `${SUPABASE_URL}/rest/v1/media_send?id=eq.${sessionId}`,
      {
        ugc_discovery_status: status,
        updated_at: new Date().toISOString()
      },
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'Content-Type': 'application/json',
          'apikey': SUPABASE_API_KEY,
          'Prefer': 'return=minimal'
        },
        timeout: 10000
      }
    );

    console.log(`📊 Session ${sessionId} status updated to: ${status}`);
  } catch (error) {
    console.error(`❌ Failed to update session status:`, error.message);
    throw error;
  }
}

async function getHashtagId(hashtag) {
  try {
    console.log(`🔍 DEBUG: Searching Instagram for hashtag: ${hashtag}`);
    const url = `https://graph.facebook.com/v19.0/ig_hashtag_search`;
    console.log(`🔗 DEBUG: API URL: ${url}?user_id=${IG_BUSINESS_ID}&q=${hashtag}`);

    const response = await axios.get(url, {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        q: hashtag
      },
      timeout: 10000
    });

    console.log(`📊 DEBUG: Hashtag search response for "${hashtag}":`, {
      status: response.status,
      hasData: !!response.data?.data,
      resultCount: response.data?.data?.length || 0
    });

    if (response.data?.data?.length > 0) {
      console.log(`✅ Hashtag "${hashtag}" found with ID: ${response.data.data[0].id}`);
      return { id: response.data.data[0].id, name: hashtag };
    }

    console.log(`❌ Hashtag "${hashtag}" not found in Instagram index`);
    return null;
  } catch (error) {
    console.error(`❌ Hashtag search failed for #${hashtag}:`, error.message);
    console.error(`🔍 DEBUG: Full error details:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: `https://graph.facebook.com/v19.0/ig_hashtag_search?user_id=${IG_BUSINESS_ID}&q=${hashtag}`
    });
    throw error;
  }
}

async function getHashtagPosts(hashtagId, hashtagName) {
  try {
    console.log(`📸 DEBUG: Getting posts for hashtag ID ${hashtagId} (${hashtagName})`);
    // Use both recent_media and top_media for comprehensive coverage
    const endpoints = ['recent_media', 'top_media'];
    let allPosts = [];

    for (const endpoint of endpoints) {
      try {
        console.log(`🔍 DEBUG: Trying ${endpoint} endpoint for hashtag ${hashtagName}`);
        const response = await axios.get(`https://graph.facebook.com/v19.0/${hashtagId}/${endpoint}`, {
          params: {
            access_token: ACCESS_TOKEN,
            user_id: IG_BUSINESS_ID,
            fields: 'id,media_type,caption,timestamp,like_count,comments_count,permalink,username',
            limit: 25
          },
          timeout: 15000
        });

        console.log(`📊 DEBUG: ${endpoint} response for ${hashtagName}:`, {
          status: response.status,
          dataLength: response.data?.data?.length || 0,
          hasData: !!response.data?.data
        });

        if (response.data?.data?.length > 0) {
          console.log(`📸 Found ${response.data.data.length} posts in ${endpoint} for #${hashtagName}`);
          // Log first post for debugging
          const firstPost = response.data.data[0];
          console.log(`🔍 DEBUG: First post sample:`, {
            id: firstPost.id,
            username: firstPost.username,
            timestamp: firstPost.timestamp,
            captionPreview: firstPost.caption ? firstPost.caption.substring(0, 100) + '...' : 'No caption',
            mediaType: firstPost.media_type
          });
          allPosts = allPosts.concat(response.data.data);
        } else {
          console.log(`📭 No posts found in ${endpoint} for #${hashtagName}`);
        }
      } catch (error) {
        console.error(`❌ ${endpoint} failed for #${hashtagName}: ${error.message}`);
        console.error(`🔍 DEBUG: ${endpoint} error details:`, error.response?.data || error);
      }
    }

    // Remove duplicates based on post ID
    const uniquePosts = allPosts.filter((post, index, self) =>
      index === self.findIndex(p => p.id === post.id)
    );

    console.log(`📊 DEBUG: Final results for ${hashtagName}: ${uniquePosts.length} unique posts from ${allPosts.length} total`);

    return uniquePosts;
  } catch (error) {
    console.error(`❌ Failed to get posts for hashtag ${hashtagName}:`, error.message);
    console.error(`🔍 DEBUG: getHashtagPosts error:`, error.response?.data || error);
    throw error;
  }
}

// NEW: Test the known working hashtag from local test
async function testKnownWorkingHashtag(results) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🧪 TESTING KNOWN WORKING HASHTAG FROM LOCAL TEST');

  try {
    // Test exact case from local test that worked
    const knownHashtag = 'postmystylesalon1O1HOY';
    console.log(`🧪 Testing exact case: #${knownHashtag}`);

    const hashtagResponse = await axios.get(`https://graph.facebook.com/v19.0/ig_hashtag_search`, {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        q: knownHashtag
      },
      timeout: 10000
    });

    const found = hashtagResponse.data?.data?.length > 0;
    console.log(`${found ? '✅' : '❌'} Known hashtag test result: ${found ? 'FOUND' : 'NOT FOUND'}`);

    if (found) {
      console.log(`📊 Hashtag ID: ${hashtagResponse.data.data[0].id}`);

      // Try to get posts
      const postsResponse = await axios.get(`https://graph.facebook.com/v19.0/${hashtagResponse.data.data[0].id}/recent_media`, {
        params: {
          access_token: ACCESS_TOKEN,
          user_id: IG_BUSINESS_ID,
          fields: 'id,caption,timestamp,username',
          limit: 5
        },
        timeout: 15000
      });

      const posts = postsResponse.data?.data || [];
      console.log(`📸 Posts found for known hashtag: ${posts.length}`);

      if (posts.length > 0) {
        console.log(`📋 Sample post:`, {
          id: posts[0].id,
          username: posts[0].username,
          timestamp: posts[0].timestamp,
          captionPreview: posts[0].caption ? posts[0].caption.substring(0, 100) + '...' : 'No caption'
        });
      }
    }

    // Also test lowercase version
    const lowercaseHashtag = 'postmystylesalon1o1hoy';
    console.log(`🧪 Testing lowercase: #${lowercaseHashtag}`);

    const lowercaseResponse = await axios.get(`https://graph.facebook.com/v19.0/ig_hashtag_search`, {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        q: lowercaseHashtag
      },
      timeout: 10000
    });

    const lowercaseFound = lowercaseResponse.data?.data?.length > 0;
    console.log(`${lowercaseFound ? '✅' : '❌'} Lowercase hashtag test result: ${lowercaseFound ? 'FOUND' : 'NOT FOUND'}`);

  } catch (error) {
    console.log(`❌ Known hashtag test failed: ${error.message}`);
    console.error(`🔍 DEBUG: Known hashtag test error:`, error.response?.data || error);
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