const axios = require('axios');

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_API_KEY = process.env.SUPABASE_API_KEY;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('📊 UGC Analytics API called:', new Date().toISOString());

  // Parse request parameters
  const requestData = parseRequestParameters(event);
  console.log('📋 Request parameters:', JSON.stringify(requestData, null, 2));

  try {
    // Validate environment variables
    if (!SUPABASE_URL || !SUPABASE_API_KEY) {
      throw new Error('Missing Supabase configuration');
    }

    // Route to appropriate analytics function based on endpoint
    let analyticsResult;

    switch (requestData.endpoint) {
      case 'overview':
        analyticsResult = await getOverviewAnalytics(requestData);
        break;
      case 'discoveries':
        analyticsResult = await getUGCDiscoveries(requestData);
        break;
      case 'sessions':
        analyticsResult = await getSessionAnalytics(requestData);
        break;
      case 'stylists':
        analyticsResult = await getStylistPerformance(requestData);
        break;
      case 'engagement':
        analyticsResult = await getEngagementAnalytics(requestData);
        break;
      case 'trends':
        analyticsResult = await getTrendAnalytics(requestData);
        break;
      case 'export':
        analyticsResult = await exportAnalyticsData(requestData);
        break;
      default:
        analyticsResult = await getOverviewAnalytics(requestData);
    }

    const response = {
      success: true,
      endpoint: requestData.endpoint,
      timestamp: new Date().toISOString(),
      executionTimeMs: Date.now() - startTime,
      filters: requestData.filters,
      data: analyticsResult
    };

    console.log(`✅ Analytics request completed in ${response.executionTimeMs}ms`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    console.error('❌ Analytics API error:', error.message);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        executionTimeMs: Date.now() - startTime
      })
    };
  }
};

function parseRequestParameters(event) {
  const defaults = {
    endpoint: 'overview',
    filters: {
      startDate: getDateDaysAgo(30), // Last 30 days by default
      endDate: new Date().toISOString(),
      salonId: null,
      stylistId: null,
      minConfidence: 50
    },
    pagination: {
      limit: 100,
      offset: 0
    }
  };

  try {
    // Handle different request methods
    let params = {};

    if (event.httpMethod === 'POST' && event.body) {
      params = JSON.parse(event.body);
    } else if (event.queryStringParameters) {
      params = event.queryStringParameters;
    }

    // Extract endpoint from path
    const pathSegments = event.path?.split('/') || [];
    const endpoint = pathSegments[pathSegments.length - 1] || params.endpoint || 'overview';

    return {
      endpoint: endpoint,
      filters: {
        ...defaults.filters,
        ...params.filters,
        startDate: params.startDate || params.filters?.startDate || defaults.filters.startDate,
        endDate: params.endDate || params.filters?.endDate || defaults.filters.endDate,
        salonId: params.salonId || params.filters?.salonId,
        stylistId: params.stylistId || params.filters?.stylistId,
        minConfidence: parseInt(params.minConfidence || params.filters?.minConfidence || defaults.filters.minConfidence)
      },
      pagination: {
        limit: parseInt(params.limit || defaults.pagination.limit),
        offset: parseInt(params.offset || defaults.pagination.offset)
      }
    };
  } catch (error) {
    console.warn('⚠️ Error parsing request parameters, using defaults:', error.message);
    return defaults;
  }
}

async function getOverviewAnalytics(requestData) {
  console.log('📊 Generating overview analytics...');

  const { startDate, endDate } = requestData.filters;

  // Get summary statistics
  const [
    totalDiscoveries,
    totalSessions,
    avgConfidence,
    topHashtags,
    recentActivity
  ] = await Promise.all([
    getTotalDiscoveries(startDate, endDate),
    getTotalSessions(startDate, endDate),
    getAverageConfidence(startDate, endDate),
    getTopHashtags(startDate, endDate),
    getRecentActivity(7) // Last 7 days
  ]);

  // Calculate key metrics
  const ugcDiscoveryRate = totalSessions > 0 ? ((totalDiscoveries / totalSessions) * 100).toFixed(1) : 0;

  return {
    summary: {
      totalUGCDiscoveries: totalDiscoveries,
      totalSessions: totalSessions,
      ugcDiscoveryRate: parseFloat(ugcDiscoveryRate),
      averageConfidenceScore: avgConfidence,
      dateRange: { startDate, endDate }
    },
    topHashtags: topHashtags,
    recentActivity: recentActivity,
    metrics: {
      dailyDiscoveryAverage: (totalDiscoveries / daysBetween(startDate, endDate)).toFixed(1),
      sessionsWithUGC: await getSessionsWithUGC(startDate, endDate),
      highConfidenceDiscoveries: await getHighConfidenceDiscoveries(startDate, endDate)
    }
  };
}

async function getUGCDiscoveries(requestData) {
  console.log('📸 Getting UGC discoveries...');

  const { startDate, endDate, salonId, stylistId, minConfidence } = requestData.filters;
  const { limit, offset } = requestData.pagination;

  // Build query with filters
  let query = `ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&confidence_score=gte.${minConfidence}`;

  if (salonId) {
    // Join with sessions to filter by salon
    query += `&sessions.salon_id=eq.${salonId}`;
  }

  if (stylistId) {
    query += `&sessions.stylist_id=eq.${stylistId}`;
  }

  const response = await makeSupabaseRequest(
    `${query}&select=*,sessions(salon_id,stylist_id,stylist_name,salon_name)&order=discovered_at.desc&limit=${limit}&offset=${offset}`
  );

  // Get total count for pagination
  const countResponse = await makeSupabaseRequest(
    `${query}&select=*&count=exact`
  );

  return {
    discoveries: response.data,
    pagination: {
      total: countResponse.count,
      limit: limit,
      offset: offset,
      hasMore: (offset + limit) < countResponse.count
    }
  };
}

async function getSessionAnalytics(requestData) {
  console.log('💼 Getting session analytics...');

  const { startDate, endDate, salonId, stylistId } = requestData.filters;

  let query = `sessions?created_at=gte.${startDate}&created_at=lte.${endDate}`;

  if (salonId) {
    query += `&salon_id=eq.${salonId}`;
  }

  if (stylistId) {
    query += `&stylist_id=eq.${stylistId}`;
  }

  const response = await makeSupabaseRequest(
    `${query}&select=*&order=created_at.desc&limit=${requestData.pagination.limit}&offset=${requestData.pagination.offset}`
  );

  // Calculate session statistics
  const sessions = response.data;
  const sessionsWithUGC = sessions.filter(s => s.ugc_discovered).length;
  const totalEngagement = sessions.reduce((sum, s) => {
    const engagement = s.instagram_engagement;
    return sum + (engagement ? (engagement.likes || 0) + (engagement.comments || 0) : 0);
  }, 0);

  return {
    sessions: sessions,
    statistics: {
      totalSessions: sessions.length,
      sessionsWithUGC: sessionsWithUGC,
      ugcDiscoveryRate: sessions.length > 0 ? ((sessionsWithUGC / sessions.length) * 100).toFixed(1) : 0,
      totalEngagement: totalEngagement,
      avgEngagementPerSession: sessions.length > 0 ? (totalEngagement / sessions.length).toFixed(1) : 0
    }
  };
}

async function getStylistPerformance(requestData) {
  console.log('👨‍💼 Getting stylist performance analytics...');

  const { startDate, endDate, salonId } = requestData.filters;

  // Get stylist performance data with UGC metrics
  let query = `sessions?created_at=gte.${startDate}&created_at=lte.${endDate}`;

  if (salonId) {
    query += `&salon_id=eq.${salonId}`;
  }

  const response = await makeSupabaseRequest(
    `${query}&select=stylist_id,stylist_name,salon_name,ugc_discovered,instagram_engagement`
  );

  // Group by stylist and calculate metrics
  const stylistMetrics = {};

  response.data.forEach(session => {
    const stylistId = session.stylist_id;

    if (!stylistMetrics[stylistId]) {
      stylistMetrics[stylistId] = {
        stylistId: stylistId,
        stylistName: session.stylist_name,
        salonName: session.salon_name,
        totalSessions: 0,
        ugcDiscoveries: 0,
        totalLikes: 0,
        totalComments: 0,
        totalEngagement: 0,
        avgConfidenceScore: 0,
        ugcDiscoveryRate: 0
      };
    }

    const metrics = stylistMetrics[stylistId];
    metrics.totalSessions++;

    if (session.ugc_discovered) {
      metrics.ugcDiscoveries++;

      if (session.instagram_engagement) {
        metrics.totalLikes += session.instagram_engagement.likes || 0;
        metrics.totalComments += session.instagram_engagement.comments || 0;
        metrics.totalEngagement += (session.instagram_engagement.likes || 0) + (session.instagram_engagement.comments || 0);
      }
    }
  });

  // Calculate rates and sort by performance
  const stylistArray = Object.values(stylistMetrics).map(stylist => ({
    ...stylist,
    ugcDiscoveryRate: stylist.totalSessions > 0 ? ((stylist.ugcDiscoveries / stylist.totalSessions) * 100).toFixed(1) : 0,
    avgEngagementPerUGC: stylist.ugcDiscoveries > 0 ? (stylist.totalEngagement / stylist.ugcDiscoveries).toFixed(1) : 0
  })).sort((a, b) => b.ugcDiscoveryRate - a.ugcDiscoveryRate);

  return {
    stylists: stylistArray,
    summary: {
      totalStylists: stylistArray.length,
      topPerformer: stylistArray[0] || null,
      avgDiscoveryRate: stylistArray.length > 0 ? (stylistArray.reduce((sum, s) => sum + parseFloat(s.ugcDiscoveryRate), 0) / stylistArray.length).toFixed(1) : 0
    }
  };
}

async function getEngagementAnalytics(requestData) {
  console.log('❤️ Getting engagement analytics...');

  const { startDate, endDate } = requestData.filters;

  const response = await makeSupabaseRequest(
    `ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&select=like_count,comments_count,confidence_score,discovered_at,instagram_username`
  );

  const discoveries = response.data;

  // Calculate engagement metrics
  const totalLikes = discoveries.reduce((sum, d) => sum + (d.like_count || 0), 0);
  const totalComments = discoveries.reduce((sum, d) => sum + (d.comments_count || 0), 0);
  const totalEngagement = totalLikes + totalComments;

  // Engagement by confidence score ranges
  const engagementByConfidence = {
    high: discoveries.filter(d => d.confidence_score >= 80),
    medium: discoveries.filter(d => d.confidence_score >= 60 && d.confidence_score < 80),
    low: discoveries.filter(d => d.confidence_score < 60)
  };

  // Top engaging posts
  const topPosts = discoveries
    .sort((a, b) => ((b.like_count || 0) + (b.comments_count || 0)) - ((a.like_count || 0) + (a.comments_count || 0)))
    .slice(0, 10);

  return {
    summary: {
      totalDiscoveries: discoveries.length,
      totalLikes: totalLikes,
      totalComments: totalComments,
      totalEngagement: totalEngagement,
      avgEngagementPerPost: discoveries.length > 0 ? (totalEngagement / discoveries.length).toFixed(1) : 0
    },
    engagementByConfidence: {
      high: {
        count: engagementByConfidence.high.length,
        avgEngagement: engagementByConfidence.high.length > 0 ?
          (engagementByConfidence.high.reduce((sum, d) => sum + (d.like_count || 0) + (d.comments_count || 0), 0) / engagementByConfidence.high.length).toFixed(1) : 0
      },
      medium: {
        count: engagementByConfidence.medium.length,
        avgEngagement: engagementByConfidence.medium.length > 0 ?
          (engagementByConfidence.medium.reduce((sum, d) => sum + (d.like_count || 0) + (d.comments_count || 0), 0) / engagementByConfidence.medium.length).toFixed(1) : 0
      },
      low: {
        count: engagementByConfidence.low.length,
        avgEngagement: engagementByConfidence.low.length > 0 ?
          (engagementByConfidence.low.reduce((sum, d) => sum + (d.like_count || 0) + (d.comments_count || 0), 0) / engagementByConfidence.low.length).toFixed(1) : 0
      }
    },
    topPosts: topPosts
  };
}

async function getTrendAnalytics(requestData) {
  console.log('📈 Getting trend analytics...');

  const { startDate, endDate } = requestData.filters;

  // Get daily discovery trends
  const response = await makeSupabaseRequest(
    `ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&select=discovered_at,confidence_score,like_count,comments_count&order=discovered_at.asc`
  );

  // Group by day
  const dailyTrends = {};

  response.data.forEach(discovery => {
    const date = discovery.discovered_at.split('T')[0]; // Get YYYY-MM-DD

    if (!dailyTrends[date]) {
      dailyTrends[date] = {
        date: date,
        discoveries: 0,
        totalLikes: 0,
        totalComments: 0,
        avgConfidence: 0,
        confidenceSum: 0
      };
    }

    const trend = dailyTrends[date];
    trend.discoveries++;
    trend.totalLikes += discovery.like_count || 0;
    trend.totalComments += discovery.comments_count || 0;
    trend.confidenceSum += discovery.confidence_score || 0;
  });

  // Calculate averages and convert to array
  const trendsArray = Object.values(dailyTrends).map(trend => ({
    ...trend,
    avgConfidence: trend.discoveries > 0 ? (trend.confidenceSum / trend.discoveries).toFixed(1) : 0,
    totalEngagement: trend.totalLikes + trend.totalComments
  }));

  return {
    dailyTrends: trendsArray,
    summary: {
      totalDays: trendsArray.length,
      avgDiscoveriesPerDay: trendsArray.length > 0 ? (trendsArray.reduce((sum, t) => sum + t.discoveries, 0) / trendsArray.length).toFixed(1) : 0,
      peakDay: trendsArray.length > 0 ? trendsArray.reduce((max, t) => t.discoveries > max.discoveries ? t : max) : null
    }
  };
}

async function exportAnalyticsData(requestData) {
  console.log('📤 Exporting analytics data...');

  const { startDate, endDate } = requestData.filters;

  // Get comprehensive data for export
  const [discoveries, sessions] = await Promise.all([
    makeSupabaseRequest(`ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&select=*&order=discovered_at.desc`),
    makeSupabaseRequest(`sessions?created_at=gte.${startDate}&created_at=lte.${endDate}&select=*&order=created_at.desc`)
  ]);

  return {
    exportMetadata: {
      generatedAt: new Date().toISOString(),
      dateRange: { startDate, endDate },
      recordCounts: {
        discoveries: discoveries.data.length,
        sessions: sessions.data.length
      }
    },
    discoveries: discoveries.data,
    sessions: sessions.data
  };
}

// Helper functions
async function makeSupabaseRequest(endpoint) {
  try {
    const response = await axios.get(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_API_KEY}`,
        'apikey': SUPABASE_API_KEY
      },
      timeout: 15000
    });

    return {
      data: response.data,
      count: response.headers['content-range'] ? parseInt(response.headers['content-range'].split('/')[1]) : response.data.length
    };
  } catch (error) {
    console.error(`❌ Supabase request failed: ${endpoint}`, error.message);
    throw new Error(`Database query failed: ${error.message}`);
  }
}

async function getTotalDiscoveries(startDate, endDate) {
  const response = await makeSupabaseRequest(`ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&select=id&count=exact`);
  return response.count;
}

async function getTotalSessions(startDate, endDate) {
  const response = await makeSupabaseRequest(`sessions?created_at=gte.${startDate}&created_at=lte.${endDate}&select=id&count=exact`);
  return response.count;
}

async function getAverageConfidence(startDate, endDate) {
  const response = await makeSupabaseRequest(`ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&select=confidence_score`);
  const scores = response.data.map(d => d.confidence_score).filter(s => s != null);
  return scores.length > 0 ? (scores.reduce((sum, s) => sum + s, 0) / scores.length).toFixed(1) : 0;
}

async function getTopHashtags(startDate, endDate) {
  const response = await makeSupabaseRequest(`ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&select=source_hashtag`);
  const hashtagCounts = {};

  response.data.forEach(d => {
    const hashtag = d.source_hashtag;
    hashtagCounts[hashtag] = (hashtagCounts[hashtag] || 0) + 1;
  });

  return Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([hashtag, count]) => ({ hashtag, count }));
}

async function getRecentActivity(days) {
  const startDate = getDateDaysAgo(days);
  const response = await makeSupabaseRequest(`ugc_discoveries?discovered_at=gte.${startDate}&select=discovered_at&order=discovered_at.desc&limit=50`);
  return response.data;
}

async function getSessionsWithUGC(startDate, endDate) {
  const response = await makeSupabaseRequest(`sessions?created_at=gte.${startDate}&created_at=lte.${endDate}&ugc_discovered=eq.true&select=id&count=exact`);
  return response.count;
}

async function getHighConfidenceDiscoveries(startDate, endDate) {
  const response = await makeSupabaseRequest(`ugc_discoveries?discovered_at=gte.${startDate}&discovered_at=lte.${endDate}&confidence_score=gte.80&select=id&count=exact`);
  return response.count;
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}