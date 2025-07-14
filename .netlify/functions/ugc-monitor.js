const axios = require('axios');

// Environment variables
const IG_BUSINESS_ID = process.env.POSTMYSTYLE_IG_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;
const MONITORING_WEBHOOK = process.env.MONITORING_ALERT_WEBHOOK;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('🔍 PostMyStyle UGC Monitor v3.0 - Salon Tracking System');

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
    hashtagsSearched: 0,
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
      trackingCodesFound: 0
    }
  };

  try {
    // Check Instagram API health first
    await validateInstagramAPI();

    // Search for PostMyStyle hashtag (main brand hashtag)
    await searchHashtagForUGC('postmystyle', results);

    // Search for recent session tracking codes
    await searchRecentTrackingCodes(results);

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

async function searchHashtagForUGC(hashtag, results) {
  try {
    console.log(`🔍 Searching hashtag: #${hashtag}`);
    results.hashtagsSearched++;

    // Step 1: Get hashtag ID
    const hashtagData = await getHashtagId(hashtag);
    if (!hashtagData) {
      console.log(`⚠️ Hashtag #${hashtag} not found`);
      return;
    }

    // Step 2: Get recent posts for this hashtag
    const posts = await getHashtagPosts(hashtagData.id, hashtag);
    if (!posts || posts.length === 0) {
      console.log(`📭 No posts found for #${hashtag}`);
      return;
    }

    results.postsFound += posts.length;
    console.log(`📸 Processing ${posts.length} posts from #${hashtag}`);

    // Step 3: Process each post for UGC discovery
    for (const post of posts) {
      try {
        const processed = await processUGCPost(post, hashtag, results);
        if (processed) {
          results.postsProcessed++;
          results.discoveredPosts.push(processed);

          // Check if this is a new discovery
          const isNew = await recordUGCDiscovery(processed);
          if (isNew) {
            results.newDiscoveries++;

            // Correlate with media_send data using tracking code
            if (processed.trackingCode) {
              const correlated = await correlateWithMediaSend(processed);
              if (correlated) {
                results.sessionsCorrelated++;
              }
            }
          } else {
            results.stats.duplicatesSkipped++;
          }
        }
      } catch (error) {
        console.error(`❌ Error processing post ${post.id}:`, error.message);
        results.stats.processingErrors++;
        results.errors.push({
          type: 'POST_PROCESSING_ERROR',
          postId: post.id,
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

  } catch (error) {
    console.error(`❌ Error searching hashtag ${hashtag}:`, error.message);
    results.errors.push({
      type: 'HASHTAG_SEARCH_ERROR',
      hashtag: hashtag,
      message: error.message,
      timestamp: new Date().toISOString()
    });
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
          console.log(`📸 Found ${response.data.data.length} posts in ${endpoint} for #${hashtagName}`);
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

async function processUGCPost(post, sourceHashtag, results) {
  if (!post.caption) {
    return null; // Skip posts without captions
  }

  console.log(`📝 Processing post ${post.id}: "${post.caption.substring(0, 100)}..."`);

  // NEW: Extract salon tracking codes from caption
  const trackingCodes = extractTrackingCodes(post.caption);

  if (trackingCodes.length === 0) {
    console.log(`⚠️ No PostMyStyle tracking codes found in post ${post.id}`);
    return null;
  }

  results.stats.trackingCodesFound += trackingCodes.length;
  console.log(`🎯 Tracking codes found: ${trackingCodes.join(', ')}`);

  // Use the first (most likely) tracking code
  const primaryTrackingCode = trackingCodes[0];

  // Extract salon mentions and other metadata
  const salonMentions = extractSalonMentions(post.caption);
  const confidenceScore = calculateConfidenceScore(post, primaryTrackingCode, salonMentions);

  // Skip low confidence posts
  if (confidenceScore < 30) {
    console.log(`⚠️ Low confidence score (${confidenceScore}%) for post ${post.id}, skipping`);
    results.stats.lowConfidenceSkipped++;
    return null;
  }

  const ugcData = {
    postId: post.id,
    trackingCode: primaryTrackingCode,
    allTrackingCodes: trackingCodes,
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
    processed: true
  };

  console.log(`✅ UGC post processed: Tracking ${primaryTrackingCode}, User @${ugcData.username}, Confidence: ${confidenceScore}%`);
  return ugcData;
}

// NEW: Extract salon tracking codes using updated patterns
function extractTrackingCodes(text) {
  // Match the new format: #PostMyStyleSalonX7K9M2
  const matches = text.match(/#PostMyStyle(salon[A-Z0-9]{6})/gi);

  if (!matches) return [];

  return matches.map(match => {
    const codeMatch = match.match(/#PostMyStyle(salon[A-Z0-9]{6})/i);
    return codeMatch ? codeMatch[1] : null;
  }).filter(Boolean);
}

function extractSalonMentions(caption) {
  const mentions = caption.match(/@(\w+)/g) || [];
  return mentions
    .filter(mention => !mention.toLowerCase().includes('postmystyle'))
    .map(mention => mention.substring(1))
    .filter(handle => handle.length > 2); // Filter out very short handles
}

function calculateConfidenceScore(post, trackingCode, salonHandles) {
  let confidence = 50; // Higher base score for new tracking system

  // Tracking code quality checks
  if (trackingCode.startsWith('salon')) confidence += 25; // Our format
  if (trackingCode.length === 12) confidence += 10; // Expected length: salon + 6 chars

  // Salon mention indicators
  if (salonHandles.length > 0) confidence += 15;
  if (salonHandles.length > 1) confidence += 5;

  // Content quality indicators
  if (post.caption.length > 50) confidence += 5;
  if (post.caption.length > 150) confidence += 5;
  if (post.like_count > 0) confidence += 5;
  if (post.like_count > 5) confidence += 5;
  if (post.comments_count > 0) confidence += 5;

  // PostMyStyle brand mentions
  if (post.caption.toLowerCase().includes('postmystyle')) confidence += 15;

  // Hair/beauty related keywords
  const beautyKeywords = ['hair', 'style', 'salon', 'cut', 'color', 'highlight', 'transformation', 'beautiful', 'gorgeous'];
  const keywordMatches = beautyKeywords.filter(keyword =>
    post.caption.toLowerCase().includes(keyword)
  ).length;
  confidence += Math.min(keywordMatches * 2, 10);

  return Math.min(confidence, 100);
}

async function recordUGCDiscovery(ugcData) {
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

    // Record new UGC discovery
    const insertResponse = await axios.post(
      `${SUPABASE_URL}/rest/v1/ugc_discoveries`,
      {
        platform: 'instagram',
        post_url: ugcData.permalink,
        post_content: ugcData.caption,
        post_timestamp: ugcData.timestamp,
        engagement_score: ugcData.likeCount + ugcData.commentsCount,
        likes: ugcData.likeCount,
        comments: ugcData.commentsCount,
        shares: 0, // Instagram doesn't provide share count
        confidence_score: ugcData.confidenceScore / 100, // Convert to decimal
        discovery_method: 'automated_hashtag',
        tracking_code: ugcData.trackingCode,
        instagram_username: ugcData.username,
        salon_handles: ugcData.salonHandles,
        source_hashtag: ugcData.sourceHashtag,
        discovered_at: ugcData.discoveredAt
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

    console.log(`✅ New UGC discovery recorded: ${ugcData.postId} with tracking code ${ugcData.trackingCode}`);
    return true; // New discovery

  } catch (error) {
    console.error(`❌ Failed to record UGC discovery for ${ugcData.postId}:`, error.message);
    throw error;
  }
}

// NEW: Correlate with media_send using tracking code and link via visit_id
async function correlateWithMediaSend(ugcData) {
  try {
    console.log(`🔗 Correlating UGC with media_send using tracking code: ${ugcData.trackingCode}`);

    // Find media_send record by public_tracking_code
    const mediaSendResponse = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?public_tracking_code=eq.${ugcData.trackingCode}&select=id,visit_id,stylist_id,client_id,client_name,stylist_name,salon_name`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    if (!mediaSendResponse.data || mediaSendResponse.data.length === 0) {
      console.log(`⚠️ No media_send found for tracking code: ${ugcData.trackingCode}`);
      return false;
    }

    const mediaSend = mediaSendResponse.data[0];
    console.log(`✅ Found media_send: ${mediaSend.client_name} at ${mediaSend.salon_name}`);

    // Update UGC discovery with correlated data
    const updateResponse = await axios.patch(
      `${SUPABASE_URL}/rest/v1/ugc_discoveries?tracking_code=eq.${ugcData.trackingCode}`,
      {
        media_send_id: mediaSend.id,
        stylist_id: mediaSend.stylist_id,
        visit_id: mediaSend.visit_id, // KEY: This links to client_visits table
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

    console.log(`📊 UGC correlation complete: tracking_code ${ugcData.trackingCode} → visit_id ${mediaSend.visit_id}`);
    return true;

  } catch (error) {
    console.error(`❌ UGC correlation failed for ${ugcData.trackingCode}:`, error.message);
    return false;
  }
}

// NEW: Search for recent tracking codes from media_send table
async function searchRecentTrackingCodes(results) {
  try {
    console.log('🔍 Searching for recent salon tracking codes...');

    // Get recent media_send records that have tracking codes but no UGC yet
    const recentSessions = await axios.get(
      `${SUPABASE_URL}/rest/v1/media_send?send_timestamp=gte.${getDateDaysAgo(7)}&public_tracking_code=not.is.null&select=public_tracking_code&limit=20&order=send_timestamp.desc`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_API_KEY}`,
          'apikey': SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    if (recentSessions.data?.length > 0) {
      console.log(`📋 Checking ${recentSessions.data.length} recent tracking codes for specific hashtags`);

      // Process in batches to avoid rate limits
      const batchSize = 3;
      for (let i = 0; i < recentSessions.data.length; i += batchSize) {
        const batch = recentSessions.data.slice(i, i + batchSize);

        await Promise.all(batch.map(async (session) => {
          const specificHashtag = `postmystyle${session.public_tracking_code}`;

          try {
            const hashtagData = await getHashtagId(specificHashtag);
            if (hashtagData) {
              const posts = await getHashtagPosts(hashtagData.id, specificHashtag);
              if (posts?.length > 0) {
                console.log(`🎯 Found ${posts.length} posts for tracking code ${session.public_tracking_code}`);

                for (const post of posts) {
                  const processed = await processUGCPost(post, specificHashtag, results);
                  if (processed) {
                    results.postsProcessed++;
                    results.discoveredPosts.push(processed);

                    const isNew = await recordUGCDiscovery(processed);
                    if (isNew) {
                      results.newDiscoveries++;

                      const correlated = await correlateWithMediaSend(processed);
                      if (correlated) {
                        results.sessionsCorrelated++;
                      }
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.error(`❌ Error checking tracking code hashtag ${specificHashtag}:`, error.message);
          }
        }));

        // Small delay between batches
        if (i + batchSize < recentSessions.data.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } else {
      console.log('📭 No recent tracking codes found');
    }

  } catch (error) {
    console.error('❌ Recent tracking code search failed:', error.message);
    results.errors.push({
      type: 'TRACKING_CODE_SEARCH_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function sendMonitoringAlert(results) {
  try {
    const message = {
      text: `🎯 PostMyStyle UGC Monitor Alert - Salon Tracking`,
      attachments: [{
        color: 'good',
        fields: [
          { title: 'New Discoveries', value: results.newDiscoveries, short: true },
          { title: 'Sessions Correlated', value: results.sessionsCorrelated, short: true },
          { title: 'Tracking Codes Found', value: results.stats.trackingCodesFound, short: true },
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
      text: `🚨 PostMyStyle UGC Monitor CRITICAL FAILURE`,
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