const axios = require('axios');

// Import the main UGC monitor function
const { handler: ugcMonitorHandler } = require('./ugc-monitor');

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('🧪 Manual UGC Monitor Test Started at:', new Date().toISOString());
  console.log('🔧 Test Mode: Enhanced logging and validation enabled');

  // Parse test parameters from event
  const testParams = parseTestParameters(event);
  console.log('📋 Test Parameters:', JSON.stringify(testParams, null, 2));

  // Add test metadata to the event
  const testEvent = {
    ...event,
    isTest: true,
    testId: generateTestId(),
    testStartTime: new Date().toISOString(),
    testParams: testParams
  };

  try {
    // Pre-test validations
    console.log('🔍 Running pre-test validations...');
    const validationResults = await runPreTestValidations();

    if (!validationResults.allPassed) {
      console.warn('⚠️ Some pre-test validations failed, continuing with test...');
    }

    // Execute the main UGC monitoring function
    console.log('🚀 Executing UGC monitor in test mode...');
    const result = await ugcMonitorHandler(testEvent, context);

    const executionTime = Date.now() - startTime;
    console.log(`🧪 Test execution completed in ${executionTime}ms`);

    // Enhanced test result processing
    const testResults = await processTestResults(result, validationResults, executionTime, testParams);

    // Send test completion notification if configured
    if (process.env.MONITORING_ALERT_WEBHOOK && testParams.sendAlert) {
      await sendTestAlert(testResults);
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(testResults)
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error('❌ UGC Monitor test failed:', error);

    const failureResults = {
      success: false,
      testMode: true,
      testId: testEvent.testId,
      error: error.message,
      executionTimeMs: executionTime,
      timestamp: new Date().toISOString(),
      validationResults: await runPreTestValidations().catch(() => ({ allPassed: false, error: 'Validation failed' }))
    };

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(failureResults)
    };
  }
};

function parseTestParameters(event) {
  const defaults = {
    verbose: true,
    sendAlert: false,
    validateOnly: false,
    targetHashtag: null,
    targetSessionId: null
  };

  try {
    // Parse parameters from body, queryStringParameters, or use defaults
    if (event.body) {
      const body = JSON.parse(event.body);
      return { ...defaults, ...body };
    }

    if (event.queryStringParameters) {
      return {
        ...defaults,
        verbose: event.queryStringParameters.verbose === 'true',
        sendAlert: event.queryStringParameters.sendAlert === 'true',
        validateOnly: event.queryStringParameters.validateOnly === 'true',
        targetHashtag: event.queryStringParameters.targetHashtag || null,
        targetSessionId: event.queryStringParameters.targetSessionId || null
      };
    }

    return defaults;
  } catch (error) {
    console.warn('⚠️ Could not parse test parameters, using defaults');
    return defaults;
  }
}

function generateTestId() {
  return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function runPreTestValidations() {
  const validations = {
    allPassed: true,
    checks: {},
    timestamp: new Date().toISOString()
  };

  // Check environment variables
  console.log('🔧 Checking environment variables...');
  const requiredEnvVars = [
    'POSTMYSTYLE_IG_USER_ID',
    'INSTAGRAM_ACCESS_TOKEN',
    'SUPABASE_URL',
    'SUPABASE_API_KEY'
  ];

  validations.checks.environmentVariables = {
    required: requiredEnvVars.length,
    present: 0,
    missing: []
  };

  for (const envVar of requiredEnvVars) {
    if (process.env[envVar]) {
      validations.checks.environmentVariables.present++;
    } else {
      validations.checks.environmentVariables.missing.push(envVar);
      validations.allPassed = false;
    }
  }

  // Test Instagram API connectivity
  console.log('📱 Testing Instagram API connectivity...');
  try {
    const response = await axios.get(`https://graph.facebook.com/v19.0/${process.env.POSTMYSTYLE_IG_USER_ID}`, {
      params: {
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN,
        fields: 'id,username'
      },
      timeout: 10000
    });

    validations.checks.instagramAPI = {
      status: 'connected',
      account: response.data.username,
      accountId: response.data.id
    };
    console.log(`✅ Instagram API connected: @${response.data.username}`);

  } catch (error) {
    validations.checks.instagramAPI = {
      status: 'failed',
      error: error.message
    };
    validations.allPassed = false;
    console.error('❌ Instagram API test failed:', error.message);
  }

  // Test Supabase connectivity
  console.log('🗄️ Testing Supabase connectivity...');
  try {
    const response = await axios.get(
      `${process.env.SUPABASE_URL}/rest/v1/ugc_discoveries?limit=1`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_API_KEY}`,
          'apikey': process.env.SUPABASE_API_KEY
        },
        timeout: 10000
      }
    );

    validations.checks.supabase = {
      status: 'connected',
      responseStatus: response.status
    };
    console.log('✅ Supabase connected successfully');

  } catch (error) {
    validations.checks.supabase = {
      status: 'failed',
      error: error.message
    };
    validations.allPassed = false;
    console.error('❌ Supabase test failed:', error.message);
  }

  // Test hashtag search capability
  console.log('🏷️ Testing hashtag search capability...');
  try {
    const response = await axios.get(`https://graph.facebook.com/v19.0/ig_hashtag_search`, {
      params: {
        access_token: process.env.INSTAGRAM_ACCESS_TOKEN,
        user_id: process.env.POSTMYSTYLE_IG_USER_ID,
        q: 'postmystyle'
      },
      timeout: 10000
    });

    validations.checks.hashtagSearch = {
      status: 'working',
      hashtagsFound: response.data?.data?.length || 0
    };
    console.log(`✅ Hashtag search working: ${response.data?.data?.length || 0} results`);

  } catch (error) {
    validations.checks.hashtagSearch = {
      status: 'failed',
      error: error.message
    };
    validations.allPassed = false;
    console.error('❌ Hashtag search test failed:', error.message);
  }

  return validations;
}

async function processTestResults(result, validationResults, executionTime, testParams) {
  try {
    // Parse the main result
    const mainResult = result.body ? JSON.parse(result.body) : {};

    // Enhanced test-specific analysis
    const testAnalysis = {
      performance: analyzePerformance(mainResult, executionTime),
      dataQuality: analyzeDataQuality(mainResult),
      coverage: analyzeCoverage(mainResult),
      recommendations: generateRecommendations(mainResult, validationResults)
    };

    const testResults = {
      success: result.statusCode === 200,
      testMode: true,
      testId: testParams.testId || 'unknown',
      executionTimeMs: executionTime,
      timestamp: new Date().toISOString(),

      // Main monitoring results
      monitoringResults: mainResult,

      // Test-specific analysis
      testAnalysis: testAnalysis,
      validationResults: validationResults,
      testParameters: testParams,

      // Summary
      summary: {
        overallHealth: calculateOverallHealth(mainResult, validationResults, testAnalysis),
        keyMetrics: {
          newDiscoveries: mainResult.newDiscoveries || 0,
          sessionsCorrelated: mainResult.sessionsCorrelated || 0,
          processingErrorRate: calculateErrorRate(mainResult),
          avgConfidenceScore: calculateAvgConfidence(mainResult)
        }
      }
    };

    console.log('📊 Test Results Summary:');
    console.log(`   Overall Health: ${testResults.summary.overallHealth}`);
    console.log(`   New Discoveries: ${testResults.summary.keyMetrics.newDiscoveries}`);
    console.log(`   Error Rate: ${testResults.summary.keyMetrics.processingErrorRate}%`);
    console.log(`   Avg Confidence: ${testResults.summary.keyMetrics.avgConfidenceScore}%`);

    return testResults;

  } catch (error) {
    console.error('❌ Error processing test results:', error.message);
    return {
      success: false,
      testMode: true,
      error: `Result processing failed: ${error.message}`,
      rawResult: result,
      validationResults: validationResults,
      executionTimeMs: executionTime
    };
  }
}

function analyzePerformance(result, executionTime) {
  return {
    executionTime: executionTime,
    postsPerSecond: result.postsFound ? (result.postsFound / (executionTime / 1000)).toFixed(2) : 0,
    processingEfficiency: result.postsFound ? ((result.postsProcessed / result.postsFound) * 100).toFixed(1) : 0,
    discoveryRate: result.postsProcessed ? ((result.newDiscoveries / result.postsProcessed) * 100).toFixed(1) : 0,
    performanceGrade: executionTime < 30000 ? 'A' : executionTime < 60000 ? 'B' : 'C'
  };
}

function analyzeDataQuality(result) {
  const posts = result.discoveredPosts || [];

  return {
    totalPosts: posts.length,
    highConfidencePosts: posts.filter(p => p.confidenceScore >= 80).length,
    mediumConfidencePosts: posts.filter(p => p.confidenceScore >= 60 && p.confidenceScore < 80).length,
    lowConfidencePosts: posts.filter(p => p.confidenceScore < 60).length,
    postsWithSalonMentions: posts.filter(p => p.salonHandles && p.salonHandles.length > 0).length,
    avgConfidenceScore: posts.length ? (posts.reduce((sum, p) => sum + p.confidenceScore, 0) / posts.length).toFixed(1) : 0
  };
}

function analyzeCoverage(result) {
  return {
    hashtagsSearched: result.hashtagsSearched || 0,
    postsFound: result.postsFound || 0,
    postsProcessed: result.postsProcessed || 0,
    processingCoverage: result.postsFound ? ((result.postsProcessed / result.postsFound) * 100).toFixed(1) : 0,
    errorRate: result.stats ? ((result.stats.processingErrors / (result.postsProcessed + result.stats.processingErrors)) * 100).toFixed(1) : 0
  };
}

function generateRecommendations(result, validationResults) {
  const recommendations = [];

  if (!validationResults.allPassed) {
    recommendations.push({
      type: 'CRITICAL',
      message: 'System validations failed - check environment variables and API connectivity'
    });
  }

  if (result.newDiscoveries === 0) {
    recommendations.push({
      type: 'WARNING',
      message: 'No new UGC discoveries found - verify hashtag usage and posting activity'
    });
  }

  if (result.stats && result.stats.processingErrors > 0) {
    recommendations.push({
      type: 'INFO',
      message: `${result.stats.processingErrors} processing errors occurred - review error logs`
    });
  }

  const avgConfidence = calculateAvgConfidence(result);
  if (avgConfidence < 70) {
    recommendations.push({
      type: 'INFO',
      message: 'Low average confidence score - consider improving session ID formats or caption guidelines'
    });
  }

  if (result.executionTimeMs > 60000) {
    recommendations.push({
      type: 'WARNING',
      message: 'Execution time exceeded 60 seconds - consider optimizing or reducing search scope'
    });
  }

  return recommendations;
}

function calculateOverallHealth(result, validationResults, testAnalysis) {
  if (!validationResults.allPassed) return 'CRITICAL';
  if (result.errors && result.errors.length > 0) return 'WARNING';
  if (testAnalysis.performance.performanceGrade === 'C') return 'WARNING';
  if (result.newDiscoveries > 0) return 'EXCELLENT';
  return 'GOOD';
}

function calculateErrorRate(result) {
  if (!result.stats || !result.postsProcessed) return 0;
  const totalProcessed = result.postsProcessed + (result.stats.processingErrors || 0);
  return totalProcessed ? ((result.stats.processingErrors / totalProcessed) * 100).toFixed(1) : 0;
}

function calculateAvgConfidence(result) {
  const posts = result.discoveredPosts || [];
  if (posts.length === 0) return 0;
  return (posts.reduce((sum, p) => sum + (p.confidenceScore || 0), 0) / posts.length).toFixed(1);
}

async function sendTestAlert(testResults) {
  const webhookUrl = process.env.MONITORING_ALERT_WEBHOOK;

  try {
    const color = testResults.summary.overallHealth === 'EXCELLENT' ? 'good' :
                  testResults.summary.overallHealth === 'GOOD' ? 'good' :
                  testResults.summary.overallHealth === 'WARNING' ? 'warning' : 'danger';

    const message = {
      text: `🧪 PostMyStyle UGC Monitor Test Complete`,
      attachments: [{
        color: color,
        fields: [
          { title: 'Overall Health', value: testResults.summary.overallHealth, short: true },
          { title: 'New Discoveries', value: testResults.summary.keyMetrics.newDiscoveries, short: true },
          { title: 'Execution Time', value: `${testResults.executionTimeMs}ms`, short: true },
          { title: 'Error Rate', value: `${testResults.summary.keyMetrics.processingErrorRate}%`, short: true }
        ],
        footer: `Test ID: ${testResults.testId}`,
        ts: Math.floor(Date.now() / 1000)
      }]
    };

    await axios.post(webhookUrl, message, { timeout: 5000 });
    console.log('📣 Test alert sent');

  } catch (error) {
    console.error('❌ Failed to send test alert:', error.message);
  }
}