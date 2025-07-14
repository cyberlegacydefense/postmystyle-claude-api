const axios = require('axios');

// Environment variables
const CURRENT_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const MONITORING_WEBHOOK = process.env.MONITORING_ALERT_WEBHOOK;

exports.handler = async (event, context) => {
  const startTime = Date.now();
  console.log('🔑 Instagram Token Refresh Service Started');
  console.log('📅 Current time:', new Date().toISOString());

  const result = {
    success: false,
    timestamp: new Date().toISOString(),
    executionTimeMs: 0,
    currentTokenStatus: null,
    newTokenInfo: null,
    expirationInfo: null,
    actions: [],
    warnings: [],
    errors: []
  };

  try {
    // Validate required environment variables
    if (!CURRENT_ACCESS_TOKEN || !FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
      throw new Error('Missing required environment variables: INSTAGRAM_ACCESS_TOKEN, FACEBOOK_APP_ID, or FACEBOOK_APP_SECRET');
    }

    // Step 1: Check current token status
    console.log('🔍 Checking current token status...');
    const tokenStatus = await checkCurrentTokenStatus();
    result.currentTokenStatus = tokenStatus;
    result.actions.push('Checked current token status');

    if (!tokenStatus.isValid) {
      throw new Error(`Current token is invalid: ${tokenStatus.error}`);
    }

    // Step 2: Check token expiration
    console.log('⏰ Checking token expiration...');
    const expirationInfo = await getTokenExpirationInfo();
    result.expirationInfo = expirationInfo;
    result.actions.push('Retrieved token expiration info');

    // Step 3: Determine if refresh is needed
    const refreshNeeded = shouldRefreshToken(expirationInfo);

    if (!refreshNeeded.needed) {
      console.log(`✅ Token refresh not needed: ${refreshNeeded.reason}`);
      result.success = true;
      result.actions.push(`Determined refresh not needed: ${refreshNeeded.reason}`);

      // Add warning if approaching expiration
      if (refreshNeeded.daysTillExpiry < 10) {
        result.warnings.push(`Token expires in ${refreshNeeded.daysTillExpiry} days - consider refreshing soon`);
      }

    } else {
      console.log(`🔄 Token refresh needed: ${refreshNeeded.reason}`);
      result.actions.push(`Determined refresh needed: ${refreshNeeded.reason}`);

      // Step 4: Refresh the token
      const newTokenInfo = await refreshAccessToken();
      result.newTokenInfo = newTokenInfo;
      result.actions.push('Successfully refreshed access token');
      result.success = true;

      // Step 5: Validate the new token
      const newTokenStatus = await validateNewToken(newTokenInfo.accessToken);
      if (!newTokenStatus.isValid) {
        throw new Error(`New token validation failed: ${newTokenStatus.error}`);
      }
      result.actions.push('Validated new token');

      console.log('✅ Token refresh completed successfully');
    }

    // Step 6: Send success notification if configured
    if (MONITORING_WEBHOOK) {
      await sendTokenRefreshNotification(result);
    }

    result.executionTimeMs = Date.now() - startTime;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('❌ Token refresh failed:', error.message);

    result.success = false;
    result.executionTimeMs = Date.now() - startTime;
    result.errors.push({
      message: error.message,
      timestamp: new Date().toISOString(),
      stack: error.stack
    });

    // Send critical failure alert
    if (MONITORING_WEBHOOK) {
      await sendTokenRefreshFailureAlert(error, result);
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(result)
    };
  }
};

async function checkCurrentTokenStatus() {
  try {
    const response = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: {
        access_token: CURRENT_ACCESS_TOKEN,
        fields: 'id,name'
      },
      timeout: 10000
    });

    console.log(`✅ Current token is valid for: ${response.data.name} (ID: ${response.data.id})`);

    return {
      isValid: true,
      accountName: response.data.name,
      accountId: response.data.id,
      checkedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Current token validation failed:', error.message);

    return {
      isValid: false,
      error: error.response?.data?.error?.message || error.message,
      checkedAt: new Date().toISOString()
    };
  }
}

async function getTokenExpirationInfo() {
  try {
    // Use the debug_token endpoint to get token info
    const response = await axios.get('https://graph.facebook.com/v19.0/debug_token', {
      params: {
        input_token: CURRENT_ACCESS_TOKEN,
        access_token: `${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`
      },
      timeout: 10000
    });

    const tokenData = response.data.data;

    const expiresAt = tokenData.expires_at ? new Date(tokenData.expires_at * 1000) : null;
    const issuedAt = tokenData.issued_at ? new Date(tokenData.issued_at * 1000) : null;
    const now = new Date();

    const daysUntilExpiry = expiresAt ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)) : null;

    console.log(`📅 Token expires at: ${expiresAt ? expiresAt.toISOString() : 'Never'}`);
    console.log(`📊 Days until expiry: ${daysUntilExpiry !== null ? daysUntilExpiry : 'N/A'}`);

    return {
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      issuedAt: issuedAt ? issuedAt.toISOString() : null,
      daysUntilExpiry: daysUntilExpiry,
      isLongLived: !tokenData.expires_at || daysUntilExpiry > 30,
      scopes: tokenData.scopes || [],
      appId: tokenData.app_id,
      userId: tokenData.user_id,
      isValid: tokenData.is_valid
    };

  } catch (error) {
    console.error('❌ Failed to get token expiration info:', error.message);

    // Fallback: assume token needs refresh if we can't get info
    return {
      expiresAt: null,
      daysUntilExpiry: null,
      error: error.message,
      fallbackAssumption: 'Token should be refreshed due to inability to check expiration'
    };
  }
}

function shouldRefreshToken(expirationInfo) {
  // If we couldn't get expiration info, refresh to be safe
  if (expirationInfo.error) {
    return {
      needed: true,
      reason: 'Unable to determine expiration, refreshing as precaution'
    };
  }

  // If token doesn't expire (long-lived), still refresh if very old
  if (!expirationInfo.expiresAt) {
    return {
      needed: false,
      reason: 'Token appears to be long-lived with no expiration'
    };
  }

  const daysUntilExpiry = expirationInfo.daysUntilExpiry;

  // Refresh if expiring within 7 days
  if (daysUntilExpiry <= 7) {
    return {
      needed: true,
      reason: `Token expires in ${daysUntilExpiry} days`,
      daysTillExpiry: daysUntilExpiry
    };
  }

  // Don't refresh if plenty of time left
  return {
    needed: false,
    reason: `Token valid for ${daysUntilExpiry} more days`,
    daysTillExpiry: daysUntilExpiry
  };
}

async function refreshAccessToken() {
  try {
    console.log('🔄 Refreshing access token...');

    // Use the existing token to get a new long-lived token
    const response = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        fb_exchange_token: CURRENT_ACCESS_TOKEN
      },
      timeout: 15000
    });

    const newToken = response.data.access_token;
    const expiresIn = response.data.expires_in; // seconds

    const expiresAt = new Date(Date.now() + (expiresIn * 1000));

    console.log('✅ New token generated successfully');
    console.log(`📅 New token expires at: ${expiresAt.toISOString()}`);
    console.log(`⏰ New token valid for: ${Math.ceil(expiresIn / (60 * 60 * 24))} days`);

    return {
      accessToken: newToken,
      expiresIn: expiresIn,
      expiresAt: expiresAt.toISOString(),
      generatedAt: new Date().toISOString(),
      daysValid: Math.ceil(expiresIn / (60 * 60 * 24))
    };

  } catch (error) {
    console.error('❌ Token refresh failed:', error.message);

    if (error.response?.data) {
      console.error('Facebook API Error:', error.response.data);
    }

    throw new Error(`Token refresh failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

async function validateNewToken(newToken) {
  try {
    console.log('🔍 Validating new token...');

    const response = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: {
        access_token: newToken,
        fields: 'id,name'
      },
      timeout: 10000
    });

    console.log(`✅ New token validated for: ${response.data.name}`);

    return {
      isValid: true,
      accountName: response.data.name,
      accountId: response.data.id,
      validatedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ New token validation failed:', error.message);

    return {
      isValid: false,
      error: error.response?.data?.error?.message || error.message,
      validatedAt: new Date().toISOString()
    };
  }
}

async function sendTokenRefreshNotification(result) {
  try {
    const isRefresh = result.newTokenInfo ? true : false;
    const color = result.success ? 'good' : 'warning';

    let title, message;
    if (isRefresh) {
      title = '🔑 Instagram Token Refreshed Successfully';
      message = `New token generated, valid for ${result.newTokenInfo.daysValid} days`;
    } else {
      title = '✅ Instagram Token Status Check';
      message = `Current token valid for ${result.expirationInfo?.daysUntilExpiry || 'unknown'} more days`;
    }

    const notification = {
      text: title,
      attachments: [{
        color: color,
        fields: [
          { title: 'Status', value: result.success ? 'Success' : 'Failed', short: true },
          { title: 'Action', value: isRefresh ? 'Token Refreshed' : 'Status Check', short: true },
          { title: 'Days Until Expiry', value: result.expirationInfo?.daysUntilExpiry || 'Unknown', short: true },
          { title: 'Execution Time', value: `${result.executionTimeMs}ms`, short: true }
        ],
        footer: 'PostMyStyle Token Management',
        ts: Math.floor(Date.now() / 1000)
      }]
    };

    if (isRefresh && result.newTokenInfo) {
      notification.attachments[0].fields.push({
        title: 'New Token Info',
        value: `Generated: ${result.newTokenInfo.generatedAt}\nExpires: ${result.newTokenInfo.expiresAt}`,
        short: false
      });

      notification.attachments[0].fields.push({
        title: '⚠️ Action Required',
        value: 'Update INSTAGRAM_ACCESS_TOKEN environment variable with the new token',
        short: false
      });
    }

    await axios.post(MONITORING_WEBHOOK, notification, { timeout: 5000 });
    console.log('📣 Token refresh notification sent');

  } catch (error) {
    console.error('❌ Failed to send token refresh notification:', error.message);
  }
}

async function sendTokenRefreshFailureAlert(error, result) {
  try {
    const alert = {
      text: '🚨 Instagram Token Refresh FAILED',
      attachments: [{
        color: 'danger',
        fields: [
          { title: 'Error', value: error.message, short: false },
          { title: 'Current Token Status', value: result.currentTokenStatus?.isValid ? 'Valid' : 'Invalid', short: true },
          { title: 'Days Until Expiry', value: result.expirationInfo?.daysUntilExpiry || 'Unknown', short: true },
          { title: 'Execution Time', value: `${result.executionTimeMs}ms`, short: true },
          {
            title: '⚠️ Immediate Action Required',
            value: 'Instagram UGC monitoring may stop working when current token expires. Manual token refresh needed.',
            short: false
          }
        ],
        footer: 'PostMyStyle Token Management - CRITICAL',
        ts: Math.floor(Date.now() / 1000)
      }]
    };

    await axios.post(MONITORING_WEBHOOK, alert, { timeout: 5000 });
    console.log('📣 Critical token refresh failure alert sent');

  } catch (alertError) {
    console.error('❌ Failed to send token refresh failure alert:', alertError.message);
  }
}