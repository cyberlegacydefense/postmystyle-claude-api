const axios = require('axios');

// Environment variables
const IG_BUSINESS_ID = process.env.POSTMYSTYLE_IG_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;
const MONITORING_WEBHOOK = process.env.MONITORING_ALERT_WEBHOOK;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('🔍 PostMyStyle UGC Monitor v4.0 - Session-Based Tracking System');

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

    // Fallback: Search general PostMyStyle hashtag for any missed sessions
    await searchGeneralPostMyStyleHashtag(results);

    // Calculate execution time
    results.executionTimeMs = Date.now() - startTime;

    console.log(`✅ UGC Monitor Complete: ${results.newDiscoveries} new discoveries, ${results.sessionsCorrelated} sessions correlated`);

    // Send monitoring alert if configured
    if (results.newDiscoveries > 0 && MONITORING_WEBHOOK) {
      await sendMonitoringAlert(results);
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

    // Send critical failure alert
    if (MONITORING_WEBHOOK) {
      await sendCriticalAlert(error, results);
    }

    return createErrorResponse(error.message, 500, results);
  }
};

async function validateInstagramAPI() {
  try {
    const response = await axios.get(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ID}`, {
      params: {
        access_token: ACCESS_TOKEN,
        fields: 'id,username'
      },
      timeout: 10000
    });

    console.log(`✅ Instagram API validated: @${response.data.username}`);
    return true;
  } catch (error) {
    console.error('❌ Instagram API validation failed:', error.message);
    throw new Error(`Instagram API validation failed: ${error.message}`);
  }
}

// NEW: Main function to search for pending session hashtags
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

    // Process sessions in batches to avoid rate limits
    const batchSize = 3;
    for (let i = 0; i < pendingSessions.length; i += batchSize) {
      const batch = pendingSessions.slice(i, i + batchSize);

      await Promise.all(batch.map(async (session) => {
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
      }));

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
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?ugc_tracking_enabled=eq.true&ugc_discovery_status=eq.pending&public_tracking_code=not.is.null&send_timestamp=gte.${getDateDaysAgo(30)}&select=id,public_tracking_code,stylist_id,client_id,client_name,send_timestamp&order=send_timestamp.desc&limit=50`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    return response.data;
  } catch (error) {
    console.error('❌ Failed to get pending sessions:', error.message);
    throw error;
  }
}

async function searchSessionHashtag(session, results) {
  const sessionHashtag = `postmystyle${session.public_tracking_code.toLowerCase()}`;

  try {
    console.log(`🔍 Searching for session hashtag: #${sessionHashtag}`);
    results.sessionHashtagsSearched++;

    // Step 1: Get hashtag ID
    const hashtagData = await getHashtagId(sessionHashtag);
    if (!hashtagData) {
      console.log(`⚠️ Hashtag #${sessionHashtag} not found on Instagram`);
      return;
    }

    // Step 2: Get posts for this specific session hashtag
    const posts = await getHashtagPosts(hashtagData.id, sessionHashtag);
    if (!posts || posts.length === 0) {
      console.log(`📭 No posts found for #${sessionHashtag}`);
      return;
    }

    results.postsFound += posts.length;
    console.log(`📸 Found ${posts.length} posts for session ${session.public_tracking_code}`);

    // Step 3: Process each post
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

  // Extract session IDs from caption
  const sessionIds = extractSessionIds(post.caption);

  // Verify this post contains the expected session ID
  if (!sessionIds.includes(session.public_tracking_code.toUpperCase()) &&
      !sessionIds.includes(session.public_tracking_code.toLowerCase())) {
    console.log(`⚠️ Post ${post.id} doesn't contain expected session ID ${session.public_tracking_code}`);
    return null;
  }

  results.stats.sessionIdsFound++;
  console.log(`🎯 Session ID confirmed: ${session.public_tracking_code}`);

  // Extract additional metadata
  const salonMentions = extractSalonMentions(post.caption);
  const confidenceScore = calculateSessionConfidenceScore(post, session.public_tracking_code, salonMentions);

  // Skip low confidence posts
  if (confidenceScore < 40) {
    console.log(`⚠️ Low confidence score (${confidenceScore}%) for post ${post.id}, skipping`);
    results.stats.lowConfidenceSkipped++;
    return null;
  }

  const ugcData = {
    postId: post.id,
    sessionId: session.public_tracking_code,
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

  console.log(`✅ Session UGC processed: ${session.public_tracking_code}, User @${ugcData.username}, Confidence: ${confidenceScore}%`);
  return ugcData;
}

// NEW: Extract session IDs using the correct pattern #PostMyStyle{SessionID}
function extractSessionIds(text) {
  // Match pattern: #PostMyStyleXXXXXX where XXXXXX is the session ID
  const matches = text.match(/#PostMyStyle([A-Z0-9]{3,12})/gi);

  if (!matches) return [];

  return matches.map(match => {
    const idMatch = match.match(/#PostMyStyle([A-Z0-9]{3,12})/i);
    return idMatch ? idMatch[1] : null;
  }).filter(Boolean);
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

// Fallback: Search general hashtag for any missed sessions
async function searchGeneralPostMyStyleHashtag(results) {
  try {
    console.log('🔍 Fallback: Searching general #postmystyle hashtag...');

    const hashtagData = await getHashtagId('postmystyle');
    if (!hashtagData) {
      console.log('⚠️ General #postmystyle hashtag not found');
      return;
    }

    const posts = await getHashtagPosts(hashtagData.id, 'postmystyle');
    if (!posts || posts.length === 0) {
      console.log('📭 No posts found in general #postmystyle');
      return;
    }

    console.log(`📸 Processing ${posts.length} posts from general #postmystyle for missed sessions`);

    for (const post of posts) {
      try {
        const sessionIds = extractSessionIds(post.caption || '');

        if (sessionIds.length > 0) {
          // Check if any of these session IDs are in our pending list
          for (const sessionId of sessionIds) {
            const session = await findSessionByTrackingCode(sessionId);
            if (session && session.ugc_discovery_status === 'pending') {
              console.log(`🎯 Found missed session: ${sessionId}`);

              const processed = await processSessionUGCPost(post, session, 'postmystyle', results);
              if (processed) {
                const isNew = await recordSessionUGCDiscovery(processed, session);
                if (isNew) {
                  results.newDiscoveries++;
                  results.sessionsCorrelated++;
                  await updateSessionDiscoveryStatus(session.id, 'found');
                  results.stats.sessionsUpdated++;
                }
              }
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error processing fallback post ${post.id}:`, error.message);
      }
    }

  } catch (error) {
    console.error('❌ Fallback search failed:', error.message);
  }
}

async function findSessionByTrackingCode(trackingCode) {
  try {
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?public_tracking_code=ilike.${trackingCode}&ugc_tracking_enabled=eq.true&select=id,public_tracking_code,stylist_id,client_id,client_name,ugc_discovery_status&limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    return response.data?.[0] || null;
  } catch (error) {
    console.error(`❌ Failed to find session by tracking code ${trackingCode}:`, error.message);
    return null;
  }
}

async function getHashtagId(hashtag) {
  try {
    const response = await axios.get(`https://graph.facebook.com/v19.0/ig_hashtag_search`, {
      params: {
        access_token: ACCESS_TOKEN,
        user_id: IG_BUSINESS_ID,
        q: hashtag
      },
      timeout: 10000
    });

    if (response.data?.data?.length > 0) {
      return { id: response.data.data[0].id, name: hashtag };
    }

    return null;
  } catch (error) {
    console.error(`❌ Hashtag search failed for #${hashtag}:`, error.message);
    throw error;
  }
}

async function getHashtagPosts(hashtagId, hashtagName) {
  try {
    // Use both recent_media and top_media for comprehensive coverage
    const endpoints = ['recent_media', 'top_media'];
    let allPosts = [];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${hashtagId}/${endpoint}`, {
          params: {
            access_token: ACCESS_TOKEN,
            user_id: IG_BUSINESS_ID,
            fields: 'id,media_type,caption,timestamp,like_count,comments_count,permalink,username',
            limit: 25
          },
          timeout: 15000
        });

        if (response.data?.data?.length > 0) {
          allPosts = allPosts.concat(response.data.data);
        }
      } catch (error) {
        console.warn(`⚠️ ${endpoint} failed for #${hashtagName}: ${error.message}`);
      }
    }

    // Remove duplicates based on post ID
    const uniquePosts = allPosts.filter((post, index, self) =>
      index === self.findIndex(p => p.id === post.id)
    );

    return uniquePosts;
  } catch (error) {
    console.error(`❌ Failed to get posts for hashtag ${hashtagName}:`, error.message);
    throw error;
  }
}

async function sendMonitoringAlert(results) {
  try {
    const message = {
      text: `🎯 PostMyStyle UGC Monitor Alert - Session Tracking`,
      attachments: [{
        color: 'good',
        fields: [
          { title: 'Pending Sessions Checked', value: results.pendingSessionsFound, short: true },
          { title: 'New Discoveries', value: results.newDiscoveries, short: true },
          { title: 'Sessions Correlated', value: results.sessionsCorrelated, short: true },
          { title: 'Sessions Updated', value: results.stats.sessionsUpdated, short: true },
          { title: 'Execution Time', value: `${results.executionTimeMs}ms`, short: true }
        ]
      }]
    };

    await axios.post(MONITORING_WEBHOOK, message, { timeout: 5000 });
    console.log('📣 Monitoring alert sent');
  } catch (error) {
    console.error('❌ Failed to send monitoring alert:', error.message);
  }
}

async function sendCriticalAlert(error, results) {
  try {
    const message = {
      text: `🚨 PostMyStyle UGC Monitor CRITICAL FAILURE - Session Tracking`,
      attachments: [{
        color: 'danger',
        fields: [
          { title: 'Error', value: error.message, short: false },
          { title: 'Execution Time', value: `${results.executionTimeMs}ms`, short: true },
          { title: 'Partial Results', value: `${results.postsProcessed} posts processed`, short: true }
        ]
      }]
    };

    await axios.post(MONITORING_WEBHOOK, message, { timeout: 5000 });
  } catch (alertError) {
    console.error('❌ Failed to send critical alert:', alertError.message);
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