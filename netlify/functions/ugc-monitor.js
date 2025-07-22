const axios = require('axios');

// Environment variables
const IG_BUSINESS_ID = process.env.POSTMYSTYLE_IG_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;
const MONITORING_WEBHOOK = process.env.MONITORING_ALERT_WEBHOOK;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('🔍 PostMyStyle UGC Monitor v6.1 - Final Production Ready');
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
      sessionsUpdated: 0,
      sessionUpdatesFailed: 0,
      topMediaSuccess: 0,
      recentMediaSuccess: 0,
      fieldPermissionErrors: 0
    }
  };

  try {
    // Check Instagram API health first
    await validateInstagramAPI();

    // Main workflow: Search for pending session hashtags
    await searchPendingSessionHashtags(results);

    // Test known working hashtag to verify functionality
    await testKnownWorkingHashtag(results);

    // Calculate execution time
    results.executionTimeMs = Date.now() - startTime;

    console.log(`✅ UGC Monitor Complete: ${results.newDiscoveries} new discoveries, ${results.sessionsCorrelated} sessions correlated`);
    console.log(`📊 Stats: ${results.stats.topMediaSuccess} top_media successes, ${results.stats.recentMediaSuccess} recent_media successes`);
    console.log(`📊 Updates: ${results.stats.sessionsUpdated} successful, ${results.stats.sessionUpdatesFailed} failed`);
    console.log(`🕐 Total execution time: ${results.executionTimeMs}ms`);

    // Send monitoring alert if configured
    if (results.newDiscoveries > 0 && MONITORING_WEBHOOK) {
      try {
        await sendMonitoringAlert(results);
      } catch (alertError) {
        console.warn('⚠️ Monitoring alert failed:', alertError.message);
      }
    }

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
    console.log(`   SUPABASE_URL: ${SUPABASE_URL ? 'SET' : 'MISSING'}`);
    console.log(`   SUPABASE_API_KEY: ${SUPABASE_API_KEY ? 'SET' : 'MISSING'} (length: ${SUPABASE_API_KEY?.length || 0})`);

    // Show partial values for debugging (without exposing secrets)
    if (IG_BUSINESS_ID && IG_BUSINESS_ID.length > 6) {
      console.log(`   IG_BUSINESS_ID format: ${IG_BUSINESS_ID.substring(0, 3)}...${IG_BUSINESS_ID.substring(IG_BUSINESS_ID.length - 3)}`);
    }
    if (ACCESS_TOKEN && ACCESS_TOKEN.length > 20) {
      console.log(`   ACCESS_TOKEN format: ${ACCESS_TOKEN.substring(0, 10)}...${ACCESS_TOKEN.substring(ACCESS_TOKEN.length - 10)}`);
    }

    // Check service role key format
    const keyType = SUPABASE_API_KEY ?
      (SUPABASE_API_KEY.startsWith('eyJ') ?
        (SUPABASE_API_KEY.length > 150 ? 'SERVICE_ROLE ✅' : 'JWT but short ⚠️') :
        'NOT_JWT ❌') :
      'MISSING ❌';

    console.log(`   🔑 Supabase Key Type: ${keyType}`);

    // Validate format
    if (!IG_BUSINESS_ID || IG_BUSINESS_ID.length < 10) {
      throw new Error(`Invalid IG_BUSINESS_ID: ${IG_BUSINESS_ID ? 'too short' : 'missing'}`);
    }
    if (!ACCESS_TOKEN || ACCESS_TOKEN.length < 50) {
      throw new Error(`Invalid ACCESS_TOKEN: ${ACCESS_TOKEN ? 'too short' : 'missing'}`);
    }

    // Test Instagram API connection with working fields
    const url = `https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`;
    const params = {
      access_token: ACCESS_TOKEN,
      fields: 'id,username,media_count,followers_count' // FIXED: Removed account_type field
    };

    console.log('🔍 TESTING INSTAGRAM API CONNECTION:');
    console.log(`   URL: ${url}`);
    console.log(`   Business ID: ${IG_BUSINESS_ID}`);

    const response = await axios.get(url, {
      params: params,
      timeout: 10000,
      headers: {
        'User-Agent': 'PostMyStyle-UGC-Monitor/6.1'
      }
    });

    console.log(`✅ Instagram API validation SUCCESS:`, {
      status: response.status,
      username: response.data.username,
      mediaCount: response.data.media_count,
      followersCount: response.data.followers_count,
      businessId: response.data.id
    });

    // Test hashtag search capability
    console.log('🔍 Testing hashtag search capability...');
    const hashtagTest = await axios.get('https://graph.facebook.com/v19.0/ig_hashtag_search', {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        q: 'postmystyle'
      },
      timeout: 10000
    });

    console.log(`✅ Hashtag search capability confirmed: Found ${hashtagTest.data?.data?.length || 0} hashtags`);
    return true;

  } catch (error) {
    console.error('❌ Instagram API validation FAILED:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Status: ${error.response?.status || 'No HTTP response'}`);

    if (error.response?.data) {
      console.error(`   Response:`, JSON.stringify(error.response.data, null, 2));
    }

    throw new Error(`Instagram API validation failed: ${error.message}`);
  }
}

async function searchPendingSessionHashtags(results) {
  try {
    console.log('🔍 Querying pending sessions from database...');

    const pendingSessions = await getPendingSessions();

    if (!pendingSessions || pendingSessions.length === 0) {
      console.log('📭 No pending sessions found');
      return;
    }

    results.pendingSessionsFound = pendingSessions.length;
    console.log(`📋 Found ${pendingSessions.length} pending sessions to process`);

    // Process sessions in batches with rate limiting
    const batchSize = 3;
    for (let i = 0; i < pendingSessions.length; i += batchSize) {
      const batch = pendingSessions.slice(i, i + batchSize);

      console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1} (${batch.length} sessions)`);

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
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // Delay between batches to respect rate limits
      if (i + batchSize < pendingSessions.length) {
        console.log('⏱️ Rate limiting pause between batches...');
        await new Promise(resolve => setTimeout(resolve, 2000));
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
    console.log(`🔍 Querying pending sessions since: ${dateThreshold}`);

    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?ugc_tracking_enabled=eq.true&ugc_discovery_status=eq.pending&public_tracking_code=not.is.null&send_timestamp=gte.${dateThreshold}&select=id,public_tracking_code,stylist_id,client_id,client_name,send_timestamp,ugc_tracking_enabled,ugc_discovery_status&order=send_timestamp.desc&limit=20`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const sessions = response.data || [];
    console.log(`📊 Database query results: ${sessions.length} pending sessions found`);

    if (sessions.length > 0) {
      console.log(`📋 Recent sessions preview:`);
      sessions.slice(0, 3).forEach((session, index) => {
        console.log(`   ${index + 1}. ${session.public_tracking_code} (${session.client_name}) - ${session.send_timestamp.substring(0, 10)}`);
      });
    }

    return sessions;
  } catch (error) {
    console.error('❌ Failed to get pending sessions:', error.message);
    if (error.response?.data) {
      console.error(`❌ Database error details:`, error.response.data);
    }
    throw error;
  }
}

async function searchSessionHashtag(session, results) {
  const sessionHashtag = `postmystyle${session.public_tracking_code.toLowerCase()}`;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 PROCESSING SESSION: ${session.public_tracking_code}`);
  console.log(`   Client: ${session.client_name || 'Unknown'}`);
  console.log(`   Hashtag: #${sessionHashtag}`);
  console.log(`   Date: ${session.send_timestamp}`);

  try {
    results.sessionHashtagsSearched++;

    // Step 1: Get hashtag ID
    console.log(`🔍 Step 1: Searching for hashtag #${sessionHashtag}`);
    const hashtagData = await getHashtagId(sessionHashtag);
    if (!hashtagData) {
      console.log(`⚠️ Hashtag #${sessionHashtag} not found - no posts made yet`);
      return;
    }

    console.log(`✅ Step 1 SUCCESS: Hashtag found - ID: ${hashtagData.id}`);

    // Step 2: Get posts using fixed method (top_media first, no username field)
    console.log(`🔍 Step 2: Getting posts for hashtag ID ${hashtagData.id}`);
    const posts = await getHashtagPosts(hashtagData.id, sessionHashtag, results);

    if (!posts || posts.length === 0) {
      console.log(`📭 No posts found for #${sessionHashtag}`);
      return;
    }

    results.postsFound += posts.length;
    console.log(`📸 Step 2 SUCCESS: Found ${posts.length} posts for session ${session.public_tracking_code}`);

    // Step 3: Process each post for UGC discovery
    console.log(`🔍 Step 3: Processing ${posts.length} posts for UGC content`);
    for (const post of posts) {
      try {
        const processed = await processSessionUGCPost(post, session, sessionHashtag, results);
        if (processed) {
          results.postsProcessed++;
          results.discoveredPosts.push(processed);

          // Record discovery and update session status
          const isNew = await recordSessionUGCDiscovery(processed, session);
          if (isNew) {
            results.newDiscoveries++;
            results.sessionsCorrelated++;

            // Update session status to 'discovered' (FIXED: no updated_at field)
            const updateSuccess = await updateSessionDiscoveryStatus(session.id, 'discovered');
            if (updateSuccess) {
              results.stats.sessionsUpdated++;
              console.log(`✅ Session ${session.public_tracking_code} marked as discovered`);
            } else {
              results.stats.sessionUpdatesFailed++;
              console.log(`⚠️ Session ${session.public_tracking_code} UGC found but status update failed`);
            }
          } else {
            results.stats.duplicatesSkipped++;
            console.log(`⚠️ Post already discovered for session ${session.public_tracking_code}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing post ${post.id}:`, error.message);
        results.stats.processingErrors++;
      }
    }

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
    console.log(`🔍 Searching Instagram hashtag index for: #${hashtag}`);

    const response = await axios.get(`https://graph.facebook.com/v19.0/ig_hashtag_search`, {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        q: hashtag
      },
      timeout: 10000
    });

    const results = response.data?.data || [];
    console.log(`📊 Hashtag search results: ${results.length} found`);

    if (results.length > 0) {
      const hashtagId = results[0].id;
      console.log(`✅ Hashtag "${hashtag}" found with ID: ${hashtagId}`);
      return { id: hashtagId, name: hashtag };
    }

    console.log(`❌ Hashtag "${hashtag}" not found in Instagram index`);
    return null;
  } catch (error) {
    console.error(`❌ Hashtag search failed for #${hashtag}:`, error.message);
    if (error.response?.data) {
      console.error(`❌ Hashtag search error details:`, error.response.data);
    }
    throw error;
  }
}

async function getHashtagPosts(hashtagId, hashtagName, results) {
  try {
    console.log(`📊 Getting posts for hashtag ID: ${hashtagId} (#${hashtagName})`);

    // CRITICAL FIX: Try both endpoints with top_media first (like working local script)
    const endpoints = ['top_media', 'recent_media'];
    let allPosts = [];

    for (const endpoint of endpoints) {
      try {
        console.log(`📊 Trying ${endpoint} endpoint for #${hashtagName}...`);

        const response = await axios.get(`https://graph.facebook.com/v19.0/${hashtagId}/${endpoint}`, {
          params: {
            access_token: ACCESS_TOKEN,
            user_id: IG_BUSINESS_ID,
            // CRITICAL FIX: Only use fields that work (no username field)
            fields: 'id,media_type,caption,timestamp',
            limit: 25
          },
          timeout: 15000,
          headers: {
            'User-Agent': 'PostMyStyle-UGC-Monitor/6.1'
          }
        });

        const posts = response.data?.data || [];
        if (posts.length > 0) {
          console.log(`✅ ${endpoint} SUCCESS: Found ${posts.length} posts for #${hashtagName}`);

          // Track which endpoint succeeded
          if (endpoint === 'top_media') {
            results.stats.topMediaSuccess++;
          } else {
            results.stats.recentMediaSuccess++;
          }

          // Log sample for debugging
          const samplePost = posts[0];
          console.log(`🔍 Sample post from ${endpoint}:`, {
            id: samplePost.id,
            mediaType: samplePost.media_type,
            hasCaption: !!samplePost.caption,
            captionPreview: samplePost.caption ? samplePost.caption.substring(0, 100) + '...' : 'No caption'
          });

          allPosts = allPosts.concat(posts);
        } else {
          console.log(`📭 ${endpoint}: No posts found for #${hashtagName}`);
        }

      } catch (endpointError) {
        console.warn(`⚠️ ${endpoint} failed for #${hashtagName}: ${endpointError.response?.data?.error?.message || endpointError.message}`);

        if (endpointError.response?.data?.error?.message?.includes('supported fields')) {
          results.stats.fieldPermissionErrors++;
        }
      }
    }

    // Remove duplicates based on post ID
    const uniquePosts = allPosts.filter((post, index, self) =>
      index === self.findIndex(p => p.id === post.id)
    );

    console.log(`📊 Total unique posts found for #${hashtagName}: ${uniquePosts.length}`);
    return uniquePosts;

  } catch (error) {
    console.error(`❌ Failed to get posts for hashtag ${hashtagName}:`, error.message);
    throw error;
  }
}

async function processSessionUGCPost(post, session, sourceHashtag, results) {
  if (!post.caption) {
    console.log(`⚠️ Skipping post ${post.id} - no caption`);
    return null;
  }

  console.log(`📝 Processing post ${post.id}: "${post.caption.substring(0, 120)}..."`);

  // Extract session IDs using multiple patterns
  const sessionIds = extractSessionIds(post.caption);

  if (sessionIds.length === 0) {
    console.log(`⚠️ No session IDs found in post ${post.id}`);
    return null;
  }

  console.log(`🔍 Found session IDs: ${sessionIds.join(', ')}`);
  console.log(`🎯 Expected session ID: ${session.public_tracking_code}`);

  // Flexible session ID matching
  const expectedVariations = [
    session.public_tracking_code.toUpperCase(),
    session.public_tracking_code.toLowerCase(),
    session.public_tracking_code,
    `salon${session.public_tracking_code}`.toLowerCase(),
    session.public_tracking_code.replace(/^salon/i, '')
  ];

  const matchedSessionId = sessionIds.find(id =>
    expectedVariations.some(variation =>
      id.toLowerCase() === variation.toLowerCase() ||
      id.toLowerCase().includes(variation.toLowerCase()) ||
      variation.toLowerCase().includes(id.toLowerCase())
    )
  );

  if (!matchedSessionId) {
    console.log(`⚠️ Post ${post.id} session IDs don't match expected: ${session.public_tracking_code}`);
    return null;
  }

  results.stats.sessionIdsFound++;
  console.log(`🎯 Session ID confirmed: ${matchedSessionId}`);

  // Extract salon mentions and calculate confidence
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
    isExactMatch: matchedSessionId.toLowerCase() === session.public_tracking_code.toLowerCase(),
    caption: post.caption,
    mediaType: post.media_type,
    timestamp: post.timestamp,
    permalink: post.permalink || `https://instagram.com/p/${post.id}`,
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

  console.log(`✅ UGC processed: Session ${matchedSessionId}, Confidence: ${confidenceScore}%`);
  return ugcData;
}

function extractSessionIds(text) {
  // Multiple patterns for robust session ID extraction
  const sessionPatterns = [
    /#postmystyle(\w{3,12})/gi,               // #postmystyleABC123
    /#postmystyle[_-](\w{3,12})/gi,          // #postmystyle_ABC123
    /#postmystyle[_-]?salon[_-]?(\w{3,12})/gi, // #postmystylesalonABC123
    /#PostMyStyle(\w{3,12})/gi,               // #PostMyStyleABC123
    /#PostMyStylesalon(\w{3,12})/gi           // #PostMyStylesalonABC123
  ];

  let allMatches = [];

  for (const pattern of sessionPatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      const ids = matches.map(match => match[1]).filter(Boolean);
      allMatches = allMatches.concat(ids);
    }
  }

  // Remove duplicates and return
  const uniqueIds = [...new Set(allMatches)];
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
  let confidence = 60; // Base score for session-based tracking

  // Session ID quality checks
  if (sessionId.length >= 6) confidence += 15;
  if (sessionId.match(/^[A-Z0-9]+$/i)) confidence += 10;

  // Salon mention indicators
  if (salonHandles.length > 0) confidence += 10;
  if (salonHandles.length > 1) confidence += 5;

  // Content quality indicators (handle missing fields gracefully)
  if (post.caption && post.caption.length > 50) confidence += 5;
  if (post.caption && post.caption.length > 150) confidence += 5;
  if ((post.like_count || 0) > 0) confidence += 5;
  if ((post.like_count || 0) > 5) confidence += 5;
  if ((post.comments_count || 0) > 0) confidence += 5;

  // PostMyStyle brand mentions
  if (post.caption && post.caption.toLowerCase().includes('postmystyle')) confidence += 10;

  // Hair/beauty related keywords
  if (post.caption) {
    const beautyKeywords = ['hair', 'style', 'salon', 'cut', 'color', 'highlight', 'transformation', 'beautiful', 'gorgeous', 'stylist'];
    const keywordMatches = beautyKeywords.filter(keyword =>
      post.caption.toLowerCase().includes(keyword)
    ).length;
    confidence += Math.min(keywordMatches * 2, 10);
  }

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
      return false;
    }

    // Record new UGC discovery
    const insertResponse = await axios.post(
      `${SUPABASE_URL}/rest/v1/ugc_discoveries`,
      {
        media_send_id: session.id,
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
        timeout: 15000
      }
    );

    console.log(`✅ UGC discovery recorded: ${ugcData.postId} → session ${session.public_tracking_code}`);
    return true;

  } catch (error) {
    console.error(`❌ Failed to record UGC discovery:`, error.message);
    throw error;
  }
}

async function updateSessionDiscoveryStatus(sessionId, status) {
  try {
    console.log(`🔍 DEBUG: Updating session ${sessionId} to status: "${status}"`);

    // Verify API key format
    const keyType = SUPABASE_API_KEY ?
      (SUPABASE_API_KEY.startsWith('eyJ') ?
        (SUPABASE_API_KEY.length > 150 ? 'SERVICE_ROLE ✅' : 'JWT but short ⚠️') :
        'NOT_JWT ❌') :
      'MISSING ❌';

    console.log(`🔑 API Key Type: ${keyType} (length: ${SUPABASE_API_KEY?.length || 0})`);

    // Check current record first
    console.log(`🔍 Step 1: Verifying session exists...`);
    const checkResponse = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?id=eq.${sessionId}&select=id,ugc_discovery_status,public_tracking_code,stylist_id`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (!checkResponse.data || checkResponse.data.length === 0) {
      throw new Error(`Session with ID ${sessionId} not found in database`);
    }

    const currentRecord = checkResponse.data[0];
    console.log(`✅ Found session record:`, {
      id: currentRecord.id,
      currentStatus: currentRecord.ugc_discovery_status,
      trackingCode: currentRecord.public_tracking_code
    });

    // CRITICAL FIX: Only update ugc_discovery_status (no updated_at column)
    console.log(`🔍 Step 2: Attempting update with ONLY status field...`);
    const updateResponse = await axios.patch(
      `${SUPABASE_URL}/rest/v1/media_send?id=eq.${sessionId}`,
      {
        ugc_discovery_status: status  // FIXED: Removed updated_at field - it doesn't exist!
      },
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        timeout: 10000
      }
    );

    console.log(`✅ SUCCESS: Session ${sessionId} status updated to "${status}"`);
    console.log(`📊 Update response status: ${updateResponse.status} ${updateResponse.statusText}`);

    // Verify the update worked
    console.log(`🔍 Step 3: Verifying update worked...`);
    const verifyResponse = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?id=eq.${sessionId}&select=id,ugc_discovery_status,public_tracking_code`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    const updatedRecord = verifyResponse.data[0];
    console.log(`📊 Verification result:`, {
      id: updatedRecord.id,
      newStatus: updatedRecord.ugc_discovery_status,
      trackingCode: updatedRecord.public_tracking_code
    });

    if (updatedRecord.ugc_discovery_status === status) {
      console.log(`🎉 STATUS UPDATE CONFIRMED: Successfully changed to "${status}"`);
      return true;
    } else {
      console.log(`⚠️ Status verification failed - expected "${status}", got "${updatedRecord.ugc_discovery_status}"`);
      return false;
    }

  } catch (error) {
    console.error(`❌ UPDATE FAILED for session ${sessionId}:`);
    console.error(`   Error: ${error.message}`);
    console.error(`   HTTP Status: ${error.response?.status} ${error.response?.statusText || ''}`);

    if (error.response?.data) {
      console.error(`   Supabase Error Details:`, JSON.stringify(error.response.data, null, 2));
    }

    // Try alternative approach - update by tracking code instead of UUID
    try {
      console.log(`🔍 Step 4: Trying alternative approach - update by tracking code...`);
      const currentRecord = checkResponse?.data?.[0];
      if (currentRecord?.public_tracking_code) {
        const trackingCode = currentRecord.public_tracking_code;

        const altResponse = await axios.patch(
          `${SUPABASE_URL}/rest/v1/media_send?public_tracking_code=eq.${trackingCode}`,
          {
            ugc_discovery_status: status  // ONLY status field, no updated_at
          },
          {
            headers: {
              'Authorization': `Bearer ${SUPABASE_API_KEY}`,
              'apikey': SUPABASE_API_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            timeout: 10000
          }
        );

        console.log(`✅ SUCCESS with tracking code approach: ${trackingCode}`);
        return true;
      }

    } catch (altError) {
      console.log(`❌ Alternative approach also failed: ${altError.response?.data?.message || altError.message}`);
    }

    // Don't throw error - let UGC discovery continue working
    console.log(`⚠️ Status update failed, but UGC discovery was successful`);
    return false;
  }
}

async function testKnownWorkingHashtag(results) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('🧪 TESTING KNOWN WORKING HASHTAG');

  try {
    const hashtagVariations = [
      'PostMyStylesalon1O1HOY',     // Exact case from your mention
      'postmystylesalon1O1HOY',     // Mixed case from logs
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

          // Try to get posts using the fixed method
          const posts = await getHashtagPosts(hashtagId, hashtag, results);
          console.log(`   Posts found: ${posts.length}`);

          if (posts.length > 0) {
            const firstPost = posts[0];
            console.log(`   📋 First post details:`);
            console.log(`      ID: ${firstPost.id}`);
            console.log(`      Media Type: ${firstPost.media_type}`);
            console.log(`      Has Caption: ${!!firstPost.caption}`);
            console.log(`      Timestamp: ${firstPost.timestamp}`);

            if (firstPost.caption) {
              console.log(`      Caption preview: ${firstPost.caption.substring(0, 200)}...`);

              // Analyze caption
              const hasPostMyStyle = firstPost.caption.toLowerCase().includes('postmystyle');
              const hasSalon = firstPost.caption.toLowerCase().includes('salon');
              const hasCode = firstPost.caption.toLowerCase().includes('1o1hoy');

              console.log(`      Caption analysis:`);
              console.log(`         Contains 'postmystyle': ${hasPostMyStyle ? '✅' : '❌'}`);
              console.log(`         Contains 'salon': ${hasSalon ? '✅' : '❌'}`);
              console.log(`         Contains '1o1hoy': ${hasCode ? '✅' : '❌'}`);
            }
          }
        }

      } catch (searchError) {
        console.log(`   ❌ Test failed: ${searchError.message}`);
      }

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.log(`❌ Known hashtag test failed: ${error.message}`);
  }
}

async function sendMonitoringAlert(results) {
  try {
    const alertData = {
      text: `🎉 PostMyStyle UGC Monitor Alert`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*UGC Discovery Report*\n• New discoveries: ${results.newDiscoveries}\n• Sessions correlated: ${results.sessionsCorrelated}\n• Status updates: ${results.stats.sessionsUpdated}/${results.stats.sessionsUpdated + results.stats.sessionUpdatesFailed}\n• Execution time: ${results.executionTimeMs}ms`
          }
        }
      ]
    };

    await axios.post(MONITORING_WEBHOOK, alertData, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('📨 Monitoring alert sent successfully');
  } catch (error) {
    console.error('❌ Failed to send monitoring alert:', error.message);
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